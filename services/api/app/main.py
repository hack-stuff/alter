"""HTTP API from contract §5.

Every route currently returns contract fixtures (DEV_MODE) so Track B can point at a real
server early. Replace each stub with the real implementation from track-a §2–7.
"""

import json
from functools import cache

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.models import (
    Answer,
    AskRequest,
    ChatRequest,
    CreateWorkspace,
    DecisionRequest,
    DirectorClaim,
    EscalationReply,
    JoinWorkspace,
    MemoryDecision,
    ReviseRequest,
    RuleUpdate,
    TeachMemory,
    UpdateMe,
)

app = FastAPI(title="Alter API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if config.DEV_MODE else [],
    allow_methods=["*"],
    allow_headers=["*"],
)


def error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"error": {"code": code, "message": message}})


@cache
def fixture(name: str) -> dict:
    return json.loads((config.FIXTURES_DIR / f"{name}.json").read_text())


def caller_uid(
    authorization: str | None = Header(default=None),
    x_dev_uid: str | None = Header(default=None),
) -> str:
    if config.DEV_MODE and x_dev_uid:
        return x_dev_uid
    # TODO(track-a §1 auth.py): verify the Firebase ID token, then resolve uid → (workspace, member).
    raise error(401, "UNAUTHENTICATED", "Sign-in required.")


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/v1/workspaces")
def create_workspace(req: CreateWorkspace, uid: str = Depends(caller_uid)) -> dict:
    # TODO: seed Firestore + provision Google resources (track-a §6).
    return fixture("workspace")["created"]


@app.post("/v1/workspaces/join")
def join_workspace(req: JoinWorkspace, uid: str = Depends(caller_uid)) -> dict:
    return {**fixture("workspace")["created"], "memberId": "m_invited", "slot": "security_engineer"}


@app.get("/v1/me")
def me(uid: str = Depends(caller_uid)) -> dict:
    created = fixture("workspace")["created"]
    return {"workspaceId": created["workspaceId"], "memberId": created["memberId"], "name": "You", "slot": created["slot"]}


@app.put("/v1/me")
def update_me(req: UpdateMe, uid: str = Depends(caller_uid)) -> dict:
    return {**me(uid), **req.model_dump(exclude_none=True)}


@app.post("/v1/workspaces/reset")
def reset_workspace(uid: str = Depends(caller_uid)) -> dict:
    return fixture("workspace")["created"]


@app.post("/v1/chat")
def chat(req: ChatRequest, uid: str = Depends(caller_uid)) -> dict:
    # TODO: run the caller's ADK Alter with tools; stream events to Firestore (track-a §2).
    return fixture("approvals")["chat_reply"]


def _fixture_answer_key(question: str) -> str:
    q = question.lower()
    if "launch" in q or "confirm" in q:
        return "launch_date"
    if "leave" in q:
        return "personal"
    return "why_one_tap"


@app.post("/v1/alters/{member_id}/ask", response_model=Answer)
def ask(member_id: str, req: AskRequest, uid: str = Depends(caller_uid)) -> dict:
    # TODO: classify intent → policy gate → target Alter with read-only tools (track-a §2–3).
    return {**fixture("answers")[_fixture_answer_key(req.question)], "alter": member_id, "question": req.question}


def _approval(approval_id: str) -> dict:
    for a in fixture("approvals")["approvals"]:
        if a["id"] == approval_id:
            return a
    raise error(404, "NOT_FOUND", "No such approval.")


@app.post("/v1/approvals/{approval_id}/revise")
def revise(approval_id: str, req: ReviseRequest, uid: str = Depends(caller_uid)) -> dict:
    a = _approval(approval_id)
    line = req.instruction  # TODO: Gemini edit of the structured preview (track-a approvals/revise.py)
    preview = {**a["preview"], "diffs": [{"op": "add", "section": "Notes", "line": line}],
               "after": a["preview"]["after"] + [{"section": "Notes", "lines": [line]}]}
    return {**a, "revision": a["revision"] + 1, "preview": preview}


@app.post("/v1/approvals/{approval_id}/decision")
def decide(approval_id: str, req: DecisionRequest, uid: str = Depends(caller_uid)) -> dict:
    a = _approval(approval_id)
    if req.expectedRevision != a["revision"]:
        raise error(409, "STALE_REVISION", "This proposal changed. Review the latest version.")
    # TODO: apply via the Google adapters (track-a §6).
    return {**a, "state": "applied" if req.decision == "approve" else "rejected"}


@app.post("/v1/escalations/{escalation_id}/respond")
def respond(escalation_id: str, req: EscalationReply, uid: str = Depends(caller_uid)) -> dict:
    return {"decision": {"type": "free_text", "text": req.text}, "applied": []}


@app.post("/v1/memories")
def teach(req: TeachMemory, uid: str = Depends(caller_uid)) -> dict:
    return {"id": "mem_new", "content": req.content, "source": "taught", "state": "proposed"}


@app.post("/v1/memories/{memory_id}/decision")
def memory_decision(memory_id: str, req: MemoryDecision, uid: str = Depends(caller_uid)) -> dict:
    return {"id": memory_id, "state": "approved" if req.decision == "approve" else "revoked"}


@app.put("/v1/rules/{rule_id}")
def update_rule(rule_id: str, req: RuleUpdate, uid: str = Depends(caller_uid)) -> dict:
    return {"id": rule_id, "mode": req.mode}


@app.post("/v1/director/claim")
def director_claim(req: DirectorClaim, uid: str = Depends(caller_uid)) -> dict:
    # TODO(contract §7): check key from Secret Manager and workspace.director == true.
    raise error(403, "FORBIDDEN", "Director mode is not enabled.")
