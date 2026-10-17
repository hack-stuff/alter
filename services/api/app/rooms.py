"""Alter's own meeting rooms: a shareable link, who is in the room, and WebRTC signaling.

Media flows browser to browser. The server only relays offers and answers between
signed-in visitors, and the organizer's page runs the represented teammate's Alter.
"""

from datetime import timedelta
import re
import secrets
import time

from pydantic import Field

from app.errors import error
from app.models import Input
from app.rate_limits import take
from app.util import iso, new_id, now

CODE = re.compile(r"^[a-z]{3}-[a-z]{4}-[a-z]{3}$")
LETTERS = "abcdefghijkmnopqrstuvwxyz"
STALE_SECONDS = 15
MAX_PEERS = 6


class RoomCreate(Input):
    meetingId: str = Field(max_length=80)


class RoomJoin(Input):
    name: str = Field(min_length=1, max_length=40)


class RoomPoll(Input):
    peerId: str = Field(max_length=80)
    after: int = 0


class RoomSignal(Input):
    peerId: str = Field(max_length=80)
    to: str = Field(max_length=80)
    kind: str = Field(pattern="^(offer|answer)$")
    data: str = Field(max_length=40000)


class RoomLeave(Input):
    peerId: str = Field(max_length=80)


def new_code():
    part = lambda size: "".join(secrets.choice(LETTERS) for _ in range(size))
    return f"{part(3)}-{part(4)}-{part(3)}"


def clock():
    """Microseconds: ordered, and still exact as a JavaScript number."""
    return time.time_ns() // 1000


class Rooms:
    def __init__(self, engine):
        self.engine, self.store = engine, engine.store

    def room(self, code):
        if not CODE.fullmatch(code or ""):
            raise error(404, "ROOM_NOT_FOUND", "This meeting link is not valid.")
        value = self.store.get(f"rooms/{code}")
        if not value or value["expiresAt"] <= iso():
            raise error(404, "ROOM_NOT_FOUND", "This meeting has ended or the link has expired.")
        return value

    @staticmethod
    def public(code, room):
        return {
            "code": code,
            "title": room["title"],
            "host": room["hostName"],
            "alter": {"memberId": room["alter"], "name": room["alterName"]},
            "meetingId": room["meetingId"],
            "ended": room.get("ended", False),
        }

    def create(self, ctx, meeting_id):
        meeting = self.engine.meetings.owned(ctx, meeting_id)
        if meeting["state"] != "capturing":
            raise error(409, "CAPTURE_CLOSED", "Start a new meeting to open a room.")
        self.store.atomic(
            lambda tx: take(
                tx,
                f"room-create:{ctx.workspace_id}:{ctx.member_id}",
                12,
                message="Too many meetings were started this hour. Please try again later.",
            )
        )
        root = f"workspaces/{ctx.workspace_id}/members/"
        host = self.store.get(root + ctx.member_id) or {}
        alter = self.store.get(root + meeting["representedMember"]) or {}
        code = new_code()
        room = {
            "workspaceId": ctx.workspace_id,
            "meetingId": meeting_id,
            "owner": ctx.member_id,
            "ownerUid": ctx.uid,
            "hostName": host.get("name", "Your teammate"),
            "title": "Team sync",
            "alter": meeting["representedMember"],
            "alterName": alter.get("name", "Teammate"),
            "createdAt": iso(),
            "expiresAt": (now() + timedelta(hours=4)).isoformat(),
        }
        self.store.set(f"rooms/{code}", room)
        return self.public(code, room)

    def info(self, code):
        return self.public(code, self.room(code))

    def peers(self, code):
        cutoff = clock() - STALE_SECONDS * 1_000_000
        return [
            {"id": p["id"], "name": p["name"], "host": p["host"]}
            for p in sorted(self.store.list(f"rooms/{code}/peers"), key=lambda p: p["joinedAt"])
            if p["seen"] >= cutoff
        ]

    def join(self, user, code, name):
        room = self.room(code)
        if room.get("ended"):
            raise error(409, "ROOM_ENDED", "This meeting has ended.")
        self.store.atomic(
            lambda tx: take(tx, f"room-join:{user.uid}", 30, message="Too many joins. Please wait a moment.")
        )
        if len(self.peers(code)) >= MAX_PEERS:
            raise error(409, "ROOM_FULL", "This meeting is full.")
        peer_id = new_id("peer_")
        stamp = clock()
        self.store.set(
            f"rooms/{code}/peers/{peer_id}",
            {"uid": user.uid, "name": name, "host": user.uid == room["ownerUid"], "joinedAt": stamp, "seen": stamp},
        )
        return {"peerId": peer_id, "room": self.public(code, room), "peers": self.peers(code)}

    def own(self, user, code, peer_id):
        peer = self.store.get(f"rooms/{code}/peers/{peer_id}")
        if not peer or peer["uid"] != user.uid:
            raise error(403, "ROOM_SCOPE", "Rejoin the meeting from its link.")
        return peer

    def poll(self, user, code, peer_id, after):
        room = self.room(code)
        peer = self.own(user, code, peer_id)
        self.store.set(f"rooms/{code}/peers/{peer_id}", {**peer, "seen": clock()})
        signals, delivered = [], []
        for item in self.store.list(f"rooms/{code}/signals"):
            if item["to"] != peer_id:
                continue
            if item["seq"] <= after:
                delivered.append(f"rooms/{code}/signals/{item['id']}")
            else:
                signals.append({k: item[k] for k in ("from", "kind", "data", "seq")})
        if delivered:
            self.store.atomic(lambda tx: [tx.delete(path) for path in delivered])
        return {
            "peers": self.peers(code),
            "signals": sorted(signals, key=lambda s: s["seq"]),
            "ended": room.get("ended", False),
        }

    def signal(self, user, code, peer_id, to, kind, data):
        self.room(code)
        self.own(user, code, peer_id)
        if not self.store.get(f"rooms/{code}/peers/{to}"):
            raise error(404, "PEER_GONE", "That participant has left.")
        self.store.set(
            f"rooms/{code}/signals/{new_id('sig_')}",
            {"from": peer_id, "to": to, "kind": kind, "data": data, "seq": clock()},
        )
        return {"ok": True}

    def leave(self, user, code, peer_id):
        self.own(user, code, peer_id)
        self.store.atomic(lambda tx: tx.delete(f"rooms/{code}/peers/{peer_id}"))
        return {"ok": True}

    def end(self, ctx, code):
        room = self.room(code)
        if (room["workspaceId"], room["owner"]) != (ctx.workspace_id, ctx.member_id):
            raise error(403, "ROOM_SCOPE", "Only the organizer can end this meeting.")
        self.store.set(f"rooms/{code}", {**room, "ended": True})
        return {"ok": True}

    def summary(self, code):
        """What everyone who was in the room sees once the organizer ends it."""
        room = self.room(code)
        root = f"workspaces/{room['workspaceId']}"
        meeting = self.store.get(f"{root}/meetings/{room['meetingId']}") or {}
        names = {m["id"]: m.get("name", m["id"]) for m in self.store.list(root + "/members")}
        segments = sorted(
            self.store.list(f"{root}/meetings/{room['meetingId']}/segments"),
            key=lambda s: s.get("sequence", 0),
        )
        return {
            "title": room["title"],
            "host": room["hostName"],
            "alter": room["alterName"],
            "ended": room.get("ended", False),
            "state": meeting.get("state", "capturing"),
            "decisions": [d["text"] for d in meeting.get("decisions", [])],
            "tasks": [
                {"title": t["title"], "owner": names.get(t["owner"], t["owner"]), "due": t.get("due", "Unconfirmed")}
                for t in meeting.get("tasks", [])
            ],
            "answers": [s["text"] for s in segments if s.get("kind") == "alter"][-3:],
            "waitingOnAlterOwner": bool(meeting.get("needsLaunchDecision")),
        }
