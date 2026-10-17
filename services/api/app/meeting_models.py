"""Meeting input and extraction schemas; transcripts are evidence, never authority."""

from typing import Annotated, Literal
from pydantic import BaseModel, Field
from app.models import Input, Identifier, Text


class MeetingCreate(Input):
    title: Annotated[str, Field(min_length=1, max_length=160)]
    participants: Annotated[list[Identifier], Field(min_length=1, max_length=8)]
    representedMember: Identifier = "siddhi"
    consent: Literal[True]


class Segment(Input):
    id: Identifier
    text: Annotated[str, Field(min_length=1, max_length=4000)]
    speaker: Annotated[str, Field(max_length=80)] = "Meeting audio"
    kind: Literal["human", "alter"] = "human"


class SegmentBatch(Input):
    segments: Annotated[list[Segment], Field(min_length=1, max_length=10)]


class EvidenceFact(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    segmentId: str
    quote: str = Field(min_length=1, max_length=2000)


class MeetingTask(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    owner: str
    due: str = Field(default="Unconfirmed", max_length=100)
    segmentId: str
    quote: str = Field(min_length=1, max_length=2000)


class MeetingExtraction(BaseModel):
    decisions: list[EvidenceFact] = Field(default_factory=list, max_length=12)
    tasks: list[MeetingTask] = Field(default_factory=list, max_length=12)
    needsLaunchDecision: bool = False


class BundleApproval(Input):
    expectedRevision: int = Field(ge=1)
    approvals: dict[Identifier, int]
    allowContinuation: bool = False


class BundleRevision(Input):
    expectedRevision: int = Field(ge=1)
    instruction: Text


class GrantDecision(Input):
    decision: Literal["revoke"]


class DeviceRegistration(Input):
    token: Annotated[str, Field(min_length=20, max_length=4096)]


class MeetingAsk(Input):
    question: Text


class WorkCommand(Input):
    command: Literal["retry", "cancel", "pause", "resume"]


class LiveStart(Input):
    mode: Literal["chat", "revise", "reply", "huddle", "review", "diagram"]
    targetId: Identifier | None = None
    conversationId: Identifier | None = None
    meetingId: Identifier | None = None
