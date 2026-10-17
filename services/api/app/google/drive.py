"""Drive ownership, markers and resource provisioning. Mutations never auto-retry."""

from urllib.parse import quote
from app.errors import error
from app.workspaces.seed import load


def run(request):
    return request.execute(num_retries=0)


def literal(value):
    return value.replace("\\", "\\\\").replace("'", "\\'")


def find(service, operation):
    rows = run(
        service.files().list(
            q=f"trashed = false and appProperties has {{ key='alterOperation' and value='{literal(operation)}' }}",
            fields="files(id,name,parents,appProperties,webViewLink)",
            pageSize=100,
        )
    ).get("files", [])
    if len(rows) > 1:
        raise RuntimeError(
            "The operation has multiple matching resources; administrator reconciliation is required."
        )
    return rows[0] if rows else None


def within(service, file_id, folder):
    metadata = run(
        service.files().get(fileId=file_id, fields="id,parents,trashed,mimeType")
    )
    if metadata.get("trashed") or folder not in metadata.get("parents", []):
        raise error(403, "POLICY_DENIED", "This file is outside the workspace folder.")
    return metadata


def create_file(service, wid, operation, title, mime, folder=None, template=None):
    existing = find(service, operation)
    if existing:
        return existing, False
    body = {
        "name": title,
        "appProperties": {"alterWorkspace": wid, "alterOperation": operation},
    }
    if folder:
        body["parents"] = [folder]
    if template:
        created = run(
            service.files().copy(fileId=template, body=body, fields="id,webViewLink")
        )
    else:
        created = run(
            service.files().create(
                body={**body, "mimeType": mime}, fields="id,webViewLink"
            )
        )
    return created, True


def provision(apps, wid, workspace):
    drive = apps.service("drive", "v3")
    folder, _ = create_file(
        drive,
        wid,
        f"{wid}:folder",
        f"Alter demo · {workspace['name']}",
        "application/vnd.google-apps.folder",
    )
    ids = {"folder": folder["id"]}
    permissions = run(
        drive.permissions().list(fileId=folder["id"], fields="permissions(type,role)")
    ).get("permissions", [])
    if not any(p["type"] == "anyone" and p["role"] == "reader" for p in permissions):
        run(
            drive.permissions().create(
                fileId=folder["id"],
                body={"type": "anyone", "role": "reader"},
                fields="id",
            )
        )
    from app.google import docs, sheets, calendar

    for key in ("designDoc", "statusDoc", "wiki", "testPlan"):
        source = load(f"docs/{key}.json")
        resource, created = create_file(
            drive,
            wid,
            f"{wid}:{key}",
            source["title"],
            "application/vnd.google-apps.document",
            folder["id"],
            apps.settings.template_ids.get(key),
        )
        ids[key] = resource["id"]
        if created and not apps.settings.template_ids.get(key):
            docs.replace(apps.service("docs", "v1"), resource["id"], source["sections"])
    resource, created = create_file(
        drive,
        wid,
        f"{wid}:sheet",
        "Login revamp tracker",
        "application/vnd.google-apps.spreadsheet",
        folder["id"],
        apps.settings.template_ids.get("sheet"),
    )
    ids["sheet"] = resource["id"]
    if created and not apps.settings.template_ids.get("sheet"):
        sheets.seed(apps.service("sheets", "v4"), resource["id"])
    ids["calendar"] = calendar.provision(
        apps.service("calendar", "v3"), wid, workspace.get("timeZone", "UTC")
    )
    return {
        "googleIds": ids,
        "google": {
            "folderUrl": f"https://drive.google.com/drive/folders/{ids['folder']}",
            "docs": {
                key: f"https://docs.google.com/document/d/{ids[key]}/edit"
                for key in ("designDoc", "statusDoc", "wiki", "testPlan")
            },
            "sheetUrl": f"https://docs.google.com/spreadsheets/d/{ids['sheet']}/edit",
            "calendarUrl": f"https://calendar.google.com/calendar/embed?src={quote(ids['calendar'])}",
        },
    }
