# Gemini Live token service (Track B)

`POST /v1/live/token {mode, memberId?}` returns `{token, model, expiresAt, sessionId}`. Modes
are `chat`, `revise`, `reply`, and `huddle`; `memberId` is required only for huddle.
Use a Firebase ID token in `Authorization: Bearer ...`. There is no development
authentication bypass in this service.

The server verifies the ID token including revocation, resolves the caller's
single workspace from `members.uid`, and checks that a huddle persona belongs to
that workspace. It reads the Gemini API key from Secret Manager using the service
identity. The key never reaches the browser; tokens are single-use, may start a
connection for 60 seconds, and expire after 10 minutes. The installed Google SDK
documents token expiry as rejecting further Live messages (the provider may
close the connection early); the browser also closes on the deadline.

A Firestore transaction reserves ten minutes before minting. A per-UID lock
prevents overlapping sessions, including at hour boundaries. When voice ends the
browser calls `POST /v1/live/release {sessionId}`, which clears that lock so the
user can start again; the reserved minutes stay charged. An open session returns
429 `VOICE_ACTIVE`; an exhausted workspace budget returns 429 `RATE_LIMITED`. The default workspace
limit is forty minutes per hour, configurable with
`LIVE_WORKSPACE_MINUTES_PER_HOUR`. Failed mints refund the reservation; the refund
is idempotent. A token minted but never used still consumes its reservation. This
conservative policy avoids relying on unauthenticated client usage reports.
Budgets live under `workspaces/{wid}/liveBudgets` and active reservations under
`liveSessions`; enable TTL on their `expiresAt` fields. Clients must have no write
access to these server-owned collections.

The model, audio modalities, transcripts, system instructions and the mode's
single tool are locked into the token. Approval and Google-write tools are never
exposed. Track A's authenticated API remains the authority for every delegated
request. Reply dictation in the UI is drafted for review before the send button.

## Local setup

```bash
cd services/live-token
python3 -m venv .venv
.venv/bin/pip install -c requirements.lock -e '.[dev]'
.venv/bin/python -m pytest -q
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8081
```

The service can start and answer `/healthz` without credentials. Mint requests
return 503 until configured. Tests inject local doubles for Firebase, Firestore
and Gemini; they verify security boundaries and budget behavior without pretending
to validate real provider access.

## Required configuration

- `GCP_PROJECT`: the Firebase/Firestore project ID.
- `GEMINI_API_KEY_SECRET`: full Secret Manager version resource name, e.g.
  `projects/PROJECT/secrets/gemini-api-key/versions/latest`.
- `LIVE_MODEL`: a concrete Gemini native-audio model compatible with ephemeral
  tokens in your project. This is required, with no guessed fallback. Pin it only
  after the real smoke check below; key creation was deferred during implementation.
- `CORS_ORIGINS`: comma-separated exact frontend origins. No wildcard is added.
- Application Default Credentials: the runtime service identity needs Firebase
  Authentication user-read access (revocation checks), Firestore data access,
  and Secret Manager accessor for the chosen secret.
- Firestore needs a collection-group index for `members.uid` equality. Merge the
  field override in `firestore.indexes.example.json` into the project's existing
  indexes rather than replacing Track A's index configuration.

For Cloud Run, build `Dockerfile` from this directory and deploy under that service
identity. Set the environment above and `PORT` as provided by Cloud Run. Allow
unauthenticated HTTP ingress to reach the endpoint; Firebase bearer verification
still protects token issuance. Track A owns the workspace data and Firestore
security rules. Do not deploy permissive client rules for budget collections.

## Real acceptance check after key/project configuration

1. Configure the web app's Firebase JSON and token endpoint. Join a real workspace
   so the UID is bound to a member by Track A.
2. Start voice. Verify input/output transcripts and audible 24 kHz output. Speak
   a work question and confirm the tool calls Track A and shows its citations.
3. In a proposal, revise by voice. Attempt voice approval and confirm it directs
   you to the button. Test hold-to-talk on an escalation, review and send it.
4. Interrupt output, mute/unmute, and end the session; confirm the microphone is
   released. Let a test session expire and confirm subsequent input is rejected.
5. Verify a second token with the same UID during cooldown is 429 and a teammate
   outside the workspace is 403. Confirm a token cannot be reused for a second
   connection and cannot change the locked model/tools.

If the provider rejects ephemeral tokens for the selected model, do not put a
long-lived key in the browser. Use the documented Track B fallback: an authenticated
Cloud Run WebSocket relay behind the same session interface, after confirming that
failure against the real project. No such compatibility failure has been observed
here because a key has not been supplied.
