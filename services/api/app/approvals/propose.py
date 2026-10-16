from datetime import datetime, timedelta, timezone
from copy import deepcopy
import json
from app.errors import error
from app.policy.gate import Rule, enforce
from app.util import new_id, iso

KINDS = {"doc_create", "doc_edit", "sheet_update", "calendar_event", "email"}


def sections(value):
    if not isinstance(value, list) or not value or len(value) > 30:
        raise error(422, "INVALID_PROPOSAL", "Provide document sections.")
    result = []
    for section in value:
        if (
            not isinstance(section, dict)
            or not isinstance(section.get("section"), str)
            or not isinstance(section.get("lines"), list)
            or not all(isinstance(line, str) for line in section["lines"])
        ):
            raise error(422, "INVALID_PROPOSAL", "Invalid document sections.")
        if (
            len(section["section"]) > 200
            or len(section["lines"]) > 100
            or sum(map(len, section["lines"])) > 30000
        ):
            raise error(422, "INVALID_PROPOSAL", "The proposed document is too large.")
        result.append({"section": section["section"], "lines": section["lines"]})
    return result


def diff(before, after):
    old = {(s["section"], line) for s in before for line in s["lines"]}
    new = {(s["section"], line) for s in after for line in s["lines"]}
    return [
        {"op": "add", "section": name, "line": line} for name, line in sorted(new - old)
    ] + [
        {"op": "remove", "section": name, "line": line}
        for name, line in sorted(old - new)
    ]


class Proposals:
    def __init__(self, store, apps):
        self.store, self.apps = store, apps

    def context(self, ctx):
        root = f"workspaces/{ctx.workspace_id}"
        workspace = self.store.get(root)
        if not workspace or workspace["expiresAt"] <= iso():
            raise error(410, "EXPIRED", "This workspace has expired.")
        if workspace.get("state") != "ready":
            raise error(
                409,
                "WORKSPACE_BUSY",
                "Your workspace resources are still being set up.",
            )
        members = {
            member["id"]: member for member in self.store.list(root + "/members")
        }
        rules = [
            Rule(rule["id"], rule["label"], tuple(rule["intents"]), rule["mode"])
            for rule in self.store.list(root + f"/rules/{ctx.member_id}/items")
        ]
        return workspace, members, rules

    def validate(self, ctx, action):
        workspace, members, rules = self.context(ctx)
        result = enforce(
            rules,
            set(members),
            ctx.member_id,
            ctx.member_id,
            "request_write",
            driving=True,
            payload=action,
            resources=workspace["googleIds"],
        )
        if result.outcome == "deny":
            raise error(403, "POLICY_DENIED", result.reason)
        if action.get("calendarId") and action["calendarId"] != workspace[
            "googleIds"
        ].get("calendar"):
            raise error(403, "POLICY_DENIED", "The calendar is outside your workspace.")
        return workspace, members

    def build(self, ctx, kind, payload, reason, citations=()):
        if kind not in KINDS:
            raise error(422, "INVALID_PROPOSAL", "Unsupported action.")
        workspace, members, _ = self.context(ctx)
        action = deepcopy(payload)
        before = []
        if kind in ("doc_create", "doc_edit"):
            action["sections"] = sections(action["sections"])
            title = str(action.get("title", "Document update")).strip()[:200]
            if not title:
                raise error(422, "INVALID_PROPOSAL", "Provide a document title.")
            action["title"] = title
            if kind == "doc_edit":
                key = action.get("document", "statusDoc")
                action["fileId"] = workspace["googleIds"].get(key, key)
                self.validate(ctx, action)
                current = self.apps.read_doc(ctx.workspace_id, action["fileId"])
                before = current["sections"]
                action["requiredRevisionId"] = current["revision"]
            after = action["sections"]
        elif kind == "sheet_update":
            action["fileId"] = workspace["googleIds"]["sheet"]
            rows = action.get("rows", [])
            if (
                not rows
                or len(rows) > 30
                or any(
                    not isinstance(row, list)
                    or len(row) != 5
                    or any(
                        not isinstance(cell, str) or len(cell) > 1000 for cell in row
                    )
                    for row in rows
                )
            ):
                raise error(
                    422,
                    "INVALID_PROPOSAL",
                    "Each tracker row must contain five text fields.",
                )
            start = action.get("startRow", 0)
            if not isinstance(start, int) or start < 0 or start == 1:
                raise error(
                    422, "INVALID_PROPOSAL", "Tracker row numbers start at two."
                )
            current = self.apps.read_sheet(ctx.workspace_id, action["fileId"])
            if start and start - 2 + len(rows) > len(current["rows"]):
                raise error(
                    422,
                    "INVALID_PROPOSAL",
                    "Choose existing tracker rows or append new ones.",
                )
            action["before"] = (
                current["rows"][start - 2 : start - 2 + len(rows)] if start else []
            )
            before = [
                {
                    "section": "Tracker rows",
                    "lines": [" | ".join(row) for row in action["before"]],
                }
            ]
            after = [
                {"section": "Tracker rows", "lines": [" | ".join(row) for row in rows]}
            ]
            title = "Login revamp tracker update"
        elif kind == "calendar_event":
            attendees = action.get("attendees", [])
            if not attendees or not isinstance(attendees, list):
                raise error(422, "INVALID_PROPOSAL", "Choose workspace attendees.")
            action["attendees"] = list(dict.fromkeys([ctx.member_id, *attendees]))
            self.validate(ctx, action)
            try:
                start = datetime.fromisoformat(action["start"].replace("Z", "+00:00"))
                minutes = int(action.get("duration", 30))
                if (
                    start.tzinfo is None
                    or start <= datetime.now(timezone.utc)
                    or not 5 <= minutes <= 240
                ):
                    raise ValueError()
            except (ValueError, KeyError, TypeError):
                raise error(
                    422,
                    "INVALID_PROPOSAL",
                    "Choose a future time with a timezone and a duration of 5–240 minutes.",
                ) from None
            action.update(
                calendarId=workspace["googleIds"]["calendar"],
                start=start.isoformat(),
                end=(start + timedelta(minutes=minutes)).isoformat(),
                attendeeNames=[members[mid]["name"] for mid in action["attendees"]],
            )
            if self.apps.availability(
                ctx.workspace_id, action["attendees"], action["start"], action["end"]
            )["busy"]:
                raise error(
                    409,
                    "NO_FREE_SLOT",
                    "Those attendees are busy at that time. Choose another slot.",
                )
            title = str(action.get("title", "Team meeting"))[:200]
            action["title"] = title
            after = [
                {
                    "section": "Event",
                    "lines": [
                        title,
                        f"{action['start']} – {action['end']}",
                        "Attendees: " + ", ".join(action["attendeeNames"]),
                    ],
                }
            ]
        else:
            if not action.get("to_members") or not isinstance(
                action["to_members"], list
            ):
                raise error(422, "INVALID_PROPOSAL", "Choose workspace recipients.")
            self.validate(ctx, action)
            for key in ("subject", "body"):
                if (
                    not isinstance(action.get(key), str)
                    or not action[key].strip()
                    or len(action[key]) > 10000
                ):
                    raise error(
                        422, "INVALID_PROPOSAL", "The email needs a subject and body."
                    )
            if "\n" in action["subject"] or "\r" in action["subject"]:
                raise error(422, "INVALID_PROPOSAL", "Email subjects must be one line.")
            title = action["subject"][:200]
            after = [
                {
                    "section": "To",
                    "lines": [
                        members[mid]["name"] + " · team inbox"
                        for mid in action["to_members"]
                    ],
                },
                {"section": "Subject", "lines": [action["subject"]]},
                {"section": "Body", "lines": [action["body"]]},
            ]
        self.validate(ctx, action)
        return {
            "owner": ctx.member_id,
            "kind": kind,
            "title": title,
            "revision": 1,
            "preview": {"before": before, "after": after, "diffs": diff(before, after)},
            "citations": list(citations),
            "state": "proposed",
            "reason": reason,
            "action": action,
            "createdAt": iso(),
        }

    def create(self, ctx, kind, payload, reason, citations=()):
        card = self.build(ctx, kind, payload, reason, citations)
        aid = new_id("apr_")

        def save(tx):
            workspace = tx.get(f"workspaces/{ctx.workspace_id}")
            if workspace.get("state") != "ready":
                raise error(
                    409, "WORKSPACE_BUSY", "The workspace changed. Please try again."
                )
            tx.set(f"workspaces/{ctx.workspace_id}/approvals/{aid}", card)

        if len(json.dumps(card, ensure_ascii=False).encode("utf-8")) > 700000:
            raise error(
                413,
                "PROPOSAL_TOO_LARGE",
                "This change is too large to review. Split it into smaller proposals.",
            )
        self.store.atomic(save)
        return {**card, "id": aid}

    def owned(self, ctx, aid):
        value = self.store.get(f"workspaces/{ctx.workspace_id}/approvals/{aid}")
        if not value:
            raise error(404, "NOT_FOUND", "No such proposal.")
        if value["owner"] != ctx.member_id:
            raise error(
                403, "FORBIDDEN", "Only the proposal owner can decide or revise it."
            )
        return {**value, "id": aid}

    def revise(self, ctx, aid, instruction, planner):
        current = self.owned(ctx, aid)
        if current["state"] != "proposed":
            raise error(
                409, "ALREADY_DECIDED", "Only pending proposals can be revised."
            )
        payload = planner.revise(current, instruction)
        revised = self.build(
            ctx, current["kind"], payload, current["reason"], current["citations"]
        )
        revised.update(revision=current["revision"] + 1, createdAt=current["createdAt"])
        revised["preview"]["diffs"] = diff(
            current["preview"]["after"], revised["preview"]["after"]
        )

        def save(tx):
            actual = tx.get(f"workspaces/{ctx.workspace_id}/approvals/{aid}")
            if (
                actual["revision"] != current["revision"]
                or actual["state"] != "proposed"
            ):
                raise error(
                    409,
                    "STALE_REVISION",
                    "This proposal changed. Review the latest version.",
                )
            tx.set(f"workspaces/{ctx.workspace_id}/approvals/{aid}", revised)

        if len(json.dumps(revised, ensure_ascii=False).encode("utf-8")) > 700000:
            raise error(
                413,
                "PROPOSAL_TOO_LARGE",
                "This change is too large to review. Split it into smaller proposals.",
            )
        self.store.atomic(save)
        return {**revised, "id": aid}
