from hashlib import sha256
import json
from app.google.creds import DemoCredentials
from app.google import drive, docs, sheets, calendar, gmail, meet
from app.workspaces.seed import calendar_keys
from app.errors import error


class GoogleApps:
    simulated = False

    def __init__(self, store, settings, secrets):
        self.store, self.settings, self.secrets = store, settings, secrets
        self.credentials = DemoCredentials(settings, secrets)

    def service(self, *args):
        return self.credentials.service(*args)

    def provision(self, wid, workspace):
        return drive.provision(self, wid, workspace)

    def workspace(self, wid):
        return self.store.get(f"workspaces/{wid}")

    def within(self, wid, file_id):
        workspace = self.workspace(wid)
        if file_id not in workspace["googleIds"].values():
            raise error(403, "POLICY_DENIED", "The file is outside this workspace.")
        return drive.within(
            self.service("drive", "v3"), file_id, workspace["googleIds"]["folder"]
        )

    def read_doc(self, wid, file_id):
        self.within(wid, file_id)
        return docs.read(self.service("docs", "v1"), file_id)

    def read_sheet(self, wid, file_id):
        self.within(wid, file_id)
        return sheets.read(self.service("sheets", "v4"), file_id)

    def availability(self, wid, members, start, end):
        return {
            **calendar.availability(
                self.service("calendar", "v3"),
                self.workspace(wid)["googleIds"]["calendar"],
                sorted(calendar_keys(self.store, wid, members)),
                start,
                end,
            ),
            "members": members,
        }

    def agenda(self, wid, member, start, end):
        return calendar.agenda(
            self.service("calendar", "v3"),
            self.workspace(wid)["googleIds"]["calendar"],
            calendar_keys(self.store, wid, [member]),
            start,
            end,
        )

    def create_meet(self, wid, member):
        return meet.create_open_space(self.settings, self.secrets)

    def apply(self, wid, approval, member, caller):
        action = approval["action"]
        operation = f"{approval['id']}:{approval['revision']}"
        kind = approval["kind"]
        if kind == "doc_create":
            workspace = self.workspace(wid)
            resource, created = drive.create_file(
                self.service("drive", "v3"),
                wid,
                operation,
                action["title"],
                "application/vnd.google-apps.document",
                workspace["googleIds"]["folder"],
            )
            if created:
                docs.replace(
                    self.service("docs", "v1"), resource["id"], action["sections"]
                )
            else:
                content = docs.read(self.service("docs", "v1"), resource["id"])
                if content["rawText"].strip() != docs.text(action["sections"]).strip():
                    raise RuntimeError(
                        "An incomplete document operation requires reconciliation."
                    )
            return {
                "fileId": resource["id"],
                "url": f"https://docs.google.com/document/d/{resource['id']}/edit",
            }
        if kind in ("doc_edit", "sheet_update"):
            self.within(wid, action["fileId"])
        if kind == "doc_edit":
            docs.replace(
                self.service("docs", "v1"),
                action["fileId"],
                action["sections"],
                action["requiredRevisionId"],
            )
            return {
                "url": f"https://docs.google.com/document/d/{action['fileId']}/edit"
            }
        if kind == "sheet_update":
            return sheets.apply(self.service("sheets", "v4"), action, operation)
        if kind == "calendar_event":
            if action["calendarId"] != self.workspace(wid)["googleIds"]["calendar"]:
                raise error(
                    403, "POLICY_DENIED", "The calendar is outside this workspace."
                )
            available = self.availability(
                wid, action["attendees"], action["start"], action["end"]
            )
            if available["busy"]:
                raise error(
                    409,
                    "CALENDAR_CHANGED",
                    "That time is no longer available. Review a new proposal.",
                )
            return calendar.insert(self.service("calendar", "v3"), action, operation)
        if kind == "email":
            account = json.loads(
                self.secrets.read(self.settings.google_oauth_secret)
            ).get("account_email", "")
            return gmail.send(
                self.service("gmail", "v1"), action, member, caller, account, operation
            )
        raise ValueError("Unsupported action")

    def reconcile(self, wid, approval):
        action = approval["action"]
        operation = f"{approval['id']}:{approval['revision']}"
        if approval["kind"] == "doc_create":
            found = drive.find(self.service("drive", "v3"), operation)
            if (
                found
                and docs.read(self.service("docs", "v1"), found["id"])[
                    "rawText"
                ].strip()
                == docs.text(action["sections"]).strip()
            ):
                return {
                    "fileId": found["id"],
                    "url": f"https://docs.google.com/document/d/{found['id']}/edit",
                }
        elif approval["kind"] == "doc_edit":
            if (
                self.read_doc(wid, action["fileId"])["rawText"].strip()
                == docs.text(action["sections"]).strip()
            ):
                return {
                    "url": f"https://docs.google.com/document/d/{action['fileId']}/edit"
                }
        elif approval["kind"] == "sheet_update":
            current = self.read_sheet(wid, action["fileId"])
            matches = [
                row
                for row, marker in zip(current["rows"], current["operations"])
                if marker == operation
            ]
            if matches == action["rows"]:
                return {"url": current["url"]}
        elif approval["kind"] == "calendar_event":
            event = drive.run(
                self.service("calendar", "v3")
                .events()
                .get(
                    calendarId=action["calendarId"],
                    eventId=sha256(operation.encode()).hexdigest(),
                )
            )
            if (
                event.get("extendedProperties", {})
                .get("private", {})
                .get("alterOperation")
                == operation
            ):
                return {"url": event.get("htmlLink", "")}
        # Gmail send outcomes cannot safely be reconciled with the minimal send/compose scopes.
        return None

    def cleanup(self, wid, workspace):
        # Delete the known folder only after checking its server-created workspace marker.
        folder = workspace.get("googleIds", {}).get("folder")
        if not folder:
            found = drive.find(self.service("drive", "v3"), f"{wid}:folder")
            folder = found["id"] if found else None
        if folder:
            try:
                value = drive.run(
                    self.service("drive", "v3")
                    .files()
                    .get(fileId=folder, fields="id,appProperties")
                )
                if value.get("appProperties", {}).get("alterWorkspace") != wid:
                    raise RuntimeError("Folder ownership cannot be verified.")
                drive.run(self.service("drive", "v3").files().delete(fileId=folder))
            except Exception as exc:
                if getattr(getattr(exc, "resp", None), "status", None) != 404:
                    raise
        cid = workspace.get("googleIds", {}).get("calendar")
        candidates = [
            entry
            for entry in calendar.calendars(self.service("calendar", "v3"))
            if entry.get("description") == f"Alter workspace {wid}"
        ]
        for entry in candidates:
            try:
                drive.run(
                    self.service("calendar", "v3")
                    .calendars()
                    .delete(calendarId=entry["id"])
                )
            except Exception as exc:
                if getattr(getattr(exc, "resp", None), "status", None) != 404:
                    raise
