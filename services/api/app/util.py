from datetime import datetime, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import re

ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def identifier(value: str):
    from app.errors import error

    if not ID.fullmatch(value):
        raise error(422, "INVALID_ID", "Invalid resource identifier.")
    return value


def now():
    return datetime.now(timezone.utc)


def zone(name):
    """The caller's IANA time zone, or UTC when it is missing or unknown."""
    try:
        return ZoneInfo(name) if isinstance(name, str) and 0 < len(name) <= 64 else ZoneInfo("UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def iso():
    return now().isoformat()


def new_id(prefix=""):
    return prefix + uuid4().hex


def path(wid: str, *parts: str):
    return "/".join(["workspaces", identifier(wid), *[identifier(p) for p in parts]])
