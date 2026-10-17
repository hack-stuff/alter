# Alter

**Everyone on a team gets their own Alter: an AI representative that answers teammates and their
Alters within the limits you set, and works in Google Docs, Drive, Sheets and Calendar for you.
Anything that leaves the team, like sending an email, waits until you say so.**

Built by Team Cold Silicon for the Google AI Builder Cup 2026, Theme 5 (Future of Work).
All people, projects and data in this repository are fictional.

> **Project status:** hackathon prototype. Local simulation and the connected Google/voice path
> have both been exercised; the connected build is deployed at [myalter.web.app](https://myalter.web.app/).
> Some meeting and notification steps still require operator setup and verification.

What's new:

- **A redesigned app.** The "Quiet Desk" design from [docs/design-brief.md](docs/design-brief.md):
  an icon rail on laptops and a bottom bar on phones, a docked voice bar, humans as circles and
  Alters as amber squircles, Google app icons on files and sources, light and dark themes.
- **Your Alter does the work.** Doc, sheet and calendar changes it drafts are applied straight
  away and kept as a record. Emails wait as drafts until you approve them, or just say "send it".
  You can also say or type "approve it" or "reject that email".
- **Instant navigation by voice or text.** "Open approvals", "show me the calendar proposal" or
  "show the retry node on the canvas" switch screens as soon as the words are recognised, and
  highlight the item. The voice session stays on while it moves you between screens.
- **The guided workday.** You step into Dev's day as product lead, hear a spoken briefing, edit a
  login-flow design by voice, join a team meeting with Siddhi's Alter and send the follow-up.
  [docs/connected-workday.md](docs/connected-workday.md) describes how this works and how to set it up.

## Description

Teams lose time waiting for each other: someone is in meetings, on leave, or in another time
zone. Alter gives each person an AI representative that can answer for them, but only within the
rules they set.

- **Ask a teammate's Alter.** "Why did we switch to one-tap sign-in?" gets an answer with sources
  from Siddhi's notes, even while Siddhi is on leave.
- **Delegate work.** Ask your Alter to update the status doc, add a tracker row or book a meeting,
  and it does it, leaving a before/after record you can inspect. Emails to the team are drafted
  and wait for you: press **Approve** or say "send it".
- **Stay in control.** Each person sets what their Alter may share, and with whom. Requests it
  can't answer, such as committing to a date for someone else, become questions for that person.
- **Alters talk to each other.** One Alter asks another over the
  [A2A protocol](https://a2a-protocol.org/) before interrupting a human. Every request is signed,
  checked against the owner's rules, and recorded with a receipt.
- **Voice.** Your Alter greets you with a spoken briefing of your day. Talk to it, revise a
  proposal or dictate a reply with [Gemini Live](https://ai.google.dev/gemini-api/docs/live),
  relayed through the API, so no Gemini API key is needed. Say "open approvals", "send it" or
  "reject that" and it does it.
- **Design by voice.** A saved design canvas (a login-flow diagram) that you edit by voice or text,
  with numbered revisions and undo. After you review it, it's published as a Google Docs
  specification.
- **Meetings.** A meeting companion asks a teammate's Alter questions during a call and records the
  conversation, with everyone's consent. When the meeting ends, your Alter drafts the follow-up:
  status doc changes, a team summary and task board items, ready for you to review together.
- **Notifications.** Questions that need a person show up in an in-app inbox, and optionally as
  phone notifications.

Every new visitor gets a private workspace: a copy of a seeded team (Dev, Siddhi, Kani and
Sahil, working on a "Login revamp" project), with its own Drive folder, spreadsheet and calendar.
Select **Step into Dev's day** to start the guided workday as Dev, or type a name to join as a
new member. An invite link lets others join the same workspace.

**How it's built:** Python 3.12, FastAPI and [Google ADK](https://google.github.io/adk-docs/)
agents with Gemini on Gemini Enterprise Agent Platform (formerly Vertex AI) for the backend; React, TypeScript and Vite for the installable
web app (PWA); Firestore for state; Firebase anonymous sign-in. The design is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Installation

There are three ways to run Alter. Start with the first; it needs nothing but Node.js.

| Mode                                      | What you get                                                                   | Needs                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------- |
| [1. Demo mode](#1-demo-mode-frontend-only) | The full app with sample answers. Changes reset on reload.                     | Node.js                                      |
| [2. Local backend](#2-local-backend)       | The real API with saved workspaces, invites and simulated AI and Google files. | Node.js, Python 3.12                         |
| [3. Cloud](#3-cloud-deployment)            | Real Gemini, real Google files, voice, public hosting.                         | A configured Google Cloud / Firebase project |

### Requirements

- [Node.js](https://nodejs.org/) 20.19+ or 22.12+ (tested with 24), and npm
- [Python](https://www.python.org/) 3.12, for the local backend only
- Git

Clone the repository first:

```bash
git clone https://github.com/hack-stuff/alter.git
cd alter
```

### 1. Demo mode (frontend only)

```bash
cd apps/web
npm ci
VITE_MOCK=1 npm run dev
```

Open [http://localhost:5173](http://localhost:5173), type a name and select **Get my Alter**. Demo mode uses built-in
sample data, never contacts a server and never writes to Google. The guided workday, the design
canvas and meeting recording need a backend, so they're available only in modes 2 and 3.

### 2. Local backend

This runs the real API on your machine. It stores workspaces in a local SQLite file, uses a
built-in stand-in for the AI, and simulates Google files. No API keys or accounts are needed.

From the repository root, set up the API once:

```bash
python3.12 -m venv services/api/.venv
services/api/.venv/bin/pip install -c services/api/requirements.lock -e 'services/api[dev]'
npm ci --prefix apps/web
```

Then start the API and the web app in two terminals:

```bash
# Terminal 1: API on port 8080
DEV_MODE=1 SERVICE_URL=http://127.0.0.1:8080 CORS_ORIGINS=http://127.0.0.1:5173 \
  services/api/.venv/bin/uvicorn app.main:app --app-dir services/api --host 127.0.0.1 --port 8080
```

```bash
# Terminal 2: web app on port 5173
VITE_MOCK=0 VITE_DEV_AUTH=1 VITE_API_BASE=http://127.0.0.1:8080/v1 \
  npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5173
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) and select **Step into Dev's day**. Workspaces are saved in
`/tmp/alter.sqlite3` (change it with `DATABASE_PATH`). Each browser profile acts as a separate
person, so use a second profile or a private window to try an invite link or a fresh workday.

All settings are listed, with comments, in [.env.example](.env.example). You can keep API
settings in an ignored root `.env.local` and pass `--env-file .env.local` to uvicorn.

To use real Gemini models, Google files and voice from your machine (with Google Cloud application
default credentials), see the "Run on the Mac" section of
[docs/connected-workday.md](docs/connected-workday.md). Settings in that mode include
`AI_BACKEND=vertex`, `GOOGLE_BACKEND=google`, `LIVE_MODEL` and `LIVE_LOCATION`. With
`DEV_MODE=1`, secrets can be read from local files in `~/.config/alter/secrets/` instead of
Secret Manager.

### 3. Cloud deployment

The current build is deployed at [myalter.web.app](https://myalter.web.app/) (Google Cloud
project `x-pathway-511910-q0`; the Hosting site is `myalter`). A separate
deployment needs a billing-enabled Google Cloud project with Firebase, Firestore, Gemini
Enterprise Agent Platform, and a demo Google account for Docs, Drive, Sheets, Calendar and Gmail.
Voice runs through the API's native-audio relay, which uses the service's own Google Cloud
credentials, so no Gemini API key is needed. Leave `VITE_LIVE_TOKEN_BASE` empty to use it; the
separate `services/live-token` service is an older alternative. The step-by-step guides are:

- [Setup and deployment](docs/deployment.md): the API, Firestore, the Google account and web settings
- [Connected workday](docs/connected-workday.md): the current deploy commands, voice model and
  Meet link settings, and an end-to-end acceptance checklist
- [Storyboard implementation](docs/storyboard-implementation.md): meeting workflows (Cloud Tasks
  queue), phone notifications (Web Push key), optional Vertex AI Search, and the Meet recording rig
- [Real-model testing](docs/real-model-testing.md): checking real Gemini calls before deploying

`infra/deploy-api.sh` also sets up the Cloud Tasks queue and messaging permissions. Deploy the
Firestore rules and indexes together with Hosting
(`npx firebase-tools deploy --only firestore,hosting`).

Before going public, set Agent Platform quotas and a billing budget in the Google Cloud console. The
app's own limits (120 model calls per member and 400 per workspace each hour) count calls, not
cost, and apply per workspace.

## Usage

After joining, you're one member of the seeded team. If you chose **Step into Dev's day**,
your Alter greets you by voice with your calendar and any pending work (allow microphone access, or
select **Enable voice** if the browser blocks sound). The Alter screen offers four starting points:
join the team sync, shape the login plan on the canvas, see what needs you, and ask about the
launch. You can also type or say these:

| Try                                            | What happens                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| "Why did we switch to one-tap sign-in?"        | Your Alter answers with links to its sources.                                                                    |
| "Ask Siddhi's Alter to confirm the launch date" | Siddhi is on leave and committing to a date is Siddhi's call, so Siddhi's Alter asks Siddhi instead of answering.              |
| "Add a QA update to the status doc"            | The status doc is updated right away; the change and its before/after record appear in the conversation.        |
| "Book 30 min with Kani on Thursday"           | The event is added to the team calendar. It's refused if either of you is already busy then.                     |
| "Email the team a QA summary"                  | An email draft to teammates' inboxes. Say "send it" or press **Approve** to send. External addresses are blocked. |
| "Open approvals" / "show the retry node"       | The screen switches immediately and the item is highlighted.                                                      |

On the design canvas, try "Add a retry state if sign-in fails and connect it back to one-tap",
then **Undo last edit** or **Review publication**.

The rail (the bottom bar and its **More** sheet on phones) holds every screen. You can also ask
your Alter to open any of them:

- **Home:** your Alter, today's agenda, what's waiting on you, and the ask bar
- **Canvas:** the login-flow design canvas
- **Meeting:** the meeting companion. It asks Siddhi's Alter questions, records the
  conversation, opens a saved Google Meet link and connects a recording rig. Its **Meetings** tab
  lists recorded meetings and their prepared follow-up
- **Approvals:** drafts waiting for you (emails) and a record of changes your Alter made
- **Decisions:** questions other people's Alters need you to answer
- **Team:** teammates and their Alters, the invite link, and asking someone's Alter directly
- **Work log:** what happened while you were away, each with a receipt of the sources and rules used
- **Rules & memory:** what your Alter knows, what it may share, your email and phone notifications
- **Files:** the workspace's Google files and your team inbox

Opening a link in Google Meet does not put an AI into the call. Joining Meet as "Siddhi's Alter"
needs the OBS and audio-routing setup in
[docs/storyboard-implementation.md](docs/storyboard-implementation.md#prepare-and-record-the-meet-scene).

## Running the tests

| Part                                     | Command (from the repository root)                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| API (Python)                             | `PYTHONPATH=services/api services/api/.venv/bin/pytest services/api/tests -q`                                                     |
| Web: type check and build                | `npm --prefix apps/web run build`                                                                                                 |
| Web: lint                                | `npm --prefix apps/web run lint`                                                                                                  |
| Web: browser tests (demo mode)           | `npm --prefix apps/web run test:e2e`                                                                                              |
| Web: browser tests against the local API | `npm --prefix apps/web run test:backend`                                                                                          |
| Web: installable app (PWA)               | `npm --prefix apps/web run test:pwa`                                                                                              |
| Voice token service                      | `cd services/live-token && .venv/bin/python -m pytest -q` (set up its `.venv` as in [its README](services/live-token/README.md)) |
| Firestore security rules                 | `npm ci --prefix infra && npm --prefix infra run test:rules` (needs Java for the Firebase emulator)                               |

The browser tests need Playwright's Chromium: run `cd apps/web && npx playwright install chromium`
once. The tests use stand-ins for Gemini, Firebase and Google, so they don't prove that the real
services work. [docs/real-model-testing.md](docs/real-model-testing.md) covers that. To check
real voice, `services/api/scripts/test_live_audio.py` sends a synthetic greeting to the configured
native-audio model (a paid call; see [docs/connected-workday.md](docs/connected-workday.md)).

## Project layout

```
apps/web/              React + Vite web app (PWA): Alter screen, design canvas, meeting
                       companion, recording kiosk, other screens, voice, demo mode
services/api/          FastAPI + Google ADK backend: workspaces, Alters, A2A, approvals,
                       policy checks, Google app actions, meetings, plans, the voice relay
                       and notifications
services/api/scripts/  Helper scripts: demo tokens, voice and model smoke tests, Search setup
                       and the world seeder
services/live-token/   Older alternative voice transport: single-use Gemini Live tokens
contracts/             Shared sample data used by both the app and the API
infra/                 Deployment script, Cloud Build config, Firestore rules tests
docs/                  Architecture, API contract, setup, deployment and design brief
video/                 Demo video script, captions and recording kit
firestore.rules        Who may read what in Firestore (all writes go through the API)
```

### Documentation

| Doc                                                                    | What it covers                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [docs/connected-workday.md](docs/connected-workday.md)                 | **Start here:** the current workday experience, local setup and acceptance checks |
| [docs/deployment.md](docs/deployment.md)                               | Cloud prerequisites, deploying the API and Hosting, operating limits              |
| [docs/storyboard-implementation.md](docs/storyboard-implementation.md) | Meeting workflows, voice relay, phone notifications, Search and the Meet rig      |
| [docs/real-model-testing.md](docs/real-model-testing.md)               | Checking real Gemini calls before deploying                                       |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                           | Positioning and design decisions                                                  |
| [docs/api-contract.md](docs/api-contract.md)                           | API endpoints, Firestore layout, seed data, limits                                |
| [docs/design-brief.md](docs/design-brief.md)                           | Visual design brief for the web app                                               |
| [docs/storyboard.md](docs/storyboard.md)                               | The 3-minute demo video script                                                    |
| [video/README.md](video/README.md)                                     | Recording the demo with Google Meet and OBS                                       |

## Support

Open an issue at [https://github.com/hack-stuff/alter/issues](https://github.com/hack-stuff/alter/issues) with what you ran, what you
expected and what happened. For error messages that include a `Reference:` code, include that
code; it matches the server log entry.

## Roadmap

- [X] Set up the Google Cloud and Firebase project, Agent Platform models and the demo Google account
- [X] Run the real-model and native-audio tests against Agent Platform
- [X] Deploy the API to Cloud Run and the app to Firebase Hosting
- [X] Deploy the latest workday, meeting and notification changes (Cloud Tasks queue, Firestore indexes)
- [X] Redesign the web app to the Quiet Desk design brief
- [ ] Deploy the autonomous-Alter behavior and voice navigation (API and web)
- [ ] Run the Firestore security rules tests with the Firebase emulator
- [ ] Set Agent Platform quotas and a billing budget with alerts
- [ ] Check phone notifications, Search indexing and real Google writes after redeploying
- [ ] Rehearse the Google Meet recording rig end to end
- [ ] Record the demo video

## Contributing

This is a hackathon project for Team Cold Silicon, and we aren't accepting outside contributions
right now. For team members:

1. Create a branch from `main`.
2. Make your change in the style of the surrounding code.
3. Run the tests above for the parts you touched (at minimum the API tests, the web build, lint
   and `test:e2e`).
4. Open a pull request with a short description of what changed and how you tested it.

Keep secrets out of the repository. Configuration takes Secret Manager resource names, never
secret values (see [.env.example](.env.example)).

## Authors and acknowledgment

Team Cold Silicon: Devesh, Sahil, Priyanshu and Kanmani.

Built with [Google ADK](https://google.github.io/adk-docs/), the
[A2A protocol](https://a2a-protocol.org/), [Gemini](https://ai.google.dev/) on Gemini Enterprise Agent Platform,
[Firebase](https://firebase.google.com/), [FastAPI](https://fastapi.tiangolo.com/),
[React](https://react.dev/) and [Vite](https://vite.dev/).

## License

No license has been chosen yet, so all rights are reserved by default. Add a `LICENSE` file before
making the project open source.
