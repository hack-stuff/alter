"""Live failures remain actionable without leaking provider request content."""

import asyncio
from dataclasses import replace
import json
from types import SimpleNamespace

from google.auth.exceptions import DefaultCredentialsError, RefreshError
import pytest

from app.diagnostics import report_live_failure, report_unhandled_request


class ProviderFailure(Exception):
    code = 403


class ProviderUnavailable(Exception):
    code = 1011


def test_unhandled_request_log_has_reference_without_request_text(capsys):
    try:
        raise RuntimeError("private-token; prompt=private-question")
    except RuntimeError as exc:
        reference = report_unhandled_request(exc)
    log = json.loads(capsys.readouterr().err)
    assert log["event"] == "unhandled_request_failed"
    assert log["reference"] == reference
    assert log["exceptionType"] == "RuntimeError"
    assert "private-token" not in json.dumps(log)
    assert "private-question" not in json.dumps(log)


@pytest.mark.parametrize(
    "exc,category",
    [
        (DefaultCredentialsError("private-token"), "credentials_unavailable"),
        (RefreshError("invalid_grant: private-token"), "credentials_unavailable"),
        (ProviderFailure("private-token"), "permission_denied"),
        (ProviderUnavailable("private-token"), "provider_unavailable"),
        (TimeoutError("private-token"), "provider_deadline_exceeded"),
        (
            ValueError("The workspace voice budget is used for now."),
            "workspace_budget_exhausted",
        ),
        (
            ValueError(
                "Another voice session is still active. End it before reconnecting."
            ),
            "session_already_active",
        ),
        (ValueError("Expired voice ticket"), "ticket_expired"),
        (RuntimeError("private-token; prompt=private-question"), "unclassified"),
    ],
)
def test_live_failure_metadata_is_safe(exc, category, capsys):
    settings = SimpleNamespace(
        region="us-central1",
        live_location="us-central1",
        model_location="global",
        live_model="native-audio-model",
    )
    response = report_live_failure(exc, settings, "provider_connect")
    log = json.loads(capsys.readouterr().err)
    assert log["category"] == category
    assert log["vertexLocation"] == "us-central1"
    assert log["model"] == "native-audio-model"
    assert log["reference"] == response["reference"]
    assert log["reference"] in response["error"]
    assert response["retryable"] is (category == "provider_unavailable")
    assert "private-token" not in json.dumps(log) + json.dumps(response)
    assert "private-question" not in json.dumps(log) + json.dumps(response)


@pytest.mark.parametrize(
    "stage", ["provider_connect", "provider_receive", "provider_send"]
)
def test_relay_failure_reports_stage_and_releases_lease(
    team, monkeypatch, capsys, stage
):
    from google import genai

    client, engine, headers, run = team
    engine.settings = replace(
        engine.settings,
        live_model="native-audio-model",
        live_location="us-central1",
        cors_origins=("http://testclient",),
    )
    closed = []

    class FakeSession:
        async def __aenter__(self):
            if stage == "provider_connect":
                raise DefaultCredentialsError("private-token")
            return self

        async def __aexit__(self, *args):
            pass

        async def receive(self):
            if stage == "provider_receive":
                raise ProviderFailure("private-token; prompt=private-question")
            await asyncio.Event().wait()
            yield

        async def send_realtime_input(self, **kwargs):
            raise ProviderFailure("private-token; prompt=private-question")

    class FakeClient:
        def __init__(self, **kwargs):
            self.aio = self.live = self

        def connect(self, **kwargs):
            return FakeSession()

        async def aclose(self):
            closed.append(True)

    monkeypatch.setattr(genai, "Client", FakeClient)
    ticket = client.post(
        "/v1/live/sessions", headers=headers, json={"mode": "chat"}
    ).json()["ticket"]
    with client.websocket_connect(
        "/v1/live/connect", headers={"origin": "http://testclient"}
    ) as socket:
        socket.send_json({"ticket": ticket})
        if stage != "provider_connect":
            assert socket.receive_json()["ready"]
        if stage == "provider_send":
            socket.send_json({"audio": "AAA="})
        response = socket.receive_json()
        # Wait for the server's close so cleanup completes before assertions.
        assert socket.receive()["type"] == "websocket.close"
    log = json.loads(capsys.readouterr().err.strip().splitlines()[-1])
    assert log["event"] == "live_session_failed"
    assert log["stage"] == stage
    assert response["reference"] == log["reference"]
    assert "private-token" not in json.dumps(log) + json.dumps(response)
    assert "private-question" not in json.dumps(log) + json.dumps(response)
    assert closed
    assert not engine.store.list(f"workspaces/{run['workspaceId']}/liveRelaySessions")
    if stage == "provider_connect":
        assert not engine.store.list(f"workspaces/{run['workspaceId']}/relayBudgets")


def test_live_websocket_close_code_is_logged_without_reason(capsys):
    from websockets.exceptions import ConnectionClosedError
    from websockets.frames import Close

    exc = ConnectionClosedError(Close(1007, "private-token; private-question"), None)
    settings = SimpleNamespace(
        region="us-central1",
        live_location="us-central1",
        model_location="global",
        live_model="native-audio-model",
    )
    response = report_live_failure(exc, settings, "provider_receive")
    log = json.loads(capsys.readouterr().err)
    assert log["category"] == "live_configuration_or_protocol"
    assert log["providerCloseCode"] == 1007
    assert "private-token" not in json.dumps(log) + json.dumps(response)
    assert "private-question" not in json.dumps(log) + json.dumps(response)
