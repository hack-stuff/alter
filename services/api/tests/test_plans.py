from dataclasses import replace
from types import SimpleNamespace
import json


def plan(client, headers):
    response = client.get("/v1/plans/login", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def edit(client, headers, value, instruction="Add a retry state if sign-in fails"):
    return client.post(
        f"/v1/plans/{value['id']}/revise",
        headers=headers,
        json={"expectedRevision": value["revision"], "instruction": instruction},
    )


def test_saved_graph_undo_and_stale_edits(team):
    c, e, h, r = team
    original = plan(c, h)
    response = edit(c, h, original)
    assert response.status_code == 200, response.text
    changed = response.json()
    assert changed["revision"] == 2
    retry = next(n for n in changed["nodes"] if n["id"] == "retry")
    assert all(
        abs(retry["x"] - n["x"]) >= 180 or abs(retry["y"] - n["y"]) >= 130
        for n in original["nodes"]
    )
    assert any(
        n["id"] == "retry" and n["connections"] == ["onetap"] for n in changed["nodes"]
    )
    assert plan(c, h)["nodes"] == changed["nodes"]
    assert edit(c, h, original).status_code == 409
    restored = c.post(
        f"/v1/plans/{changed['id']}/undo", headers=h, json={"expectedRevision": 2}
    ).json()
    assert restored["nodes"] == original["nodes"]
    assert restored["revision"] == 3
    assert restored["canUndo"] is False


def test_publication_is_reviewed_then_read_back(team):
    c, e, h, r = team
    value = edit(c, h, plan(c, h)).json()
    path = f"/v1/plans/{value['id']}/prepare"
    prepared = c.post(
        path, headers=h, json={"expectedRevision": value["revision"]}
    ).json()
    card = prepared["approval"]
    assert card["state"] == "proposed"
    assert "externalUrl" not in card
    assert (
        c.post(path, headers=h, json={"expectedRevision": value["revision"]}).json()[
            "approval"
        ]["id"]
        == card["id"]
    )
    assert (
        c.post(
            f"/v1/approvals/{card['id']}/revise",
            headers=h,
            json={"instruction": "Invent a different graph"},
        ).status_code
        == 409
    )
    response = c.post(
        f"/v1/approvals/{card['id']}/decision",
        headers=h,
        json={"decision": "approve", "expectedRevision": card["revision"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["state"] == "applied"
    published = c.get(f"/v1/artifacts/{card['id']}", headers=h).json()
    assert any(s["section"] == "Retry sign-in" for s in published["sections"])
    assert plan(c, h)["approval"]["state"] == "applied"
    root = f"workspaces/{r['workspaceId']}"
    assert e.store.list(root + "/inbox/meera/messages") == []


def test_changed_graph_cannot_publish_an_old_review(team):
    c, e, h, r = team
    value = plan(c, h)
    prepared = c.post(
        f"/v1/plans/{value['id']}/prepare", headers=h, json={"expectedRevision": 1}
    ).json()
    card = prepared["approval"]
    assert edit(c, h, value).status_code == 200
    assert (
        c.post(
            f"/v1/approvals/{card['id']}/decision",
            headers=h,
            json={"decision": "approve", "expectedRevision": 1},
        ).status_code
        == 409
    )
    assert (
        e.proposals.owned(
            e.auth.member(e.auth.authenticate(None, "alice")), card["id"]
        )["state"]
        == "proposed"
    )


def test_plans_are_owner_scoped_and_live_target_is_real(team):
    c, e, h, r = team
    value = plan(c, h)
    other = {"X-Dev-Uid": "bob"}
    code = r["inviteUrl"].split("/")[-1]
    assert (
        c.post(
            "/v1/workspaces/join",
            headers=other,
            json={"name": "Bob", "inviteCode": code},
        ).status_code
        == 200
    )
    assert c.get(f"/v1/plans/{value['id']}", headers=other).status_code == 404
    e.settings = replace(e.settings, live_model="fake-native-audio")
    assert (
        c.post(
            "/v1/live/sessions",
            headers=h,
            json={"mode": "diagram", "targetId": value["id"]},
        ).status_code
        == 200
    )
    assert (
        c.post(
            "/v1/live/sessions",
            headers=other,
            json={"mode": "diagram", "targetId": value["id"]},
        ).status_code
        == 404
    )
    assert (
        c.post(
            "/v1/live/sessions",
            headers=h,
            json={"mode": "revise", "targetId": "plan-canvas"},
        ).status_code
        == 404
    )


def test_real_model_patch_is_validated_and_failure_keeps_saved_graph(team):
    c, e, h, r = team
    original = plan(c, h)
    e.settings = replace(e.settings, ai_backend="vertex")
    calls = []

    def generate(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            text=json.dumps(
                {
                    "operations": [
                        {"op": "connect", "nodeId": "onetap", "targetId": "invented"}
                    ],
                    "explanation": "Invalid edge",
                }
            )
        )

    e.model_client = SimpleNamespace(models=SimpleNamespace(generate_content=generate))
    assert edit(c, h, original).status_code == 422
    assert plan(c, h)["revision"] == 1
    assert calls[0]["model"] == e.settings.model_fast

    def timeout(**kwargs):
        raise TimeoutError("Must never be returned to the browser")

    e.model_client.models.generate_content = timeout
    response = edit(c, h, original)
    assert response.status_code == 503
    assert "Reference:" in response.text
    assert "Must never" not in response.text
    assert plan(c, h)["nodes"] == original["nodes"]


def test_unknown_local_edit_does_not_claim_success(team):
    c, e, h, r = team
    value = plan(c, h)
    unchanged = edit(c, h, value, "Deploy Kubernetes").json()
    assert unchanged["revision"] == value["revision"]
    assert "No changes were made" in unchanged["explanation"]


def test_actual_agenda_and_meet_link_validation(team):
    c, e, h, r = team
    value = c.get("/v1/day", headers=h).json()
    assert value["name"] == "Alice"
    assert value["meetingPresence"] == "unverified"
    assert value["meetUrl"] == ""
    assert (
        c.put(
            "/v1/day/meet-link",
            headers=h,
            json={"url": "https://evil.example/abc-defg-hij"},
        ).status_code
        == 422
    )
    assert (
        c.put(
            "/v1/day/meet-link", headers=h, json={"url": "https://meet.google.com/new"}
        ).status_code
        == 422
    )
    assert (
        c.put(
            "/v1/day/meet-link",
            headers=h,
            json={"url": "https://meet.google.com/abc-defg-hij"},
        ).status_code
        == 200
    )
    assert (
        c.get("/v1/day", headers=h).json()["meetUrl"]
        == "https://meet.google.com/abc-defg-hij"
    )


def test_demo_day_is_isolated_resumable_and_not_director(system):
    c, e = system
    first = c.post("/v1/demo/day", headers={"X-Dev-Uid": "judge1"}).json()
    second = c.post("/v1/demo/day", headers={"X-Dev-Uid": "judge2"}).json()
    assert first["memberId"] == second["memberId"] == "priya"
    assert first["workspaceId"] != second["workspaceId"]
    assert c.post("/v1/demo/day", headers={"X-Dev-Uid": "judge1"}).json() == first
    e.workspaces.provision(first["workspaceId"])
    root = e.store.get("workspaces/" + first["workspaceId"])
    assert root["director"] is False
    value = c.get("/v1/day", headers={"X-Dev-Uid": "judge1"}).json()
    assert value["role"] == "Product lead"
    assert any("login journey" in event["title"] for event in value["agenda"])
    import asyncio

    asyncio.run(
        e.welcome(first["workspaceId"], "priya", root["generation"], delay=False)
    )
    assert e.store.list(f"workspaces/{first['workspaceId']}/escalations") == []


def test_production_secret_access_does_not_fall_back_to_local_files(
    tmp_path, monkeypatch
):
    from app.secrets import Secrets

    monkeypatch.setenv("ALTER_SECRET_DIR", str(tmp_path))
    (tmp_path / "example.json").write_text("local-only")
    assert Secrets()._local_file("projects/p/secrets/example/versions/latest") is None
    assert (
        Secrets(allow_local=True).read("projects/p/secrets/example/versions/latest")
        == "local-only"
    )


def test_publications_in_independent_demo_runs_have_distinct_provider_operations(
    system,
):
    c, e = system
    ids = []
    for uid in ["publication1", "publication2"]:
        h = {"X-Dev-Uid": uid}
        created = c.post("/v1/demo/day", headers=h).json()
        e.workspaces.provision(created["workspaceId"])
        value = plan(c, h)
        prepared = c.post(
            f"/v1/plans/{value['id']}/prepare", headers=h, json={"expectedRevision": 1}
        ).json()
        card = prepared["approval"]
        response = c.post(
            f"/v1/approvals/{card['id']}/decision",
            headers=h,
            json={"decision": "approve", "expectedRevision": 1},
        )
        assert response.status_code == 200, response.text
        assert c.get(f"/v1/artifacts/{card['id']}", headers=h).status_code == 200
        ids.append(response.json()["externalUrl"])
    assert ids[0] != ids[1]


def test_voice_context_tracks_setup_and_verified_workday(system):
    from app.auth import Caller
    from app.live import LiveRelay
    from app.meeting_models import LiveStart

    c, e = system
    joined = e.workspaces.create(Caller("early-voice"), "Priya", "early-voice", demo_day=True)
    ctx = e.auth.member(Caller("early-voice"))
    context = json.loads(LiveRelay(e).context(ctx, LiveStart(mode="chat")))
    assert context["owner"] == "Priya"
    assert context["setupState"] == "provisioning"
    assert context["workday"]["agenda"] == []
    assert (
        c.get("/v1/plans/login", headers={"X-Dev-Uid": "early-voice"}).status_code
        == 409
    )
    e.workspaces.provision(joined["workspaceId"])
    ready_context = json.loads(LiveRelay(e).context(ctx, LiveStart(mode="chat")))
    assert ready_context["workday"]["project"] == "Login revamp"
    assert ready_context["workday"]["pendingDrafts"] == []
    assert [item["title"] for item in ready_context["workday"]["agenda"]] == [
        "Review Meera's login journey",
        "Login revamp · team sync",
    ]
