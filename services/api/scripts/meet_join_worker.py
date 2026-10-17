"""Poll the private Firestore Meet queue and ask the local Alter browser to join.

Run this beside the signed-in Alter browser on a persistent cloud host with
Firestore access. Judges only use the hosted app; no local Mac stays online.
"""

import argparse
from datetime import timedelta
import signal
import time

import requests

from app.day import valid_meet_url
from app.store import FirestoreStore
from app.util import iso, new_id, now


def claim(store, job_id, worker_id):
    path = f"meetJoinJobs/{job_id}"

    def update(tx):
        job = tx.get(path)
        if not job or job.get("state") not in ("pending", "claimed"):
            return None
        if job.get("state") == "claimed" and job.get("leaseUntil", "") > iso():
            return None
        if job.get("expiresAt", "") <= iso():
            tx.set(path, {**job, "state": "failed", "error": "expired"})
            return None
        tx.set(path, {
            **job,
            "state": "claimed",
            "workerId": worker_id,
            "leaseUntil": (now() + timedelta(seconds=45)).isoformat(),
        })
        return job

    return store.atomic(update)


def finish(store, job_id, worker_id, joined):
    path = f"meetJoinJobs/{job_id}"

    def update(tx):
        job = tx.get(path)
        if not job or job.get("state") != "claimed" or job.get("workerId") != worker_id:
            return
        tx.set(path, {
            **job,
            "state": "joined" if joined else "failed",
            "finishedAt": iso(),
            "error": "" if joined else "browser_join_failed",
        })

    store.atomic(update)


def process_once(store, bot_url, worker_id):
    for job in store.list("meetJoinJobs"):
        if job.get("state") not in ("pending", "claimed"):
            continue
        claimed = claim(store, job["id"], worker_id)
        if not claimed:
            continue
        url = claimed.get("meetUrl", "")
        joined = False
        if valid_meet_url(url):
            try:
                response = requests.post(bot_url + "/join", json={"meetUrl": url}, timeout=35)
                response.raise_for_status()
                joined = response.json().get("joined") is True
            except (requests.RequestException, ValueError):
                pass
        finish(store, job["id"], worker_id, joined)
        print(f"Meet participant job {job['id']}: {'joined' if joined else 'failed'}", flush=True)
        return True
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="GCP project containing the private Meet queue")
    parser.add_argument("--bot-url", default="http://127.0.0.1:8787")
    args = parser.parse_args()
    if args.bot_url != "http://127.0.0.1:8787":
        raise ValueError("The local Meet participant must use http://127.0.0.1:8787.")
    store = FirestoreStore(args.project)
    worker_id = new_id("worker_")
    running = True

    def stop(*_):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print("Meet participant queue is running.", flush=True)
    while running:
        if not process_once(store, args.bot_url, worker_id):
            time.sleep(1)


if __name__ == "__main__":
    main()
