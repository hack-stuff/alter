# Setup and deployment

The API now persists workspaces, messages, rules, memories, approvals, traces and receipts. It uses ADK agents, signed A2A JSON-RPC HTTP calls, and Google app adapters. The a2a-sdk client is the documented fallback for ADK-version differences; runtime versions are pinned in `services/api/requirements.lock`.

## Local integration

Run these commands from the repository root. Keep the API and web server running in separate terminals:

```bash
python3.12 -m venv services/api/.venv
services/api/.venv/bin/pip install -c services/api/requirements.lock -e 'services/api[dev]'
DEV_MODE=1 SERVICE_URL=http://127.0.0.1:8080 CORS_ORIGINS=http://127.0.0.1:5173 \
  services/api/.venv/bin/uvicorn app.main:app --app-dir services/api --host 127.0.0.1 --port 8080
VITE_MOCK=0 VITE_DEV_AUTH=1 VITE_API_BASE=http://127.0.0.1:8080/v1 \
  npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5173
```

Local mode uses persistent SQLite (`DATABASE_PATH`, default `/tmp/alter.sqlite3`), deterministic development AI and simulated Google resources. It needs no API key. Each browser profile has its own development identity. Use separate browser profiles to test invites. Local file URLs open read-only simulated files. The app labels this mode. `DEV_MODE=0` rejects development identity headers and requires Firebase/Firestore/Agent Platform/Google configuration.

Tests:

```bash
PYTHONPATH=services/api services/api/.venv/bin/pytest services/api/tests -q
npm --prefix apps/web run build
npm --prefix apps/web run lint
npm --prefix apps/web run test:e2e
npm --prefix apps/web run test:backend
npm ci --prefix infra
npm --prefix infra run test:rules
# Against a running API, after creating a workspace:
PYTHONPATH=services/api services/api/.venv/bin/python services/api/scripts/eval.py --dev-uid YOUR_LOCAL_UID
```

The evaluation sends 30 questions through the real A2A HTTP endpoint and reports citation rate, commitment escalation rate and measured p50 latency. Local results measure simulation and transport, not Agent Platform quality or latency. For live evaluation omit `--dev-uid` and put the member's Firebase token in `ALTER_ID_TOKEN`. This creates pending questions; use a dedicated test workspace.

For actual Agent Platform model/ADK/tool validation before deployment, use [Real-model local acceptance](real-model-testing.md). Ordinary offline checks do not validate provider compatibility.

## Cloud prerequisites

Use an existing billing-enabled Firebase/GCP project; enable Firestore Native mode and Firebase Anonymous Auth. The API uses Gemini Enterprise Agent Platform (formerly Vertex AI) service-account credentials rather than a Gemini API key. The preferred Live relay also uses Agent Platform ADC and requires a supported native-audio model/region; no Gemini API key is needed for that path (see `storyboard-implementation.md`). Cloud validation and deployment require these project settings and credentials.

1. Configure the demo OAuth consent screen in testing mode; register only the team demo account as a test user. Download a Desktop OAuth client into a gitignored directory. Enable the six Google APIs shown in `infra/deploy-api.sh`. Create a Secret Manager secret, then run `scripts/get_demo_token.py --client-file ... --secret projects/PROJECT/secrets/NAME --account-email ...` with the API virtualenv and `PYTHONPATH=services/api`. It writes the refresh credentials directly to Secret Manager. It never prints token values. OAuth apps in testing can issue refresh tokens that expire after seven days; reauthorize before a demo.
2. Create random HMAC and director secrets through Secret Manager. Only the service account needs access. Pass resource names ending in `/versions/latest`, not secret values, to the API. Director keys go only into the director screen during a video session.
3. Select exact supported Flash and Pro Agent Platform model IDs in your project. Set `MODEL_FAST` and `MODEL_PRO`; set `VERTEX_LOCATION=global` when those models require the global endpoint, while keeping `GCP_REGION=us-central1` for Cloud Run; the API deliberately does not guess them. Flash serves chat/classification/answers; Pro drafts and revises documents. Agent Platform, Firebase and Google access use server ADC, never browser credentials.
4. Optionally run `scripts/make_templates.py` once and copy its non-secret `GOOGLE_TEMPLATE_IDS` result into configuration. All four Docs and the Sheet are copied into each workspace. Without templates the service creates seeded resources directly. A failed provisioning attempt stays failed; reset creates a new workspace and retires its resources. No blind mutation retry occurs.
5. Copy `infra/api.env.example.yaml` to ignored `infra/api.env.yaml` and fill every placeholder. Set HTTPS API/Hosting origins, scheduler identity, administrator's verified email and secret resource names. The service URL must reach the same service publicly for signed A2A. A predictable Cloud Run URL can use `https://alter-api-PROJECT_NUMBER.REGION.run.app`; Cloud Run also exposes a service-hash URL through `status.url`; either URL is valid. Keep `SERVICE_URL` and `SCHEDULER_AUDIENCE` consistent.
6. Review and run `infra/deploy-api.sh` with its required environment identifiers. It enables APIs, grants the API account Firestore/Agent Platform access and per-secret access, builds the image, deploys Cloud Run with minimum one instance and CPU outside requests, and creates a 15-minute OIDC cleanup job. It leaves Firebase deployment as an explicit final command. Run it with the intended project administrator identity. Artifact Registry/Cloud Build service identities may need your organization's build permissions.
7. Deploy `firestore.rules` and `firestore.indexes.json` before opening the app. All browser writes are denied. Owner/participant reads are limited by the private UID binding and workspace expiry. The indexes include the members collection-group lookup and Live TTL fields. Production workspace expiry uses native Firestore timestamps. Existing deployments that contain old string expiry values must be reset or migrated before using these rules.
8. Build Hosting with `VITE_MOCK=0`, `VITE_DEV_AUTH=0`, public Firebase web config, the API URL and Live token URL. Deploy Hosting and verify mobile HTTPS microphone access. Run readiness, API evaluation, actual Google-file mutations, a separate-browser invite, director reply, cleanup and Live tests before recording the final Meet demo.

## Operations and boundaries

The API allows at most four humans per workspace (the fourth seat reuses QA starter knowledge because the contract lists three role profiles), five creations including resets per observed IP per hour, and 120 model calls per member and 400 per workspace each hour (`MODEL_CALLS_PER_MEMBER_PER_HOUR`, `MODEL_CALLS_PER_WORKSPACE_PER_HOUR`). One chat with tools uses several calls. Production defaults to the observed proxy address conservatively. `TRUST_FORWARDED_IP=1` reads `X-Real-IP` only behind a proxy you control that overwrites it; do not enable it on an unconfigured ingress. Put a trusted ingress in front of the service to obtain individual client limits under larger traffic. A project billing budget and alerts should be configured in the Cloud Billing console; application counters are not a billing spending cap.

Google resources use the team demo account. Public sharing grants viewer access only. File writes require both the workspace registry and Drive parent checks. Proposals store before/after content and Google revisions; approval revalidates organization constraints and serializes writes per workspace. Sheets use RAW values and operation markers. Calendar events use deterministic IDs, fresh busy checks and no external invitations. Email always delivers to member inboxes; Gmail additionally sends only to the caller's currently verified own address. Anonymous sign-ins have no verified email, so typing an address alone does not enable Gmail. Linking a verified Firebase email identity can enable that path without changing authorization.

Unknown mutation outcomes are read back where possible, then marked applied or failed; creates are never blindly replayed. Gmail's minimal send/compose scopes cannot reconcile an ambiguous send. Scheduler cleanup first reconciles approvals interrupted for more than ten minutes, then deletes expired or retired resources and bindings. Failed cleanup remains discoverable for a subsequent run. Private nonce and rate-limit records also expire during cleanup. Daily inspect failed approvals and cleanup results; rotate OAuth/HMAC/director secrets by deploying a new secret version and restarting the service (secrets are cached per worker).

Welcome events run about 20 seconds after joining and ask from Priya's Alter through the same A2A path. Provisioning and welcome tasks use in-process asyncio jobs with progress persisted in storage. Meeting workflows use the new durable Cloud Tasks/outbox coordinator. A process restart can still interrupt the separate welcome/setup jobs. Stalled approvals are reconciled, never replayed; interrupted provisioning requires reset. Keep minimum one instance and CPU outside requests enabled for the current deployment.

Create a video workspace with `scripts/video_workspace.py --base https://API`, using a verified administrator Firebase token in `ALTER_ADMIN_ID_TOKEN`. Public create/join cannot enable director mode. Claim seeded roles with the director key. Explicit, unconditional future dates in an escalation reply authorize a status-document update; the confirmation screen states that effect. Other replies are recorded without claiming a date commitment. Reset invalidates the old invite and atomically rebinds human sessions; guests reload to follow the new workspace.

## Remaining live acceptance

The checked-in implementation and local tests do not demonstrate successful Agent Platform calls, real Google OAuth mutations, Cloud Run IAM/quotas, production Firestore indexes, public Hosting or a Meet recording. Those require project configuration and credentials. Record those results separately after provisioning; simulated screenshots and evaluation numbers must remain labeled as local development.

## Web app settings

Web build settings are listed in [.env.example](../.env.example). For production use `VITE_MOCK=0`, `VITE_DEV_AUTH=0`, the API's `/v1` URL in `VITE_API_BASE`, an empty `VITE_LIVE_TOKEN_BASE` (voice uses the API relay), the public Firebase web config in `VITE_FIREBASE_CONFIG` and, for phone notifications, `VITE_FIREBASE_VAPID_KEY`. Never put a Gemini key, service-account JSON or director key in a `VITE_` variable. Enable Anonymous Auth and authorize the Hosting domain in Firebase Auth.
