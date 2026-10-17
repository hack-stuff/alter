from datetime import timedelta
import secrets
from app.auth import Caller, MemberContext
from app.diagnostics import report_provision_failure
from app.errors import error
from app.rate_limits import take
from app.util import new_id, iso, now
from app.workspaces.seed import seed_workspace, seed_member, SLOTS


class Workspaces:
    def __init__(self, store, settings, apps):
        self.store, self.settings, self.apps = store, settings, apps

    def result(self, wid, mid, slot, invite):
        return {
            "workspaceId": wid,
            "memberId": mid,
            "slot": slot,
            "inviteUrl": f"{self.settings.public_origin.rstrip('/')}/join/{invite}",
        }

    def create(
        self, caller: Caller, name, ip, director=False, demo_day=False, time_zone="UTC"
    ):
        wid, mid, code = new_id("ws_"), new_id("m_"), secrets.token_urlsafe(18)
        slot = "product_lead" if demo_day else SLOTS[0]
        if demo_day:
            mid, name = "dev", "Dev"

        def create(tx):
            bound = tx.get(f"userBindings/{caller.uid}")
            if bound:
                raise error(
                    409,
                    "ALREADY_JOINED",
                    "You already have a workspace. Open it or reset it instead.",
                )
            take(tx, f"create:{ip}", 5)
            tx.set(
                f"workspaces/{wid}",
                {
                    "name": "Login revamp",
                    "createdAt": iso(),
                    "expiresAt": (now() + timedelta(hours=48)).isoformat(),
                    "inviteCode": code,
                    "creatorUid": caller.uid,
                    "director": director,
                    "demoDay": demo_day,
                    "timeZone": time_zone,
                    "humanCount": 1,
                    "state": "provisioning",
                    "generation": new_id(),
                    "google": {"docs": {}},
                    "googleIds": {},
                },
            )
            tx.set(f"invites/{code}", {"workspaceId": wid, "invitedBy": name})
            seed_workspace(tx, wid, mid, name, caller.uid, slot)
            return self.result(wid, mid, slot, code)

        return self.store.atomic(create)

    def join(self, caller, name, code):
        mid = new_id("m_")

        def join(tx):
            if tx.get(f"userBindings/{caller.uid}"):
                raise error(
                    409,
                    "ALREADY_JOINED",
                    "This sign-in already belongs to a workspace.",
                )
            invite = tx.get(f"invites/{code}")
            if not invite:
                raise error(404, "INVALID_INVITE", "This invitation is not valid.")
            wid = invite["workspaceId"]
            workspace = tx.get(f"workspaces/{wid}")
            if (
                not workspace
                or workspace["expiresAt"] <= iso()
                or workspace.get("state") in ("deleting", "resetting")
            ):
                raise error(410, "EXPIRED", "This invitation has expired.")
            count = workspace["humanCount"]
            if count >= 4:
                raise error(409, "SLOTS_FULL", "This workspace has no free places.")
            slot = SLOTS[count]
            seed_member(tx, wid, mid, name, caller.uid, slot)
            tx.set(f"workspaces/{wid}", {**workspace, "humanCount": count + 1})
            return self.result(wid, mid, slot, code)

        return self.store.atomic(join)

    def provision(self, wid):
        workspace = self.store.get(f"workspaces/{wid}")
        if not workspace or workspace["state"] != "provisioning":
            return
        generation = workspace["generation"]
        try:
            resources = self.apps.provision(wid, workspace)

            def finish(tx):
                current = tx.get(f"workspaces/{wid}")
                if (
                    current
                    and current["generation"] == generation
                    and current["state"] == "provisioning"
                ):
                    tx.set(
                        f"workspaces/{wid}", {**current, **resources, "state": "ready"}
                    )

            self.store.atomic(finish)
        except Exception as exc:
            report_provision_failure(exc)

            def failed(tx):
                current = tx.get(f"workspaces/{wid}")
                if current and current["generation"] == generation:
                    tx.set(
                        f"workspaces/{wid}",
                        {
                            **current,
                            "state": "provisioning_failed",
                            "setupError": "Google resources could not be provisioned. Please contact the workspace administrator.",
                        },
                    )

            self.store.atomic(failed)

    def retry_failed_provision(self, context: MemberContext):
        """Resume the same workspace after its external setup becomes available."""

        def retry(tx):
            path = f"workspaces/{context.workspace_id}"
            workspace = tx.get(path)
            if not workspace or workspace.get("creatorUid") != context.uid:
                raise error(403, "FORBIDDEN", "Only the workspace creator can retry setup.")
            if workspace["state"] != "provisioning_failed":
                raise error(409, "SETUP_NOT_FAILED", "Google setup is not waiting for a retry.")
            take(tx, f"provision-retry:{context.workspace_id}", 3)
            updated = {**workspace, "state": "provisioning", "generation": new_id()}
            updated.pop("setupError", None)
            tx.set(path, updated)
            return context.workspace_id, context.member_id

        return self.store.atomic(retry)

    def reset(self, context: MemberContext, ip="unknown"):
        old = self.store.get(f"workspaces/{context.workspace_id}")
        # Retire the old workspace atomically. It is deleted only after resources are reconciled by cleanup.
        wid, code = new_id("ws_"), secrets.token_urlsafe(18)

        def reset(tx):
            binding = tx.get(f"userBindings/{context.uid}")
            current = tx.get(f"workspaces/{context.workspace_id}")
            if (
                not current
                or not binding
                or binding["workspaceId"] != context.workspace_id
            ):
                raise error(
                    409,
                    "WORKSPACE_CHANGED",
                    "The workspace changed. Reload and try again.",
                )
            if current.get("activeWrite"):
                raise error(
                    409,
                    "WORKSPACE_BUSY",
                    "A change is being applied. Try again when it finishes.",
                )
            if current["creatorUid"] != context.uid:
                raise error(
                    403,
                    "FORBIDDEN",
                    "Only the workspace creator can reset this shared workspace.",
                )
            take(tx, f"create:{ip}", 5)
            members = tx.list(f"workspaces/{context.workspace_id}/members")
            tx.set(
                f"workspaces/{context.workspace_id}", {**current, "state": "deleting"}
            )
            tx.delete(f"invites/{current['inviteCode']}")
            tx.set(
                f"workspaces/{wid}",
                {
                    **old,
                    "createdAt": iso(),
                    "expiresAt": (now() + timedelta(hours=48)).isoformat(),
                    "inviteCode": code,
                    "state": "provisioning",
                    "generation": new_id(),
                    "google": {"docs": {}},
                    "googleIds": {},
                },
            )
            tx.set(
                f"invites/{code}",
                {
                    "workspaceId": wid,
                    "invitedBy": next(
                        m["name"] for m in members if m.get("uid") == context.uid
                    ),
                },
            )
            for member in members:
                if member.get("kind") == "human" and member.get("uid"):
                    seed_member(
                        tx,
                        wid,
                        member["id"],
                        member["name"],
                        member["uid"],
                        member["slot"],
                    )
            own = next(m for m in members if m.get("uid") == context.uid)
            owner_id = context.member_id if own["kind"] == "human" else new_id("m_")
            seed_workspace(
                tx, wid, owner_id, own["name"], context.uid, own.get("slot", "qa_lead")
            )
            for member in members:
                if (
                    member["kind"] == "seeded"
                    and member.get("uid")
                    and member["uid"] != context.uid
                ):
                    profile = tx.get(f"workspaces/{wid}/members/{member['id']}")
                    tx.set(
                        f"workspaces/{wid}/members/{member['id']}",
                        {**profile, "uid": member["uid"]},
                    )
                    tx.set(
                        f"userBindings/{member['uid']}",
                        {"workspaceId": wid, "memberId": member["id"]},
                    )
            for member in members:
                if member.get("uid"):
                    tx.set(
                        f"{'workspaces'}/{context.workspace_id}/members/{member['id']}",
                        {k: v for k, v in member.items() if k not in ("uid", "id")},
                    )
            return self.result(wid, owner_id, own.get("slot", "qa_lead"), code)

        return self.store.atomic(reset)
