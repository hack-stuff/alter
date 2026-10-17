"""The user's actual agenda and explicitly configured meeting link."""

from datetime import timedelta, timezone
import re
from app.models import Input
from pydantic import Field
from app.errors import error
from app.schedule import local_zone
from app.util import now


class MeetLink(Input):
    url: str = Field(max_length=200)


def valid_meet_url(url):
    prefix = "https://meet.google.com/"
    return bool(
        isinstance(url, str)
        and len(url) <= len(prefix) + 128
        and re.fullmatch(r"https://meet\.google\.com/[a-z]+-[a-z]+-[a-z]+", url)
    )


def validate_meet_url(url):
    if url and not valid_meet_url(url):
        raise error(
            422,
            "INVALID_MEET_URL",
            "Enter an existing Google Meet link, such as https://meet.google.com/abc-defg-hij.",
        )
    return url


def day(engine, ctx):
    workspace, _, _ = engine.proposals.context(ctx)
    member = engine.me(ctx)
    local = local_zone(engine, ctx)
    start = now().astimezone(local).replace(hour=0, minute=0, second=0, microsecond=0)
    agenda, agenda_error = [], ""
    try:
        agenda = engine.apps.agenda(
            ctx.workspace_id,
            ctx.member_id,
            start.astimezone(timezone.utc).isoformat(),
            (start + timedelta(days=7)).astimezone(timezone.utc).isoformat(),
        )
    except Exception:
        agenda_error = (
            "Your calendar could not load. Your saved work is still available."
        )
    configured = member.get("meetUrl", engine.settings.meet_url)
    meet_url = (
        configured
        if valid_meet_url(configured)
        else next(
            (item["meetUrl"] for item in agenda if valid_meet_url(item.get("meetUrl"))), ""
        )
    )
    return {
        "name": member["name"],
        "role": member["role"],
        "agenda": agenda,
        "agendaError": agenda_error,
        "meetUrl": meet_url,
        "meetingPresence": "unverified",
        "simulated": workspace.get("simulated", False),
        "voiceConfigured": bool(engine.settings.live_model),
        "timeZone": local.key,
    }
