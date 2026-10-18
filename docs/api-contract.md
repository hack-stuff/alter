# API contract

## Version 3 additions: meeting workflow and scoped authority

The existing endpoints and fixture shapes remain compatible. The integrated implementation adds:

- `POST/GET /v1/meetings`, `GET /v1/meetings/{id}`, immutable segment uploads, finalize, bundle revision, exact-revision bundle approval, and pause/resume/cancel/retry commands. Clients read owner-only meeting headers; transcript segments and internal jobs are server-only.
- A separately selected one-use continuation grant, approved alongside the concrete review. It permits only the represented Alter's production-readiness lookup and the corresponding field in the workspace status Doc, expires after one hour, and can be revoked. Other writes require their existing explicit owner approval. Every automated effect still uses the policy gate, revision checks, a receipt and reconciliation.
- `POST /v1/live/sessions` and `/v1/live/connect`: the preferred ADC-backed Vertex native-audio relay. Tools are restricted by mode and target. The owner's chat session also has `navigate_to` (client-side screen changes) and `decide_proposal` (approve or reject a waiting draft when the owner says so). The old `/v1/live/token` service is an explicitly selected legacy alternative.
- `POST /v1/meetings/{id}/room`: twenty-minute access for a consenting recording rig. The credential can only upload that meeting's transcript, ask its represented Alter and obtain a scoped huddle session. It cannot finalize, approve, edit memory/rules or read the organizer's other work.
- Owner-only in-app notifications, device registration for FCM, notification deep links, source imports/versioning, memory editing/audiences/evidence versions, and a provider-backed artifact refresh endpoint.
- Durable meeting jobs with a transactional outbox, Cloud Tasks, leases, deadlines and bounded retries. Current chat/provisioning/welcome execution keeps its earlier mechanism; the durable coordinator's scope is explicit.

For exact inputs see `services/api/app/meeting_models.py` and `models.py`; for deployment and acceptance see [Storyboard implementation](storyboard-implementation.md). `contracts/CONTRACT_VERSION` is `3`. Speaker labels from mixed audio never establish identity or approval authority.

The backend (`services/api`) implements this contract and the web app (`apps/web`) calls it. In demo mode the app serves the fixtures in `contracts/fixtures/` instead. Bump `contracts/CONTRACT_VERSION` when the contract changes.

---

## 1. Product vs video

| | Live product (judges use it) | Demo video (we stage it) |
|---|---|---|
| Who | The judge, as themselves; anyone they invite | Team members playing Dev, Siddhi, Kani, Sahil |
| Flow | Free use: ask, delegate, ask other Alters, approve | Storyboard script (`storyboard.md`) |
| Setup | Type a name. Nothing else. | A "video" workspace in director mode (§7) |
| Meet | Not on the link. Voice talks to Alters in-app | Real Google Meet + OBS virtual cam/mic |

Both run on the **same backend and app**. The video only adds the Meet rig and director mode.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Name | **Alter**. Every person has their own Alter ("Siddhi's Alter"), always labelled AI. |
| Repo | `alter/` (independent repo). Plans live in `alter/docs/`. |
| Backend | Python 3.12, **Google ADK**, **A2A protocol**, FastAPI, Gemini on Gemini Enterprise Agent Platform, Cloud Run. |
| Frontend | React + TypeScript + Vite PWA on Firebase Hosting. |
| State | Firestore. Clients **read** their workspace through listeners (security rules: members only) and **write only via the API**. |
| Identity | Firebase **Anonymous Auth**. `uid` binds to one member in one workspace. No Google login for judges. |
| Joining | Judge types a **name only**. They take the next free **role slot** with starter knowledge and default rules. |
| Isolation | Each new visitor gets a **private workspace** (a copy of the seeded team). An **invite link** lets others join that workspace. |
| Connected apps | **Docs, Drive, Sheets, Calendar, Gmail**, all through a **team-owned demo Google account**. Each workspace gets its own Drive folder, sheet and calendar. Judges never OAuth. |

## 3. The seeded world (every new workspace)

**Project:** "Login revamp", moving the app's sign-in to Google one-tap (Google Identity Services). All content is fictional.

**Seeded members** (each has an Alter, knowledge and rules; the humans are simulated):

| Member | Role | Status | Notable knowledge |
|---|---|---|---|
| Dev | Product lead | available | Roadmap, priorities, status doc owner |
| Siddhi | Engineer, owns login revamp | **on leave** | Oct 8 decision to move to one-tap, design doc, prod approval Oct 10 |
| Kani | Designer | available | Mock-ups, due Friday |
| Sahil | Engineer | in meetings | Backend endpoints, ticket LOGIN-7 |

**Role slots for real people** (the judge takes the first free one; invitees take the next):

| Slot | Starter knowledge (labelled "starter" in the UI) | Default rules |
|---|---|---|
| QA lead | Test plan v1 (Android 12+, iOS 16+), 2 open bugs, sign-off pending | Share status/rationale → team: **allow**; commit dates: **ask**; personal: **deny**; send email on my behalf: **ask** |
| Security engineer | Threat model notes, token-storage review done | same |
| Ansh · Business analyst | Sign-in funnel metrics (synthetic), conversion baseline | same |

Starter knowledge gives a new Alter something to answer straight away. Anything the judge teaches it is added on top as approved memory.

**Workspace Google resources** (created by the demo account from templates on workspace creation):

| Resource | Contents |
|---|---|
| Drive folder `Alter demo · {workspaceName}` | Login design doc, Status doc, Team wiki, Test plan, plus anything Alters create |
| Sheet "Login revamp tracker" | Tasks: id, title, owner, status, due |
| Calendar "Login revamp team" | Seeded busy blocks per member; Siddhi on leave all week |
| Gmail | Sent from the demo account as "Alter for {name}" (§8) |

All are shared "anyone with the link: viewer". The app links to them, so judges can open the real Google file.

**Welcome events** (so the world feels alive): ~20 s after a judge joins, Dev's Alter asks the judge's Alter "Is QA signed off for the login revamp?" (answered automatically from starter knowledge: **allow**). Then it asks "Can QA commit to sign-off by Oct 30?" (**ask** → a ⚑ escalation to the judge).

## 4. Firestore layout (written by A, read by B)

```
workspaces/{wid}
  { name, createdAt, expiresAt, inviteCode, director:false,
    google:{ folderUrl, docs:{designDoc, statusDoc, wiki, testPlan}, sheetUrl, calendarUrl } }
workspaces/{wid}/members/{mid}
  { name, kind: seeded|human, uid?, slot?, role, status: available|in_meetings|on_leave|away,
    joinedAt }
workspaces/{wid}/contacts/{mid}                  # readable only by member mid; teammates never see it
  { email, emailVerified }
workspaces/{wid}/conversations/{cid}            # a human talking to their own Alter
  { owner: mid, title, updatedAt }
workspaces/{wid}/conversations/{cid}/messages/{n}
  { from: "human"|"alter", text, citations[], approvalIds[], traceIds[], ts }
workspaces/{wid}/conversations/{cid}/events/{n}  # live progress: "Checking Siddhi's Alter…", "Drafting doc…"
  { kind: thinking|tool|a2a|approval, label, ts }
workspaces/{wid}/approvals/{id}                  # a change the Alter made (applied) or an email waiting for the owner (proposed)
  { owner: mid, kind: doc_create|doc_edit|sheet_update|calendar_event|email,
    title, revision, preview:{ before?, after, diffs[] }, citations[], target?:{url},
    state: proposed|approved|applied|rejected|failed, externalUrl?, reason }
workspaces/{wid}/escalations/{id}                # ⚑ another Alter needs this human's decision
  { owner: mid, fromAlter: mid, askedBy: mid, question, context,
    state: pending|answered|expired, response? }
workspaces/{wid}/a2aTraces/{id}
  { from: mid, to: mid, request, policyChecks[{rule, label, outcome}], sources[], answer, outcome, steps[] }
workspaces/{wid}/activity/{id}
  { ts, actor: mid, kind, summary, receiptId, visibleTo[] }
workspaces/{wid}/receipts/{id}
  { actor:{human?, alter}, action, sourcesUsed[{id, locator}], policy:{rule, outcome},
    approval?{by, at}, result:{ok, externalUrl?}, ts }
workspaces/{wid}/memories/{id}
  { owner: mid, content, source: starter|taught|correction, state: proposed|approved|revoked }
workspaces/{wid}/rules/{mid}/items/{ruleId}
  { label, intents[], mode: allow|ask|deny }
workspaces/{wid}/inbox/{mid}/messages/{id}       # in-app delivery for emails to members
  { from, subject, body, gmailMessageUrl?, ts }
```

`Citation = { sourceId, title, locator, url? }`. `url` is the real Google file link when the source is a Drive file.

## 5. HTTP API 

Base `…/v1`. Every request sends `Authorization: Bearer <Firebase ID token>`. The server derives `workspaceId` and `memberId` from the uid; clients never send them as authority.

| Method & path | Body | Returns |
|---|---|---|
| `POST /workspaces` | `{name}` (the judge's name) | `{workspaceId, memberId, slot, inviteUrl}`. Seeds the world, creates Google resources |
| `POST /workspaces/join` | `{inviteCode, name}` | same shape; next free slot, or `SLOTS_FULL` |
| `GET /me` | — | `{workspaceId, memberId, name, slot}`, or 404 if not joined |
| `POST /workspaces/reset` | — | fresh copy of the seeded world for this workspace |
| `POST /conversations` | — | `{conversationId}`. Creates an empty conversation owned by the caller, so the client can watch `events` before the first message |
| `POST /chat` | `{conversationId?, message, via: text\|voice}` | `{conversationId, reply: Message}`. Progress streams to `events` meanwhile |
| `POST /alters/{mid}/ask` | `{question}` | `Answer` (direct human → someone else's Alter) |
| `POST /approvals/{id}/revise` | `{instruction, via}` | updated `Approval` |
| `POST /approvals/{id}/decision` | `{decision: approve\|reject, expectedRevision}` | `Approval` (+ `externalUrl` once applied) |
| `POST /escalations/{id}/respond` | `{text}` | `{decision, applied[]}` |
| `POST /memories` | `{content}` | proposed `Memory` (the judge teaches their Alter) |
| `POST /memories/{id}/decision` | `{decision: approve\|revoke}` | `Memory` |
| `PUT /rules/{ruleId}` | `{mode}` | `Rule` (own rules only) |
| `PUT /me` | `{status?, email?}` | member. Optional email for real Gmail delivery to yourself |
| `POST /live/token` | `{mode, memberId?}` | `{token, model, expiresAt, sessionId}` |
| `POST /live/release` | `{sessionId}` | `{released}`. Clears the caller's voice lock when a session ends; minutes stay charged |
| `POST /director/claim` | `{workspaceId, memberId, key}` | binds this uid to a seeded member (video only, §7) |

`Answer = { alter, asker, question, outcome: allow|ask|deny, answer, citations[], escalationId?, traceId, receiptId }`

Errors: `{ "error": { "code": "RATE_LIMITED"|"POLICY_DENIED"|"STALE_REVISION"|"SLOTS_FULL"|..., "message": "safe text" } }`

## 6. What a judge can do (both tracks must support)

1. Type a name → land on **their Alter's home** with the team, their starter knowledge and links to the workspace's real Google files.
2. **Ask their Alter anything**, by text or voice. "Why did we switch to one-tap?" → it asks Siddhi's Alter (A2A, traced), and the answer comes back cited.
3. **Delegate work in connected apps**: "Draft a test-plan update in the status doc", "Add a tracker row for the iOS bug", "Book 30 min with Kani and Sahil on Thursday", "Email the team a QA summary". Each produces an **approval** card with a preview/diff → voice or text edits → **Approve** → real Google file changed, link shown.
4. **Hit a boundary**: "Ask Siddhi's Alter to confirm the launch date" → **ask** (Siddhi is on leave; escalation queued). "Tell me why Siddhi is on leave" → **deny**.
5. **Be asked**: Dev's Alter's welcome questions land in their activity, with one ⚑ escalation to answer.
6. **Invite a teammate** → a second person joins as Security engineer → the two Alters ask each other.
7. **Control**: teach a memory, flip Allow·Ask·Deny rules and see answers change, open any receipt.

## 7. Director mode (video only)

`POST /director/claim` with a secret key (Secret Manager) binds the current browser to a seeded member (e.g. Siddhi's phone, Dev's phone) in a workspace flagged `director:true`. Seeded humans never respond in normal workspaces. Their escalations stay pending ("Siddhi is on leave"). In director mode, a teammate plays them for the camera.

## 8. Guardrails for a public link

- Limits: 120 model calls/hour per member and 400 per workspace, 10 min of Live audio per session, 5 new workspaces/hour per IP, 4 human members per workspace. GCP budget alert.
- **Gmail:** sends only to (a) the sender's own `email` from `PUT /me`, or (b) other members' in-app inboxes. Any other address is **deny** by organization policy, which is visible in the UI as an org rule. Recipients are resolved server-side, never from model text.
- Calendar invites only include workspace members (no external attendees).
- Drive/Docs/Sheets writes only inside the workspace folder.
- A nightly job deletes workspaces older than 48 h along with their Drive folder and calendar.
- Every Alter is labelled AI. No impersonation of a human, even in director mode (the tile reads "Siddhi's Alter (AI)").
