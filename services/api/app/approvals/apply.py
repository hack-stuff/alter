from app.errors import error
from app.util import iso
from app.receipts import record


class Application:
    def __init__(self, store, apps, proposals):
        self.store, self.apps, self.proposals = store, apps, proposals

    def decide(self, ctx, aid, decision, revision):
        card = self.proposals.owned(ctx, aid)

        def reserve(tx):
            root = f"workspaces/{ctx.workspace_id}"
            current = tx.get(root + "/approvals/" + aid)
            workspace = tx.get(root)
            binding = current.get("planBinding")
            if binding and decision == "approve":
                plan = tx.get(root + "/plans/" + binding["id"])
                if (
                    not plan
                    or plan["owner"] != ctx.member_id
                    or plan["revision"] != binding["revision"]
                ):
                    raise error(
                        409,
                        "STALE_REVISION",
                        "The design changed. Prepare and review its latest version before publishing.",
                    )
            if current["revision"] != revision:
                raise error(
                    409,
                    "STALE_REVISION",
                    "This proposal changed. Review the latest version.",
                )
            if current["state"] != "proposed":
                raise error(
                    409, "ALREADY_DECIDED", "This proposal has already been decided."
                )
            if workspace.get("state") != "ready":
                raise error(
                    409, "WORKSPACE_BUSY", "This workspace is not ready for changes."
                )
            if decision == "reject":
                tx.set(root + "/approvals/" + aid, {**current, "state": "rejected"})
                record(
                    tx,
                    ctx.workspace_id,
                    ctx.member_id,
                    "rejected",
                    f"Rejected {current['title']}",
                    [ctx.member_id],
                    ok=False,
                )
                return {**current, "state": "rejected", "id": aid}
            if workspace.get("activeWrite"):
                raise error(
                    409,
                    "WORKSPACE_BUSY",
                    "Another change is being applied. Please try again shortly.",
                )
            tx.set(root, {**workspace, "activeWrite": aid})
            approved = {
                **current,
                "state": "approved",
                "approvedAt": iso(),
                "approvedBy": ctx.uid,
            }
            tx.set(root + "/approvals/" + aid, approved)
            return {**approved, "id": aid}

        pending = self.store.atomic(reserve)
        if decision == "reject":
            return pending
        return self.execute(ctx, pending)

    def execute(self, ctx, card):
        wid, aid = ctx.workspace_id, card["id"]
        result = None
        failure = None
        attempted = False
        try:
            current_member = self.proposals.engine.auth.member(ctx.caller)
            if (current_member.workspace_id, current_member.member_id) != (
                ctx.workspace_id,
                ctx.member_id,
            ):
                raise error(
                    403,
                    "MEMBERSHIP_CHANGED",
                    "The approver's membership changed before execution.",
                )
            if card.get("continuationGrant"):
                self.proposals.engine.meetings.check_grant(
                    ctx, card["continuationGrant"]
                )
            self.proposals.validate(ctx, card["action"])
            member = self.store.get(f"workspaces/{wid}/members/{ctx.member_id}") | {
                "id": ctx.member_id
            }
            attempted = True
            result = self.apps.apply(wid, card, member, ctx.caller)
        except Exception as exc:
            try:
                result = self.apps.reconcile(wid, card) if attempted else None
            except Exception:
                result = None
            failure = "The write could not be confirmed. It will not be retried automatically."
            if hasattr(exc, "detail") and isinstance(exc.detail, dict):
                failure = exc.detail.get("error", {}).get("message", failure)
        return self.finalize(wid, aid, card, result, failure)

    def finalize(self, wid, aid, card, result, failure):
        owner = card["owner"]

        def finish(tx):
            root = f"workspaces/{wid}"
            current = tx.get(root + "/approvals/" + aid)
            workspace = tx.get(root)
            if not current or current["state"] != "approved":
                raise error(
                    409,
                    "STATE_CHANGED",
                    "The proposal state changed during application.",
                )
            updated = {
                **current,
                "state": "applied" if result is not None else "failed",
            }
            if result and result.get("url"):
                updated["externalUrl"] = result["url"]
            if result is None:
                updated["failureReason"] = failure
                updated["reason"] = failure
            if result is not None and card["kind"] == "email":
                for recipient in card["action"]["to_members"]:
                    tx.set(
                        root + f"/inbox/{recipient}/messages/{aid}",
                        {
                            "from": owner,
                            "subject": card["action"]["subject"],
                            "body": card["action"]["body"],
                            "ts": iso(),
                            **(
                                {"gmailMessageUrl": result["gmailMessageUrl"]}
                                if result.get("gmailMessageUrl")
                                else {}
                            ),
                        },
                    )
            if result and result.get("fileId"):
                workspace = {
                    **workspace,
                    "googleIds": {
                        **workspace["googleIds"],
                        f"created_{aid}": result["fileId"],
                    },
                    "google": {
                        **workspace["google"],
                        "docs": {
                            **workspace["google"]["docs"],
                            f"created_{aid}": result["url"],
                        },
                    },
                }
            tx.set(root + "/approvals/" + aid, updated)
            if result is not None and card["kind"] == "doc_edit":
                workspace = {
                    **workspace,
                    "knowledgeEpoch": workspace.get("knowledgeEpoch", 0) + 1,
                }
                document_key = card["action"].get("document")
                if document_key in workspace["googleIds"]:
                    for source in tx.list(root + "/sources"):
                        if source.get("documentKey") == document_key:
                            tx.delete(root + "/sources/" + source["id"])
                    for index, section in enumerate(card["action"]["sections"]):
                        tx.set(
                            root + f"/sources/{document_key}_current_{index}",
                            {
                                "logicalId": document_key,
                                "title": card["title"],
                                "locator": section["section"],
                                "text": "\n".join(section["lines"]),
                                "scope": "work",
                                "audience": "team",
                                "documentKey": document_key,
                                "version": iso(),
                            },
                        )
            tx.set(root, {k: v for k, v in workspace.items() if k != "activeWrite"})
            record(
                tx,
                wid,
                owner,
                card["kind"],
                ("Applied " if result is not None else "Could not confirm ")
                + card["title"],
                [owner],
                rule="owner-approval",
                sources=card["citations"],
                ok=result is not None,
                url=(result or {}).get("url"),
                approved_by=owner,
            )
            return {**updated, "id": aid}

        return self.store.atomic(finish)

    def recover(self, wid, aid):
        # A crash may leave an approved operation. Reconcile read-only; never replay it.
        root = f"workspaces/{wid}"
        card = self.store.get(root + "/approvals/" + aid)
        if not card or card["state"] != "approved":
            return
        try:
            result = self.apps.reconcile(wid, {**card, "id": aid})
        except Exception:
            result = None
        return self.finalize(
            wid,
            aid,
            {**card, "id": aid},
            result,
            "An interrupted write could not be confirmed. It was not retried.",
        )
