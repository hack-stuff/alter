import pytest
import httpx
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app


@pytest.fixture
def system(tmp_path):
    settings = Settings(
        dev_mode=True,
        store_backend="sqlite",
        database_path=str(tmp_path / "db.sqlite"),
        ai_backend="local",
        google_backend="local",
        a2a_secret="test-only-key",
        director_key="director-test",
        welcome_delay=1000,
        trace_delay=0,
    )
    app = create_app(settings)
    app.state.engine.transport.transport = httpx.ASGITransport(app=app)
    with TestClient(app) as client:
        yield client, app.state.engine


@pytest.fixture
def team(system):
    client, engine = system
    headers = {"X-Dev-Uid": "alice"}
    result = client.post(
        "/v1/workspaces", headers=headers, json={"name": "Alice"}
    ).json()
    engine.workspaces.provision(result["workspaceId"])
    return client, engine, headers, result


def pytest_addoption(parser):
    parser.addoption(
        "--live-models",
        action="store_true",
        default=False,
        help="Enable paid real Vertex model tests; requires ADC and explicit project/model configuration.",
    )
