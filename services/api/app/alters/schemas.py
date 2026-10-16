"""Explicit Gemini schemas; no unconstrained dictionaries in model inputs/outputs."""

from pydantic import BaseModel


class DocumentSection(BaseModel):
    section: str
    lines: list[str]


class DocumentContent(BaseModel):
    sections: list[DocumentSection]


class DocumentRevision(BaseModel):
    title: str | None = None
    sections: list[DocumentSection]


class SheetRevision(BaseModel):
    rows: list[list[str]]
    startRow: int | None = None


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
    "doc_create": DocumentRevision,
    # A doc_edit title only labels the card; it never renames the document.
    "doc_edit": DocumentContent,
    "sheet_update": SheetRevision,
    "calendar_event": EventContent,
    "email": EmailContent,
}
