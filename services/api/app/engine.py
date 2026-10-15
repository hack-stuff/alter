"""Application orchestration. Identity and write authority never come from the model."""

from functools import cached_property
from datetime import timedelta
import asyncio, hmac, re, secrets
from fastapi import HTTPException

from app.config import Settings
from app.store import SQLiteStore, FirestoreStore
from app.auth import Authentication, Caller, MemberContext
from app.secrets import Secrets
from app.errors import error
from app.util import new_id, iso, now, identifier
from app.rate_limits import take
from app.receipts import record
from app.workspaces.provision import Workspaces
from app.approvals.propose import Proposals
from app.approvals.apply import Application
from app.policy.gate import Rule, enforce
from app.policy.intents import classify


class Engine:
    def __init__(
        self, settings: Settings, store=None, apps=None, brain=None, verifier=None
    ):
        self.settings = settings
        self.store = store or (
            SQLiteStore(settings.database_path)
            if settings.store_backend == "sqlite"
            else FirestoreStore(settings.project)
        )
        self.secrets = Secrets(allow_local=settings.dev_mode)
        self.auth = Authentication(settings, self.store, verifier)
        if apps:
            self.apps = apps
        elif settings.google_backend == "local":
            from app.google.local import LocalApps

            self.apps = LocalApps(self.store, settings)
        else:
            from app.google.apps import GoogleApps

            self.apps = GoogleApps(self.store, settings, self.secrets)
        self.workspaces = Workspaces(self.store, settings, self.apps)
        self.proposals = Proposals(self.store, self.apps)
        self.proposals.engine = self
        self.application = Application(self.store, self.apps, self.proposals)
        if brain:
            self.brain = brain
        elif settings.ai_backend == "local":
            from app.alters.brain import LocalBrain

            self.brain = LocalBrain(self)
        else:
            from app.alters.brain import VertexBrain

            self.brain = VertexBrain(self)
        from app.a2a.client import A2ATransport

        self.transport = A2ATransport(self)
        self.jobs = set()
        from app.meetings import Meetings
        from app.workflows import Workflows
        from app.notifications import Notifications

        self.meetings = Meetings(self)
        self.workflows = Workflows(self)
        self.notifications = Notifications(self)
        from app.plans import Plans

        self.plans = Plans(self)
        self.injected = (
            store is not None
            or apps is not None
            or brain is not None
            or verifier is not None
        )

    @cached_property
    def hmac_secret(self):
        return self.settings.a2a_secret or (
            self.secrets.read(self.settings.a2a_secret_name)
            if self.settings.a2a_secret_name
            else secrets.token_hex(32)
            if self.settings.dev_mode
            else self.secrets.read("")
        )

    @cached_property
    def model_client(self):
        from google import genai

        return genai.Client(
            vertexai=True,
            project=self.settings.project,
            location=self.settings.model_location,
            http_options={
                "timeout": self.settings.model_timeout_ms,
                "retry_options": {
                    "attempts": 2,
                    "initial_delay": 1,
                    "max_delay": 2,
                    "http_status_codes": [429, 500, 502, 503, 504],
                },
            },
        )

    def require_ready(self):
        if not self.injected and self.settings.missing():
            raise error(
                503,
                "NOT_CONFIGURED",
                "The service is not configured. Please contact the workspace administrator.",
            )

    def charge(self, wid):
        self.store.atomic(lambda tx: take(tx, f"models:{wid}", 60))

    def me(self, ctx):
        value = self.store.get(f"workspaces/{ctx.workspace_id}/members/{ctx.member_id}")
        return {
            **value,
            "workspaceId": ctx.workspace_id,
            "memberId": ctx.member_id,
            "slot": value.get("slot", "seeded"),
        }

    def update_me(self, ctx, update):
        email = update.get("email")
        if (
            email is not None
            and email
            and not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", email)
        ):
            raise error(422, "INVALID_EMAIL", "Enter a valid email address.")

        def save(tx):
            path = f"workspaces/{ctx.workspace_id}/members/{ctx.member_id}"
            value = tx.get(path)
            result = {**value, **update}
            if update.get("status") == "away":
                result["awaySince"] = iso()
            elif update.get("status") == "available":
                result["digestSince"] = value.get(
                    "awaySince", value.get("lastSeenAt", value.get("joinedAt", iso()))
                )
                result["lastSeenAt"] = iso()
            if email is not None:
                result["emailVerified"] = bool(
                    ctx.caller.email_verified
                    and ctx.caller.email.casefold() == email.casefold()
                )
            tx.set(path, result)
            return result

        return self.store.atomic(save)

    def guidance_sources(self, ctx, source_ids, audience):
        versions = {}
        for sid in source_ids:
            source = self.store.get(f"workspaces/{ctx.workspace_id}/sources/{sid}")
            if (
                not source
                or source.get("status", "active") != "active"
                or (
                    source.get("owner") != ctx.member_id
                    and source.get("audience") != "team"
                )
            ):
                raise error(
                    403, "SOURCE_DENIED", "Choose an accessible current source."
                )
            if audience == "team" and source.get("audience") != "team":
                raise error(
                    403,
                    "SOURCE_DENIED",
                    "Private source guidance cannot be shared with the team.",
                )
            versions[sid] = source.get("version", 1)
        return versions

    def teach(
        self, ctx, content, audience="team", applies_to="Login revamp", source_ids=()
    ):
        source_versions = self.guidance_sources(ctx, source_ids, audience)
        self.charge(ctx.workspace_id)
        fact = self.brain.planner(ctx).atomic_memory(content)
        if not fact["content"].strip() or len(fact["content"]) > 10000:
            raise error(422, "INVALID_MEMORY", "Enter one concise fact.")
        mid = new_id("mem_")
        memory = {
            "owner": ctx.member_id,
            "content": fact["content"],
            "scope": fact["scope"],
            "state": "proposed",
            "source": "taught",
            "audience": "owner" if fact["scope"] == "personal" else audience,
            "appliesTo": applies_to,
            "version": 1,
            "createdAt": iso(),
            "evidence": {
                "type": "explicit_owner_guidance",
                "by": ctx.member_id,
                "text": content,
            },
            "sourceIds": list(source_ids),
            "sourceVersions": source_versions,
        }
        self.store.set(f"workspaces/{ctx.workspace_id}/memories/{mid}", memory)
        return {**memory, "id": mid}

    def memory_decision(self, ctx, mid, decision):
        def save(tx):
            path = f"workspaces/{ctx.workspace_id}/memories/{mid}"
            value = tx.get(path)
            if not value:
                raise error(404, "NOT_FOUND", "No such memory.")
            if value["owner"] != ctx.member_id:
                raise error(403, "FORBIDDEN", "Only the owner can decide this memory.")
            state = "approved" if decision == "approve" else "revoked"
            if decision == "approve":
                for sid, version in value.get("sourceVersions", {}).items():
                    source = tx.get(f"workspaces/{ctx.workspace_id}/sources/{sid}")
                    if (
                        not source
                        or source.get("status", "active") != "active"
                        or source.get("version", 1) != version
                    ):
                        raise error(
                            409,
                            "SOURCE_CHANGED",
                            "A supporting source changed. Edit and review this guidance again.",
                        )
            tx.set(
                path,
                {
                    **value,
                    "state": state,
                    "decidedBy": ctx.member_id,
                    "decidedAt": iso(),
                },
            )
            member_path = f"workspaces/{ctx.workspace_id}/members/{ctx.member_id}"
            member = tx.get(member_path)
            tx.set(
                member_path, {**member, "memoryEpoch": member.get("memoryEpoch", 0) + 1}
            )
            return {"id": mid, "state": state}

        return self.store.atomic(save)

    def update_rule(self, ctx, rid, mode):
        def save(tx):
            path = f"workspaces/{ctx.workspace_id}/rules/{ctx.member_id}/items/{rid}"
            value = tx.get(path)
            if not value:
                raise error(
                    404,
                    "NOT_FOUND",
                    "No such owner rule. Organization rules cannot be changed.",
                )
            tx.set(path, {**value, "mode": mode})
            return {"id": rid, "mode": mode}

        return self.store.atomic(save)

    def escalate(
        self, wid, owner, asker, question, context, commitment=False, event_key=None
    ):
        from hashlib import sha256

        eid = (
            "esc_" + sha256(f"{event_key}:{owner}".encode()).hexdigest()[:32]
            if event_key
            else new_id("esc_")
        )
        if commitment:
            context += " A clear date confirmation authorizes updating the status document with that commitment."
        item = {
            "owner": owner,
            "fromAlter": asker,
            "askedBy": asker,
            "question": question,
            "context": context,
            "state": "pending",
            "createdAt": iso(),
        }
        if commitment:
            item["effectDescription"] = (
                "A clear date confirmation will update the status document and notify the requester."
            )
        if event_key:
            item["meetingId"] = event_key

        def save(tx):
            existing = tx.get(f"workspaces/{wid}/escalations/{eid}")
            if existing:
                return {"id": eid, **existing}
            tx.set(f"workspaces/{wid}/escalations/{eid}", item)
            record(
                tx,
                wid,
                asker,
                "escalated",
                "A teammate needs your decision: " + question[:120],
                [owner, asker],
                rule="owner-decision",
                outcome="ask",
            )
            return {"id": eid, **item}

        result = self.store.atomic(save)
        self.notifications.publish(
            wid,
            owner,
            eid,
            "Priority · your decision is needed",
            question,
            "?decision=" + eid,
        )
        return result

    async def ask_core(self, ctx, target, question, trace_id):
        root = f"workspaces/{ctx.workspace_id}"
        members = {m["id"]: m for m in self.store.list(root + "/members")}
        if target not in members:
            raise error(404, "NOT_FOUND", "No such teammate.")
        if ctx.member_id not in members:
            raise error(403, "FORBIDDEN", "Workspace membership is required.")
        self.charge(ctx.workspace_id)
        model = self.model_client if self.settings.ai_backend == "vertex" else None
        intent = await asyncio.to_thread(
            classify, question, model, self.settings.model_fast
        )
        rules = [
            Rule(r["id"], r["label"], tuple(r["intents"]), r["mode"])
            for r in self.store.list(root + f"/rules/{target}/items")
        ]
        decision = enforce(rules, set(members), ctx.member_id, target, intent)
        trace = {
            "from": ctx.member_id,
            "to": target,
            "request": question,
            "policyChecks": [
                {
                    "rule": decision.rule_id,
                    "label": decision.reason,
                    "outcome": decision.outcome,
                }
            ],
            "sources": [],
            "answer": "",
            "outcome": decision.outcome,
            "steps": [
                f"Your Alter → {members[target]['name']}’s Alter",
                "Sharing rules checked",
            ],
            "createdAt": iso(),
        }
        self.store.set(root + "/a2aTraces/" + trace_id, trace)
        if self.settings.trace_delay:
            await asyncio.sleep(self.settings.trace_delay)
        escalation = None
        if decision.outcome == "deny":
            result = {
                "answer": f"I can’t share that. It is outside what {members[target]['name']} allows me to share.",
                "citations": [],
            }
        elif decision.outcome == "ask":
            escalation = self.escalate(
                ctx.workspace_id,
                target,
                ctx.member_id,
                question,
                f"{members[target]['name']} must make this decision. Current status: {members[target]['status'].replace('_', ' ')}.",
                intent == "request_commitment",
            )
            result = {
                "answer": f"That needs {members[target]['name']}’s decision. I have asked them; their current status is {members[target]['status'].replace('_', ' ')}.",
                "citations": [],
            }
        else:
            result = await self.brain.answer(
                ctx,
                {**members[target], "_allowPersonal": intent == "request_personal"},
                question,
            )
        if decision.outcome == "allow" and (
            not result["citations"] or result.get("escalationId")
        ):
            escalation = (
                {"id": result["escalationId"]}
                if result.get("escalationId")
                else self.escalate(
                    ctx.workspace_id,
                    target,
                    ctx.member_id,
                    question,
                    "The Alter has no evidence for this question.",
                )
            )
            result = {
                "answer": "I don’t have evidence for that. I have asked the owner.",
                "citations": [],
            }
            trace["outcome"] = "ask"
        trace.update(
            answer=result["answer"],
            sources=result["citations"],
            steps=trace["steps"]
            + [
                (
                    "Answer returned with sources"
                    if result["citations"]
                    else "Decision requested from the owner"
                    if escalation
                    else "Private information kept private"
                )
            ],
        )
        rid = new_id("rcp_")

        def finish(tx):
            tx.set(root + "/a2aTraces/" + trace_id, trace)
            record(
                tx,
                ctx.workspace_id,
                target,
                "answered"
                if trace["outcome"] == "allow"
                else "escalated"
                if escalation
                else "denied",
                f"{members[target]['name']}’s Alter answered: {question[:120]}",
                [ctx.member_id, target],
                rule=decision.rule_id,
                outcome=trace["outcome"],
                sources=result["citations"],
                receipt_id=rid,
            )

        self.store.atomic(finish)
        return {
            "alter": target,
            "asker": ctx.member_id,
            "question": question,
            "outcome": trace["outcome"],
            **result,
            "traceId": trace_id,
            "receiptId": rid,
            **({"escalationId": escalation["id"]} if escalation else {}),
        }

    async def hop(self, ctx, target, question):
        identifier(target)
        return await self.transport.ask(ctx, target, question, new_id("trc_"))

    def event(self, ctx, cid, label, kind="thinking"):
        self.store.set(
            f"workspaces/{ctx.workspace_id}/conversations/{cid}/events/{new_id('evt_')}",
            {"kind": kind, "label": label, "ts": iso()},
        )

    async def chat(self, ctx, message, cid=None):
        supplied = cid is not None
        cid = cid or new_id("conv_")

        def begin(tx):
            root = f"workspaces/{ctx.workspace_id}/conversations/{cid}"
            current = tx.get(root)
            if supplied and not current:
                raise error(404, "NOT_FOUND", "No such conversation.")
            if current and current["owner"] != ctx.member_id:
                raise error(
                    403, "FORBIDDEN", "This conversation belongs to another member."
                )
            take(tx, f"chat:{ctx.workspace_id}:{ctx.member_id}", 60)
            tx.set(
                root,
                {
                    "owner": ctx.member_id,
                    "title": (current or {}).get("title", message[:80]),
                    "updatedAt": iso(),
                },
            )
            tx.set(
                root + "/messages/" + new_id("msg_"),
                {
                    "from": "human",
                    "text": message,
                    "citations": [],
                    "approvalIds": [],
                    "traceIds": [],
                    "ts": iso(),
                },
            )

        self.store.atomic(begin)
        self.charge(ctx.workspace_id)
        self.event(ctx, cid, "Checking your knowledge and workspace…")
        try:
            from dataclasses import replace

            reply = await self.brain.chat(replace(ctx, conversation_id=cid), message)
        except HTTPException:
            raise
        except Exception as exc:
            from app.diagnostics import report_agent_failure

            reference = report_agent_failure(exc, self.settings)
            message = (
                "The model took too long. Please retry your question."
                if getattr(exc, "code", None) == 504 or isinstance(exc, TimeoutError)
                else "Your Alter could not complete that request. Please try again."
            )
            raise error(
                503,
                "AGENT_UNAVAILABLE",
                f"{message} Reference: {reference}",
            ) from None
        result = {"from": "alter", **reply, "ts": iso()}

        def finish(tx):
            tx.set(
                f"workspaces/{ctx.workspace_id}/conversations/{cid}/messages/{new_id('msg_')}",
                result,
            )
            record(
                tx,
                ctx.workspace_id,
                ctx.member_id,
                "chat",
                "Your Alter responded to your request.",
                [ctx.member_id],
                sources=reply["citations"],
            )

        self.store.atomic(finish)
        self.event(
            ctx,
            cid,
            "Ready for your review." if reply["approvalIds"] else "Answer ready.",
            "approval" if reply["approvalIds"] else "thinking",
        )
        return {"conversationId": cid, "reply": result}

    def respond(self, ctx, eid, text):
        root = f"workspaces/{ctx.workspace_id}"
        token = new_id()

        def reserve(tx):
            item = tx.get(root + "/escalations/" + eid)
            if not item:
                raise error(404, "NOT_FOUND", "No such question.")
            if item["owner"] != ctx.member_id:
                raise error(403, "FORBIDDEN", "Only the requested owner may answer.")
            member = tx.get(root + "/members/" + ctx.member_id)
            workspace = tx.get(root)
            if member["kind"] == "seeded" and not workspace.get("director"):
                raise error(
                    403, "FORBIDDEN", "Seeded owners answer only in director mode."
                )
            if item["state"] != "pending" or (
                item.get("processing")
                and item.get("processingAt", "9999")
                > (now() - timedelta(minutes=10)).isoformat()
            ):
                raise error(
                    409,
                    "ALREADY_DECIDED",
                    "This question is no longer awaiting a reply.",
                )
            if item.get("effectReply") and item["effectReply"] != text:
                raise error(
                    409,
                    "EFFECT_PENDING",
                    "The earlier reply is already associated with a change. Submit that same reply to retrieve its result.",
                )
            tx.set(
                root + "/escalations/" + eid,
                {**item, "processing": token, "processingAt": iso()},
            )
            return item

        item = self.store.atomic(reserve)
        applied = []
        from app.escalations import date_decision

        decision = date_decision(text) if item.get("effectDescription") else None
        try:
            if decision:
                workspace = self.store.get(root)
                current = self.apps.read_doc(
                    ctx.workspace_id, workspace["googleIds"]["statusDoc"]
                )
                member = self.store.get(root + "/members/" + ctx.member_id)
                content = [dict(section) for section in current["sections"]]
                launch = next(
                    (
                        section
                        for section in content
                        if section["section"].casefold() == "launch"
                    ),
                    None,
                )
                line = (
                    f"Launch date: {decision['date']} · confirmed by {member['name']}."
                )
                if launch:
                    launch["lines"] = [line]
                else:
                    content.append({"section": "Launch", "lines": [line]})
                if item.get("effectApprovalId"):
                    card = self.proposals.owned(ctx, item["effectApprovalId"])
                else:
                    card = self.proposals.create(
                        ctx,
                        "doc_edit",
                        {
                            "document": "statusDoc",
                            "title": "Confirmed owner commitment",
                            "sections": content,
                            "baseRevision": current["revision"],
                        },
                        "The owner explicitly confirmed this date in their reply.",
                    )

                    def remember(tx):
                        pending = tx.get(root + "/escalations/" + eid)
                        tx.set(
                            root + "/escalations/" + eid,
                            {
                                **pending,
                                "effectApprovalId": card["id"],
                                "effectDecision": decision,
                                "effectReply": text,
                            },
                        )

                    self.store.atomic(remember)
                result = (
                    self.application.decide(
                        ctx, card["id"], "approve", card["revision"]
                    )
                    if card["state"] == "proposed"
                    else card
                )
                if result["state"] == "applied":
                    applied = [card["id"]]
                decision = item.get("effectDecision", decision)
            actual = decision or {"type": "free_text", "text": text}
            meeting = (
                self.store.get(root + "/meetings/" + item["meetingId"])
                if item.get("meetingId")
                else None
            )
            recipients = list(
                dict.fromkeys(
                    [item["askedBy"], *(meeting or {}).get("participants", [])]
                )
            )
            effect_state = "applied" if applied else "failed" if decision else "none"

            def finish(tx):
                current = tx.get(root + "/escalations/" + eid)
                tx.set(
                    root + "/escalations/" + eid,
                    {
                        k: v
                        for k, v in {
                            **current,
                            "state": "answered",
                            "response": text,
                            "decision": actual,
                            "effectState": effect_state,
                            "notifiedMembers": recipients
                            if effect_state != "failed"
                            else [],
                        }.items()
                        if k != "processing"
                    },
                )
                record(
                    tx,
                    ctx.workspace_id,
                    ctx.member_id,
                    "answered",
                    "The owner replied: " + text[:120],
                    list(dict.fromkeys([ctx.member_id, *recipients])),
                    rule="explicit-owner-decision",
                    approved_by=ctx.member_id,
                )
                if decision:
                    tx.set(
                        root + "/decisions/launch_" + eid,
                        {
                            "owner": ctx.member_id,
                            "type": "launch",
                            "date": decision["date"],
                            "status": "confirmed",
                            "effectState": effect_state,
                            "escalationId": eid,
                            "source": {"type": "owner_confirmation", "text": text},
                            "confirmedAt": iso(),
                        },
                    )
                if effect_state != "failed":
                    for recipient in recipients:
                        if recipient != ctx.member_id:
                            tx.set(
                                root + f"/inbox/{recipient}/messages/{eid}",
                                {
                                    "from": ctx.member_id,
                                    "subject": "Launch date confirmed"
                                    if decision
                                    else "Owner reply",
                                    "body": text,
                                    "ts": iso(),
                                    "escalationId": eid,
                                },
                            )
                if meeting and effect_state == "applied":
                    tx.set(
                        root + "/meetings/" + item["meetingId"],
                        {
                            **meeting,
                            "launchDecision": actual,
                            "launchState": "confirmed",
                        },
                    )

            self.store.atomic(finish)
            if effect_state != "failed":
                for recipient in recipients:
                    if recipient != ctx.member_id:
                        self.notifications.publish(
                            ctx.workspace_id,
                            recipient,
                            eid + ":answered",
                            "Rahul confirmed the launch date"
                            if decision
                            else "A teammate replied",
                            text,
                            "?meeting=" + item["meetingId"]
                            if meeting and recipient == meeting["owner"]
                            else "?view=files",
                        )
            return {"decision": actual, "applied": applied, "effectState": effect_state}
        except Exception:

            def release(tx):
                current = tx.get(root + "/escalations/" + eid)
                if current and current.get("processing") == token:
                    tx.set(
                        root + "/escalations/" + eid,
                        {k: v for k, v in current.items() if k != "processing"},
                    )

            self.store.atomic(release)
            raise

    def claim(self, caller, wid, mid, key):
        expected = self.settings.director_key or (
            self.secrets.read(self.settings.director_secret_name)
            if self.settings.director_secret_name
            else ""
        )
        if not expected or not hmac.compare_digest(key, expected):
            raise error(403, "FORBIDDEN", "Director access denied.")

        def bind(tx):
            root = f"workspaces/{wid}"
            workspace = tx.get(root)
            member = tx.get(root + "/members/" + mid)
            if (
                not workspace
                or not workspace.get("director")
                or workspace["expiresAt"] <= iso()
                or not member
                or member["kind"] != "seeded"
            ):
                raise error(403, "FORBIDDEN", "This is not a valid video role.")
            if member.get("uid") and member["uid"] != caller.uid:
                raise error(409, "ROLE_IN_USE", "That video role is already claimed.")
            previous = tx.get(f"userBindings/{caller.uid}")
            if previous and (previous["workspaceId"], previous["memberId"]) != (
                wid,
                mid,
            ):
                old_path = f"workspaces/{previous['workspaceId']}/members/{previous['memberId']}"
                old = tx.get(old_path)
                if old:
                    tx.set(old_path, {k: v for k, v in old.items() if k != "uid"})
            tx.set(root + "/members/" + mid, {**member, "uid": caller.uid})
            tx.set(f"userBindings/{caller.uid}", {"workspaceId": wid, "memberId": mid})
            return {
                "workspaceId": wid,
                "memberId": mid,
                "slot": member.get("slot", "seeded"),
                "inviteUrl": self.settings.public_origin.rstrip("/")
                + "/join/"
                + workspace["inviteCode"],
            }

        return self.store.atomic(bind)

    def snapshot(self, ctx):
        root = f"workspaces/{ctx.workspace_id}"
        workspace = self.store.get(root)

        def owned(name):
            return [
                value
                for value in self.store.list(root + "/" + name)
                if value.get("owner") == ctx.member_id
            ]

        activity = [
            item
            for item in self.store.list(root + "/activity")
            if ctx.member_id in item["visibleTo"]
        ]
        receipt_ids = {item["receiptId"] for item in activity}
        return {
            "workspace": {
                key: workspace[key]
                for key in (
                    "name",
                    "inviteCode",
                    "google",
                    "director",
                    "state",
                    "simulated",
                    "aiBackend",
                )
                if key in workspace
            },
            "members": self.store.list(root + "/members"),
            "approvals": [public_card(a) for a in owned("approvals")],
            "escalations": owned("escalations"),
            "memories": owned("memories"),
            "rules": self.store.list(root + f"/rules/{ctx.member_id}/items"),
            "inbox": self.store.list(root + f"/inbox/{ctx.member_id}/messages"),
            "activity": activity,
            "receipts": [
                r for r in self.store.list(root + "/receipts") if r["id"] in receipt_ids
            ],
            "traces": [
                t
                for t in self.store.list(root + "/a2aTraces")
                if ctx.member_id in (t["from"], t["to"])
            ],
            "events": [],
            "meetings": owned("meetings"),
            "notifications": owned("notifications"),
        }

    async def welcome(self, wid, mid, generation, delay=True):
        if delay:
            await asyncio.sleep(self.settings.welcome_delay)
        workspace = self.store.get(f"workspaces/{wid}")
        if (
            not workspace
            or workspace.get("generation") != generation
            or workspace["state"] != "ready"
            or workspace.get("demoDay")
        ):
            return
        key = f"workspaces/{wid}/welcome/{mid}"

        def reserve(tx):
            if tx.get(key):
                return False
            tx.set(key, {"state": "started", "createdAt": iso()})
            return True

        if not self.store.atomic(reserve):
            return
        ctx = MemberContext("service", wid, "priya", Caller("service"))
        try:
            await self.transport.ask(
                ctx, mid, "Is QA signed off for the login revamp?", new_id("trc_")
            )
            await self.transport.ask(
                ctx, mid, "Can QA commit to sign-off by Oct 30?", new_id("trc_")
            )
            self.store.set(key, {"state": "complete", "createdAt": iso()})
        except Exception:
            self.store.set(key, {"state": "interrupted", "createdAt": iso()})

    def schedule(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.jobs.add(task)
        task.add_done_callback(self.jobs.discard)

    def cleanup(self):
        result = {"deleted": [], "failed": []}
        for workspace in self.store.list("workspaces"):
            wid = workspace["id"]
            if workspace["expiresAt"] > iso() and workspace.get("state") != "deleting":
                continue

            def reserve(tx):
                value = tx.get(f"workspaces/{wid}")
                if not value or value.get("activeWrite"):
                    return False
                tx.set(f"workspaces/{wid}", {**value, "state": "deleting"})
                return True

            if not self.store.atomic(reserve):
                continue
            try:
                self.apps.cleanup(wid, workspace)

                def remove_bindings(tx):
                    tx.delete(f"invites/{workspace['inviteCode']}")
                    for member in tx.list(f"workspaces/{wid}/members"):
                        if member.get("uid"):
                            binding = tx.get(f"userBindings/{member['uid']}")
                            if binding and binding["workspaceId"] == wid:
                                tx.delete(f"userBindings/{member['uid']}")

                self.store.atomic(remove_bindings)
                self.store.delete_tree(f"workspaces/{wid}")
                result["deleted"].append(wid)
            except Exception:
                result["failed"].append(wid)
        for collection in ("rateLimits", "a2aNonces"):
            for row in self.store.list(collection):
                if row.get("expiresAt", "9999") < iso():
                    self.store.atomic(
                        lambda tx, key=collection + "/" + row["id"]: tx.delete(key)
                    )
        for collection in (
            "liveTickets",
            "meetingRooms",
            "workflowJobs",
            "pushDevices",
        ):
            for row in self.store.list(collection):
                expired = row.get("expiresAt", "9999") <= iso()
                orphaned = row.get("workspaceId") and not self.store.get(
                    "workspaces/" + row["workspaceId"]
                )
                if expired or orphaned:
                    self.store.atomic(
                        lambda tx, key=collection + "/" + row["id"]: tx.delete(key)
                    )
        return result


def public_card(card):
    return {
        key: value for key, value in card.items() if key not in ("action", "approvedBy")
    }
