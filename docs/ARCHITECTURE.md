# Alter — Architecture

**Team Cold Silicon** · Google AI Builder Cup 2026 · **Theme 5: Future of Work & Enterprise Productivity**

> **Extend what you can get done—and how your team can work with you.**
>
> An Alter that works in the open, and answers your colleagues and their Alters with the knowledge and limits you've approved.

This document is the source of truth for the hackathon build. It is written so a teammate or an LLM coding agent can implement it end to end. Decisions are explicit. Assumptions are marked.

---

## 1. Positioning (why this, not a general work agent)

On Oct 8, 2026 Google announced **Gemini agent**: org-wide context, four memory types, work across apps, team-member agents and enterprise governance. Microsoft (Agent 365, Copilot Cowork) and Glean have similar pieces. **Memory, app automation and role agents alone are no longer differentiators.** See `sources.md`.

What we build is the **per-employee layer** on Google's agent stack:

| Core idea | What it means | Why it's different |
|---|---|---|
| **Decision ledger** | Each employee's decisions as first-class records: what, who, when, why, source, still valid? | Agent memory belongs to the agent. The ledger is the *person's* decisions, with provenance |
| **Delegation contract** | Each employee sets what their Alter may share, with whom, and what it may never commit to | Authority is bounded per person, not just per org policy |
| **Alter to Alter** | Alters ask each other (A2A) before interrupting humans, and every request is checked against both contracts | Agents represent individual people to each other |
| **Away mode** | When the owner is unavailable, the Alter answers within its contract, queues the rest, and gives a catch-up on return | Work doesn't wait for availability (meetings, time zones, leave) |

Pitch line for Google judges: **"We built the per-employee layer on Google's agent stack"**, not "Google doesn't do this".

### Scope

| In the hackathon build | Later (vision only) |
|---|---|
| Decision ledger from meeting transcripts + docs | Broad role coverage |
| Delegation contracts + A2A between 3 Alters | General computer use / cloud desktop |
| Away mode + "while you were out" catch-up | Employee departure / handover workflows |
| One real workflow: update a Google Doc via the Docs API | Cross-company Alters |
| Mobile review by voice with the doc on screen (Gemini Live API) | Enterprise SSO, Workspace-wide connectors |

---

## 2. System architecture

```
┌──────────────────────── Mobile PWA (Firebase Hosting + Auth) ────────────────────────┐
│ Ask · Needs you · Live review (voice + doc on screen) · While you were out · Contract │
└──────────┬───────────────────────────┬─────────────────────────────┬─────────────────┘
           │ HTTPS                     │ Firestore realtime + FCM    │ WebSocket
           ▼                           ▼                             ▼
┌──────── Cloud Run: Alter service (one ADK agent per employee) ────────┐   ┌── Cloud Run: live-bridge ──────┐
│ Gemini on Gemini Enterprise Agent Platform                                  │   │ Gemini Live API session        │
│ tools:                                                                      │   │ in: user mic (16 kHz PCM),     │
│  ledger_search(q)         → Firestore decisions + Vertex AI Search          │   │     doc snapshot frames @1 FPS │
│  ask_alter(to, q)         → A2A client  ───────────────┐                    │◄──┤ out: voice                     │
│  request_approval(item)   → Firestore approvals + FCM  │                    │   │ tools: get_pending(), explain()│
│  update_doc(doc, patch)   → Google Docs API (after approval)                │   │        approve(), reject()     │
│  set_status / get_status  → Firestore presence         │                    │   └────────────────────────────────┘
│ memory: Memory Bank (preferences)                      │                    │
│ A2A server: /a2a/{employee}  ◄─────────────────────────┘                    │
│   every inbound request → contract_check(asker, owner, intent) → allow / redact / escalate
└─────────────┬───────────────────────────────────────────────────────────────┘
              ▼
┌── Data ─────────────────────────────────────────────────────────────────────┐
│ Firestore: users, contracts, decisions, a2a_requests, approvals, audit_log  │
│ Vertex AI Search: meeting transcripts + project docs (metadata: owner, acl) │
│ Cloud Storage: raw transcripts, doc snapshots                               │
│ BigQuery (optional): audit export → metrics for the deck                    │
└─────────────────────────────────────────────────────────────────────────────┘

Ingestion job (Cloud Run job): transcript/doc → Gemini (structured output) → decisions[] → Firestore + Search index
```

### Google Cloud services

| Need | Service | Notes |
|---|---|---|
| Reasoning | **Gemini on Gemini Enterprise Agent Platform** | Pin current model IDs from release notes (names change often). Pro-class model for the Alter, Flash for extraction |
| Agents | **Agent Development Kit (ADK)** | One agent definition, instantiated per employee with that employee's ledger, contract and identity |
| Agent-to-agent | **A2A protocol** (ADK supports exposing/consuming A2A agents) | Each Alter exposes an A2A endpoint with an agent card |
| Agent identity / registry | **Agent Identity, Agent Registry** on Gemini Enterprise Agent Platform, *if available to hackathon accounts* | Fallback: a service account per Alter + a signed `asker` field in A2A metadata |
| Memory | **Memory Bank** | Preferences and conversational memory. The **decision ledger is our own Firestore collection** (needs provenance + validity fields) |
| Knowledge retrieval | **Vertex AI Search** | Transcripts + docs, filtered by `owner` and `acl_groups` |
| Real workflow | **Google Docs API** (Workspace test domain or a personal Google account) | OAuth via a service account with domain-wide delegation, or user OAuth for the demo doc |
| Voice review | **Gemini Live API** | Mic in, voice out. Doc diff rendered to an image and sent as frames |
| App + push | **Firebase** Hosting, Auth, Firestore, Cloud Messaging | Installable PWA |
| Hosting | **Cloud Run** | Alter service, live-bridge, ingestion job |
| Audit + metrics | **Firestore → BigQuery** | Every A2A exchange, contract decision, approval and doc change |

---

## 3. Key designs

### 3.1 Decision ledger
Extraction prompt (Gemini, structured output) over each meeting transcript/doc:
```json
{"decisions": [{
  "title": "Use Approach B for payment migration",
  "decided_by": ["rahul"], "date": "2026-10-08",
  "rationale": "Approach A adds operational complexity",
  "depends_on": ["vendor API v2 GA"],
  "source": {"type": "meeting", "id": "arch-sync-2026-10-08", "quote": "...", "uri": "gs://..."},
  "status": "active", "confidence": "high"
}]}
```
- Store in `decisions/{id}` with `owner_uid` and `topic_tags[]`. Also index in Vertex AI Search.
- **Staleness:** if a later source contradicts a decision, mark it `superseded_by`. Answers must say so.
- **Answer rule:** every claim cites a decision or doc. Unsupported claims are dropped.

### 3.2 Delegation contract
`contracts/{uid}` (editable in the app, shown as YAML on the slide):
```yaml
owner: rahul
may_share: [status, decisions, design_docs]
share_with: [team:payments, team:product]
never: [commit_dates, approve_spend, share_personal_notes]
otherwise: escalate        # default for anything not listed
away_mode: answer_within_contract
```
`contract_check(asker, owner, intent, payload)` → `allow | redact | escalate | deny`:
1. Classify the request intent with Gemini into a fixed enum: `ask_status | ask_decision | request_commitment | request_doc | other`.
2. Is the asker in `share_with`? If not, `deny`.
3. Is the intent in `never`? Then `escalate` (queue an approval for the owner).
4. Is the payload type in `may_share`? Then `allow` (redact fields outside it). Otherwise `escalate`.
5. Check the **asker's** contract too: the asker's Alter may only *commit on its owner's behalf* if its own contract allows it.
6. Log the decision to `audit_log`.

**Rule-based enforcement in code. The LLM only classifies intent.** This keeps the trust story honest.

### 3.3 Alter to Alter (A2A)
- Each Alter publishes an agent card at `/a2a/{employee}/.well-known/agent.json`, with the skills `answer_question` and `request_commitment`.
- Message metadata: `asker_uid`, `asker_alter`, `intent`, `on_behalf_of`, `trace_id`.
- The response includes `{answer, citations[], contract_outcome, pending_approval_id?}`.
- Timeout 15 s. On timeout or `escalate`, the asker's Alter tells its human what's pending.

### 3.4 Away mode + catch-up
- `presence/{uid}`: `available | in_meeting | away (until)`. In the demo it's set manually in the app. Later it comes from Calendar.
- While away, inbound A2A requests are handled within the contract. Escalations go into `approvals` with `notify_on_return: true`.
- On return: "While you were out" digest = answered requests (with what was shared) + pending approvals.

### 3.5 Real workflow: Google Doc update
- Target: a "Payments status" Google Doc created before the demo.
- `update_doc` prepares a `batchUpdate` (insert text + named range for "Decisions" and "Dates").
- **Never applied without approval.** The approval card shows a rendered before/after diff.

### 3.6 Live voice review
- live-bridge opens a Gemini Live session whose system prompt holds the pending approval, the diff and the citations.
- Video input is the diff rendered as an image (768×768), resent when it changes.
- Tools: `get_pending()`, `explain(claim_id)`, `approve(id)`, `reject(id, reason)`.

---

## 4. Data model (Firestore)

```
users/{uid}               name, role, team, timezone
presence/{uid}            state, until
contracts/{uid}           may_share[], share_with[], never[], otherwise, away_mode
decisions/{id}            owner_uid, title, decided_by[], date, rationale, depends_on[], source{}, status, superseded_by
a2a_requests/{id}         from_uid, to_uid, intent, question, outcome(allow|redact|escalate|deny), answer, citations[], ts
approvals/{id}            owner_uid, type(commitment|doc_update), summary, diff, citations[], status, notify_on_return, decided_at
audit_log/{id}            actor(Alter|human), uid, action, contract_outcome, trace_id, ts
```

---

## 5. Numbers to capture for the deck

| Metric | Target (deck shows until measured) | How |
|---|---|---|
| Alter-to-Alter answer time (p50) | < 15 s | timestamps in `a2a_requests` |
| Answers with ≥1 cited source | 100% | check `citations[]` over 20 test questions |
| Out-of-contract requests escalated | 100% | 15 adversarial test requests ("just commit to the date") |
| Status update: manual vs Alter | measure | stopwatch: teammate gathering info + editing vs agent |

---

## 6. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Agent Identity / Registry not available to hackathon accounts | Service account per Alter + signed metadata |
| Docs API auth friction | Personal Google account + user OAuth for the single demo doc |
| Live API latency or audio problems | Text review on the same screen. Recorded clip in the video |
| Intent classifier lets a commitment through | Rule engine defaults to `escalate`. Add the adversarial tests above |
| Product and model names change (Vertex AI → Gemini Enterprise Agent Platform) | Keep model IDs and endpoints in config |

## 7. Responsible AI
- Alters have their own identity and never pose as the human. Messages say "Rahul's Alter".
- Meeting ingestion is opt-in. Personal notes are never shared by default.
- Escalation is the default for anything the contract doesn't cover.
- Every A2A exchange, contract decision, approval and doc change is logged.
- All demo data is fictional.
