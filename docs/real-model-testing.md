# Real-model local acceptance

These tests run the installed Gemini SDK and ADK Runner against real Vertex endpoints. They use SQLite and local Google app adapters; no production Firestore workspace or Google file is changed. All prompts and source data are synthetic. The suite tests both model IDs, structured output, owner retrieval/citations, the signed A2A receiver agent, document drafting/revision, and an owner agent creating a proposal without applying it.

Run this before rebuilding Cloud Run after an agent/model change. A simple Studio `OK` response alone does not validate tool calling, structured output, the configured region, or the deployed service account.

## Prepare once (Mac or Cloud Shell)

Use Python 3.12 or newer and the same pinned dependencies as deployment:

```bash
cd alter # use ~/alter in Cloud Shell
python3 -m venv services/api/.venv
services/api/.venv/bin/python -m pip install -c services/api/requirements.lock -e 'services/api[dev]'
```

On a Mac, install the Google Cloud CLI if necessary, then establish Application Default Credentials (ADC) through its browser flow. A normal `gcloud auth login` alone is not SDK ADC:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project alter-48b59
```

In Cloud Shell, try the test first; its existing ADC may already work. If the suite reports missing ADC, use those same commands. Never paste access tokens or credentials into the test files, chat, or repository. In the managed Codex environment, connect the intended GCP identity through environment settings instead of falling back to another identity or reading credential files. The outbound policy must also permit the selected Vertex API and Google authentication endpoints.

## Use the deployment configuration

Cloud Shell already has the ignored `infra/api.env.yaml`. The runner reads only the project, region and model IDs from it; it never fetches demo OAuth or director secrets. Environment variables override the file:

```bash
bash services/api/scripts/test_real_models.sh
```

The script runs tests with real model calls explicitly enabled and stops at the first failure. Expect a small amount of billable Vertex usage. It does not require a new Cloud Run revision or frontend build. Provider failures report the failing stage and provider error directly using synthetic test inputs; share that output, never credential files.

On a Mac without the deployment YAML, select the exact deployment values explicitly:

```bash
export GCP_PROJECT=alter-48b59
export GCP_REGION=us-central1
export MODEL_FAST=gemini-3.5-flash-lite
export MODEL_PRO=gemini-3.8-flash
bash services/api/scripts/test_real_models.sh
```

These IDs are the user's selected configuration, not a claim of verified regional availability. A 404 means the configured model/endpoint needs investigation. A 403 requires checking Vertex access for the active identity. A 429 can indicate quota or capacity. The A2A acceptance uses the actual SDK's signed JSON-RPC exchange through a local ASGI transport; the model calls are real HTTPS requests to Vertex.

For a model-only subset or one failing stage:

```bash
bash services/api/scripts/test_real_models.sh -k model_access
bash services/api/scripts/test_real_models.sh -k real_owner_agent_retrieves_citations
```

Ordinary `pytest` runs skip the seven paid tests unless `--live-models` is passed. Skips are never a live acceptance result. Passing locally with your user ADC also does not establish Cloud Run service-account permission; test the deployed identity separately if local acceptance passes but deployment fails.

## Interactive local app with real models

After the suite passes, keep the same ADC/model environment and run:

```bash
export GCP_PROJECT=alter-48b59
export GCP_REGION=us-central1
export MODEL_FAST=gemini-3.5-flash-lite
export MODEL_PRO=gemini-3.8-flash
DEV_MODE=1 STORE_BACKEND=sqlite GOOGLE_BACKEND=local AI_BACKEND=vertex \
  SERVICE_URL=http://127.0.0.1:8080 CORS_ORIGINS=http://127.0.0.1:5173 \
  services/api/.venv/bin/uvicorn app.main:app --app-dir services/api --host 127.0.0.1 --port 8080
```

In another terminal, run the web app:

```bash
VITE_MOCK=0 VITE_DEV_AUTH=1 VITE_API_BASE=http://127.0.0.1:8080/v1 \
  npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5173
```

Model responses are real in this configuration, while Google files and identity are local development. Production remains `DEV_MODE=0` with Firebase, Firestore and the live Google adapters.
