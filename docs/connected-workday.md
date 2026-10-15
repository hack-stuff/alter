# Connected workday setup and acceptance

The Alter, diagram and meeting companion now use the persisted API. This document describes this implementation, rather than the earlier scripted screen prototype.

## What is connected

- **Step into Priya's day** creates a fresh, rate-limited project bound to the current Firebase user as Priya. It does not grant director access or claim an existing person's account. Repeating the request resumes that same run. Existing signed-in projects are preserved.
- **Calendar** reads the selected project calendar through the Google adapter. New project calendars include Priya's design review and sync. Existing calendars are not silently rewritten. Times are returned with their actual offset; the browser renders them locally.
- **Design canvas** has owner-only server storage, numbered revisions, validated graph edits and ten undo steps. Production uses a typed Gemini graph patch; the explicit local AI adapter is used only when `AI_BACKEND=local`. A failed production model call never invokes that adapter.
- **Review publication** prepares a new Google Docs specification of the graph. It does not edit running authentication configuration or claim to create a native Google Drawing. The exact reviewed graph revision must still be current when approved. The regular write executor provides the result and receipt. **Read back published document** fetches actual provider content.
- **Meeting questions** use the existing A2A transport and sharing policy. The answer, citations, trace and escalation ID come from the server. Saving a priority question is distinguished from actual phone delivery.
- **Capture** stores typed and voice transcripts in the meeting. A local outbox retains uploads until acknowledged; the existing recording rig can capture the actual Meet audio. Finalizing opens the existing persisted review, approval, continuation and owner-decision workflow.
- **Voice** uses the new scoped `diagram` tool for saved plans. Leaving a work surface stops its microphone/session. Supported navigation requests can open the canvas or meeting companion. A live greeting uses the verified owner's name/context and does not invent completed work.

Voice startup now reuses one page audio context, primed by the entry click and suspended between sessions. A blocked autoplay request times out to a visible **Enable voice** control near the top of the first screen. The greeting is acknowledged only when audio arrives; an unheard greeting is retried on reconnect, and **Hear my briefing** requests it again. Voice can greet during project provisioning while artifact actions remain gated on readiness. Browser sound/microphone permission is still required; a fresh page cannot promise unsolicited playback before any user interaction.
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

## Deploy

Use the updated `storyboard-workflows-redesign` branch. Existing browser sessions keep their current role; use a fresh browser profile/incognito session to try the new Priya entry without replacing existing work.

Use the existing `infra/deploy-api.sh` exports and ignored `infra/api.env.yaml`. Preserve:

```yaml
VERTEX_LOCATION: global
LIVE_MODEL: gemini-live-2.5-flash-native-audio
LIVE_LOCATION: us-central1
MODEL_TIMEOUT_MS: '60000'
```

Optionally add `MEET_URL` with an existing Google Meet call URL. Alternatively, save that link from the meeting companion; it is stored for the current owner. The link must have the form `https://meet.google.com/abc-defg-hij`. It is not a secret and is not evidence that the AI is connected to the call.

Deploy backend first, then rebuild Hosting with the existing public Firebase config, `VITE_MOCK=0`, `VITE_DEV_AUTH=0`, the production `/v1` API URL and an empty `VITE_LIVE_TOKEN_BASE`. Keep the current Firestore rules: plans are accessed through the owner-checked API and gain no direct client write/read permission.

```bash
bash infra/deploy-api.sh
npm --prefix apps/web ci
npm --prefix apps/web run build
npx --yes firebase-tools@15 deploy --project alter-48b59 --only firestore,hosting
```

The new source files are included by the existing API image build; the product-lead seed is covered by the existing package-data wildcard. No new dependency, API service or OAuth scope is required for graph publication to Docs.

## Actual Google Meet operation

The app opens an existing real Google Meet. It still does **not** autonomously join a Google account or manufacture live participant tiles. Before the evaluation window:

1. Create the actual Meet with the hosting account and verify admission from an external account. Save its URL in the companion or API configuration.
2. Start a consenting meeting capture in the companion. Expand **Connect the Meet recording rig**, generate room access and open the linked kiosk.
3. Enter room access on the rig. Join Meet with the separate account named **Rahul's Alter (AI)**, use OBS Virtual Camera for the kiosk and separate BlackHole paths for incoming/outgoing audio. The existing [recording instructions](storyboard-implementation.md#prepare-and-record-the-meet-scene) cover this setup.
4. Verify that a real attendee's question reaches the Alter and that its answer is audible in Meet. A successful API voice smoke test is insufficient.
5. Keep the operator and rig available. Existing ten-minute voice sessions and twenty-minute room credentials still require renewal/reconnection; no unattended 24/7 Meet host is supplied by this change.
6. End room voice, verify transcript uploads and then prepare the review. The server refuses finalization while a meeting voice lease is active.

The companion's microphone hears its selected device input, not another tab's audio automatically. Avoid running the companion microphone and rig capture simultaneously for the same audio: use the companion's End voice control when the rig owns capture. The application distinguishes the linked call from actual participant presence, which it cannot independently verify.

## Acceptance path

1. Start with a fresh browser session and **Step into Priya's day**. Confirm the correct name, role and calendar. A second evaluator must have different project resources.
2. Open the plan. Ask for a retry state using the microphone and then with alternate wording. Confirm the saved revision, edges, reload and undo. Unsupported requests must preserve the graph and explain what is needed.
3. Prepare publication, inspect the specification and approve. Verify the real Google file and readback. Edit the graph after preparing another review; the old review must fail rather than publish stale content. No team notification is asserted for this publication.
4. Switch between Alter, plan and meeting companion. Confirm one microphone/session at a time and no old session consuming the new question. Confirm mobile permission and recovery behavior.
5. Start consented capture, ask Rahul's Alter for rationale and a launch date, inspect actual sources/trace and verify one saved escalation. Add actual transcript if needed, finish and open the prepared meeting review.
6. Complete the existing grouped approval, scoped A2A continuation and Rahul date-reply checks against real Google resources. Background phone delivery additionally requires the public VAPID key and a subscribed device.
7. Rehearse the external Meet rig and guest admission. Do not describe an unavailable or disconnected call as live.

Local automated tests cover the connected API using simulated Google resources and synthetic model adapters. Paid model access, actual phone notification display and the external Meet audio bridge remain project/device acceptance checks.

Validation: 82 backend tests passed, with eight paid Vertex tests skipped. All 32 existing browser checks passed. The twelve connected desktop/mobile cases passed across the full regression run and the corrected relay/workday rerun; the final six-case relay/workday rerun passed. The final plan suite (ten cases), TypeScript/Vite build, lint, Python import/undefined checks and whitespace checks passed. Vertex graph schema serialization was also exercised through the real SDK with a local mock HTTP transport, which does not prove provider access. Desktop and mobile visual inspection checks the edited node remains visible without page overflow.

Local simulated previews: [day](screenshots/connected-day-desktop.png), [desktop plan](screenshots/connected-plan-desktop.png), [mobile plan](screenshots/connected-plan-mobile.png). The simulation banner remains visible. Native-audio transport is replaced by a local test harness for these captures.
