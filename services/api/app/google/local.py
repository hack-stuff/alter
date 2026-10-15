"""Persistent development adapter. It simulates Google files; it never calls Google."""

from datetime import datetime, timedelta
from hashlib import sha256
from app.errors import error
from app.util import now
from app.workspaces.seed import load


class LocalApps:
    simulated = True

    def __init__(self, store, settings):
        self.store, self.settings = store, settings

    def url(self, rid):
        return self.settings.service_url.rstrip("/") + "/local/files/" + rid

    def provision(self, wid, workspace):
        ids = {
            key: sha256(f"{wid}:{key}".encode()).hexdigest()[:32]
            for key in (
                "folder",
                "designDoc",
                "statusDoc",
                "wiki",
                "testPlan",
                "sheet",
                "calendar",
            )
        }

        def seed(tx):
            for key in ("designDoc", "statusDoc", "wiki", "testPlan"):
                rid = ids[key]
                if not tx.get(f"localResources/{rid}"):
                    tx.set(
                        f"localResources/{rid}",
                        {
                            **load(f"docs/{key}.json"),
                            "workspaceId": wid,
                            "kind": "doc",
                            "revision": 1,
                        },
                    )
            if not tx.get(f"localResources/{ids['sheet']}"):
                tx.set(
                    f"localResources/{ids['sheet']}",
                    {
                        **load("sheet.json"),
                        "workspaceId": wid,
                        "title": "Login revamp tracker",
                        "kind": "sheet",
                        "operations": [],
                    },
                )
            if not tx.get(f"localResources/{ids['calendar']}"):
                events = []
                for block in load("calendar/blocks.json"):
                    for offset in range(block["days"]):
                        start = (now() + timedelta(days=offset)).replace(
                            hour=block["hour"], minute=0, second=0, microsecond=0
                        )
                        events.append(
                            {
                                "id": block["member"] + str(offset),
                                "title": block["title"],
                                "attendees": [block["member"]],
                                "start": start.isoformat(),
                                "end": (
                                    start + timedelta(hours=block["hours"])
                                ).isoformat(),
                            }
                        )
                tx.set(
                    f"localResources/{ids['calendar']}",
                    {
                        "workspaceId": wid,
                        "title": "Team calendar",
                        "kind": "calendar",
                        "events": events,
                    },
                )
            tx.set(
                f"localResources/{ids['folder']}",
                {
                    "workspaceId": wid,
                    "title": "Workspace Drive folder",
                    "kind": "folder",
                    "files": [self.url(ids[key]) for key in ids if key != "folder"],
                },
            )

        self.store.atomic(seed)
        return {
            "googleIds": ids,
            "google": {
                "folderUrl": self.url(ids["folder"]),
                "docs": {
                    key: self.url(ids[key])
                    for key in ("designDoc", "statusDoc", "wiki", "testPlan")
                },
                "sheetUrl": self.url(ids["sheet"]),
                "calendarUrl": self.url(ids["calendar"]),
            },
            "simulated": True,
            "aiBackend": self.settings.ai_backend,
        }

    def read_doc(self, wid, file_id):
        value = self.store.get(f"localResources/{file_id}")
        if not value or value["workspaceId"] != wid or value["kind"] != "doc":
            raise error(403, "FORBIDDEN", "This file is outside your workspace.")
        return {
            "sections": value["sections"],
            "revision": str(value["revision"]),
            "url": self.url(file_id),
        }

    def read_sheet(self, wid, file_id):
        value = self.store.get(f"localResources/{file_id}")
        if not value or value["workspaceId"] != wid:
            raise error(403, "FORBIDDEN", "This tracker is outside your workspace.")
        return {
            "headers": value["headers"],
            "rows": value["rows"],
            "url": self.url(file_id),
        }

    def availability(self, wid, members, start, end):
        workspace = self.store.get(f"workspaces/{wid}")
        calendar = self.store.get(
            "localResources/" + workspace["googleIds"]["calendar"]
        )
        busy = [
            {"start": event["start"], "end": event["end"]}
            for event in calendar["events"]
            if set(event["attendees"]).intersection(members)
            and datetime.fromisoformat(event["start"]) < datetime.fromisoformat(end)
            and datetime.fromisoformat(event["end"]) > datetime.fromisoformat(start)
        ]
        return {
            "start": start,
            "end": end,
            "members": members,
            "busy": busy,
            "simulated": True,
        }

    def apply(self, wid, approval, member, caller):
        action = approval["action"]
        kind = approval["kind"]
        operation = f"{approval['id']}:{approval['revision']}"

        def apply(tx):
            previous = tx.get(f"localOperations/{operation.replace(':', '_')}")
            if previous:
                return previous
            if kind == "doc_create":
                file_id = sha256(operation.encode()).hexdigest()[:32]
                tx.set(
                    f"localResources/{file_id}",
                    {
                        "workspaceId": wid,
                        "title": action["title"],
                        "kind": "doc",
                        "sections": action["sections"],
                        "revision": 1,
                    },
                )
                result = {"url": self.url(file_id), "fileId": file_id}
            elif kind == "doc_edit":
                file_id = action["fileId"]
                current = tx.get(f"localResources/{file_id}")
                if str(current["revision"]) != action["requiredRevisionId"]:
                    raise error(
                        409,
                        "DOCUMENT_CHANGED",
                        "The document changed. Review a new proposal before applying it.",
                    )
                tx.set(
                    f"localResources/{file_id}",
                    {
                        **current,
                        "sections": action["sections"],
                        "revision": current["revision"] + 1,
                    },
                )
                result = {"url": self.url(file_id)}
            elif kind == "sheet_update":
                file_id = action["fileId"]
                current = tx.get(f"localResources/{file_id}")
                rows = current["rows"]
                start = action.get("startRow", 0)
                if start:
                    index = start - 2
                    if rows[index : index + len(action["rows"])] != action["before"]:
                        raise error(
                            409,
                            "DOCUMENT_CHANGED",
                            "The tracker changed. Review a new proposal.",
                        )
                    rows = (
                        rows[:index]
                        + action["rows"]
                        + rows[index + len(action["rows"]) :]
                    )
                else:
                    rows = rows + action["rows"]
                tx.set(
                    f"localResources/{file_id}",
                    {
                        **current,
                        "rows": rows,
                        "operations": current.get("operations", []) + [operation],
                    },
                )
                result = {"url": self.url(file_id)}
            elif kind == "calendar_event":
                file_id = action["calendarId"]
                current = tx.get(f"localResources/{file_id}")
                if any(
                    set(event["attendees"]).intersection(action["attendees"])
                    and event["start"] < action["end"]
                    and event["end"] > action["start"]
                    for event in current["events"]
                ):
                    raise error(
                        409, "CALENDAR_CHANGED", "That time is no longer available."
                    )
                tx.set(
                    f"localResources/{file_id}",
                    {
                        **current,
                        "events": current["events"] + [{"id": operation, **action}],
                    },
                )
                result = {"url": self.url(file_id)}
            elif kind == "email":
                result = {"inboxOnly": True, "simulated": True}
            else:
                raise ValueError("Unsupported action")
            tx.set(f"localOperations/{operation.replace(':', '_')}", result)
            return result

        return self.store.atomic(apply)

    def reconcile(self, wid, approval):
        return self.store.get(
            f"localOperations/{approval['id']}_{approval['revision']}"
        )

    def cleanup(self, wid, workspace):
        for resource in self.store.list("localResources"):
            if resource["workspaceId"] == wid:
                self.store.atomic(
                    lambda tx, rid=resource["id"]: tx.delete(f"localResources/{rid}")
                )
