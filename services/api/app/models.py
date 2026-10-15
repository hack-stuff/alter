"""Validated inputs and contract response shapes."""

from typing import Literal, Annotated
from pydantic import BaseModel, Field, ConfigDict

Outcome = Literal["allow", "ask", "deny"]
Text = Annotated[str, Field(min_length=1, max_length=10000)]
Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


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
    citations: list[Citation] = Field(default_factory=list)
    escalationId: str | None = None
    traceId: str
    receiptId: str


class CreateWorkspace(Input):
    name: Annotated[str, Field(min_length=1, max_length=80)]


class JoinWorkspace(CreateWorkspace):
    inviteCode: Identifier


class ChatRequest(Input):
    conversationId: Identifier | None = None
    message: Text
    via: Literal["text", "voice"] = "text"


class AskRequest(Input):
    question: Text


class ReviseRequest(Input):
    instruction: Text
    via: Literal["text", "voice"] = "text"


class DecisionRequest(Input):
    decision: Literal["approve", "reject"]
    expectedRevision: Annotated[int, Field(ge=1)]


class EscalationReply(Input):
    text: Text


class TeachMemory(Input):
    content: Text


class MemoryDecision(Input):
    decision: Literal["approve", "revoke"]


class RuleUpdate(Input):
    mode: Outcome


class UpdateMe(Input):
    status: Literal["available", "away"] | None = None
    email: Annotated[str, Field(max_length=254)] | None = None


class DirectorClaim(Input):
    workspaceId: Identifier
    memberId: Identifier
    key: Annotated[str, Field(min_length=1, max_length=4096)]


class VideoWorkspace(CreateWorkspace):
    pass
