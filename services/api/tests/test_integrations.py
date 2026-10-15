"""Provider payloads are verified without credentials or external side effects."""

from unittest.mock import MagicMock
from datetime import timedelta
from email import message_from_bytes
import asyncio, base64, json
from pathlib import Path
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from app.auth import Caller
from app.google import docs, sheets, calendar, gmail, drive
from app.policy.intents import classify
from app.policy.gate import enforce, load_rules
from app.util import now, iso


def test_thirty_question_gate_table():
    cases = json.loads(
        (Path(__file__).parent.parent / "scripts/eval_cases.json").read_text()
    )
    rules = load_rules("rahul")
    for question, expected in cases:
        result = enforce(
            rules, {"alice", "rahul"}, "alice", "rahul", classify(question)
        )
        assert result.outcome == expected, question
    # An owner toggle cannot permit another member to commit a date.
    from app.policy.gate import Rule

    assert (
        enforce(
            [Rule("all", "Share", ("request_commitment",), "allow")],
            {"alice", "rahul"},
            "alice",
            "rahul",
            "request_commitment",
        ).outcome
        == "ask"
    )


def test_docs_revision_and_no_retry():
    service = MagicMock()
    service.documents().get().execute.return_value = {
        "title": "QA",
        "revisionId": "r1",
        "body": {
            "content": [
                {
                    "paragraph": {"elements": [{"textRun": {"content": "Old\n"}}]},
                    "endIndex": 5,
                }
            ]
        },
    }
    docs.replace(service, "file", [{"section": "QA", "lines": ["New"]}], "r0")
    payload = service.documents().batchUpdate.call_args.kwargs
    assert payload["body"]["writeControl"] == {"requiredRevisionId": "r0"}
    assert payload["body"]["requests"][0]["deleteContentRange"]["range"] == {
        "startIndex": 1,
        "endIndex": 4,
    }
    service.documents().batchUpdate().execute.assert_called_once_with(num_retries=0)


def test_sheets_formula_text_and_operation_marker():
    service = MagicMock()
    service.spreadsheets().values().get().execute.return_value = {
        "values": [
            ["id", "title", "owner", "status", "due"],
            ["old", "Old", "QA", "Open", "TBD"],
        ]
    }
    action = {
        "fileId": "sheet",
        "rows": [['=IMPORTXML("bad")', "Title", "QA", "Open", "TBD"]],
    }
    sheets.apply(service, action, "operation")
    payload = service.spreadsheets().values().append.call_args.kwargs
    assert payload["valueInputOption"] == "RAW"
    assert payload["body"]["values"][0][-1] == "operation"
    service.spreadsheets().values().append().execute.assert_called_once_with(
        num_retries=0
    )
    # Reconciliation marker prevents duplicate appends.
    service.spreadsheets().values().append.reset_mock()
    service.spreadsheets().values().get().execute.return_value = {
        "values": [
            ["id", "title", "owner", "status", "due", "_alter_operation"],
            action["rows"][0] + ["operation"],
        ]
    }
    sheets.apply(service, action, "operation")
    service.spreadsheets().values().append.assert_not_called()


def test_calendar_deterministic_event_no_external_invites():
    service = MagicMock()
    error = RuntimeError("missing")
    error.resp = SimpleNamespace(status=404)
    service.events().get().execute.side_effect = error
    service.events().insert().execute.return_value = {
        "htmlLink": "https://calendar.google.com/event"
    }
    calendar.insert(
        service,
        {
            "calendarId": "team",
            "title": "Sync",
            "start": now().isoformat(),
            "end": (now() + timedelta(minutes=30)).isoformat(),
            "attendees": ["alice", "meera"],
            "attendeeNames": ["Alice", "Meera"],
        },
        "operation",
    )
    payload = service.events().insert.call_args.kwargs
    assert payload["sendUpdates"] == "none" and "attendees" not in payload["body"]
    assert len(payload["body"]["id"]) == 64
    assert json.loads(
        payload["body"]["extendedProperties"]["private"]["memberIds"]
    ) == ["alice", "meera"]
    service.events().insert().execute.assert_called_once_with(num_retries=0)


def test_gmail_current_verified_own_address_only():
    service = MagicMock()
    service.users().messages().send().execute.return_value = {"id": "sent-id"}
    action = {"to_members": ["alice", "meera"], "subject": "Summary", "body": "Hello"}
    member = {
        "id": "alice",
        "name": "Alice",
        "email": "alice@example.com",
        "emailVerified": True,
    }
    for caller in [
        Caller("alice"),
        Caller("alice", "other@example.com", True),
        Caller("alice", "alice@example.com", False),
    ]:
        assert gmail.send(
            service, action, member, caller, "demo@example.com", "operation"
        ) == {"inboxOnly": True}
    assert service.users().messages().send().execute.call_count == 0
    result = gmail.send(
        service,
        action,
        member,
        Caller("alice", "alice@example.com", True),
        "demo@example.com",
        "operation",
    )
    payload = service.users().messages().send.call_args.kwargs
    message = message_from_bytes(base64.urlsafe_b64decode(payload["body"]["raw"]))
    assert message["To"] == "alice@example.com" and "Meera" not in message["To"]
    assert message["From"] == "Alter for Alice <demo@example.com>"
    assert result["gmailMessageUrl"].endswith("sent-id")
    service.users().messages().send().execute.assert_called_once_with(num_retries=0)


def test_drive_does_not_recreate_marked_files():
    service = MagicMock()
    service.files().list().execute.return_value = {"files": [{"id": "existing"}]}
    resource, created = drive.create_file(
        service, "workspace", "operation", "Name", "mime", "folder"
    )
    assert resource["id"] == "existing" and created is False
    service.files().create.assert_not_called()
    service.files().get().execute.return_value = {"id": "outside", "parents": ["wrong"]}
    with pytest.raises(HTTPException):
        drive.within(service, "outside", "folder")


def test_director_effect_and_welcome(team):
    c, e, h, r = team
    root = f"workspaces/{r['workspaceId']}"
    value = e.store.get(root)
    e.store.set(root, {**value, "director": True})
    claim = c.post(
        "/v1/director/claim",
        headers={"X-Dev-Uid": "rahul-director"},
        json={
            "workspaceId": r["workspaceId"],
            "memberId": "rahul",
            "key": "director-test",
        },
    )
    assert claim.status_code == 200
    context = e.auth.member(Caller("alice"))
    item = e.escalate(
        context.workspace_id,
        "rahul",
        context.member_id,
        "Confirm date?",
        "Owner call.",
        True,
    )
    reply = {"text": "Confirmed for " + (now() + timedelta(days=20)).date().isoformat()}
    response = c.post(
        "/v1/escalations/" + item["id"] + "/respond",
        headers={"X-Dev-Uid": "rahul-director"},
        json=reply,
    )
    assert response.status_code == 200, response.text
    assert (
        response.json()["decision"]["type"] == "date_commitment"
        and response.json()["applied"]
    )
    assert (
        c.post(
            "/v1/escalations/" + item["id"] + "/respond",
            headers={"X-Dev-Uid": "rahul-director"},
            json=reply,
        ).status_code
        == 409
    )
    asyncio.run(
        e.welcome(context.workspace_id, context.member_id, value["generation"], False)
    )
    assert any(
        item["owner"] == context.member_id and "Oct 30" in item["question"]
        for item in e.store.list(root + "/escalations")
    )


def test_creation_rate_and_verified_identity(system):
    c, e = system
    for i in range(5):
        assert (
            c.post(
                "/v1/workspaces",
                headers={"X-Dev-Uid": f"user{i}"},
                json={"name": "Judge"},
            ).status_code
            == 200
        )
    assert (
        c.post(
            "/v1/workspaces", headers={"X-Dev-Uid": "sixth"}, json={"name": "Judge"}
        ).status_code
        == 429
    )
    from dataclasses import replace
    from app.auth import Authentication

    secure = Authentication(
        replace(e.settings, dev_mode=False),
        e.store,
        lambda token: {
            "uid": "verified",
            "email": "own@example.com",
            "email_verified": True,
        },
    )
    with pytest.raises(HTTPException):
        secure.authenticate(None, "spoofed")
    assert secure.authenticate("Bearer token", "spoofed").uid == "verified"


def test_crash_recovery_finishes_inbox_and_receipt(team):
    c, e, h, r = team
    context = e.auth.member(Caller("alice"))
    a = e.proposals.create(
        context,
        "email",
        {"to_members": ["meera"], "subject": "Summary", "body": "Once"},
        "Test",
    )
    root = f"workspaces/{context.workspace_id}"
    e.store.set(
        root + "/approvals/" + a["id"],
        {**a, "state": "approved", "approvedAt": iso(), "approvedBy": "alice"},
    )
    e.apps.apply(
        context.workspace_id,
        a,
        e.me(context) | {"id": context.member_id},
        context.caller,
    )
    e.application.recover(context.workspace_id, a["id"])
    assert e.store.get(root + "/inbox/meera/messages/" + a["id"])["body"] == "Once"
    assert e.store.get(root + "/approvals/" + a["id"])["state"] == "applied"
    assert e.store.list(root + "/receipts")


def test_vertex_output_rejects_invented_claims(team, monkeypatch):
    from app.alters.brain import VertexBrain
    from google.adk import runners
    from google.genai import types

    c, e, h, r = team
    context = e.auth.member(Caller("alice"))
    member = e.store.get(f"workspaces/{context.workspace_id}/members/rahul") | {
        "id": "rahul"
    }

    class FakeRunner:
        def __init__(self, agent, **kwargs):
            self.agent = agent

        async def run_async(self, **kwargs):
            passages = (await self.agent.tools[0]("one-tap"))["passages"]
            source = passages[0]
            claims = [
                {
                    "sourceId": source["sourceId"],
                    "locator": source["locator"],
                    "quote": source["text"],
                },
                {
                    "sourceId": "invented",
                    "locator": "fake",
                    "quote": "Launch is guaranteed.",
                },
                {
                    "sourceId": source["sourceId"],
                    "locator": source["locator"],
                    "quote": "Unsupported extra fact.",
                },
            ]
            yield SimpleNamespace(
                is_final_response=lambda: True,
                content=types.Content(
                    parts=[types.Part(text=json.dumps({"claims": claims}))]
                ),
            )

    monkeypatch.setattr(runners, "Runner", FakeRunner)
    result = asyncio.run(VertexBrain(e).answer(context, member, "Why one-tap?"))
    assert (
        result["citations"]
        and "guaranteed" not in result["answer"]
        and "Unsupported" not in result["answer"]
    )


def test_live_configuration_has_no_silent_simulation(system):
    from app.main import create_app
    from app.config import Settings
    from fastapi.testclient import TestClient

    with TestClient(create_app(Settings())) as client:
        assert client.get("/healthz").status_code == 200
        assert client.get("/readyz").status_code == 503
        assert client.get("/v1/me", headers={"X-Dev-Uid": "spoofed"}).status_code == 503
        assert client.get("/local/files/random").status_code == 404


def test_scheduler_requires_matching_oidc_claims(system, monkeypatch):
    from dataclasses import replace
    from app.main import create_app
    from fastapi.testclient import TestClient
    from google.oauth2 import id_token

    c, e = system
    settings = replace(
        e.settings,
        scheduler_email="scheduler@example.com",
        scheduler_audience="https://alter.example",
    )
    app = create_app(settings, engine=e)
    claims = {"email": "outsider@example.com", "email_verified": True}

    def verify(token, request, audience):
        assert audience == "https://alter.example"
        return claims

    monkeypatch.setattr(id_token, "verify_oauth2_token", verify)
    with TestClient(app) as client:
        assert (
            client.post(
                "/internal/cleanup", headers={"Authorization": "Bearer token"}
            ).status_code
            == 403
        )
        claims["email"] = "scheduler@example.com"
        assert (
            client.post(
                "/internal/cleanup", headers={"Authorization": "Bearer token"}
            ).status_code
            == 200
        )


@pytest.mark.parametrize(
    "text",
    [
        "Maybe November 3",
        "November 3 if QA passes",
        "We should discuss November 3",
        "I was considering November 3",
        "November 3 or November 4",
        "My birthday is November 3",
        "No, November 3 is not confirmed",
    ],
)
def test_ambiguous_dates_never_authorize_changes(text):
    from app.escalations import date_decision

    assert date_decision(text) is None


def test_oversized_proposals_do_not_reach_storage(team):
    c, e, h, r = team
    context = e.auth.member(Caller("alice"))
    sections = [{"section": str(i), "lines": ["x" * 10000] * 3} for i in range(30)]
    with pytest.raises(HTTPException) as exc:
        e.proposals.create(
            context,
            "doc_create",
            {"title": "Too big", "sections": sections},
            "Owner request",
        )
    assert exc.value.status_code == 413
    assert not e.store.list(f"workspaces/{context.workspace_id}/approvals")


def test_provider_exception_text_is_not_exposed(team, monkeypatch):
    c, e, h, r = team

    def failed(*args):
        raise RuntimeError("sensitive-provider-detail")

    monkeypatch.setattr(e, "me", failed)
    response = c.get("/v1/me", headers=h)
    assert response.status_code == 503
    assert "sensitive-provider-detail" not in response.text


def test_adk_memory_tool_acknowledges_pending_review(team, monkeypatch):
    from app.alters.brain import VertexBrain
    from google.adk import runners
    from google.genai import types

    c, e, h, r = team
    context = e.auth.member(Caller("alice"))

    class FakeRunner:
        def __init__(self, agent, **kwargs):
            self.agent = agent

        async def run_async(self, **kwargs):
            tool = next(
                tool for tool in self.agent.tools if tool.__name__ == "propose_memory"
            )
            await tool("The extra regression check uses synthetic accounts.")
            yield SimpleNamespace(
                is_final_response=lambda: True,
                content=types.Content(parts=[types.Part(text='{"claims":[]}')]),
            )

    monkeypatch.setattr(runners, "Runner", FakeRunner)
    result = asyncio.run(VertexBrain(e).chat(context, "Remember this check"))
    assert "memory for your review" in result["text"]
    memories = e.store.list(f"workspaces/{context.workspace_id}/memories")
    assert any(memory["state"] == "proposed" for memory in memories)


def test_agent_escalation_is_not_duplicated(team, monkeypatch):
    c, e, h, r = team
    context = e.auth.member(Caller("alice"))

    async def answer(*args):
        item = e.escalate(
            context.workspace_id,
            "rahul",
            context.member_id,
            "Why one-tap?",
            "No evidence",
        )
        return {"answer": "Asked owner", "citations": [], "escalationId": item["id"]}

    monkeypatch.setattr(e.brain, "answer", answer)
    result = asyncio.run(e.ask_core(context, "rahul", "Why one-tap?", "one-trace"))
    assert result["outcome"] == "ask" and result["escalationId"]
    assert len(e.store.list(f"workspaces/{context.workspace_id}/escalations")) == 1


def test_agent_failure_logs_safe_reference(team, monkeypatch, capsys):
    c, e, h, r = team

    class ProviderFailure(Exception):
        code = 400
        status = "INVALID_ARGUMENT"

    async def fail(*args):
        raise ProviderFailure(
            "Function schema invalid; credential=private-token; prompt=private-question"
        )

    monkeypatch.setattr(e.brain, "chat", fail)
    response = c.post("/v1/chat", headers=h, json={"message": "private-question"})
    assert response.status_code == 503
    details = json.loads(capsys.readouterr().err.strip().splitlines()[-1])
    assert details["category"] == "model_tool_or_schema_configuration"
    assert details["providerCode"] == 400 and details["frames"]
    assert details["reference"] in response.text
    assert "private-token" not in json.dumps(details) + response.text
    assert "private-question" not in json.dumps(details) + response.text


def test_real_adk_runner_with_provider_double(team, monkeypatch):
    from google.adk.models.base_llm import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from google.genai import types
    from app.alters import factory
    from app.alters.brain import VertexBrain

    c, e, h, r = team
    original = factory.build_alter

    class TestModel(BaseLlm):
        async def generate_content_async(self, llm_request, stream=False):
            yield LlmResponse(
                content=types.Content(
                    role="model", parts=[types.Part(text='{"claims":[]}')]
                )
            )

    def build(*args, **kwargs):
        result = original(*args, **kwargs)
        result[0].model = TestModel(model="test")
        return result

    monkeypatch.setattr(factory, "build_alter", build)
    result = asyncio.run(VertexBrain(e).chat(e.auth.member(Caller("alice")), "Hello"))
    assert result["text"] and result["approvalIds"] == []
