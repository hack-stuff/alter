from datetime import datetime, timedelta, timezone
from threading import Lock
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from google.genai import types

from app.main import Settings, create_app
from app.modes import live_config

SETTINGS = Settings(project="test-project", model="test-live-model", api_key_secret="projects/test-project/secrets/gemini/versions/latest", origins=("https://alter.test",))

class FakeBackend:
    def __init__(self):
        self.reservations = []
        self.refunds = []
        self.mints = []
        self.lock = Lock()
        self.used = 0
        self.capacity = 40
        self.fail_mint = False
        self.forbidden = False

    def authenticate(self, token):
        if token != "valid":
            raise ValueError("bad token")
        return "anonymous-user"

    def workspace(self, uid, persona):
        if self.forbidden or persona == "outsider":
            raise PermissionError("This teammate is not in your workspace.")
        return "workspace", "member"

    def reserve(self, workspace, uid, request_id, now, minutes):
        with self.lock:
            if self.used + minutes > self.capacity:
                return False
            self.used += minutes
            self.reservations.append((workspace, uid, request_id, now, minutes))
            return True

    def refund(self, *args):
        self.refunds.append(args)
        self.used -= args[-1]

    def mint(self, *args):
        self.mints.append(args)
        if self.fail_mint:
            raise RuntimeError("provider failure with secret that must not escape")
        return "single-use-token"

@pytest.fixture
def backend():
    return FakeBackend()

@pytest.fixture
def client(backend):
    return TestClient(create_app(SETTINGS, backend))

def request(client, body=None, token="valid"):
    return client.post("/v1/live/token", headers={"Authorization": f"Bearer {token}"}, json=body or {"mode": "chat"})

def test_missing_and_invalid_auth_never_reserve(client, backend):
    assert client.post("/v1/live/token", json={"mode": "chat"}).status_code == 401
    assert request(client, token="invalid").status_code == 401
    assert not backend.reservations

def test_unconfigured_service_is_explicitly_unavailable(backend):
    client = TestClient(create_app(Settings(), backend))
    assert request(client).status_code == 503
    assert not backend.mints

def test_token_has_ten_minute_lifetime_and_one_minute_connection_window(client, backend):
    response = request(client)
    assert response.status_code == 200
    assert response.json()["token"] == "single-use-token"
    assert response.json()["model"] == SETTINGS.model
    now = backend.reservations[0][3]
    expires, new_expires = backend.mints[0][2:]
    assert expires - now == timedelta(minutes=10)
    assert new_expires - now == timedelta(minutes=1)
    assert datetime.fromisoformat(response.json()["expiresAt"]) == expires
    assert backend.reservations[0][-1] == 10

@pytest.mark.parametrize("body", [{"mode": "approve"}, {"mode": "huddle"}, {"mode": "huddle", "memberId": "../../escape"}])
def test_invalid_mode_or_target_is_rejected_before_reserving(client, backend, body):
    assert request(client, body).status_code == 422
    assert not backend.reservations

def test_workspace_membership_and_huddle_persona_are_checked(client, backend):
    backend.forbidden = True
    assert request(client).status_code == 403
    backend.forbidden = False
    assert request(client, {"mode": "huddle", "memberId": "outsider"}).status_code == 403
    assert not backend.reservations
    assert request(client, {"mode": "huddle", "memberId": "rahul"}).status_code == 200
    assert backend.mints[-1][1] == "rahul"

def test_budget_denial_never_mints(client, backend):
    backend.capacity = 0
    response = request(client)
    assert response.status_code == 429
    assert response.json()["detail"]["error"]["code"] == "RATE_LIMITED"
    assert not backend.mints

def test_provider_failure_refunds_and_does_not_leak_details(client, backend):
    backend.fail_mint = True
    response = request(client)
    assert response.status_code == 503
    assert len(backend.refunds) == 1
    assert backend.used == 0
    assert "secret" not in response.text
    assert "provider failure" not in response.text

def test_concurrent_requests_cannot_exceed_reservation_capacity(client, backend):
    backend.capacity = 10
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: request(client).status_code, range(4)))
    assert results.count(200) == 1
    assert results.count(429) == 3
    assert len(backend.mints) == 1

@pytest.mark.parametrize("mode, tool", [("chat", "alter_chat"), ("revise", "revise_approval"), ("reply", "respond_escalation"), ("huddle", "ask_alter")])
def test_locked_configuration_is_valid_sdk_schema_and_never_exposes_approval(mode, tool):
    config = types.CreateAuthTokenConfig(uses=1, expire_time=datetime.now(timezone.utc) + timedelta(minutes=10), live_connect_constraints={"model": SETTINGS.model, "config": live_config(mode, "rahul" if mode == "huddle" else None)})
    assert config.uses == 1
    live = config.live_connect_constraints.config
    assert live.input_audio_transcription is not None and live.output_audio_transcription is not None
    assert [f.name for t in live.tools for f in t.function_declarations] == [tool]
    assert "on-screen button" in live.system_instruction

def test_cors_allows_only_configured_origin(client):
    allowed = client.options("/v1/live/token", headers={"Origin": "https://alter.test", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization"})
    denied = client.options("/v1/live/token", headers={"Origin": "https://untrusted.test", "Access-Control-Request-Method": "POST"})
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "https://alter.test"
    assert "access-control-allow-origin" not in denied.headers

class MemoryFirestore:
    def __init__(self):
        self.values = {}
    def collection(self, path):
        return MemoryReference(self, path)
    def transaction(self):
        return MemoryTransaction(self)

class MemoryReference:
    def __init__(self, db, path):
        self.db, self.path = db, path
    def document(self, name):
        return MemoryReference(self.db, f"{self.path}/{name}")
    def collection(self, name):
        return MemoryReference(self.db, f"{self.path}/{name}")
    def get(self, transaction=None):
        from copy import deepcopy
        from types import SimpleNamespace
        return SimpleNamespace(to_dict=lambda: deepcopy(self.db.values.get(self.path)))

class MemoryTransaction:
    def __init__(self, db):
        self.db = db
    def set(self, ref, values):
        from copy import deepcopy
        self.db.values[ref.path] = deepcopy(values)
    def delete(self, ref):
        self.db.values.pop(ref.path, None)

def test_durable_budget_cooldown_crosses_hour_boundary_and_refund_is_idempotent(monkeypatch):
    from google.cloud import firestore
    from app.main import GoogleBackend
    monkeypatch.setattr(firestore, "transactional", lambda f: f)
    backend = GoogleBackend(SETTINGS)
    backend._db = MemoryFirestore()
    before = datetime(2026, 10, 14, 18, 59, tzinfo=timezone.utc)
    after = before + timedelta(minutes=2)
    assert backend.reserve("ws", "user", "reservation", before, 10)
    assert not backend.reserve("ws", "user", "cross-hour", after, 10)
    backend.refund("ws", "user", "reservation", before, 10)
    backend.refund("ws", "user", "reservation", before, 10)
    assert backend.reserve("ws", "user", "retry", after, 10)
    assert backend._db.values["workspaces/ws/liveBudgets/2026101418"]["minutes"] == 0
    assert backend._db.values["workspaces/ws/liveBudgets/2026101419"]["minutes"] == 10
