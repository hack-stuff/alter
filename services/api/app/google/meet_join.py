"""Wait for a real Alter browser participant before sending the user to Meet."""

from datetime import timedelta
import os
import time

from app.errors import error
from app.google import meet
from app.util import iso, new_id, now


def prepare(store, settings, workspace_id, member_id, url):
    mode = os.getenv("ALTER_MEET_BOT_MODE", "").strip().lower()
    if mode == "firestore":
        if settings.store_backend != "firestore":
            raise error(503, "ALTER_JOIN_FAILED", "The Meet participant queue requires Firestore.")
        return wait_for_worker(store, workspace_id, member_id, url)
    if mode and mode != "local":
        raise error(503, "ALTER_JOIN_FAILED", "The Meet participant mode is not configured correctly.")
    if mode == "local" and (not settings.dev_mode or not os.getenv("ALTER_MEET_BOT_URL")):
        raise error(503, "ALTER_JOIN_FAILED", "The local Meet participant is not configured.")
    if mode == "local" or (settings.dev_mode and os.getenv("ALTER_MEET_BOT_URL")):
        meet.join_local_alter(settings, url)


def wait_for_worker(store, workspace_id, member_id, url, *, timeout=35):
    job_id = new_id("meet_")
    path = f"meetJoinJobs/{job_id}"
    store.set(path, {
        "workspaceId": workspace_id,
        "memberId": member_id,
        "meetUrl": url,
        "state": "pending",
        "createdAt": iso(),
        "expiresAt": (now() + timedelta(minutes=15)).isoformat(),
    })
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = store.get(path)
        if job and job.get("state") == "joined":
            return
        if job and job.get("state") == "failed":
            raise error(503, "ALTER_JOIN_FAILED", "The Alter could not join this Meet. Check the demo participant and retry.")
        time.sleep(0.75)

    def expire(tx):
        current = tx.get(path)
        if current and current.get("state") not in ("joined", "failed"):
            tx.set(path, {**current, "state": "timed_out"})

    store.atomic(expire)
    if (store.get(path) or {}).get("state") == "joined":
        return
    raise error(503, "ALTER_JOIN_TIMEOUT", "The Alter did not join Meet in time. Retry with a new room.")
