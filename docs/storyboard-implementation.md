# Storyboard implementation and live acceptance

The application now connects meeting capture, review, Google writes, A2A continuation and owner confirmation. The visual design is shared across existing screens and the new workflow. This document distinguishes implemented behavior from live checks that still need the team's project and recording devices.

## Implemented

- Warm ivory/cobalt visual system, editorial headings, shared icons and avatars, and a character-first Alter surface with the remaining screens behind the More workbench menu.
- Work screen with consenting transcript capture, review cards for the status document, team summary and task board; source chips, revisions, blue changes and reviewed confirmation.
- Transcript segment IDs, immutable uploads, bounded capture, evidence-backed extraction, persisted review state and deep links. Pending uploads stay on the capturing device for retry. Mixed meeting audio does not authenticate a speaker.
- Restart-safe meeting jobs with transactional outbox, Cloud Tasks dispatch, stable names, leases, deadlines, retry limits, pause/resume/cancel and reconciliation of uncertain writes. Provisioning/welcome still use the earlier in-process mechanism; arbitrary chat is still request-based.
- A separate opt-in, one-use, one-hour continuation grant: ask the represented Alter about production readiness and fill only the designated document section. Other writes keep their explicit approval requirement. Revocation is checked before the effect; already in-flight effects may finish and remain in receipts.
- Priority questions and durable in-app notifications, optional FCM delivery, device registration, a background service worker and notification deep links. FCM acceptance is not proof the OS displayed a notification; retries may replace the same tagged notification.
- Reviewed launch-date parsing, including the storyboard's exact line. The confirmation replaces the pending Launch field, records the typed owner decision and notifies authorized meeting participants through their Alter inboxes. Write failures are separate from accepted owner replies.
- Updated source snapshots after confirmed document edits; an explicit provider-refresh control to inspect the current document. Approved previews remain labelled as the approved version.
- Memory audience controls, editing/reapproval, version history, source-linked guidance, source-version invalidation and memory-epoch checks before releasing an agent answer. Selected text excerpts can be imported with owner/audience/version metadata. Broad Drive discovery and per-user connector OAuth are not added by this workflow.
- Vertex Live relay in the existing API, using ADC and a separately selected native-audio model. Single-use 60-second tickets travel in the first WebSocket message, exact-origin checks, server-owned session release, minute budgeting and separate personal/meeting sessions. Live offers scoped tool modes, never approval. The legacy ephemeral-token service remains available by explicit configuration.
- Recording kiosk with audio input/output selectors, a clean view, playback-driven avatar/voice animation and transcript upload. Short-lived room access allows a separate rig to capture/ask for one meeting; it cannot access approval or owner-control routes. Unrelated huddle tool requests and audio before an accepted work answer are suppressed.
- Search provisioning and native-audio smoke scripts. These scripts do not imply that either provider integration has been deployed or validated yet.

## Run locally

Use the existing commands in [Setup and deployment](deployment.md). Start the API with `DEV_MODE=1` and the web app with `VITE_MOCK=0 VITE_DEV_AUTH=1`. This exercises persistence, workflows, real A2A HTTP and simulated Google adapters without provider charges. The app identifies local AI/Google simulation.

Open **More → Meetings → New meeting**, choose participants, confirm capture consent, then add an actual transcript or start the meeting audio. End voice and choose **Prepare my review**. Edit the prepared work, inspect all cards, optionally authorize the specific production-readiness follow-up, and approve the displayed changes. A team summary is delivered to Alter inboxes; arbitrary external Gmail delivery remains prohibited.

For actual local Gemini reasoning, follow [Real model testing](real-model-testing.md), retaining `GCP_REGION=us-central1` and `VERTEX_LOCATION=global` for the selected text models. The native-audio model/region is configured independently.

## Deploy the backend and Firestore changes

The existing `infra/deploy-api.sh` now enables Cloud Tasks and FCM, creates the `alter-workflows` queue and grants the runtime its enqueue/act-as permissions. It merges `WORKFLOW_QUEUE` and `WORKFLOW_SERVICE_ACCOUNT` into a temporary environment file, preserving the ignored local YAML. The authenticated worker endpoint lives in the same Cloud Run service, with bounded queue concurrency. The service timeout is 900 seconds to accommodate ten-minute audio sessions.

Run that script with the existing project/secret exports. Then deploy the updated Firestore rules/indexes. New collections remain server-written; meeting headers and notifications can be read only by their owner. Transcripts, room credentials, outbox records, tickets and device tokens have no client Firestore access.

The API checks its outbox on startup and periodically while CPU is allocated; Scheduler cleanup also reconciles saved workflows. Keep the current minimum-instance and CPU settings. A queue receipt only means work was accepted. Inspect the Work timeline for the actual result.

## Enable real voice without creating a Gemini API key

Select a **native-audio Vertex model** available to `alter-48b59` and its supported Vertex location. Existing text model access does not prove Live support. Run this explicit paid smoke check from Cloud Shell or a local environment with ADC:

```bash
cd ~/alter
export GCP_PROJECT=alter-48b59
# Replace both values with the actual supported model and location.
PYTHONPATH=services/api services/api/.venv/bin/python \
  services/api/scripts/test_live_audio.py \
  --model YOUR_NATIVE_AUDIO_MODEL --location YOUR_SUPPORTED_LOCATION
```

Only a synthetic greeting is sent. After success, add the same `LIVE_MODEL` and `LIVE_LOCATION` to `infra/api.env.yaml`, then deploy. Leave `VITE_LIVE_TOKEN_BASE` empty so the browser uses `/v1/live/sessions` and the API's WebSocket relay. Do not put service credentials or a Gemini API key in a Vite variable.

In the real app verify audible output and input/output transcripts, a cited tool answer, voice revision, interruption, mute/end, immediate reconnect, a switch between chat and review, and refusal to approve by voice. Verify workspace-minute limits and another user's inability to operate a proposal.

The legacy token endpoint can still be selected with `VITE_LIVE_TOKEN_BASE`; its old ten-minute reservation policy remains conservative. Use the new relay for the continuous storyboard flow.

## Enable phone notifications

1. In Firebase project settings → Cloud Messaging, create/copy the Web Push certificate's **public VAPID key**.
2. Add `VITE_FIREBASE_VAPID_KEY` to the ignored web production environment file. Ensure the public Firebase JSON includes `messagingSenderId: "37066953260"` alongside `projectId`, `apiKey`, `appId` and `authDomain`.
3. Keep `VITE_MOCK=0`, `VITE_DEV_AUTH=0`, the deployed `/v1` API base and an empty legacy token endpoint. Rebuild the frontend and deploy Hosting.
4. Open **Settings → Enable phone notifications** on each recording device. The PWA worker handles background pushes and opens the corresponding work item. On iPhone this requires a supported iOS version and the installed Home Screen web app, with permission requested through a user action.
5. Close/background the recipient app, create one priority question, and observe the notification on the actual phone. Check its deep link and current authenticated role. An open-page Firestore update is not this acceptance test.

Browser session data and room credentials are separate. If switching director roles on a shared device, disable that device's push subscription first and re-enable it for the intended role. The server also checks current UID/member binding before sending.

## Configure Vertex AI Search if retaining that narration

```bash
PYTHONPATH=services/api services/api/.venv/bin/python \
  services/api/scripts/configure_search.py --project alter-48b59
```

This creates a Search store/engine for **fictional shared seed documents only**, imports them and attempts an actual search. It uses normal ADC and Search project billing. Let indexing complete if the first search is empty. Add the printed non-secret `SEARCH_SERVING_CONFIG` to the API YAML and redeploy.

Runtime Search can only reorder passages already authorized by the application. Unknown document IDs and replaced workspace-source versions cannot expand access. Citations indicate whether a passage actually came through Search or lexical fallback. Keep the architecture narration aligned with the retrieval actually observed in the rehearsal.

## Prepare and record the Meet scene

1. Create a director workspace with `scripts/video_workspace.py`, and claim Priya on her phone and Rahul on his phone. Use the same video workspace; each human has its own authenticated browser session.
2. On Priya's Work screen create the meeting, choose Meera and Arjun as summary recipients, and acknowledge capture consent. Rahul's Alter is the represented colleague, not the authenticated organizer.
3. Expand **Connect the Meet recording rig**, generate 20-minute room access, and open the linked kiosk on the Mac recording rig. Enter the room access in its password field. Keep the access code and director key outside the recording. The rig does not claim Rahul's owner role.
4. Join Google Meet from a dedicated account named **Rahul's Alter (AI)**. Capture the kiosk window with OBS Virtual Camera. Route Meet output through one BlackHole path into the kiosk input, and kiosk output through another path into Meet's microphone. Avoid returning the generated voice to its input; all human participants use headphones.
5. Refresh/select devices before starting audio. Use the clean recording view after starting the session; Escape restores operator controls. Test the unaddressed rationale question, irrelevant conversation, launch escalation, source evidence and audible turn-taking before filming.
6. End the rig's voice after the meeting. Confirm all transcript segments uploaded. Priya then prepares the review from her phone. Finalization refuses an active relay room.
7. Run the review/continuation/Rahul-return scenes. Priya's spoken “Approve” accompanies the visible review control. Rahul's voice creates a draft; he reviews the parsed full date and sends it through the explicit control.
8. Record the actual notification, before/after artifact, trace and Google document. Add only disclosed editorial overlays/captions and replace the mock rehearsal footage. The final video is an external recording task, not a generated claim of live behavior.

## Remaining acceptance and broader product scope

Local validation recorded for this implementation:

| Check | Result |
| --- | --- |
| Full API regression suite | 71 passed; 7 paid real-model tests skipped |
| Final targeted meeting/relay/recovery suite | 14 passed, including the subsequent Cloud Tasks retry-generation check |
| Desktop/mobile browser regressions | 32 passed |
| Connected local API browser checks | 8 passed, including meeting, source/memory and relay paths |
| Changed-review confirmation check | Passed on desktop and mobile |
| Production PWA/offline check | Passed |
| TypeScript/Vite build, web lint, Python undefined/import checks, shell syntax and diff whitespace | Passed |


Local tests cover the connected workflow, revision/authority failures, restart and pause, room access boundaries, relay framing/release, memory privacy and desktop/mobile behavior. The actual project still needs real Live audio, FCM phone delivery, Search indexing, Cloud Tasks IAM/restart behavior, Firestore rules/index deployment and Google mutation rehearsal after redeployment. The managed coding environment has no GCP identity or recording devices, so those checks cannot be performed here.

The wider product still has roadmap work: general queued execution for arbitrary chat/delegation, arbitrary Workspace/Drive source connectors, configurable role packages, advanced conflict resolution and the human-effort comparison study. The implemented durable coordinator is scoped to the storyboard's meeting workflow. No benchmark improvements or complete enterprise feature set are asserted.
