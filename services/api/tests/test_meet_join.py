from datetime import timedelta

from app.google import meet_join
from app.store import SQLiteStore
from app.util import now
from scripts import meet_join_worker


class Joined:
    def raise_for_status(self):
        pass

    def json(self):
        return {"joined": True}


def test_worker_joins_private_job_and_api_observes_presence(monkeypatch):
    store = SQLiteStore(":memory:")
    job_id = "meet_test"
    store.set(f"meetJoinJobs/{job_id}", {
        "workspaceId": "workspace",
        "memberId": "dev",
        "meetUrl": "https://meet.google.com/abc-defg-hij",
        "state": "pending",
        "expiresAt": (now() + timedelta(minutes=15)).isoformat(),
    })
    calls = []

    def join(url, **kwargs):
        calls.append((url, kwargs))
        return Joined()

    monkeypatch.setattr(meet_join_worker.requests, "post", join)
    assert meet_join_worker.process_once(store, "http://127.0.0.1:8787", "worker_a")
    assert store.get(f"meetJoinJobs/{job_id}")["state"] == "joined"
    assert calls == [("http://127.0.0.1:8787/join", {"json": {"meetUrl": "https://meet.google.com/abc-defg-hij"}, "timeout": 35})]


def test_worker_rejects_non_meet_url(monkeypatch):
    store = SQLiteStore(":memory:")
    store.set("meetJoinJobs/meet_test", {
        "meetUrl": "https://example.com/unsafe",
        "state": "pending",
        "expiresAt": (now() + timedelta(minutes=15)).isoformat(),
    })

    def should_not_post(*args, **kwargs):
        raise AssertionError("Invalid URLs must never reach the browser")

    monkeypatch.setattr(meet_join_worker.requests, "post", should_not_post)
    assert meet_join_worker.process_once(store, "http://127.0.0.1:8787", "worker_a")
    assert store.get("meetJoinJobs/meet_test")["state"] == "failed"
