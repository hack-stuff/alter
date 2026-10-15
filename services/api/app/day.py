"""The user's actual agenda and explicitly configured meeting link."""

from datetime import timedelta
import re
from app.models import Input
from pydantic import Field
from app.errors import error
from app.util import now


class MeetLink(Input):
    url: str = Field(max_length=200)


def validate_meet_url(url):
    if url and not re.fullmatch(
        r"https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}", url
    ):
        raise error(
            422,
            "INVALID_MEET_URL",
            "Enter an existing Google Meet link, such as https://meet.google.com/abc-defg-hij.",
        )
    return url


def day(engine, ctx):
    workspace, _, _ = engine.proposals.context(ctx)
    member = engine.me(ctx)
    start = now().replace(hour=0, minute=0, second=0, microsecond=0)
    agenda, agenda_error = [], ""
    try:
        agenda = engine.apps.agenda(
            ctx.workspace_id,
            ctx.member_id,
            start.isoformat(),
            (start + timedelta(days=2)).isoformat(),
        )
    except Exception:
        agenda_error = (
            "Your calendar could not load. Your saved work is still available."
        )
    configured = member.get("meetUrl", engine.settings.meet_url)
    valid = lambda url: bool(
        re.fullmatch(r"https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}", url or "")
    )
    meet_url = (
        configured
        if valid(configured)
        else next(
            (item["meetUrl"] for item in agenda if valid(item.get("meetUrl"))), ""
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
        "timeZone": "UTC",
    }
