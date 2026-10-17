"""Persisted, bounded workflow jobs with an outbox, leases and Cloud Tasks dispatch.

External operations are never performed in a transaction callback. A restarted job
reuses stable proposal IDs and reconciles approved effects instead of replaying them.
"""

import base64
from datetime import timedelta
from hashlib import sha256

from app.auth import Caller, MemberContext
from app.errors import error
from app.util import iso, now, new_id


class Workflows:
    def __init__(self, engine):
        self.engine, self.store = engine, engine.store

    def enqueue(self, tx, ctx, meeting_id, kind):
        jid = sha256(f"{ctx.workspace_id}:{meeting_id}:{kind}".encode()).hexdigest()[
            :40
        ]
        if not tx.get("workflowJobs/" + jid):
            tx.set(
                "workflowJobs/" + jid,
                {
                    "workspaceId": ctx.workspace_id,
                    "owner": ctx.member_id,
                    "uid": ctx.uid,
                    "meetingId": meeting_id,
                    "kind": kind,
                    "state": "queued",
                    "attempt": 1,
                    "dispatch": "pending",
                    "createdAt": iso(),
                    "deadline": (now() + timedelta(minutes=30)).isoformat(),
                },
            )
        return jid

    async def dispatch(self, jid):
        import asyncio

        if self.engine.settings.dev_mode or not self.engine.settings.task_queue:
            if self.engine.settings.dev_mode:
                await self.run(jid)
            return
        await asyncio.to_thread(self._dispatch_cloud, jid)

    def _dispatch_cloud(self, jid):
        job = self.store.get("workflowJobs/" + jid)
        if not job or job["state"] != "queued" or job.get("dispatch") == "sent":
            return
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        settings = self.engine.settings
        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        queue = f"projects/{settings.project}/locations/{settings.region}/queues/{settings.task_queue}"
        task = {
            "name": f"{queue}/tasks/alter-{jid}-{job.get('generation', 0)}-{job['attempt']}",
            "dispatchDeadline": "240s",
            "httpRequest": {
                "httpMethod": "POST",
                "url": settings.service_url.rstrip("/") + "/internal/workflows/" + jid,
                "headers": {"Content-Type": "application/json"},
                "body": base64.b64encode(b"{}").decode(),
                "oidcToken": {
                    "serviceAccountEmail": settings.task_service_account,
                    "audience": settings.service_url,
                },
            },
        }
        response = AuthorizedSession(credentials).post(
            "https://cloudtasks.googleapis.com/v2/" + queue + "/tasks",
            json={"task": task},
            timeout=15,
        )
        if response.status_code not in (200, 409):
            raise error(
                503,
                "QUEUE_UNAVAILABLE",
                "Work is saved. Background dispatch will be retried.",
            )

        def finish(tx):
            current = tx.get("workflowJobs/" + jid)
            if (
                current
                and current["attempt"] == job["attempt"]
                and current.get("generation", 0) == job.get("generation", 0)
            ):
                tx.set(
                    "workflowJobs/" + jid,
                    {**current, "dispatch": "sent", "dispatchedAt": iso()},
                )

        self.store.atomic(finish)

    async def run(self, jid):
        token = new_id("lease_")

        def claim(tx):
            job = tx.get("workflowJobs/" + jid)
            if not job or job["state"] in (
                "completed",
                "cancelled",
                "failed",
                "paused",
            ):
                return None
            if job.get("leaseUntil", "") > iso():
                raise error(409, "JOB_BUSY", "This workflow is already running.")
            workspace = tx.get(f"workspaces/{job['workspaceId']}")
            if (
                not workspace
                or workspace["expiresAt"] <= iso()
                or workspace.get("state") != "ready"
            ):
                tx.set("workflowJobs/" + jid, {**job, "state": "cancelled"})
                return None
            updated = {
                **job,
                "state": "running",
                "lease": token,
                "leaseUntil": (now() + timedelta(minutes=5)).isoformat(),
            }
            tx.set("workflowJobs/" + jid, updated)
            return updated

        job = self.store.atomic(claim)
        if not job:
            return {"accepted": True}
        ctx = MemberContext(
            job["uid"], job["workspaceId"], job["owner"], Caller(job["uid"])
        )
        try:
            current_member = self.engine.auth.member(ctx.caller)
            if (current_member.workspace_id, current_member.member_id) != (
                ctx.workspace_id,
                ctx.member_id,
            ):
                raise error(403, "MEMBERSHIP_CHANGED", "Workflow membership changed.")
            self.check(jid, token)
            import asyncio

            if job["kind"] == "extract":
                await asyncio.to_thread(
                    self.engine.meetings.extract, ctx, job["meetingId"], jid, token
                )
            elif job["kind"] == "apply":
                next_job = await asyncio.to_thread(
                    self.engine.meetings.apply_bundle, ctx, job["meetingId"], jid, token
                )
            elif job["kind"] == "continue":
                await self.engine.meetings.continue_work(
                    ctx, job["meetingId"], jid, token
                )
            self.check(jid, token)

            def complete(tx):
                current = tx.get("workflowJobs/" + jid)
                if current.get("lease") == token and current["state"] == "running":
                    tx.set(
                        "workflowJobs/" + jid,
                        {
                            **current,
                            "state": "completed",
                            "leaseUntil": "",
                            "finishedAt": iso(),
                        },
                    )

            self.store.atomic(complete)
            if job["kind"] == "apply" and next_job:
                await self.dispatch(next_job)
        except Exception:

            def fail(tx):
                current = tx.get("workflowJobs/" + jid)
                if (
                    current
                    and current.get("lease") == token
                    and current["state"] == "running"
                ):
                    tx.set(
                        "workflowJobs/" + jid,
                        {
                            **current,
                            "state": "failed",
                            "leaseUntil": "",
                            "reason": "Work paused before completion. Review its current results before retrying.",
                        },
                    )

            self.store.atomic(fail)
            current = self.store.get("workflowJobs/" + jid)
            if (
                current
                and current["state"] == "failed"
                and self.store.get(
                    f"workspaces/{ctx.workspace_id}/meetings/{job['meetingId']}"
                )
            ):
                self.engine.meetings.failed(ctx, job["meetingId"])
        finally:

            def release(tx):
                current = tx.get("workflowJobs/" + jid)
                if current and current.get("lease") == token:
                    tx.set("workflowJobs/" + jid, {**current, "leaseUntil": ""})

            self.store.atomic(release)
            await asyncio.to_thread(self.engine.notifications.deliver, ctx.workspace_id)
        return {"accepted": True}

    def check(self, jid, token):
        job = self.store.get("workflowJobs/" + jid)
        if (
            not job
            or job["state"] != "running"
            or job.get("lease") != token
            or job["leaseUntil"] <= iso()
            or job.get("deadline", "9999") <= iso()
            or job.get("attempt", 1) > 5
        ):
            raise error(
                409, "JOB_STOPPED", "The workflow stopped or its lease expired."
            )

    def fence(self, tx, jid, token):
        job = tx.get("workflowJobs/" + jid)
        if (
            not job
            or job["state"] != "running"
            or job.get("lease") != token
            or job["leaseUntil"] <= iso()
            or job.get("deadline", "9999") <= iso()
            or job.get("attempt", 1) > 5
        ):
            raise error(
                409, "JOB_STOPPED", "The workflow stopped before checkpointing."
            )

    async def reconcile(self):
        for job in self.store.list("workflowJobs"):
            if job["state"] in ("queued", "running") and (
                job.get("deadline", "9999") <= iso() or job["attempt"] > 5
            ):
                self.store.set(
                    "workflowJobs/" + job["id"],
                    {
                        **job,
                        "state": "failed",
                        "leaseUntil": "",
                        "reason": "The workflow reached its execution deadline or retry limit.",
                    },
                )
                ctx = MemberContext(
                    job["uid"], job["workspaceId"], job["owner"], Caller(job["uid"])
                )
                if self.store.get(
                    f"workspaces/{job['workspaceId']}/meetings/{job['meetingId']}"
                ):
                    self.engine.meetings.failed(ctx, job["meetingId"])
                continue
            if (
                job["state"] == "queued"
                and job.get("dispatch") == "sent"
                and job.get("dispatchedAt", "9999")
                < (now() - timedelta(minutes=6)).isoformat()
            ):
                self.store.set(
                    "workflowJobs/" + job["id"],
                    {**job, "attempt": job["attempt"] + 1, "dispatch": "pending"},
                )
            if job["state"] == "running" and job.get("leaseUntil", "") <= iso():

                def release(tx):
                    current = tx.get("workflowJobs/" + job["id"])
                    if (
                        current["state"] == "running"
                        and current.get("leaseUntil", "") <= iso()
                    ):
                        tx.set(
                            "workflowJobs/" + job["id"],
                            {
                                **current,
                                "state": "queued",
                                "attempt": current["attempt"] + 1,
                                "dispatch": "pending",
                            },
                        )

                self.store.atomic(release)
            latest = self.store.get("workflowJobs/" + job["id"])
            if latest["state"] == "queued":
                try:
                    await self.dispatch(job["id"])
                except Exception:
                    pass  # The durable outbox remains queued for the next reconciliation.
