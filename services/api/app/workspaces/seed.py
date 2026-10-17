from datetime import datetime, time, timedelta, timezone
import json
from app.config import SEED_DIR
from app.util import iso, now, zone

SLOTS = ("qa_lead", "security_engineer", "data_analyst", "qa_lead")


def load(relative):
    return json.loads((SEED_DIR / relative).read_text())


def calendar_events(time_zone="UTC", today=None):
    """The team's demo calendar for the next five days, at local hours in the workspace's zone.

    Attendees are member IDs, or "slot:<role>" for people who join with their own name.
    Times are stored in UTC.
    """
    local = zone(time_zone)
    first = (today or now()).astimezone(local).date()
    events = []
    for block in load("calendar/blocks.json"):
        hour, minute = (int(part) for part in block["start"].split(":"))
        for offset in range(block["day"], block["day"] + block.get("days", 1)):
            start = datetime.combine(first + timedelta(days=offset), time(hour, minute), local)
            events.append(
                {
                    "key": f"{block['key']}-{offset}",
                    "title": block["title"],
                    "attendees": block["members"],
                    "start": start.astimezone(timezone.utc).isoformat(),
                    "end": (start + timedelta(minutes=block["minutes"]))
                    .astimezone(timezone.utc)
                    .isoformat(),
                }
            )
    return events


def calendar_keys(store, wid, member_ids):
    """Everything a member answers to on the calendar: their ID and their role slot."""
    keys = set(member_ids)
    for mid in member_ids:
        slot = (store.get(f"workspaces/{wid}/members/{mid}") or {}).get("slot")
        if slot:
            keys.add("slot:" + slot)
    return keys


def seed_workspace(tx, wid, human_id, name, uid, slot="qa_lead"):
    prefix = f"workspaces/{wid}"
    for mid in load("team.json")["members"]:
        profile = load(f"members/{mid}.json")
        tx.set(
            f"{prefix}/members/{mid}",
            {k: profile[k] for k in ("name", "role", "status")} | {"kind": "seeded"},
        )
        rules = load(f"policies/{'siddhi' if mid == 'siddhi' else 'slot-default'}.json")[
            "rules"
        ]
        for rule in rules:
            tx.set(f"{prefix}/rules/{mid}/items/{rule['id']}", rule)
        for source in profile["sources"]:
            tx.set(
                f"{prefix}/sources/{mid}_{source['id']}",
                {
                    **source,
                    "logicalId": source["id"],
                    "owner": mid,
                    "audience": "owner",
                },
            )
    for key in ("designDoc", "statusDoc", "wiki", "testPlan"):
        document = load(f"docs/{key}.json")
        for index, section in enumerate(document["sections"]):
            tx.set(
                f"{prefix}/sources/{document['id']}_{index}",
                {
                    "logicalId": document["id"],
                    "title": document["title"],
                    "locator": section["section"],
                    "text": "\n".join(section["lines"]),
                    "scope": "work",
                    "audience": "team",
                    "documentKey": key,
                },
            )
    seed_member(tx, wid, human_id, name, uid, slot)


def seed_member(tx, wid, mid, name, uid, slot):
    profile = load(f"slots/{slot}.json")
    prefix = f"workspaces/{wid}"
    tx.set(
        f"{prefix}/members/{mid}",
        {
            "name": name,
            "uid": uid,
            "slot": slot,
            "role": profile["role"],
            "kind": "human",
            "status": "available",
            "joinedAt": iso(),
        },
    )
    for rule in load("policies/slot-default.json")["rules"]:
        tx.set(f"{prefix}/rules/{mid}/items/{rule['id']}", rule)
    tx.set(
        f"{prefix}/memories/starter_{mid}",
        {
            "owner": mid,
            "content": profile["text"],
            "source": "starter",
            "state": "approved",
            "scope": "work",
        },
    )
    tx.set(f"userBindings/{uid}", {"workspaceId": wid, "memberId": mid})
