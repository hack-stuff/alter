from dataclasses import dataclass
from threading import Lock
import hashlib

from app.config import Settings
from app.errors import error
from app.util import identifier, now
from datetime import datetime


@dataclass(frozen=True)
class Caller:
    uid: str
    email: str = ""
    email_verified: bool = False


@dataclass(frozen=True)
class MemberContext:
    uid: str
    workspace_id: str
    member_id: str
    caller: Caller
    conversation_id: str | None = None
    room_meeting_id: str | None = None
    room_key: str | None = None


class Authentication:
    def __init__(self, settings: Settings, store, verifier=None):
        self.settings, self.store, self.verifier = settings, store, verifier
        self._app = None
        self._lock = Lock()

    def authenticate(self, authorization, dev_uid):
        if self.settings.dev_mode and dev_uid:
            identifier(dev_uid)
            return Caller(dev_uid)
        if (
            not authorization
            or not authorization.startswith("Bearer ")
            or len(authorization) > 8192
        ):
            raise error(401, "UNAUTHENTICATED", "Sign-in required.")
        try:
            if self.verifier:
                decoded = self.verifier(authorization[7:])
            else:
                import firebase_admin
                from firebase_admin import auth

                with self._lock:
                    if self._app is None:
                        name = (
                            "alter-api-"
                            + hashlib.sha256(
                                self.settings.project.encode()
                            ).hexdigest()[:12]
                        )
                        try:
                            self._app = firebase_admin.get_app(name)
                        except ValueError:
                            self._app = firebase_admin.initialize_app(
                                options={"projectId": self.settings.project}, name=name
                            )
                decoded = auth.verify_id_token(
                    authorization[7:], app=self._app, check_revoked=True
                )
            uid = decoded["uid"]
            identifier(uid)
            return Caller(
                uid, decoded.get("email", ""), decoded.get("email_verified") is True
            )
        except Exception:
            raise error(
                401, "UNAUTHENTICATED", "Sign-in expired. Please sign in again."
            ) from None

    def member(self, caller: Caller):
        binding = self.store.get(f"userBindings/{caller.uid}")
        if not binding:
            raise error(404, "NOT_JOINED", "Join a workspace first.")
        wid, mid = binding["workspaceId"], binding["memberId"]
        workspace = self.store.get(f"workspaces/{wid}")
        member = self.store.get(f"workspaces/{wid}/members/{mid}")
        if not workspace or not member or member.get("uid") != caller.uid:
            raise error(403, "FORBIDDEN", "Workspace membership is no longer valid.")
        if datetime.fromisoformat(workspace["expiresAt"]) <= now():
            raise error(410, "EXPIRED", "This workspace has expired.")
        if workspace.get("state") in ("deleting", "resetting"):
            raise error(
                409,
                "WORKSPACE_BUSY",
                "This workspace is being refreshed. Please try again.",
            )
        return MemberContext(caller.uid, wid, mid, caller)
