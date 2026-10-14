# Alter

Everyone gets their own Alter: an AI representative that answers teammates and their Alters within
the limits you set, and acts in Google Docs, Drive, Sheets, Calendar and Gmail when you approve.

Team Cold Silicon · Google AI Builder Cup 2026 · Theme 5 (Future of Work).
All people, projects and data in this repo are fictional.

## Plan

| Doc | What |
|---|---|
| [docs/00-shared-contract.md](docs/00-shared-contract.md) | **Read first.** API, Firestore layout, seed data, judge flow, milestones |
| [docs/track-a-agent-backend.md](docs/track-a-agent-backend.md) | Track A: workspaces, ADK Alters, A2A, policy gate, Google app actions |
| [docs/track-b-voice-and-app.md](docs/track-b-voice-and-app.md) | Track B: web app, Gemini Live voice, demo video |
| [docs/storyboard.md](docs/storyboard.md) | 3-minute demo video script (staged; the live product is free-use) |

## Layout

```
contracts/          shared fixtures + CONTRACT_VERSION (both tracks)
services/api/       Track A: FastAPI + ADK (Python 3.12)
services/live-token Track B: Gemini Live ephemeral-token minting
apps/web/           Track B: React + Vite PWA
```

## Run locally

```bash
# Backend (stub routes serve contract fixtures while DEV_MODE=1)
cd services/api
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/pytest
.venv/bin/uvicorn app.main:app --reload --port 8080

# Web app against mocks (no backend needed)
cd apps/web
npm install
VITE_MOCK=1 npm run dev
# …or against the local backend
VITE_API_BASE=http://localhost:8080/v1 npm run dev
```

## Track B development

Track B implements all seven app screens, mock workspace streams, Firebase anonymous
auth/read subscriptions, four Gemini Live voice modes, a separate authenticated token
service, and an installable PWA. Voice can revise or draft replies; approval always
uses an on-screen button. Kiosk/director entry points and a captioned sample-data
recording kit are included.

Use `VITE_MOCK=1 npm run dev` from `apps/web` for the full rehearsal. Sample changes
last for the page session and reset on reload. The mock app never writes to Google.
For the current Track A HTTP stub use `VITE_MOCK=0 VITE_DEV_AUTH=1`; for real Firebase
and voice use the configuration in [Track B deployment](docs/track-b-deployment.md).
The real Google integrations and director authorization depend on Track A.

From `apps/web`, validate with `npm run build`, `npm run lint`, `npm run test:e2e`,
and `npm run test:pwa`. Install Playwright Chromium first or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` in this cloud environment.
The token service has its own Python environment and pytest suite under
`services/live-token`. For the recording kit and real Meet/OBS setup, see
[video/README.md](video/README.md).

Live Gemini/Firebase validation and public deployment await the project's
configuration and API key. Local tests use provider doubles and sample data;
they do not establish real Google actions or a completed live Meet recording.
