"""Explicit Gemini schemas; no unconstrained dictionaries in model inputs/outputs."""

from pydantic import BaseModel


class DocumentSection(BaseModel):
    section: str
    lines: list[str]


class DocumentContent(BaseModel):
    sections: list[DocumentSection]


class SheetContent(BaseModel):
    rows: list[list[str]]


class EventContent(BaseModel):
    title: str
    attendees: list[str]
    start: str
    duration: int


class EmailContent(BaseModel):
    to_members: list[str]
    subject: str
    body: str


REVISION_SCHEMAS = {
    "doc_create": DocumentContent,
    "doc_edit": DocumentContent,
    "sheet_update": SheetContent,
    "calendar_event": EventContent,
    "email": EmailContent,
}
