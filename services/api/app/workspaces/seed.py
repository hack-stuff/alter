import json
from app.config import SEED_DIR
from app.util import iso

SLOTS = ("qa_lead", "security_engineer", "data_analyst", "qa_lead")


def load(relative):
    return json.loads((SEED_DIR / relative).read_text())


def seed_workspace(tx, wid, human_id, name, uid, slot="qa_lead"):
    prefix = f"workspaces/{wid}"
    for mid in load("team.json")["members"]:
        profile = load(f"members/{mid}.json")
        tx.set(
            f"{prefix}/members/{mid}",
            {k: profile[k] for k in ("name", "role", "status")} | {"kind": "seeded"},
        )
        rules = load(f"policies/{'rahul' if mid == 'rahul' else 'slot-default'}.json")[
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
            "email": "",
            "emailVerified": False,
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
