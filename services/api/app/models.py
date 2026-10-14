"""Pydantic mirrors of contract §4–5. Keep in sync with apps/web/src/api/types.ts."""

from typing import Literal

from pydantic import BaseModel

Outcome = Literal["allow", "ask", "deny"]


class Citation(BaseModel):
    sourceId: str
    title: str
    locator: str
    url: str | None = None


class Answer(BaseModel):
    alter: str
    asker: str
    question: str
    outcome: Outcome
    answer: str
    citations: list[Citation] = []
    escalationId: str | None = None
    traceId: str
    receiptId: str


class CreateWorkspace(BaseModel):
    name: str


class JoinWorkspace(BaseModel):
    inviteCode: str
    name: str


class ChatRequest(BaseModel):
    conversationId: str | None = None
    message: str
    via: Literal["text", "voice"] = "text"


class AskRequest(BaseModel):
    question: str


class ReviseRequest(BaseModel):
    instruction: str
    via: Literal["text", "voice"] = "text"


class DecisionRequest(BaseModel):
    decision: Literal["approve", "reject"]
    expectedRevision: int


class EscalationReply(BaseModel):
    text: str


class TeachMemory(BaseModel):
    content: str


class MemoryDecision(BaseModel):
    decision: Literal["approve", "revoke"]


class RuleUpdate(BaseModel):
    mode: Outcome


class UpdateMe(BaseModel):
    status: Literal["available", "away"] | None = None
    email: str | None = None


class DirectorClaim(BaseModel):
    workspaceId: str
    memberId: str
    key: str
