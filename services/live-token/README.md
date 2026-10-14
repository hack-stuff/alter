# live-token (Track B)

Tiny Cloud Run service: `POST /v1/live/token {mode, persona}` → `{token, model, expiresAt}`.

- Verifies the Firebase anonymous ID token and the per-sandbox Live-minutes budget (contract §6).
- Mints a short-lived, single-use Gemini Live **ephemeral token** with the API key held in Secret Manager.
- Day 1: confirm ephemeral tokens work with the chosen native-audio Live model. If not, replace this
  with a WebSocket relay to Vertex AI Live and keep `apps/web/src/live/session.ts`'s interface unchanged.

See `docs/track-b-voice-and-app.md` §3.
