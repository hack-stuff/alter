"""Plain-language calendar answers in the caller's time zone, for chat and voice."""

from datetime import date, datetime, time, timedelta, timezone
import re
from app.util import now, zone

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
SHORT = {"mon": 0, "tue": 1, "tues": 1, "wed": 2, "thu": 3, "thur": 3, "thurs": 3, "fri": 4, "sat": 5, "sun": 6}
DAY = re.compile(r"\b(" + "|".join(WEEKDAYS + tuple(SHORT)) + r")\b", re.I)
WHEN = re.compile(
    r"\b(today|tonight|tomorrow|tmrw|tmr|next day|this week|next week|week|upcoming|\d{4}-\d{2}-\d{2})\b|" + DAY.pattern,
    re.I,
)
# Booking verbs win over reading: "schedule a meeting with Kani" proposes an event.
BOOKING = re.compile(
    r"\b(book|arrange|set ?up|create|invite|move|cancel|reschedule)\b"
    r"|\b(please|can you|could you|would you|let's|lets|to|and|then)\s+schedule\b"
    r"|\bschedule\s+(a|an|the|time|me|some|it|this|that|us|them|with|one|another)\b",
    re.I,
)
STRONG = re.compile(r"\b(schedule|calendar|agenda|diary|on my plate|my day|my week)\b", re.I)
SOFT = re.compile(r"\b(meetings?|events?|plans|appointments?|calls?|free|busy|available|availability|booked)\b", re.I)
FOLLOW_UP = re.compile(r"^\s*(and|what about|how about)\b", re.I)
ASK = re.compile(r"^\s*(what|what's|whats|when|which|do|does|am|is|are|any|how|show|list|tell|read|give|check)\b|\?\s*$|\bmy\b", re.I)


def asks_schedule(message):
    """True for questions about what is on a calendar, never for requests to book something."""
    if BOOKING.search(message):
        return False
    return bool(
        STRONG.search(message)
        or (SOFT.search(message) and (ASK.search(message) or WHEN.search(message)))
        # "What about tomorrow?" after a schedule answer.
        or (FOLLOW_UP.search(message) and WHEN.search(message) and len(message.split()) <= 6)
    )


def local_zone(engine, ctx):
    """The caller's zone, or the workspace's when the request did not say."""
    workspace = engine.store.get(f"workspaces/{ctx.workspace_id}") or {}
    return zone(ctx.time_zone or workspace.get("timeZone"))


def today_line(engine, ctx):
    """Models do not know the date; this anchors "tomorrow" and weekday names."""
    local = local_zone(engine, ctx)
    current = now().astimezone(local)
    return f"Today is {WEEKDAYS[current.weekday()].title()} {current.day} {current.strftime('%B %Y')}, {clock(current)} in {local.key}."


def window(phrase, time_zone="UTC", today=None):
    """The first local date and number of days a phrase such as tomorrow, friday or this week covers."""
    first = (today or now()).astimezone(zone(time_zone)).date()
    text = (phrase or "").lower()
    if match := re.search(r"\b\d{4}-\d{2}-\d{2}\b", text):
        try:
            return date.fromisoformat(match.group()), 1
        except ValueError:
            pass
    if "day after tomorrow" in text:
        return first + timedelta(days=2), 1
    if re.search(r"\b(tomorrow|tmrw|tmr|next day)\b", text):
        return first + timedelta(days=1), 1
    if "next week" in text:
        return first + timedelta(days=7 - first.weekday()), 7
    if re.search(r"\b(week|upcoming|next few days|coming days)\b", text):
        return first, 7
    if match := DAY.search(text):
        name = match.group(1).lower()
        target = WEEKDAYS.index(name) if name in WEEKDAYS else SHORT[name]
        ahead = (target - first.weekday()) % 7
        if ahead == 0 and re.search(r"\bnext\s+" + name, text):
            ahead = 7
        return first + timedelta(days=ahead), 1
    return first, 1


def clock(moment):
    return f"{moment.hour % 12 or 12}:{moment.minute:02d} {'AM' if moment.hour < 12 else 'PM'}"


def span(start, end):
    """10:00–10:30 AM, or 11:30 AM–12:30 PM when the half of the day changes."""
    first, last = clock(start), clock(end)
    if first[-2:] == last[-2:] and start.date() == end.date():
        return first[:-3] + "–" + last
    return first + "–" + last


def label(day, today):
    name = f"{WEEKDAYS[day.weekday()].title()} {day.day} {day.strftime('%B')}"
    offset = (day - today).days
    return {0: "Today, ", 1: "Tomorrow, "}.get(offset, "") + name


def local_time(value, local):
    moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    # All-day events come back as dates; they belong to the local day.
    return moment.replace(tzinfo=local) if moment.tzinfo is None else moment.astimezone(local)


def schedule(engine, ctx, phrase="today", member_id=None, details=True):
    """Sentences describing a calendar, plus the source they are quoted from.

    With details, the member's own events are listed with titles. Otherwise only busy times
    are shared, which is all a teammate's calendar reveals.
    """
    member_id = member_id or ctx.member_id
    local = local_zone(engine, ctx)
    today = now().astimezone(local).date()
    first, count = window(phrase, local.key)
    start = datetime.combine(first, time(0), local)
    begin = start.astimezone(timezone.utc).isoformat()
    finish = (start + timedelta(days=count)).astimezone(timezone.utc).isoformat()
    if details:
        items = engine.apps.agenda(ctx.workspace_id, member_id, begin, finish)
    else:
        items = engine.apps.availability(ctx.workspace_id, [member_id], begin, finish)["busy"]
    days = {first + timedelta(days=offset): [] for offset in range(count)}
    for item in items:
        opens, closes = local_time(item["start"], local), local_time(item["end"], local)
        # An event that began before the window (a long leave block) counts on the first day.
        day = max(opens.date(), first)
        if day in days:
            days[day].append((opens, closes, item.get("title", "")))
    owner = (engine.store.get(f"workspaces/{ctx.workspace_id}/members/{member_id}") or {}).get("name", "They")
    own = member_id == ctx.member_id
    sentences = []
    for day, entries in days.items():
        entries.sort()
        heading = label(day, today)
        if details:
            if not entries:
                sentences.append(f"{heading}, {'your' if own else owner + "'s"} calendar is clear.")
                continue
            listed = [f"{title} at {span(opens, closes)}" for opens, closes, title in entries]
            count_text = f"{len(entries)} event{'s' if len(entries) != 1 else ''}"
            sentences.append(
                f"{heading}, {'you have' if own else owner + ' has'} {count_text}: " + ", then ".join(listed) + "."
            )
        elif entries:
            times = [span(opens, closes) for opens, closes, _ in entries]
            joined = times[0] if len(times) == 1 else ", ".join(times[:-1]) + " and " + times[-1]
            sentences.append(f"{heading}, {owner} is busy {joined}.")
        else:
            sentences.append(f"{heading}, {owner} has nothing booked.")
    locator = first.isoformat() if count == 1 else f"{first.isoformat()} – {(first + timedelta(days=count - 1)).isoformat()}"
    text = " ".join(sentences)
    return {
        "sentences": sentences,
        "timeZone": local.key,
        "source": {
            "sourceId": "calendar",
            "title": "Your calendar" if own else f"{owner}'s availability",
            "locator": locator + " · " + local.key,
            "text": text,
        },
    }
