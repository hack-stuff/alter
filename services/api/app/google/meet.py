"""Create a fresh Google Meet room that does not require host admission."""

import json
import os
from urllib.parse import urlparse

from google.auth.transport.requests import AuthorizedSession
from google.oauth2.credentials import Credentials
import requests

from app.day import validate_meet_url
from app.errors import error


MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.created"
SPACES_URL = "https://meet.googleapis.com/v2/spaces"


def create_open_space(settings, secrets):
    values = json.loads(secrets.read(settings.google_oauth_secret))
    refresh_token = values.get("meet_refresh_token")
    if not refresh_token:
        raise error(
            503,
            "MEET_SETUP_REQUIRED",
            "The connected Google account needs Meet room access before Alter can open a no-wait call.",
        )
    credentials = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=values["client_id"],
        client_secret=values["client_secret"],
        scopes=[MEET_SCOPE],
    )
    try:
        response = AuthorizedSession(credentials).post(
            SPACES_URL,
            json={"config": {"accessType": "OPEN"}},
            timeout=20,
        )
        response.raise_for_status()
        space = response.json()
    except Exception as exc:
        raise error(
            503,
            "MEET_CREATION_FAILED",
            "Google could not create an open Meet room. Check the Meet API and connected account, then retry.",
        ) from exc
    if space.get("config", {}).get("accessType") != "OPEN":
        raise error(
            503,
            "MEET_NOT_OPEN",
            "Google did not confirm open access for this room, so Alter will not send you to a host waiting screen.",
        )
    return validate_meet_url(space.get("meetingUri", ""))


def join_local_alter(settings, url):
    """Wait for the optional local demo account to join before opening Meet."""
    if not getattr(settings, "dev_mode", False):
        return
    endpoint = os.getenv("ALTER_MEET_BOT_URL", "").rstrip("/")
    if not endpoint:
        return
    parsed = urlparse(endpoint)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost"):
        raise error(503, "ALTER_JOIN_FAILED", "The local Alter participant address must use loopback HTTP.")
    try:
        response = requests.post(endpoint + "/join", json={"meetUrl": url}, timeout=35)
        response.raise_for_status()
        if response.json().get("joined") is not True:
            raise ValueError("The Alter did not confirm its Meet presence.")
    except Exception as exc:
        raise error(
            503,
            "ALTER_JOIN_FAILED",
            "The Alter has not joined this Meet. Sign into the local Alter browser and retry with a new room.",
        ) from exc
