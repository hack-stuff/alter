"""Opt-in real Agent Platform (formerly Vertex AI)/ADK acceptance. Only synthetic data; Google files stay local.

Run with --live-models. No fake model, Runner or Agent Platform transport is installed.
"""

import asyncio
from pathlib import Path
import os

import httpx
import pytest

from app.auth import Caller
from app.config import Settings
from app.engine import Engine
from app.main import create_app
from app.alters.brain import MemoryFact

pytestmark = pytest.mark.vertex_live


@pytest.fixture(scope="module")
def vertex_settings(request, tmp_path_factory):
    if not request.config.getoption("--live-models"):
        pytest.skip("Real Agent Platform tests require explicit --live-models opt-in.")
    config_path = Path(os.environ.get("ALTER_LIVE_CONFIG", "infra/api.env.yaml"))
    values = {}
    if config_path.exists():
        import yaml

        values = yaml.safe_load(config_path.read_text()) or {}
    names = ("GCP_PROJECT", "GCP_REGION", "MODEL_FAST", "MODEL_PRO")
    selected = {name: os.environ.get(name) or values.get(name) for name in names}
    missing = [name for name, value in selected.items() if not value]
    if missing:
        pytest.fail(
            "Set "
            + ", ".join(missing)
            + " or point ALTER_LIVE_CONFIG at the deployment YAML.",
            pytrace=False,
        )
    selected["VERTEX_LOCATION"] = (
        os.environ.get("VERTEX_LOCATION")
        or values.get("VERTEX_LOCATION")
        or selected["GCP_REGION"]
    )
    import google.auth
    from google.auth.exceptions import DefaultCredentialsError

    try:
        google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    except DefaultCredentialsError:
        pytest.fail(
            "No application-default credentials. On your Mac run: gcloud auth application-default login; then gcloud auth application-default set-quota-project "
            + selected["GCP_PROJECT"],
            pytrace=False,
        )
    print(
        "\nREAL AGENT PLATFORM: "
        + ", ".join(f"{name}={selected[name]}" for name in (*names, "VERTEX_LOCATION"))
    )
    print(
        "Only synthetic test prompts are sent. Workspace storage and Google app adapters are local."
    )
    return Settings(
        dev_mode=True,
        store_backend="sqlite",
        database_path=str(tmp_path_factory.mktemp("vertex-live") / "smoke.sqlite"),
        ai_backend="vertex",
        google_backend="local",
        project=selected["GCP_PROJECT"],
        region=selected["GCP_REGION"],
        vertex_location=selected["VERTEX_LOCATION"],
        model_fast=selected["MODEL_FAST"],
        model_pro=selected["MODEL_PRO"],
        trace_delay=0,
        welcome_delay=10000,
    )


@pytest.fixture(scope="module")
def vertex_engine(vertex_settings):
    engine = Engine(vertex_settings)
    created = engine.workspaces.create(
        Caller("live-smoke"), "Live smoke test", "local-smoke"
    )
    engine.workspaces.provision(created["workspaceId"])
    app = create_app(vertex_settings, engine=engine)
    engine.transport.transport = httpx.ASGITransport(app=app)
    return engine, engine.auth.member(Caller("live-smoke"))


@pytest.mark.parametrize("setting", ["model_fast", "model_pro"])
def test_model_access(vertex_engine, setting):
    engine, ctx = vertex_engine
    response = engine.model_client.models.generate_content(
        model=getattr(engine.settings, setting),
        contents="Reply with exactly OK.",
        config={"temperature": 0, "max_output_tokens": 8192},
    )
    assert response.text and response.text.strip().upper() == "OK"


def test_fast_structured_output(vertex_engine):
    engine, ctx = vertex_engine
    response = engine.model_client.models.generate_content(
        model=engine.settings.model_fast,
        contents="Return this work fact: The synthetic QA checklist covers Android and iOS.",
        config={
            "response_mime_type": "application/json",
            "response_schema": MemoryFact,
            "temperature": 0,
        },
    )
    fact = MemoryFact.model_validate_json(response.text)
    assert fact.scope == "work" and fact.content


def test_real_owner_agent_retrieves_citations(vertex_engine):
    engine, ctx = vertex_engine
    response = asyncio.run(
        engine.brain.chat(
            ctx,
            "Use search_knowledge to find why the project switched to one-tap sign-in. Answer using exact cited source sentences.",
        )
    )
    assert response["citations"], response
    assert "one-tap" in response["text"].lower(), response
    assert not response["approvalIds"]


def test_real_a2a_receiver_agent(vertex_engine):
    engine, ctx = vertex_engine
    response = asyncio.run(
        engine.hop(ctx, "rahul", "Why did we switch to one-tap sign-in?")
    )
    assert response["outcome"] == "allow" and response["citations"], response
    assert "one-tap" in response["answer"].lower(), response
    assert engine.store.get(
        f"workspaces/{ctx.workspace_id}/a2aTraces/{response['traceId']}"
    )


def test_real_drafting_and_revision(vertex_engine):
    engine, ctx = vertex_engine
    planner = engine.brain.planner(ctx)
    payload = {
        "title": "Local QA smoke draft",
        "sections": [
            {
                "section": "QA",
                "lines": ["The synthetic checklist covers Android and iOS."],
            }
        ],
    }
    sources = [
        {
            "sourceId": "synthetic",
            "title": "Synthetic QA notes",
            "locator": "QA",
            "text": "The synthetic checklist covers Android and iOS.",
        }
    ]
    draft = planner.draft_document(payload, sources)
    card = engine.proposals.create(
        ctx, "doc_create", draft, "Real-model smoke test; do not apply."
    )
    revised = engine.proposals.revise(
        ctx,
        card["id"],
        "Add a Notes section containing: Human review is required.",
        planner,
    )
    assert revised["revision"] == 2 and revised["state"] == "proposed"
    assert any(
        "Human review is required" in line
        for section in revised["preview"]["after"]
        for line in section["lines"]
    )
    assert engine.apps.reconcile(ctx.workspace_id, revised) is None


def test_real_owner_can_propose_without_applying(vertex_engine):
    engine, ctx = vertex_engine
    response = asyncio.run(
        engine.brain.chat(
            ctx,
            "Search the test plan, then use propose_doc to draft a new QA checklist titled Local model acceptance. Do not edit an existing file or apply any write.",
        )
    )
    assert response["approvalIds"], response
    for aid in response["approvalIds"]:
        card = engine.proposals.owned(ctx, aid)
        assert card["kind"] == "doc_create" and card["state"] == "proposed"
        assert engine.apps.reconcile(ctx.workspace_id, card) is None
