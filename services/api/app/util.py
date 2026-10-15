from datetime import datetime, timezone
from uuid import uuid4
import re

ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def identifier(value: str):
    from app.errors import error

    if not ID.fullmatch(value):
        raise error(422, "INVALID_ID", "Invalid resource identifier.")
    return value


def now():
    return datetime.now(timezone.utc)


def iso():
    return now().isoformat()


def new_id(prefix=""):
    return prefix + uuid4().hex


def path(wid: str, *parts: str):
    return "/".join(["workspaces", identifier(wid), *[identifier(p) for p in parts]])
