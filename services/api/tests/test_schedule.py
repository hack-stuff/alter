"""Seeded calendars stay light, and schedule questions are answered in the caller's time zone."""

from collections import Counter
from dataclasses import replace
from datetime import datetime, timezone
from unittest.mock import MagicMock
import asyncio
import json
from zoneinfo import ZoneInfo
import pytest
from app.auth import Caller
from app.google import calendar
from app.schedule import asks_schedule, window
from app.workspaces.seed import calendar_events, load

SATURDAY = datetime(2026, 10, 17, 6, 30, tzinfo=timezone.utc)
KOLKATA = {"X-Time-Zone": "Asia/Kolkata"}


def test_each_person_has_one_or_two_events_a_day_at_local_hours():
    local = ZoneInfo("Asia/Kolkata")
    events = calendar_events("Asia/Kolkata", SATURDAY)
    per_day = Counter(
        (who, datetime.fromisoformat(e["start"]).astimezone(local).date())
        for e in events
        for who in e["attendees"]
    )
    assert max(per_day.values()) <= 2
    first = SATURDAY.astimezone(local).date()
    people = set(load("team.json")["members"]) | {"slot:qa_lead", "slot:security_engineer", "slot:data_analyst"}
    assert {who for who, day in per_day if day == first} == people
    sync = next(e for e in events if e["title"] == "Login revamp · team sync")
    assert datetime.fromisoformat(sync["start"]).astimezone(local).strftime("%Y-%m-%d %H:%M") == "2026-10-17 14:00"


@pytest.mark.parametrize(
    "phrase, first, days",
    [
        ("What's on today?", "2026-10-17", 1),
        ("my schedule tomorrow", "2026-10-18", 1),
        ("the next day", "2026-10-18", 1),
        ("day after tomorrow", "2026-10-19", 1),
        ("anything on Friday?", "2026-10-23", 1),
        ("Saturday", "2026-10-17", 1),
        ("next Saturday", "2026-10-24", 1),
        ("this week", "2026-10-17", 7),
        ("next week", "2026-10-19", 7),
        ("2026-10-20", "2026-10-20", 1),
    ],
)
def test_schedule_phrases_resolve_to_local_days(phrase, first, days):
    assert window(phrase, "Asia/Kolkata", SATURDAY) == (datetime.fromisoformat(first).date(), days)


@pytest.mark.parametrize(
    "message, reads",
    [
        ("What's my schedule tomorrow?", True),
        ("What meetings do I have today?", True),
        ("Is Kani free on Friday?", True),
        ("What's on my calendar this week", True),
        ("What about tomorrow?", True),
        ("And Friday?", True),
        ("Schedule a meeting with Kani", False),
        ("Can you schedule time with Sahil", False),
        ("Book a QA sync", False),
        ("Set up a meeting with Kani tomorrow", False),
        ("Feel free to update the doc", False),
    ],
)
def test_schedule_questions_are_told_apart_from_bookings(message, reads):
    assert asks_schedule(message) is reads


@pytest.fixture
def kolkata(system):
    client, engine = system
    headers = {"X-Dev-Uid": "asha", **KOLKATA}
    joined = client.post("/v1/workspaces", headers=headers, json={"name": "Asha"}).json()
    engine.workspaces.provision(joined["workspaceId"])
    assert engine.store.get("workspaces/" + joined["workspaceId"])["timeZone"] == "Asia/Kolkata"
    return client, engine, headers, joined


def test_chat_reads_tomorrow_in_local_time_and_books_nothing(kolkata):
    client, engine, headers, joined = kolkata
    reply = client.post("/v1/chat", headers=headers, json={"message": "What's my schedule tomorrow?"})
    assert reply.status_code == 200, reply.text
    body = reply.json()["reply"]
    # Asha joined as QA lead, so the QA lead's seeded events are theirs.
    assert body["text"].startswith("Tomorrow, ")
    assert "you have 2 events: Test plan review at 11:00–11:45 AM, then Launch readiness review at 3:00–4:00 PM." in body["text"]
    assert body["approvalIds"] == []
    assert body["citations"][0]["sourceId"] == "calendar"
    assert engine.store.list(f"workspaces/{joined['workspaceId']}/approvals") == []
    booked = client.post("/v1/chat", headers=headers, json={"message": "Schedule a meeting with Kani"}).json()["reply"]
    assert len(booked["approvalIds"]) == 1


def test_teammate_schedule_shows_busy_times_only(kolkata):
    client, engine, headers, _ = kolkata
    text = client.post("/v1/chat", headers=headers, json={"message": "Is Kani free tomorrow?"}).json()["reply"]["text"]
    assert text.startswith("Tomorrow, ") and text.endswith("Kani is busy 3:00–4:00 PM.")
    assert "Launch readiness" not in text


def test_day_uses_the_callers_zone_and_falls_back_to_the_workspace(kolkata):
    client, engine, headers, _ = kolkata
    value = client.get("/v1/day", headers=headers).json()
    assert value["timeZone"] == "Asia/Kolkata"
    first = datetime.fromisoformat(value["agenda"][0]["start"]).astimezone(ZoneInfo("Asia/Kolkata"))
    assert (value["agenda"][0]["title"], first.strftime("%H:%M")) == ("QA triage · iOS sign-in crash", "11:30")
    assert client.get("/v1/day", headers={"X-Dev-Uid": "asha"}).json()["timeZone"] == "Asia/Kolkata"
    assert client.get("/v1/day", headers={"X-Dev-Uid": "asha", "X-Time-Zone": "Europe/London"}).json()["timeZone"] == "Europe/London"


def test_agent_schedule_tool_quotes_own_events_and_hides_teammate_titles(kolkata):
    from app.alters.factory import build_alter

    client, engine, headers, joined = kolkata
    ctx = replace(engine.auth.member(Caller("asha")), time_zone="Asia/Kolkata")
    me = engine.store.get(f"workspaces/{ctx.workspace_id}/members/{ctx.member_id}") | {"id": ctx.member_id}
    agent, observed, *_ = build_alter(engine, ctx, me)
    tool = next(t for t in agent.tools if getattr(t, "__name__", "") == "get_schedule")
    own = asyncio.run(tool(day="tomorrow"))
    assert own["timeZone"] == "Asia/Kolkata"
    assert "Launch readiness review at 3:00–4:00 PM" in own["sentences"][0]
    assert observed[-1]["text"] == own["sentences"][0]
    assert (own["sourceId"], own["locator"]) == (observed[-1]["sourceId"], observed[-1]["locator"])
    kani = asyncio.run(tool(day="tomorrow", teammate="Kani"))
    assert kani["sentences"][0].endswith("Kani is busy 3:00–4:00 PM.")
    assert asyncio.run(tool(teammate="someone-else")) == {"error": "Choose a workspace member ID or name."}


def test_google_calendar_seeds_local_hours_and_role_slots():
    service = MagicMock()
    service.calendarList().list().execute.return_value = {"items": [{"id": "cal", "description": "Alter workspace w1"}]}
    service.acl().list().execute.return_value = {"items": [{"scope": {"type": "default"}, "role": "reader"}]}
    error = RuntimeError("missing")
    error.resp = MagicMock(status=404)
    service.events().get().execute.side_effect = error
    calendar.provision(service, "w1", "Asia/Kolkata")
    bodies = [call.kwargs["body"] for call in service.events().insert.call_args_list if "body" in call.kwargs]
    assert len(bodies) == len(calendar_events("Asia/Kolkata"))
    triage = next(b for b in bodies if b["summary"] == "QA triage · iOS sign-in crash")
    assert json.loads(triage["extendedProperties"]["private"]["memberIds"]) == ["slot:qa_lead"]
    start = datetime.fromisoformat(triage["start"]["dateTime"]).astimezone(ZoneInfo("Asia/Kolkata"))
    assert start.strftime("%H:%M") == "11:30"


def test_gemini_quote_with_a_mislabelled_locator_is_cited_from_its_real_source(kolkata, monkeypatch):
    from types import SimpleNamespace
    from google.adk import runners
    from google.genai import types
    from app.alters.brain import VertexBrain

    client, engine, headers, joined = kolkata
    ctx = replace(engine.auth.member(Caller("asha")), time_zone="Asia/Kolkata")

    class FakeRunner:
        def __init__(self, agent, **kwargs):
            self.agent = agent

        async def run_async(self, **kwargs):
            tool = next(t for t in self.agent.tools if t.__name__ == "get_schedule")
            sentence = (await tool(day="tomorrow"))["sentences"][0]
            claims = [
                # Seen from Gemini: the sentence repeated as the locator.
                {"sourceId": "calendar", "locator": sentence, "quote": sentence},
                {"sourceId": "calendar", "locator": sentence, "quote": "Tomorrow you are free all day."},
            ]
            yield SimpleNamespace(
                is_final_response=lambda: True,
                content=types.Content(parts=[types.Part(text=json.dumps({"claims": claims}))]),
            )

    monkeypatch.setattr(runners, "Runner", FakeRunner)
    member = engine.store.get(f"workspaces/{ctx.workspace_id}/members/{ctx.member_id}") | {"id": ctx.member_id}
    result = asyncio.run(VertexBrain(engine).run(ctx, member, "What's my schedule tomorrow?"))
    assert result["text"].startswith("Tomorrow, ") and "free all day" not in result["text"]
    assert result["citations"][0]["locator"].endswith("· Asia/Kolkata")
