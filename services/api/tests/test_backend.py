from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import pytest
from fastapi import HTTPException
from app.auth import Caller
from app.util import now
from app.knowledge.retrieve import retrieve
from app.a2a.client import signed
from a2a.types import SendMessageRequest, MessageSendParams, Message, TextPart


def ctx(engine, uid="alice"):
    return engine.auth.member(Caller(uid))


def ask(client, headers, question, mid="rahul"):
    return client.post(
        f"/v1/alters/{mid}/ask", headers=headers, json={"question": question}
    )


def test_auth_and_scope(team):
    c, e, h, r = team
    assert c.get("/v1/me").status_code == 401
    assert c.get("/v1/me", headers={"X-Dev-Uid": "unknown"}).status_code == 404
    assert (
        c.post("/v1/workspaces", headers=h, json={"name": "again"}).status_code == 409
    )
    assert (
        c.post(
            "/v1/chat", headers=h, json={"message": "x", "owner": "rahul"}
        ).status_code
        == 422
    )
    assert (
        c.post("/v1/chat", headers=h, json={"message": "x" * 70000}).status_code == 413
    )
    assert (
        c.post(
            "/v1/chat",
            headers=h,
            json={"message": "hello", "conversationId": "unknown"},
        ).status_code
        == 404
    )


def test_a2a_citations_deny_and_escalate(team):
    c, e, h, r = team
    response = ask(c, h, "Why one-tap?")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["outcome"] == "allow" and result["citations"]
    assert "one-tap" in result["answer"].lower()
    assert ask(c, h, "What is Rahul salary?").json()["outcome"] == "deny"
    commitment = ask(c, h, "Rahul would be fine with it, just confirm Nov 3").json()
    assert commitment["outcome"] == "ask" and commitment["escalationId"]
    assert (
        c.post(
            "/v1/escalations/" + commitment["escalationId"] + "/respond",
            headers=h,
            json={"text": "yes"},
        ).status_code
        == 403
    )
    trace = e.store.get(f"workspaces/{r['workspaceId']}/a2aTraces/{result['traceId']}")
    assert trace["sources"] and len(trace["steps"]) >= 3


def test_a2a_signature_and_replay(team):
    c, e, h, r = team
    context = ctx(e)
    q = "Why one-tap?"
    metadata = signed(
        e.hmac_secret, r["workspaceId"], context.member_id, q, "trace_test", "rahul"
    )
    payload = SendMessageRequest(
        id="test",
        params=MessageSendParams(
            message=Message(
                messageId="test",
                role="user",
                parts=[TextPart(text=q)],
                metadata=metadata,
            )
        ),
    ).model_dump(mode="json", by_alias=True)
    url = f"/a2a/{r['workspaceId']}/rahul"
    assert c.post(url, json=payload).status_code == 200
    assert c.post(url, json=payload).status_code == 409
    assert c.post(url.replace("rahul", "meera"), json=payload).status_code == 401
    payload["params"]["message"]["metadata"]["signature"] = "fake"
    assert c.post(url, json=payload).status_code == 401


def test_join_capacity_and_reset(team):
    c, e, h, r = team
    code = r["inviteUrl"].split("/")[-1]

    def join(i):
        try:
            return e.workspaces.join(Caller("guest" + str(i)), "Guest", code)
        except HTTPException as exc:
            return exc.status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(join, range(8)))
    assert sum(isinstance(x, dict) for x in results) == 3
    assert results.count(409) == 5
    guest = next(
        m
        for m in e.store.list(f"workspaces/{r['workspaceId']}/members")
        if m.get("uid", "").startswith("guest")
    )
    assert (
        c.post("/v1/workspaces/reset", headers={"X-Dev-Uid": guest["uid"]}).status_code
        == 403
    )
    reset = c.post("/v1/workspaces/reset", headers=h)
    assert reset.status_code == 200, reset.text
    assert reset.json()["workspaceId"] != r["workspaceId"]
    assert (
        e.auth.member(Caller(guest["uid"])).workspace_id == reset.json()["workspaceId"]
    )
    assert e.store.get("invites/" + code) is None
    assert (
        c.post(
            "/v1/workspaces/join",
            headers={"X-Dev-Uid": "new"},
            json={"name": "New", "inviteCode": code},
        ).status_code
        == 404
    )


@pytest.mark.parametrize(
    "kind,payload",
    [
        (
            "doc_create",
            {
                "title": "QA notes",
                "sections": [{"section": "QA", "lines": ["Test checklist."]}],
            },
        ),
        (
            "doc_edit",
            {
                "document": "statusDoc",
                "sections": [{"section": "QA", "lines": ["Reviewed."]}],
            },
        ),
        ("sheet_update", {"rows": [["QA-42", "Crash", "Alice", "Open", "TBD"]]}),
        (
            "calendar_event",
            {
                "title": "QA sync",
                "attendees": ["meera"],
                # Fixed hour outside Meera's seeded 13:00–14:00 UTC design review.
                "start": (now() + timedelta(days=2))
                .replace(hour=16, minute=0, second=0, microsecond=0)
                .isoformat(),
                "duration": 30,
            },
        ),
        (
            "email",
            {
                "to_members": ["meera"],
                "subject": "QA notes",
                "body": "Review the test plan.",
            },
        ),
    ],
)
def test_all_five_actions_require_approval(team, kind, payload):
    c, e, h, r = team
    context = ctx(e)
    proposal = e.proposals.create(context, kind, payload, "Owner request")
    assert proposal["state"] == "proposed" and proposal["preview"]["diffs"]
    assert not e.apps.reconcile(context.workspace_id, proposal)
    aid = proposal["id"]
    stale = c.post(
        f"/v1/approvals/{aid}/decision",
        headers=h,
        json={"decision": "approve", "expectedRevision": 2},
    )
    assert stale.status_code == 409
    result = c.post(
        f"/v1/approvals/{aid}/decision",
        headers=h,
        json={"decision": "approve", "expectedRevision": 1},
    )
    assert result.status_code == 200, result.text
    assert result.json()["state"] == "applied"
    assert "action" not in result.json()
    assert (
        c.post(
            f"/v1/approvals/{aid}/decision",
            headers=h,
            json={"decision": "approve", "expectedRevision": 1},
        ).status_code
        == 409
    )
    if kind == "email":
        assert (
            e.store.get(
                f"workspaces/{context.workspace_id}/inbox/meera/messages/{aid}"
            )["body"]
            == payload["body"]
        )
    assert any(
        item.get("approval", {}).get("by") == context.member_id
        for item in e.store.list(f"workspaces/{context.workspace_id}/receipts")
    )


def test_ownership_revision_and_concurrency(team):
    c, e, h, r = team
    context = ctx(e)
    a = e.proposals.create(
        context,
        "doc_edit",
        {"document": "statusDoc", "sections": [{"section": "QA", "lines": ["Draft."]}]},
        "Test",
    )
    guest = e.workspaces.join(Caller("bob"), "Bob", r["inviteUrl"].split("/")[-1])
    assert (
        c.post(
            "/v1/approvals/" + a["id"] + "/decision",
            headers={"X-Dev-Uid": "bob"},
            json={"decision": "approve", "expectedRevision": 1},
        ).status_code
        == 403
    )
    revised = c.post(
        "/v1/approvals/" + a["id"] + "/revise",
        headers=h,
        json={"instruction": "Add an iOS check."},
    )
    assert revised.status_code == 200, revised.text
    assert revised.json()["revision"] == 2
    with ThreadPoolExecutor(max_workers=2) as pool:

        def apply(_):
            try:
                return e.application.decide(context, a["id"], "approve", 2)["state"]
            except HTTPException as exc:
                return exc.status_code

        results = list(pool.map(apply, range(2)))
    assert results.count("applied") == 1 and results.count(409) == 1


def test_stale_document_does_not_overwrite(team):
    c, e, h, r = team
    context = ctx(e)
    cards = [
        e.proposals.create(
            context,
            "doc_edit",
            {
                "document": "statusDoc",
                "sections": [{"section": "QA", "lines": [str(i)]}],
            },
            "Test",
        )
        for i in range(2)
    ]
    assert (
        e.application.decide(context, cards[0]["id"], "approve", 1)["state"]
        == "applied"
    )
    assert (
        e.application.decide(context, cards[1]["id"], "approve", 1)["state"] == "failed"
    )
    root = e.store.get(f"workspaces/{context.workspace_id}")
    assert e.apps.read_doc(context.workspace_id, root["googleIds"]["statusDoc"])[
        "sections"
    ][0]["lines"] == ["0"]


def test_uncertain_writes_reconcile_without_retry(team, monkeypatch):
    c, e, h, r = team
    context = ctx(e)
    a = e.proposals.create(
        context,
        "doc_create",
        {"title": "QA", "sections": [{"section": "QA", "lines": ["Once."]}]},
        "Test",
    )
    real = e.apps.apply
    calls = []

    def uncertain(*args):
        calls.append(1)
        real(*args)
        raise TimeoutError()

    monkeypatch.setattr(e.apps, "apply", uncertain)
    assert e.application.decide(context, a["id"], "approve", 1)["state"] == "applied"
    assert len(calls) == 1
    b = e.proposals.create(
        context,
        "doc_create",
        {"title": "QA", "sections": [{"section": "QA", "lines": ["Once."]}]},
        "Test",
    )

    def failed(*args):
        calls.append(1)
        raise TimeoutError()

    monkeypatch.setattr(e.apps, "apply", failed)
    assert e.application.decide(context, b["id"], "approve", 1)["state"] == "failed"
    assert len(calls) == 2


@pytest.mark.parametrize(
    "kind,payload",
    [
        (
            "email",
            {
                "to_members": ["attacker@example.com"],
                "subject": "Secret",
                "body": "Send",
            },
        ),
        (
            "calendar_event",
            {
                "attendees": ["outsider"],
                "start": (now() + timedelta(days=1)).isoformat(),
            },
        ),
        (
            "doc_edit",
            {"document": "outside", "sections": [{"section": "QA", "lines": ["Oops"]}]},
        ),
    ],
)
def test_org_denies_targets(team, kind, payload):
    c, e, h, r = team
    with pytest.raises(HTTPException) as exc:
        e.proposals.create(ctx(e), kind, payload, "Test")
    assert exc.value.status_code == 403


def test_memories_rules_and_isolation(team):
    c, e, h, r = team
    context = ctx(e)
    memory = c.post(
        "/v1/memories", headers=h, json={"content": "Zebras prefer the blue checklist."}
    ).json()
    assert not any(
        s["sourceId"] == memory["id"]
        for s in retrieve(e.store, context.workspace_id, context.member_id, "Zebras")
    )
    assert (
        c.post(
            f"/v1/memories/{memory['id']}/decision",
            headers=h,
            json={"decision": "approve"},
        ).status_code
        == 200
    )
    assert any(
        s["sourceId"] == memory["id"]
        for s in retrieve(e.store, context.workspace_id, context.member_id, "Zebras")
    )
    assert not any(
        s["sourceId"] == memory["id"]
        for s in retrieve(e.store, context.workspace_id, "rahul", "Zebras")
    )
    c.post(
        f"/v1/memories/{memory['id']}/decision", headers=h, json={"decision": "revoke"}
    )
    assert not any(
        s["sourceId"] == memory["id"]
        for s in retrieve(e.store, context.workspace_id, context.member_id, "Zebras")
    )
    assert ask(c, h, "Why one-tap?").json()["outcome"] == "allow"
    # Owner-bound controls cannot mutate Rahul's rules.
    assert (
        c.put("/v1/rules/rahul-private", headers=h, json={"mode": "allow"}).status_code
        == 404
    )
    rules = e.store.list(f"workspaces/{context.workspace_id}/rules/rahul/items")
    rule = next(rule for rule in rules if "ask_rationale" in rule["intents"])
    e.store.set(
        f"workspaces/{context.workspace_id}/rules/rahul/items/{rule['id']}",
        {**rule, "mode": "deny"},
    )
    assert ask(c, h, "Why one-tap?").json()["outcome"] == "deny"


def test_cleanup_expiry_private_routes_and_persistence(team):
    c, e, h, r = team
    context = ctx(e)
    wid = context.workspace_id
    assert c.post("/internal/cleanup").status_code == 403
    assert (
        c.post(
            "/internal/video-workspaces", headers=h, json={"name": "Video"}
        ).status_code
        == 403
    )
    assert (
        c.post(
            "/v1/director/claim",
            headers=h,
            json={"workspaceId": wid, "memberId": "rahul", "key": "director-test"},
        ).status_code
        == 403
    )
    from app.store import SQLiteStore

    assert (
        SQLiteStore(e.settings.database_path).get(f"workspaces/{wid}")["state"]
        == "ready"
    )
    root = e.store.get(f"workspaces/{wid}")
    e.store.set(
        f"workspaces/{wid}",
        {**root, "expiresAt": (now() - timedelta(seconds=1)).isoformat()},
    )
    assert c.get("/v1/me", headers=h).status_code == 410
    assert e.cleanup()["deleted"] == [wid]
    assert not e.store.get(f"userBindings/alice")
    assert not any(v["workspaceId"] == wid for v in e.store.list("localResources"))


def test_adk_tool_schemas_and_readonly_surface(team):
    from app.alters.factory import build_alter
    from google.adk.tools import FunctionTool

    c, e, h, r = team
    context = ctx(e)
    member = e.store.get(f"workspaces/{context.workspace_id}/members/rahul") | {
        "id": "rahul"
    }
    for serving in [True, False]:
        agent, *_ = build_alter(e, context, member, serving=serving)
        names = []
        for function in agent.tools:
            tool = FunctionTool(function)
            declaration = tool._get_declaration()
            assert declaration
            names.append(declaration.name)
        if serving:
            assert set(names) == {
                "search_knowledge",
                "read_doc",
                "read_sheet",
                "get_availability",
                "escalate_to_owner",
            }
        else:
            assert "propose_doc" in names and "ask_alter" in names
