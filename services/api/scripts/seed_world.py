"""Seed the Cold Silicon world with each character's own Google credentials.

Reads per-character OAuth bundles from ALTER_SECRET_DIR
(default ~/.config/alter/secrets/alter-demo-oauth-<name>.json), then creates:
  - the shared Drive folder and the five demo docs (owned by the first character),
  - the fiction's email threads (each message sent by its author's own account),
  - calendar events with real invites.

Additive and idempotent: run it whenever another character comes online; it
only creates what is missing. Never prints secrets or credential values.
"""

import argparse
import base64
import json
import os
from datetime import datetime, timedelta
from email.message import EmailMessage
from hashlib import sha256
from pathlib import Path

from app.google import docs as docs_module
from app.google import sheets as sheets_module
from app.google.creds import SCOPES
from app.google.drive import create_file, run
from app.workspaces.seed import load
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

WORLD = "cold-silicon"

CHARACTERS = [
    {"key": "dev", "name": "Dev", "title": "Product lead"},
    {"key": "siddhi", "name": "Siddhi", "title": "Engineering lead"},
    {"key": "kani", "name": "Kani", "title": "Product designer"},
    {"key": "sahil", "name": "Sahil", "title": "Backend engineer"},
]

DOC_KEYS = ("designDoc", "statusDoc", "wiki", "testPlan")


def secret_dir():
    return Path(os.getenv("ALTER_SECRET_DIR") or (Path.home() / ".config/alter/secrets"))


def load_characters():
    characters = {}
    for character in CHARACTERS:
        path = secret_dir() / f"alter-demo-oauth-{character['key']}.json"
        if not path.exists():
            print(f"[skip] {character['key']}: no credential file yet")
            continue
        values = json.loads(path.read_text())
        credentials = Credentials(
            token=None,
            refresh_token=values["refresh_token"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=values["client_id"],
            client_secret=values["client_secret"],
            scopes=SCOPES,
        )
        characters[character["key"]] = {
            **character,
            "email": values["account_email"],
            "credentials": credentials,
        }
    return characters


def service(character, api, version):
    return build(api, version, credentials=character["credentials"], cache_discovery=False)


def load_manifest():
    path = secret_dir() / "world.json"
    return json.loads(path.read_text()) if path.exists() else {"docs": {}, "threads": {}, "events": {}}


def save_manifest(manifest):
    path = secret_dir() / "world.json"
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True))
    path.chmod(0o600)


def share(drive, file_id, email):
    try:
        run(drive.permissions().create(
            fileId=file_id,
            body={"type": "user", "role": "writer", "emailAddress": email},
            sendNotificationEmail=True,
            fields="id",
        ))
        print(f"[share] {email} <- {file_id}")
    except Exception as exc:
        status = getattr(getattr(exc, "resp", None), "status", None)
        if status in (400, 409):
            print(f"[share] already shared: {email}")
        else:
            raise


def ensure_docs(characters, manifest):
    owner_key = "dev" if "dev" in characters else next(iter(characters))
    owner = characters[owner_key]
    drive = service(owner, "drive", "v3")
    docs_service = service(owner, "docs", "v1")

    folder, made = create_file(
        drive, WORLD, f"{WORLD}:folder",
        "Login Revamp — Cold Silicon", "application/vnd.google-apps.folder",
    )
    print(f"[folder] {'created' if made else 'exists'}: {folder.get('webViewLink', folder['id'])} (owner {owner['email']})")
    ids = {"folder": folder["id"]}
    for key in DOC_KEYS:
        source = load(f"docs/{key}.json")
        resource, made = create_file(
            drive, WORLD, f"{WORLD}:doc:{key}",
            source["title"], "application/vnd.google-apps.document", folder["id"],
        )
        ids[key] = resource["id"]
        if made:
            docs_module.replace(docs_service, resource["id"], source["sections"])
        print(f"[doc:{key}] {'created' if made else 'exists'}: {source['title']}")
    sheet, made = create_file(
        drive, WORLD, f"{WORLD}:sheet",
        "Login revamp tracker", "application/vnd.google-apps.spreadsheet", folder["id"],
    )
    ids["sheet"] = sheet["id"]
    if made:
        sheets_module.seed(service(owner, "sheets", "v4"), sheet["id"])
    print(f"[sheet] {'created' if made else 'exists'}")

    for key, character in characters.items():
        if key == owner_key:
            continue
        for file_id in [folder["id"], *ids.values()]:
            share(drive, file_id, character["email"])
    manifest.setdefault("docs", {}).update(ids)
    return ids


def ensure_comment(characters, manifest, key, file_id, comment_key, content, explicit=False):
    """A comment authored by the character themselves (Drive attributes it to them)."""
    marker = f"{WORLD}:{comment_key}"
    if manifest["docs"].get(marker):
        print(f"[comment:{comment_key}] exists")
        return
    drive = service(characters[key], "drive", "v3")
    created = run(drive.comments().create(
        fileId=file_id, fields="id,createdTime",
        body={"content": content},
    ))
    manifest["docs"][marker] = created.get("id", "")
    print(f"[comment:{comment_key}] created by {characters[key]['email']}")


def gmail_for(character):
    return service(character, "gmail", "v1")


def find_sent(gmail, subject, sender_email):
    query = f'subject:"{subject}" from:{sender_email}'
    found = gmail.users().messages().list(userId="me", q=query, maxResults=5).execute().get("messages", [])
    if not found:
        return None
    meta = gmail.users().messages().get(
        userId="me", id=found[0]["id"], format="metadata", metadataHeaders=["Message-ID", "Subject"],
    ).execute()
    headers = {h["name"].lower(): h["value"] for h in meta.get("payload", {}).get("headers", [])}
    return {"id": found[0]["id"], "threadId": meta.get("threadId", ""), "messageId": headers.get("message-id", "")}


def send_message(characters, author_key, recipients, subject, body, references=None, existing=None):
    author = characters[author_key]
    gmail = gmail_for(author)
    if existing and existing.get("messageId"):
        print(f"[mail] exists: {subject} ({author['email']})")
        return existing
    message = EmailMessage()
    message["From"] = f"{author['name']} <{author['email']}>"
    message["To"] = ", ".join(recipient["email"] for recipient in recipients)
    message["Subject"] = subject
    message["Message-ID"] = f"<{WORLD}-{sha256((author_key + subject).encode()).hexdigest()[:16]}@world.local>"
    if references:
        message["References"] = " ".join(references)
        message["In-Reply-To"] = references[-1]
    message.set_content(body)
    sent = gmail.users().messages().send(
        userId="me", body={"raw": base64.urlsafe_b64encode(message.as_bytes()).decode()},
    ).execute()
    meta = gmail.users().messages().get(
        userId="me", id=sent["id"], format="metadata", metadataHeaders=["Message-ID"],
    ).execute()
    headers = {h["name"].lower(): h["value"] for h in meta.get("payload", {}).get("headers", [])}
    result = {"id": sent["id"], "threadId": sent.get("threadId", ""), "messageId": headers.get("message-id", "")}
    print(f"[mail] sent: {subject!r} from {author['email']} -> {len(recipients)} recipient(s)")
    return result


def ensure_threads(characters, manifest):
    threads = manifest.setdefault("threads", {})

    def run_thread(key, subject, steps):
        if key not in threads:
            threads[key] = {"subject": subject, "messages": {}}
        state = threads[key]
        references = []
        sent_any = False
        for index, step in enumerate(steps):
            step_id = str(index)
            if step_id in state["messages"] and state["messages"][step_id].get("messageId"):
                references = references + [state["messages"][step_id]["messageId"]]
                continue
            if step["author"] not in characters:
                continue
            recipients = [c for c in characters.values() if c["email"] != characters[step["author"]]["email"]]
            if not recipients:
                continue
            gmail = gmail_for(characters[step["author"]])
            existing = find_sent(gmail, subject, characters[step["author"]]["email"])
            stored = send_message(
                characters, step["author"], recipients, subject,
                step["body"], references=references or None, existing=existing if existing else None,
            )
            state["messages"][step_id] = stored
            if stored.get("messageId"):
                references = references + [stored["messageId"]]
            sent_any = True
        print(f"[thread:{key}] {'updated' if sent_any else 'waiting for authors'}")

    run_thread(
        "one-tap", "Login revamp — moving to Google one-tap sign-in",
        [
            {
                "author": "siddhi",
                "body": "Team — decision from this morning's arch sync: we're replacing the old Google Sign-In\n"
                        "button with Google One-Tap. Google is retiring the old button, and one-tap gets users to a\n"
                        "session faster on mobile. The decision record is in the design doc (working notes), and the\n"
                        "backend side is tracked under AUTH-112.\n\n— Siddhi\n",
            },
            {
                "author": "dev",
                "body": "Thanks, Siddhi. Kani — can you take one-tap as the primary path and keep email/password as the\n"
                        "fallback? Mobile mock-ups by Friday would let us plan the review.\n\nI'll fold this decision into\n"
                        "the status doc so it's not living in this thread.\n\n— Dev\n",
            },
            {
                "author": "kani",
                "body": "On it. One-tap as the primary path, email/password stays as the fallback. I'll have the mobile\n"
                        "mock-ups by Friday and drop them next to the design doc.\n\n— Kani\n",
            },
        ],
    )

    run_thread(
        "auth-112", "AUTH-112 — sign-in approved for production",
        [
            {
                "author": "sahil",
                "body": "Status on AUTH-112: the token auth for one-tap sign-in is approved for production and\n"
                        "verified live in prod on October 10. No open backend blockers on my side.\n\n— Sahil\n",
            },
            {
                "author": "dev",
                "body": "Great — adding this to the status doc today so QA sees it in one place.\n\n— Dev\n",
            },
        ],
    )

    run_thread(
        "handover", "Handover — I'm on leave",
        [
            {
                "author": "siddhi",
                "body": "Heads up: I'm on leave from today. For anything on the login revamp, my Alter has my notes\n"
                        "and will answer in my place — with sources. Anything that genuinely needs my call (the\n"
                        "launch date is the obvious one) will reach me directly, and I'll turn it around quickly.\n\n"
                        "— Siddhi\n",
            },
            {
                "author": "dev",
                "body": "Noted — enjoy the break. We'll route through your Alter where it can, and come to you only\n"
                        "for the calls.\n\n— Dev\n",
            },
        ],
    )

    run_thread(
        "qa-signoff", "QA sign-off — can we commit to Oct 30?",
        [
            {
                "author": "dev",
                "body": "Planning question ahead of the launch: can QA commit to sign-off by October 30?\n"
                        "Test plan v1 is in the shared folder. There are 2 open bugs right now, one of them the\n"
                        "iOS sign-in crash. If Oct 30 is realistic I'll put it in the plan; if not, tell me what has\n"
                        "to close first.\n\n— Dev\n",
            },
        ],
    )


def next_weekday(hour, minute=0):
    now = datetime.now().astimezone()
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= now:
        candidate = candidate + timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate = candidate + timedelta(days=1)
    return candidate


def ensure_calendar(characters, manifest):
    if "dev" not in characters:
        print("[calendar] waiting for dev")
        return
    dev = characters["dev"]
    calendar = service(dev, "calendar", "v3")
    events = manifest.setdefault("events", {})
    others = [c for c in characters.values() if c["key"] != "dev"]

    def ensure_event(key, summary, start, end, attendees, description, transparency=None, owner="dev"):
        if events.get(key):
            print(f"[event:{key}] exists")
            return
        event_id = sha256(f"{WORLD}:{key}".encode()).hexdigest()
        body = {
            "id": event_id,
            "summary": summary,
            "description": description,
            "start": {"dateTime": start.isoformat(), "timeZone": "Asia/Kolkata"},
            "end": {"dateTime": end.isoformat(), "timeZone": "Asia/Kolkata"},
            "extendedProperties": {"private": {"alterOperation": f"{WORLD}:{key}"}},
        }
        if attendees:
            body["attendees"] = [{"email": c["email"], "displayName": c["name"]} for c in attendees]
        if transparency:
            body["transparency"] = transparency
        try:
            created = run(service(characters[owner], "calendar", "v3").events().insert(
                calendarId="primary", body=body,
                sendUpdates="all" if attendees else "none",
            ))
            events[key] = created.get("htmlLink", event_id)
            print(f"[event:{key}] created: {summary} ({'invites sent' if attendees else 'no attendees yet'})")
        except Exception as exc:
            status = getattr(getattr(exc, "resp", None), "status", None)
            if status == 409:
                events[key] = event_id
                print(f"[event:{key}] exists")
            else:
                raise

    sync_start = next_weekday(14, 0)
    ensure_event(
        "sync", "Login revamp · team sync", sync_start, sync_start + timedelta(minutes=30),
        others,
        "Agenda: status doc, mock-ups, launch date.\nRahul is on leave — his Alter attends in his place.",
    )
    review_start = next_weekday(11, 0)
    ensure_event(
        "mockups", "Kani — sign-in mock-up review", review_start, review_start + timedelta(minutes=30),
        [c for c in characters.values() if c["key"] in ("dev", "kani") and c["key"] != "dev"] or [],
        "Walk through the mobile mock-ups for the one-tap flow.",
    )
    if "siddhi" in characters:
        away_start = next_weekday(9, 0)
        ensure_event(
            "siddhi-away", "On leave — login revamp covered by my Alter", away_start, away_start + timedelta(days=5),
            [], "Anything urgent reaches me directly; everything else my Alter answers with sources.",
            transparency="transparent", owner="siddhi",
        )

    def add_missing_attendees(key, wanted):
        """When a character comes online later, fold them into the existing invite."""
        if not events.get(key) or not wanted:
            return
        event_id = sha256(f"{WORLD}:{key}".encode()).hexdigest()
        try:
            current = run(calendar.events().get(calendarId="primary", eventId=event_id))
        except Exception:
            return
        have = {a.get("email") for a in current.get("attendees", [])}
        missing = [c for c in wanted if c["email"] not in have]
        if not missing:
            return
        attendees = current.get("attendees", []) + [{"email": c["email"], "displayName": c["name"]} for c in missing]
        run(calendar.events().patch(calendarId="primary", eventId=event_id, body={"attendees": attendees}, sendUpdates="all"))
        print(f"[event:{key}] attendees added: {', '.join(c['email'] for c in missing)}")

    add_missing_attendees("sync", others)
    add_missing_attendees("mockups", [c for c in characters.values() if c["key"] == "kani"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-docs", action="store_true")
    parser.add_argument("--skip-threads", action="store_true")
    parser.add_argument("--skip-calendar", action="store_true")
    args = parser.parse_args()

    characters = load_characters()
    if not characters:
        raise SystemExit("No character credentials found in " + str(secret_dir()))
    print("characters online: " + ", ".join(f"{c['key']} <{c['email']}>" for c in characters.values()))
    manifest = load_manifest()

    if not args.skip_docs:
        ids = ensure_docs(characters, manifest)
        if "kani" in characters:
            ensure_comment(
                characters, manifest, "kani", ids["designDoc"], "comment-kani-design",
                "One-tap as the primary path — mock-ups coming Friday. Two questions for the team: "
                "fallback prominence and whether we show it on iPad. Notes to follow in the doc.",
            )
        if "sahil" in characters:
            ensure_comment(
                characters, manifest, "sahil", ids["statusDoc"], "comment-sahil-status",
                "AUTH-112 is verified in prod — I'll keep the tracker row current as the crash fix lands.",
            )
        if "dev" in characters:
            ensure_comment(
                characters, manifest, "dev", ids["statusDoc"], "comment-dev-status",
                "Status demo is on for Thursday's review — one open question is the QA sign-off date (thread sent).",
            )
    if not args.skip_threads:
        ensure_threads(characters, manifest)
    if not args.skip_calendar:
        ensure_calendar(characters, manifest)

    save_manifest(manifest)
    print("WORLD_SEEDED")


if __name__ == "__main__":
    main()
