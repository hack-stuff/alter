"""Connected storyboard paths and failure/security boundaries using local adapters."""

import asyncio
import json
import pytest
from dataclasses import replace
from time import sleep

from app.auth import Caller
from app.escalations import date_decision
from app.live import LiveRelay
from app.meeting_models import LiveStart


def wait_for(c, h, mid, states):
    for _ in range(200):
        value = c.get("/v1/meetings/" + mid, headers=h).json()
        if value.get("state") in states:
            return value
        sleep(0.01)
    raise AssertionError(value)


def prepare(team):
    c, e, h, r = team
    response = c.post(
        "/v1/meetings",
        headers=h,
        json={
            "title": "Login revamp · 2:00 meeting",
            "participants": ["dev", "kani", "sahil"],
            "representedMember": "siddhi",
            "consent": True,
        },
    )
    assert response.status_code == 201, response.text
    mid = response.json()["id"]
    segments = [
        {
            "id": "s1",
            "text": "Siddhi switched to Google one-tap on October 8.",
            "kind": "alter",
        },
        {"id": "s2", "text": "When are we launching this?", "kind": "human"},
        {
            "id": "s3",
            "text": "Kani, update the mock-ups. Dev will update the status doc.",
            "kind": "human",
        },
    ]
    assert (
        c.post(
            f"/v1/meetings/{mid}/segments", headers=h, json={"segments": segments}
        ).status_code
        == 200
    )
    assert c.post(f"/v1/meetings/{mid}/finalize", headers=h).status_code == 202
    value = wait_for(c, h, mid, {"ready", "needs_attention"})
    assert value["state"] == "ready", value
    return mid, value


def test_capture_is_scoped_deduplicated_and_closed(team):
    c, e, h, r = team
    mid, value = prepare(team)
    assert value["segmentCount"] == 3
    assert (
        value["decisions"][0]["text"]
        == "Siddhi switched to Google one-tap on October 8."
    )
    assert len(value["approvals"]) == 2
    assert len(e.store.list(f"workspaces/{r['workspaceId']}/escalations")) == 1
    other = {"X-Dev-Uid": "bob"}
    c.post("/v1/workspaces", headers=other, json={"name": "Bob"})
    assert c.get("/v1/meetings/" + mid, headers=other).status_code == 404
    assert (
        c.post(
            f"/v1/meetings/{mid}/segments",
            headers=h,
            json={"segments": [{"id": "late", "text": "Late data"}]},
        ).status_code
        == 409
    )
    assert c.post(f"/v1/meetings/{mid}/finalize", headers=h).status_code == 202
    assert len(e.store.list("workflowJobs")) == 1


def test_bundle_revision_approval_and_continuation(team):
    c, e, h, r = team
    mid, value = prepare(team)
    response = c.post(
        f"/v1/meetings/{mid}/revise",
        headers=h,
        json={
            "expectedRevision": value["revision"],
            "instruction": "Add that Kani's mock-ups are due Friday.",
        },
    )
    assert response.status_code == 200, response.text
    revised = response.json()
    assert all(t["due"] == "Friday" for t in revised["tasks"] if t["owner"] == "kani")
    email = next(a for a in revised["approvals"] if a["kind"] == "email")
    assert "friday" in json.dumps(email).lower()
    bad = c.post(
        f"/v1/meetings/{mid}/approve",
        headers=h,
        json={
            "expectedRevision": value["revision"],
            "approvals": {a["id"]: a["revision"] for a in value["approvals"]},
        },
    )
    assert bad.status_code == 409
    body = {
        "expectedRevision": revised["revision"],
        "approvals": {a["id"]: a["revision"] for a in revised["approvals"]},
        "allowContinuation": True,
    }
    response = c.post(f"/v1/meetings/{mid}/approve", headers=h, json=body)
    assert response.status_code == 202, response.text
    for _ in range(300):
        result = c.get("/v1/meetings/" + mid, headers=h).json()
        if result["continuation"] in ("completed", "needs_review"):
            break
        sleep(0.01)
    assert result["state"] == "completed", result
    assert result["continuation"] == "completed", result
    assert all(a["state"] == "applied" for a in result["approvals"])
    root = f"workspaces/{r['workspaceId']}"
    for member in ["dev", "kani", "sahil"]:
        assert len(e.store.list(root + f"/inbox/{member}/messages")) == 1
    current = e.apps.read_doc(
        r["workspaceId"], e.store.get(root)["googleIds"]["statusDoc"]
    )
    assert any(s["section"] == "Production readiness" for s in current["sections"])
    # A delivery retry cannot create more documents or messages.
    for job in e.store.list("workflowJobs"):
        asyncio.run(e.workflows.run(job["id"]))
    assert len(e.store.list(root + "/inbox/kani/messages")) == 1


def test_segment_ids_cannot_be_replaced(team):
    c, e, h, _ = team
    response = c.post(
        "/v1/meetings",
        headers=h,
        json={"title": "Meeting", "participants": ["dev"], "consent": True},
    )
    mid = response.json()["id"]
    body = {"segments": [{"id": "one", "text": "Original transcript"}]}
    assert (
        c.post(f"/v1/meetings/{mid}/segments", headers=h, json=body).json()["saved"]
        == 1
    )
    assert (
        c.post(f"/v1/meetings/{mid}/segments", headers=h, json=body).json()["saved"]
        == 1
    )
    body["segments"][0]["text"] = "Replaced transcript"
    assert (
        c.post(f"/v1/meetings/{mid}/segments", headers=h, json=body).status_code == 409
    )


def test_scripted_owner_confirmation_resolves_field_and_notifies_team(team):
    c, e, h, r = team
    mid, value = prepare(team)
    root = f"workspaces/{r['workspaceId']}"
    workspace = e.store.get(root)
    e.store.set(root, {**workspace, "director": True})
    uid = "siddhi-phone"
    claim = c.post(
        "/v1/director/claim",
        headers={"X-Dev-Uid": uid},
        json={
            "workspaceId": r["workspaceId"],
            "memberId": "siddhi",
            "key": "director-test",
        },
    )
    assert claim.status_code == 200
    text = "November 3. Tell them that's the date."
    assert date_decision(text)["date"].endswith("-11-03")
    response = c.post(
        f"/v1/escalations/{value['escalationId']}/respond",
        headers={"X-Dev-Uid": uid},
        json={"text": text},
    )
    assert response.status_code == 200, response.text
    assert response.json()["effectState"] == "applied"
    current = e.apps.read_doc(r["workspaceId"], workspace["googleIds"]["statusDoc"])
    launch = next(s for s in current["sections"] if s["section"] == "Launch")
    assert "11-03" in launch["lines"][0] and "awaiting" not in launch["lines"][0]
    for member in ["dev", "kani", "sahil"]:
        assert e.store.list(root + f"/inbox/{member}/messages")
    assert (
        c.post(
            f"/v1/escalations/{value['escalationId']}/respond",
            headers={"X-Dev-Uid": uid},
            json={"text": text},
        ).status_code
        == 409
    )


def test_live_tickets_are_single_use_scoped_and_session_release_allows_reconnect(team):
    c, e, h, r = team
    e.settings = replace(e.settings, live_model="test-native-audio")
    relay = LiveRelay(e)
    ctx = e.auth.member(Caller("alice"))
    first = relay.start(ctx, LiveStart(mode="chat"))
    value = relay.consume(first["ticket"])
    import pytest

    with pytest.raises(ValueError):
        relay.consume(first["ticket"])
    key = relay.reserve(value, "session-one")
    with pytest.raises(ValueError):
        relay.reserve(value, "session-two")
    e.store.atomic(lambda tx: tx.delete(key))
    relay.reserve(value, "session-two")
    bad = c.post(
        "/v1/live/sessions", headers=h, json={"mode": "revise", "targetId": "unknown"}
    )
    assert bad.status_code in (404, 503)


def test_queue_worker_requires_service_identity(team):
    c, e, h, r = team
    assert c.post("/internal/workflows/unknown", headers=h).status_code == 403
    assert (
        c.post(
            "/v1/meetings",
            headers=h,
            json={"title": "Meeting", "participants": ["outsider"], "consent": True},
        ).status_code
        == 403
    )


@pytest.mark.parametrize("revocation", ["grant", "sharing", "evidence"])
def test_revoked_continuation_cannot_write(team, monkeypatch, revocation):
    c, e, h, r = team
    mid, value = prepare(team)

    async def hold(_jid):
        return

    monkeypatch.setattr(e.workflows, "dispatch", hold)
    response = c.post(
        f"/v1/meetings/{mid}/approve",
        headers=h,
        json={
            "expectedRevision": value["revision"],
            "approvals": {a["id"]: a["revision"] for a in value["approvals"]},
            "allowContinuation": True,
        },
    )
    asyncio.run(e.workflows.run(response.json()["jobId"]))
    context = e.auth.member(Caller("alice"))
    if revocation == "grant":
        e.meetings.revoke(context, mid)
    elif revocation == "sharing":
        path = f"workspaces/{r['workspaceId']}/rules/siddhi/items/share-status"
        rule = e.store.get(path)
        e.store.set(path, {**rule, "mode": "deny"})
    else:
        root = f"workspaces/{r['workspaceId']}"
        workspace = e.store.get(root)
        e.store.set(
            root,
            {**workspace, "knowledgeEpoch": workspace.get("knowledgeEpoch", 0) + 1},
        )
        # A cached reply from an older knowledge epoch must not authorize a later write.
        meeting = e.store.get(root + "/meetings/" + mid)
        e.store.set(
            root + "/meetings/" + mid,
            {
                **meeting,
                "followupAnswer": {
                    "outcome": "allow",
                    "answer": "Old evidence",
                    "citations": [{"sourceId": "old", "locator": "old"}],
                    "_knowledgeEpoch": 0,
                    "_memoryEpoch": 0,
                },
            },
        )
    continuation = next(
        j for j in e.store.list("workflowJobs") if j["kind"] == "continue"
    )
    asyncio.run(e.workflows.run(continuation["id"]))
    root = f"workspaces/{r['workspaceId']}"
    doc = e.apps.read_doc(r["workspaceId"], e.store.get(root)["googleIds"]["statusDoc"])
    assert not any(s["section"] == "Production readiness" for s in doc["sections"])
    if revocation == "grant":
        assert e.meetings.owned(context, mid)["grant"]["state"] == "revoked"


def test_saved_job_survives_engine_restart_and_pause(team, monkeypatch):
    from app.engine import Engine

    c, e, h, r = team

    async def hold(_jid):
        return

    monkeypatch.setattr(e.workflows, "dispatch", hold)
    mid = c.post(
        "/v1/meetings",
        headers=h,
        json={"title": "Restart test", "participants": ["kani"], "consent": True},
    ).json()["id"]
    c.post(
        f"/v1/meetings/{mid}/segments",
        headers=h,
        json={"segments": [{"id": "s1", "text": "Siddhi switched to one-tap."}]},
    )
    job = c.post(f"/v1/meetings/{mid}/finalize", headers=h).json()["jobId"]
    context = e.auth.member(Caller("alice"))
    e.meetings.command(context, mid, "pause")
    asyncio.run(e.workflows.run(job))
    assert e.store.get("workflowJobs/" + job)["state"] == "paused"
    e.meetings.command(context, mid, "resume")
    restarted = Engine(e.settings, store=e.store)
    asyncio.run(restarted.workflows.reconcile())
    assert restarted.meetings.owned(context, mid)["state"] == "ready"
    assert restarted.store.get("workflowJobs/" + job)["state"] == "completed"


def test_explicit_retry_uses_a_new_cloud_task_name(team, monkeypatch):
    import google.auth
    from google.auth.transport import requests
    from types import SimpleNamespace

    c, e, h, r = team

    async def hold(_jid):
        return

    monkeypatch.setattr(e.workflows, "dispatch", hold)
    names = []

    class Session:
        def __init__(self, _credentials):
            pass

        def post(self, _url, json, timeout):
            names.append(json["task"]["name"])
            return SimpleNamespace(status_code=200)

    monkeypatch.setattr(
        google.auth, "default", lambda **kwargs: (object(), "test-project")
    )
    monkeypatch.setattr(requests, "AuthorizedSession", Session)
    mid = c.post(
        "/v1/meetings",
        headers=h,
        json={"title": "Retry test", "participants": ["kani"], "consent": True},
    ).json()["id"]
    c.post(
        f"/v1/meetings/{mid}/segments",
        headers=h,
        json={"segments": [{"id": "s1", "text": "A captured work statement."}]},
    )
    jid = c.post(f"/v1/meetings/{mid}/finalize", headers=h).json()["jobId"]
    e.workflows._dispatch_cloud(jid)
    first = e.store.get("workflowJobs/" + jid)
    e.store.set("workflowJobs/" + jid, {**first, "state": "failed"})
    e.meetings.command(e.auth.member(Caller("alice")), mid, "retry")
    e.workflows._dispatch_cloud(jid)
    assert len(names) == 2 and names[0] != names[1]


def test_room_credentials_are_bound_to_capture_and_cannot_approve(team):
    c, e, h, r = team
    mid = c.post(
        "/v1/meetings",
        headers=h,
        json={"title": "Room test", "participants": ["kani"], "consent": True},
    ).json()["id"]
    token = c.post(f"/v1/meetings/{mid}/room", headers=h).json()["token"]
    room = {"X-Meeting-Room": token}
    assert (
        c.post(
            f"/v1/meetings/{mid}/segments",
            headers=room,
            json={"segments": [{"id": "room1", "text": "Meeting audio."}]},
        ).status_code
        == 200
    )
    assert (
        c.post(
            "/v1/meetings/other/segments",
            headers=room,
            json={"segments": [{"id": "room2", "text": "Cross-meeting data"}]},
        ).status_code
        == 403
    )
    assert c.get("/v1/workspace", headers=room).status_code == 401
    assert (
        c.post(
            f"/v1/meetings/{mid}/approve",
            headers=room,
            json={"expectedRevision": 1, "approvals": {}},
        ).status_code
        == 401
    )
    assert c.post(f"/v1/meetings/{mid}/finalize", headers=h).status_code == 202
    assert (
        c.post(
            f"/v1/meetings/{mid}/segments",
            headers=room,
            json={"segments": [{"id": "late", "text": "Late"}]},
        ).status_code
        == 409
    )


def test_memory_audience_corrections_and_source_versions(team):
    from app.knowledge.retrieve import retrieve

    c, e, h, r = team
    owner = r["memberId"]
    body = {"content": "Lighthouse uses the blue checklist.", "audience": "owner"}
    memory = c.post("/v1/memories", headers=h, json=body).json()
    c.post(
        f"/v1/memories/{memory['id']}/decision", headers=h, json={"decision": "approve"}
    )
    assert not any(
        s["sourceId"] == memory["id"]
        for s in retrieve(
            e.store,
            r["workspaceId"],
            owner,
            "Lighthouse",
            personal=True,
            requester="dev",
        )
    )
    assert any(
        s["sourceId"] == memory["id"]
        for s in retrieve(
            e.store,
            r["workspaceId"],
            owner,
            "Lighthouse",
            personal=True,
            requester=owner,
        )
    )
    revised = c.put(
        "/v1/memories/" + memory["id"],
        headers=h,
        json={
            **body,
            "content": "Lighthouse uses the green checklist.",
            "expectedVersion": 1,
        },
    )
    assert revised.status_code == 200 and revised.json()["state"] == "proposed"
    assert not any(
        s["sourceId"] == memory["id"]
        for s in retrieve(
            e.store,
            r["workspaceId"],
            owner,
            "Lighthouse",
            personal=True,
            requester=owner,
        )
    )
    source = c.post(
        "/v1/sources",
        headers=h,
        json={
            "title": "Selected source",
            "text": "Lighthouse uses the green checklist.",
        },
    ).json()
    assert (
        c.post(
            "/v1/memories",
            headers=h,
            json={**body, "audience": "team", "sourceIds": [source["id"]]},
        ).status_code
        == 403
    )
    derived = c.post(
        "/v1/memories", headers=h, json={**body, "sourceIds": [source["id"]]}
    ).json()
    assert (
        c.put(
            "/v1/sources/" + source["id"],
            headers=h,
            json={"text": "Lighthouse changed its checklist.", "expectedVersion": 1},
        ).status_code
        == 200
    )
    assert (
        c.post(
            "/v1/memories/" + derived["id"] + "/decision",
            headers=h,
            json={"decision": "approve"},
        ).status_code
        == 409
    )


def test_vertex_relay_releases_server_session_and_forwards_audio(team, monkeypatch):
    from google import genai
    from google.genai import types

    c, e, h, r = team
    e.settings = replace(
        e.settings, live_model="test-native-audio", cors_origins=("http://testclient",)
    )
    received = []

    class FakeSession:
        def __init__(self):
            self.queue = asyncio.Queue()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def send_realtime_input(self, **kwargs):
            received.append(kwargs)
            await self.queue.put(
                types.LiveServerMessage(
                    server_content=types.LiveServerContent(
                        model_turn=types.Content(
                            parts=[
                                types.Part(
                                    inline_data=types.Blob(
                                        data=b"\x00\xff",
                                        mime_type="audio/pcm;rate=24000",
                                    )
                                )
                            ]
                        ),
                        turn_complete=True,
                    )
                )
            )

        async def receive(self):
            yield await self.queue.get()

    class FakeClient:
        def __init__(self, **kwargs):
            self.aio = self
            self.live = self

        def connect(self, model, config):
            types.LiveConnectConfig.model_validate(config)
            assert (
                config["tools"][0]["function_declarations"][0]["name"] == "alter_chat"
            )
            return FakeSession()

        async def aclose(self):
            pass

    monkeypatch.setattr(genai, "Client", FakeClient)
    ticket = c.post("/v1/live/sessions", headers=h, json={"mode": "chat"}).json()[
        "ticket"
    ]
    with c.websocket_connect(
        "/v1/live/connect", headers={"origin": "http://testclient"}
    ) as socket:
        socket.send_json({"ticket": ticket})
        assert socket.receive_json()["ready"]
        socket.send_json({"audio": "AAD/AA=="})
        response = socket.receive_json()
        assert (
            response["serverContent"]["modelTurn"]["parts"][0]["inlineData"]["data"]
            == "AP8="
        )
    for _ in range(100):
        if not e.store.list(f"workspaces/{r['workspaceId']}/liveRelaySessions"):
            break
        sleep(0.01)
    assert received[0]["audio"]["mime_type"] == "audio/pcm;rate=16000"
    assert not e.store.list(f"workspaces/{r['workspaceId']}/liveRelaySessions")


def test_friday_edit_moves_only_the_named_task(team):
    c, e, h, r = team
    mid, value = prepare(team)
    response = c.post(
        f"/v1/meetings/{mid}/revise",
        headers=h,
        json={"expectedRevision": value["revision"], "instruction": "Move Dev's status doc to Friday."},
    )
    assert response.status_code == 200, response.text
    due = {t["owner"]: t["due"] for t in response.json()["tasks"]}
    assert due["dev"] == "Friday" and due["kani"] != "Friday"


def test_meeting_launch_answer_is_not_reused_after_it_is_answered(team):
    c, e, h, r = team
    mid, value = prepare(team)
    first = c.post(f"/v1/meetings/{mid}/ask", headers=h, json={"question": "When are we launching?"})
    assert first.status_code == 200, first.text
    asked = first.json().get("escalationId")
    assert asked
    path = f"workspaces/{r['workspaceId']}/escalations/{asked}"
    assert c.post(f"/v1/meetings/{mid}/ask", headers=h, json={"question": "Is the launch date set?"}).json().get("escalationId") == asked
    e.store.set(path, {**e.store.get(path), "state": "answered"})
    again = c.post(f"/v1/meetings/{mid}/ask", headers=h, json={"question": "Is the launch date set?"})
    assert again.status_code == 200, again.text
    assert again.json().get("escalationId") != asked
