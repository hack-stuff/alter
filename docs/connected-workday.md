# Connected workday setup and acceptance

The Alter, diagram and meeting review now use the persisted API. This document describes this implementation, rather than the earlier scripted screen prototype.

## What is connected

- **Step into Dev's day** creates a fresh, rate-limited project bound to the current Firebase user as Dev. It does not grant director access or claim an existing person's account. Repeating the request resumes that same run. Existing signed-in projects are preserved.
- **Calendar** reads the selected project calendar through the Google adapter. New project calendars include Dev's design review and sync. Existing calendars are not silently rewritten. Times are returned with their actual offset; the browser renders them locally.
- **Design canvas** has owner-only server storage, numbered revisions, validated graph edits and ten undo steps. Production uses a typed Gemini graph patch; the explicit local AI adapter is used only when `AI_BACKEND=local`. A failed production model call never invokes that adapter.
- **Review publication** prepares a new Google Docs specification of the graph. It does not edit running authentication configuration or claim to create a native Google Drawing. The exact reviewed graph revision must still be current when approved. The regular write executor provides the result and receipt. **Read back published document** fetches actual provider content.
- **Meeting questions** use the existing A2A transport and sharing policy. The answer, citations, trace and escalation ID come from the server. Saving a priority question is distinguished from actual phone delivery.
- **Meet launch and capture** create a fresh Google Meet space with open access on every start; a previously saved link is never reused. Saying “start the meeting” or “join the team sync,” typing it, or choosing the team sync card opens the new room without another click. If the connected account lacks Meet space consent or Google does not confirm open access, Alter shows an error instead of sending the user to a host waiting room. A local outbox retains consenting transcript uploads until acknowledged; the existing recording rig can capture actual Meet audio. Finalizing opens the persisted review, approval, continuation and owner-decision workflow in Alter.
- **Voice** is one chat session that stays on while the Alter moves between screens. On the canvas, spoken edits ("change the timeout to 15 minutes") revise the saved plan and highlight the changed node. A live greeting uses the verified owner's name/context and does not invent completed work. The meeting companion still starts its own scoped huddle session for Siddhi's Alter.
- **Autonomous Alter.** Doc, sheet and calendar changes the owner's Alter drafts are applied immediately (`Engine.autopilot`) and kept as a before/after record. Emails stay `proposed` until the owner approves them, by button, by typing "send it" / "approve it" / "reject that", or by voice through the Live `decide_proposal` tool.
- **Navigation** goes through one typed action, `navigateTo(screen, targetElementId?, highlightState?)`, for the nine screens (`home`, `canvas`, `meeting`, `approvals`, `decisions`, `team`, `work-log`, `rules`, `files`). A deterministic parser (`apps/web/src/agent/navigation.ts`) acts on the streaming transcript or typed text before the model answers, and the Live `navigate_to` tool covers everything else; a later tool call for the same screen is skipped. Workday screens stay mounted, so a switch takes one frame, and the target item is scrolled to, focused and pulsed. The Voice Bar shows where the Alter went.

Voice startup reuses one page audio context, primed by the entry click and suspended between sessions. On first entry, a full-screen workday transition stays visible until the first greeting audio arrives; a returning session waits until voice reconnects. Voice starts after project provisioning, so the greeting can use verified calendar events and pending work. A blocked autoplay request shows **Enable voice** on the transition; a failed or slow connection also offers entry without voice. An unheard greeting is retried on reconnect, and **Hear my briefing** requests it again. Browser sound/microphone permission is still required; a fresh page cannot promise unsolicited playback before any user interaction.
- **Provider resilience** has a configurable 60-second per-request model timeout, at most two SDK attempts, a matching A2A transport timeout and separate deadline diagnostics. These settings mitigate transient failures; they do not establish that the previously observed provider 504 is resolved in the deployed project. No automatic Google-write replay was added.
- **Local secrets** are supported only with `DEV_MODE=1`. Production always reads Secret Manager, even when an identically named local JSON file exists.

The browser-only mock build still exists for the original fixture demonstrations. The new canvas and capture explicitly require the connected API instead of pretending to publish work. `VITE_MOCK=0` does not itself prove that AI or Google adapters are real: the server's local simulation banner remains visible, including on the diagram and meeting stages.

## Run on the Mac

Keep local API settings and OAuth credentials outside Git. Use the existing API virtualenv, local SQLite storage and development authentication. For a fully synthetic connected run, use `DEV_MODE=1`, `STORE_BACKEND=sqlite`, `AI_BACKEND=local` and `GOOGLE_BACKEND=local`. Start the API and web app using the existing deployment/development runbook, with web variables `VITE_MOCK=0`, `VITE_DEV_AUTH=1` and `VITE_API_BASE=http://localhost:8080/v1`.

For real models locally, select `AI_BACKEND=vertex`, the actual project and models and ADC. The new paid acceptance test is included in:

```bash
GCP_PROJECT=alter-48b59 GCP_REGION=us-central1 VERTEX_LOCATION=global \
  bash services/api/scripts/test_real_models.sh -k diagram
```

Only synthetic design content is sent; the Google adapters in this test remain local. Running it is not a substitute for checking the deployed runtime service account and a real Google document write.

For voice, set `LIVE_MODEL=gemini-live-2.5-flash-native-audio` and `LIVE_LOCATION=us-central1` in the API's ignored `.env.local`. Keep `VERTEX_LOCATION=global` for the text models. Restart the API after changing its environment. Test the Mac's identity and native audio independently of the browser:

```bash
services/api/.venv/bin/python services/api/scripts/test_live_audio.py \
  --project alter-48b59 --model gemini-live-2.5-flash-native-audio \
  --location us-central1 --with-tools
```

This opt-in provider call uses a synthetic greeting and a fixed tool result; it sends no workspace data. The tools option checks the function-call round trip as well as audio and transcription configuration.

If Python reports `google.auth.exceptions.RefreshError` with `invalid_grant`, refresh **application default credentials on the Mac**, then restart the API:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project alter-48b59
```

CLI login alone does not refresh the credentials used by Python. A passing Cloud Shell check also does not validate the Mac's credentials. Retest voice after restarting; the browser keeps no provider credential. Live failures now show an error reference and emit a matching `live_session_failed` JSON record in the API terminal, including the failure stage, category, model and location. These records exclude raw provider messages, credentials and transcripts. Failed provider connections release their session lease without consuming the workspace's voice minutes.

## Deploy

Deploy from `main`. Existing browser sessions keep their current role; use a fresh browser profile/incognito session to try the new Dev entry without replacing existing work.

Use the existing `infra/deploy-api.sh` exports and ignored `infra/api.env.yaml`. Preserve:

```yaml
VERTEX_LOCATION: global
LIVE_MODEL: gemini-live-2.5-flash-native-audio
LIVE_LOCATION: us-central1
MODEL_TIMEOUT_MS: '60000'
```

`MEET_URL` can still supply a day-view link, but starting a meeting always creates a fresh Open Meet space through the connected account. The local Google simulator returns a visible setup error instead of a fake link. A link alone is not evidence that an AI has joined the call.

Deploy backend first, then rebuild Hosting with the existing public Firebase config, `VITE_MOCK=0`, `VITE_DEV_AUTH=0`, the production `/v1` API URL and an empty `VITE_LIVE_TOKEN_BASE`. Keep the current Firestore rules: plans are accessed through the owner-checked API and gain no direct client write/read permission.

```bash
bash infra/deploy-api.sh
npm --prefix apps/web ci
npm --prefix apps/web run build
npx --yes firebase-tools@15 deploy --project alter-48b59 --only firestore,hosting
```

The new source files are included by the existing API image build; the product-lead seed is covered by the existing package-data wildcard. No new dependency, API service or OAuth scope is required for graph publication to Docs.

## Actual Google Meet operation

The app creates a fresh open Google Meet and opens it by voice. The OAuth bundle must include Meet space consent from `get_demo_token.py --include-meet`, and the Google Meet API must be enabled. Existing OAuth secrets without `meet_refresh_token` fail with `MEET_SETUP_REQUIRED` while the rest of Google work stays available. It shows the user's Alter and seeded teammates' Alters as ready **in Alter**. For a local demo, the optional Chrome participant helper can join one dedicated Google account as a real muted Meet tile before the user enters. It does not route Alter speech or other accounts into Meet. Meet's microphone and camera prompts belong to Google's origin and cannot be granted by Alter ahead of time. Before the evaluation window:

1. Renew the connected demo account's OAuth consent with `--include-meet` and verify a fresh room returns `OPEN` access. The Meet API must be enabled in the Cloud project. Opening the review alone does not create a room; every start command does.
2. Start a consenting meeting capture in the companion. Expand **Connect the Meet recording rig**, generate room access and open the linked kiosk.
3. Enter room access on the rig. Join Meet with the separate account named **Siddhi's Alter (AI)**, use OBS Virtual Camera for the kiosk and separate BlackHole paths for incoming/outgoing audio. The existing [recording instructions](storyboard-implementation.md#prepare-and-record-the-meet-scene) cover this setup.
4. Verify that a real attendee's question reaches the Alter and that its answer is audible in Meet. A successful API voice smoke test is insufficient.
5. Keep the operator and rig available. Existing ten-minute voice sessions and twenty-minute room credentials still require renewal/reconnection; no unattended 24/7 Meet host is supplied by this change.
6. End room voice, verify transcript uploads and then prepare the review. The server refuses finalization while a meeting voice lease is active.

For the local participant helper, run `ALTER_MEET_BOT_ACCOUNT=... npm --prefix apps/web run meet:bot` and sign into that exact account in the separate Chrome window once. Chrome stores that session in `~/.config/alter/meet-bot-chrome`, outside the repo; do not copy or commit it. Set `ALTER_MEET_BOT_URL=http://127.0.0.1:8787` in the local API environment and restart the API. Each start waits for the helper to confirm that its muted tile joined. If the helper or account is unavailable, Alter shows a retry error and stays on its own page. The helper uses synthetic media devices and mutes its browser output, so it cannot supply a speaking Alter. A real speaking tile still needs the documented OBS and audio-routing rig.

The companion's microphone hears its selected device input, not another tab's audio automatically. Avoid running the companion microphone and rig capture simultaneously for the same audio: use the companion's End voice control when the rig owns capture. The application distinguishes the linked call from actual participant presence, which it cannot independently verify.

## Acceptance path

1. Start with a fresh browser session and **Step into Dev's day**. Confirm the correct name, role and calendar. A second evaluator must have different project resources.
2. Open the plan. Ask for a retry state using the microphone and then with alternate wording. Confirm the saved revision, edges, reload and undo. Unsupported requests must preserve the graph and explain what is needed.
3. Prepare publication, inspect the specification and approve. Verify the real Google file and readback. Edit the graph after preparing another review; the old review must fail rather than publish stale content. No team notification is asserted for this publication.
4. Switch between Alter, plan and meeting companion. Confirm one microphone/session at a time and no old session consuming the new question. Confirm mobile permission and recovery behavior.
5. Start consented capture, ask Siddhi's Alter for rationale and a launch date, inspect actual sources/trace and verify one saved escalation. Add actual transcript if needed, finish and open the prepared meeting review.
6. Complete the existing grouped approval, scoped A2A continuation and Siddhi date-reply checks against real Google resources. Background phone delivery additionally requires the public VAPID key and a subscribed device.
7. Rehearse the external Meet rig and guest admission. Do not describe an unavailable or disconnected call as live.

Local automated tests cover the connected API using simulated Google resources and synthetic model adapters. Paid model access, actual phone notification display and the external Meet audio bridge remain project/device acceptance checks.

Validation: 82 backend tests passed, with eight paid Vertex tests skipped. All 32 existing browser checks passed. The twelve connected desktop/mobile cases passed across the full regression run and the corrected relay/workday rerun; the final six-case relay/workday rerun passed. The final plan suite (ten cases), TypeScript/Vite build, lint, Python import/undefined checks and whitespace checks passed. Vertex graph schema serialization was also exercised through the real SDK with a local mock HTTP transport, which does not prove provider access. Desktop and mobile visual inspection checks the edited node remains visible without page overflow.
