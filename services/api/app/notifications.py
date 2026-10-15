"""Durable in-app notifications and best-effort FCM delivery with stable event keys."""

from hashlib import sha256
from datetime import timedelta

from app.errors import error
from app.util import iso, now


class Notifications:
    def __init__(self, engine):
        self.engine, self.store = engine, engine.store
        self._firebase = None

    def firebase_app(self):
        import firebase_admin

        if self._firebase is None:
            name = "alter-notifications-" + self.engine.settings.project
            try:
                self._firebase = firebase_admin.get_app(name)
            except ValueError:
                self._firebase = firebase_admin.initialize_app(
                    options={"projectId": self.engine.settings.project}, name=name
                )
        return self._firebase

    def publish(self, wid, recipient, key, title, body, path):
        nid = sha256(f"{recipient}:{key}".encode()).hexdigest()[:40]
        target = f"workspaces/{wid}/notifications/{nid}"

        def save(tx):
            if not tx.get(target):
                tx.set(
                    target,
                    {
                        "owner": recipient,
                        "title": title[:160],
                        "body": body[:500],
                        "path": path,
                        "ts": iso(),
                        "read": False,
                        "delivery": "pending",
                        "attempts": 0,
                    },
                )

        self.store.atomic(save)
        return nid

    def register(self, ctx, token):
        did = sha256(token.encode()).hexdigest()
        self.store.set(
            f"pushDevices/{did}",
            {
                "uid": ctx.uid,
                "workspaceId": ctx.workspace_id,
                "memberId": ctx.member_id,
                "token": token,
                "updatedAt": iso(),
            },
        )
        return {"id": did, "registered": True}

    def remove(self, ctx, did):
        def save(tx):
            device = tx.get("pushDevices/" + did)
            if device and device["uid"] == ctx.uid:
                tx.delete("pushDevices/" + did)

        self.store.atomic(save)
        return {"removed": True}

    def read(self, ctx, nid):
        path = f"workspaces/{ctx.workspace_id}/notifications/{nid}"

        def save(tx):
            item = tx.get(path)
            if not item or item["owner"] != ctx.member_id:
                raise error(404, "NOT_FOUND", "No such notification.")
            tx.set(path, {**item, "read": True})

        self.store.atomic(save)
        return {"read": True}

    def deliver(self, wid):
        workspace = self.store.get(f"workspaces/{wid}")
        if not workspace or workspace["expiresAt"] <= iso():
            return
        devices = self.store.list("pushDevices")
        for item in self.store.list(f"workspaces/{wid}/notifications"):
            if item["delivery"] not in ("pending", "waiting_for_device", "retry"):
                continue
            if item.get("attempts", 0) >= 5:
                continue
            path = f"workspaces/{wid}/notifications/{item['id']}"

            def claim(tx):
                current = tx.get(path)
                if current.get("leaseUntil", "") > iso():
                    return False
                tx.set(
                    path,
                    {
                        **current,
                        "leaseUntil": (now() + timedelta(minutes=2)).isoformat(),
                    },
                )
                return True

            if not self.store.atomic(claim):
                continue
            member = self.store.get(f"workspaces/{wid}/members/{item['owner']}") or {}
            targets = [
                d
                for d in devices
                if d["workspaceId"] == wid
                and d["memberId"] == item["owner"]
                and d["uid"] == member.get("uid")
            ]
            state = "waiting_for_device"
            try:
                if targets:
                    if self.engine.settings.dev_mode:
                        state = "simulated"
                    else:
                        from firebase_admin import messaging

                        app = self.firebase_app()
                        for device in targets:
                            # Data-only payload lets the service worker use one stable notification tag.
                            messaging.send(
                                messaging.Message(
                                    token=device["token"],
                                    data={
                                        "title": item["title"],
                                        "body": item["body"],
                                        "path": item["path"],
                                        "eventId": item["id"],
                                        "workspaceId": wid,
                                    },
                                ),
                                app=app,
                            )
                        state = "provider_accepted"
            except Exception:
                state = "retry"

            def finish(tx):
                current = tx.get(path)
                tx.set(
                    path,
                    {
                        **current,
                        "delivery": state,
                        "attempts": current.get("attempts", 0) + (1 if targets else 0),
                        "leaseUntil": "",
                    },
                )

            self.store.atomic(finish)
