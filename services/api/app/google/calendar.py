from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from app.google.drive import run


def calendars(service):
    result = []
    token = None
    while True:
        page = run(service.calendarList().list(pageToken=token, maxResults=250))
        result.extend(page.get("items", []))
        token = page.get("nextPageToken")
        if not token:
            return result


def provision(service, wid):
    marker = f"Alter workspace {wid}"
    candidates = [
        entry for entry in calendars(service) if entry.get("description") == marker
    ]
    if len(candidates) > 1:
        raise RuntimeError("Calendar provisioning requires reconciliation.")
    calendar = (
        candidates[0]
        if candidates
        else run(
            service.calendars().insert(
                body={
                    "summary": "Login revamp team",
                    "description": marker,
                    "timeZone": "UTC",
                }
            )
        )
    )
    cid = calendar["id"]
    acl = run(service.acl().list(calendarId=cid)).get("items", [])
    if not any(
        item.get("scope", {}).get("type") == "default" and item.get("role") == "reader"
        for item in acl
    ):
        run(
            service.acl().insert(
                calendarId=cid, body={"scope": {"type": "default"}, "role": "reader"}
            )
        )
    start = datetime.now(timezone.utc).replace(
        hour=9, minute=0, second=0, microsecond=0
    )
    from app.workspaces.seed import load

    for block in load("calendar/blocks.json"):
        for offset in range(block["days"]):
            day = (start + timedelta(days=offset)).replace(hour=block["hour"])
            eid = sha256(
                f"{wid}:{block.get('key', block['member'])}:{offset}".encode()
            ).hexdigest()
            try:
                run(service.events().get(calendarId=cid, eventId=eid))
            except Exception as exc:
                if getattr(getattr(exc, "resp", None), "status", None) != 404:
                    raise
                run(
                    service.events().insert(
                        calendarId=cid,
                        body={
                            "id": eid,
                            "summary": block["title"],
                            "start": {"dateTime": day.isoformat()},
                            "end": {
                                "dateTime": (
                                    day + timedelta(hours=block["hours"])
                                ).isoformat()
                            },
                            "extendedProperties": {
                                "private": {"memberIds": json.dumps([block["member"]])}
                            },
                        },
                        sendUpdates="none",
                    )
                )
    return cid


def agenda(service, cid, member, start, end):
    result = []
    token = None
    while len(result) < 20:
        page = run(
            service.events().list(
                calendarId=cid,
                timeMin=start,
                timeMax=end,
                singleEvents=True,
                orderBy="startTime",
                maxResults=50,
                pageToken=token,
            )
        )
        for event in page.get("items", []):
            ids = json.loads(
                event.get("extendedProperties", {})
                .get("private", {})
                .get("memberIds", "[]")
            )
            if event.get("status") == "cancelled" or (ids and member not in ids):
                continue
            result.append(
                {
                    "id": event["id"],
                    "title": event.get("summary", "Untitled event"),
                    "start": event["start"].get("dateTime", event["start"].get("date")),
                    "end": event["end"].get("dateTime", event["end"].get("date")),
                    "meetUrl": event.get("hangoutLink", ""),
                    "url": event.get("htmlLink", ""),
                }
            )
        token = page.get("nextPageToken")
        if not token:
            break
    return result[:20]


def availability(service, cid, members, start, end):
    run(
        service.freebusy().query(
            body={"timeMin": start, "timeMax": end, "items": [{"id": cid}]}
        )
    )
    events = []
    token = None
    while True:
        page = run(
            service.events().list(
                calendarId=cid,
                timeMin=start,
                timeMax=end,
                singleEvents=True,
                pageToken=token,
                maxResults=250,
            )
        )
        events.extend(page.get("items", []))
        token = page.get("nextPageToken")
        if not token:
            break
    busy = []
    for event in events:
        ids = json.loads(
            event.get("extendedProperties", {})
            .get("private", {})
            .get("memberIds", "[]")
        )
        if event.get("transparency") == "transparent":
            continue
        if ids and not set(ids).intersection(members):
            continue
        begin = event.get("start", {})
        finish = event.get("end", {})
        busy.append(
            {
                "start": begin.get("dateTime", begin.get("date")),
                "end": finish.get("dateTime", finish.get("date")),
            }
        )
    return {"members": members, "start": start, "end": end, "busy": busy}


def insert(service, action, operation):
    cid = action["calendarId"]
    eid = sha256(operation.encode()).hexdigest()
    try:
        event = run(service.events().get(calendarId=cid, eventId=eid))
        if (
            event.get("extendedProperties", {}).get("private", {}).get("alterOperation")
            != operation
        ):
            raise RuntimeError("Calendar operation mismatch.")
    except Exception as exc:
        if getattr(getattr(exc, "resp", None), "status", None) != 404:
            raise
        event = run(
            service.events().insert(
                calendarId=cid,
                body={
                    "id": eid,
                    "summary": action["title"],
                    "description": "Attendees (workspace only): "
                    + ", ".join(action["attendeeNames"]),
                    "start": {"dateTime": action["start"]},
                    "end": {"dateTime": action["end"]},
                    "extendedProperties": {
                        "private": {
                            "memberIds": json.dumps(action["attendees"]),
                            "alterOperation": operation,
                        }
                    },
                },
                sendUpdates="none",
            )
        )
    return {"url": event.get("htmlLink", "")}
