import json

import pytest
from fastapi import HTTPException

from app.google import meet


class Secrets:
    def __init__(self, include_meet=True):
        self.values = {
            "client_id": "test-client",
            "client_secret": "test-secret",
            "refresh_token": "calendar-token",
        }
        if include_meet:
            self.values["meet_refresh_token"] = "meet-token"

    def read(self, name):
        assert name == "oauth-bundle"
        return json.dumps(self.values)


class Settings:
    google_oauth_secret = "oauth-bundle"


class Response:
    def __init__(self, access="OPEN"):
        self.access = access

    def raise_for_status(self):
        pass

    def json(self):
        return {
            "meetingUri": "https://meet.google.com/abc-defg-hij",
            "config": {"accessType": self.access},
        }


def test_create_open_meet_requests_no_knock_access(monkeypatch):
    requests = []

    class Session:
        def __init__(self, credentials):
            assert credentials.scopes == [meet.MEET_SCOPE]
            assert credentials.refresh_token == "meet-token"

        def post(self, url, **kwargs):
            requests.append((url, kwargs))
            return Response()

    monkeypatch.setattr(meet, "AuthorizedSession", Session)
    assert meet.create_open_space(Settings(), Secrets()) == "https://meet.google.com/abc-defg-hij"
    assert requests == [
        (meet.SPACES_URL, {"json": {"config": {"accessType": "OPEN"}}, "timeout": 20})
    ]


def test_meet_without_scope_or_open_access_does_not_send_user_to_waiting_room(monkeypatch):
    with pytest.raises(HTTPException) as missing:
        meet.create_open_space(Settings(), Secrets(include_meet=False))
    assert missing.value.detail["error"]["code"] == "MEET_SETUP_REQUIRED"

    class Session:
        def __init__(self, credentials):
            pass

        def post(self, url, **kwargs):
            return Response(access="TRUSTED")

    monkeypatch.setattr(meet, "AuthorizedSession", Session)
    with pytest.raises(HTTPException) as restricted:
        meet.create_open_space(Settings(), Secrets())
    assert restricted.value.detail["error"]["code"] == "MEET_NOT_OPEN"
