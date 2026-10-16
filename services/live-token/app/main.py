"""Firebase-authenticated, single-use Gemini Live tokens with a durable minute budget."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
import os
from typing import Literal, Protocol
from uuid import uuid4
from threading import Lock

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.modes import live_config

LOGGER = logging.getLogger(__name__)
SESSION_SECONDS = 600

@dataclass(frozen=True)
class Settings:
    project: str = ""
    model: str = ""
    api_key_secret: str = ""
    origins: tuple[str, ...] = ()
    workspace_minutes_per_hour: int = 40

    @classmethod
    def from_env(cls):
        return cls(project=os.getenv("GCP_PROJECT", ""), model=os.getenv("LIVE_MODEL", ""), api_key_secret=os.getenv("GEMINI_API_KEY_SECRET", ""), origins=tuple(origin.strip() for origin in os.getenv("CORS_ORIGINS", "").split(",") if origin.strip()), workspace_minutes_per_hour=int(os.getenv("LIVE_WORKSPACE_MINUTES_PER_HOUR", "40")))

class TokenRequest(BaseModel):
    mode: Literal["chat", "revise", "reply", "huddle"]
    memberId: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,128}$")

class ReleaseRequest(BaseModel):
    sessionId: str = Field(pattern=r"^[0-9a-f]{32}$")

Reservation = Literal["reserved", "busy", "exhausted"]

class Backend(Protocol):
    def authenticate(self, token: str) -> str: ...
    def workspace(self, uid: str, persona: str | None) -> tuple[str, str]: ...
    def reserve(self, workspace: str, uid: str, request_id: str, now: datetime, minutes: int) -> Reservation: ...
    def refund(self, workspace: str, uid: str, request_id: str, now: datetime, minutes: int) -> None: ...
    def release(self, workspace: str, uid: str, request_id: str) -> None: ...
    def mint(self, mode: str, persona: str | None, expires: datetime, new_session_expires: datetime) -> str: ...

class GoogleBackend:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._initialize = Lock()
        self._db = None
        self._client = None
        self._firebase = None

    def db(self):
        with self._initialize:
            if self._db is None:
                from google.cloud import firestore
                self._db = firestore.Client(project=self.settings.project)
        return self._db

    def authenticate(self, token):
        import firebase_admin
        from firebase_admin import auth
        with self._initialize:
            if self._firebase is None:
                # A named app keeps Firebase's project explicit and avoids duplicate initialization on concurrent requests.
                try:
                    self._firebase = firebase_admin.get_app("alter-live-token")
                except ValueError:
                    self._firebase = firebase_admin.initialize_app(options={"projectId": self.settings.project}, name="alter-live-token")
        return auth.verify_id_token(token, app=self._firebase, check_revoked=True)["uid"]

    def workspace(self, uid, persona):
        from google.cloud.firestore_v1.base_query import FieldFilter
        matches = list(self.db().collection_group("members").where(filter=FieldFilter("uid", "==", uid)).limit(2).stream())
        if len(matches) != 1:
            raise PermissionError("Join a workspace before starting voice.")
        member = matches[0]
        parent = member.reference.parent.parent
        if parent is None or parent.parent.id != "workspaces":
            raise PermissionError("Workspace membership could not be verified.")
        workspace = parent.get()
        if not workspace.exists:
            raise PermissionError("This workspace no longer exists.")
        data = workspace.to_dict()
        expires_at = data.get("expiresAt")
        if isinstance(expires_at, datetime) and expires_at <= datetime.now(timezone.utc):
            raise PermissionError("This workspace has expired.")
        # Track A rejects requests while a workspace is retiring; voice should too.
        if data.get("state") in ("deleting", "resetting"):
            raise PermissionError("This workspace is being refreshed. Please try again.")
        if persona and not parent.collection("members").document(persona).get().exists:
            raise PermissionError("This teammate is not in your workspace.")
        return parent.id, member.id

    def _budget_ref(self, workspace, now):
        return self.db().collection("workspaces").document(workspace).collection("liveBudgets").document(now.strftime("%Y%m%d%H"))

    def reserve(self, workspace, uid, request_id, now, minutes):
        from google.cloud import firestore
        budget = self._budget_ref(workspace, now)
        active_session = self.db().collection("workspaces").document(workspace).collection("liveSessions").document(uid)
        transaction = self.db().transaction()
        @firestore.transactional
        def increment(tx):
            snapshot = budget.get(transaction=tx)
            values = snapshot.to_dict() or {}
            active = active_session.get(transaction=tx).to_dict() or {}
            reservations = values.get("reservations", {})
            used = values.get("minutes", 0)
            # At most one active ten-minute reservation per UID, until it expires or the client releases it.
            if active.get("expiresAt") and active["expiresAt"] > now:
                return "busy"
            if used + minutes > self.settings.workspace_minutes_per_hour:
                return "exhausted"
            reservations[request_id] = {"uid": uid, "minutes": minutes}
            tx.set(budget, {"minutes": used + minutes, "reservations": reservations, "expiresAt": now + timedelta(hours=2)})
            tx.set(active_session, {"requestId": request_id, "expiresAt": now + timedelta(seconds=SESSION_SECONDS)})
            return "reserved"
        return increment(transaction)

    def refund(self, workspace, uid, request_id, now, minutes):
        from google.cloud import firestore
        budget = self._budget_ref(workspace, now)
        active_session = self.db().collection("workspaces").document(workspace).collection("liveSessions").document(uid)
        transaction = self.db().transaction()
        @firestore.transactional
        def decrement(tx):
            values = budget.get(transaction=tx).to_dict() or {}
            active = active_session.get(transaction=tx).to_dict() or {}
            reservations = values.get("reservations", {})
            if request_id not in reservations:
                return
            reservations.pop(request_id)
            tx.set(budget, {**values, "minutes": max(0, values.get("minutes", 0) - minutes), "reservations": reservations})
            if active.get("requestId") == request_id:
                tx.delete(active_session)
        decrement(transaction)

    def release(self, workspace, uid, request_id):
        # Clears only the per-UID lock. The minutes stay charged: a client report
        # cannot prove the single-use token is no longer connected.
        from google.cloud import firestore
        active_session = self.db().collection("workspaces").document(workspace).collection("liveSessions").document(uid)
        transaction = self.db().transaction()
        @firestore.transactional
        def clear(tx):
            active = active_session.get(transaction=tx).to_dict() or {}
            if active.get("requestId") == request_id:
                tx.delete(active_session)
        clear(transaction)

    def mint(self, mode, persona, expires, new_session_expires):
        with self._initialize:
            if self._client is None:
                from google import genai
                from google.cloud import secretmanager
                key = secretmanager.SecretManagerServiceClient().access_secret_version(request={"name": self.settings.api_key_secret}, timeout=10).payload.data.decode("utf-8")
                self._client = genai.Client(api_key=key, http_options={"api_version": "v1alpha", "timeout": 15000})
        token = self._client.auth_tokens.create(config={"uses": 1, "expire_time": expires, "new_session_expire_time": new_session_expires, "live_connect_constraints": {"model": self.settings.model, "config": live_config(mode, persona)}})
        if not token.name:
            raise RuntimeError("Gemini did not return a token.")
        return token.name

def failure(status, code, message):
    return HTTPException(status, {"error": {"code": code, "message": message}})

def create_app(settings: Settings | None = None, backend: Backend | None = None):
    settings = settings or Settings.from_env()
    backend = backend or GoogleBackend(settings)
    app = FastAPI(title="Alter Live Token", version="0.1.0")
    if settings.origins:
        app.add_middleware(CORSMiddleware, allow_origins=list(settings.origins), allow_methods=["POST"], allow_headers=["Authorization", "Content-Type"])

    @app.get("/healthz")
    def health():
        return {"ok": True}

    def caller(authorization):
        if not authorization or not authorization.startswith("Bearer ") or len(authorization) > 8192:
            raise failure(401, "UNAUTHENTICATED", "Sign in before starting voice.")
        if not settings.project or not settings.model or not settings.api_key_secret:
            raise failure(503, "NOT_CONFIGURED", "Voice is not configured yet. You can continue by text.")
        try:
            return backend.authenticate(authorization[7:])
        except Exception:
            raise failure(401, "UNAUTHENTICATED", "Sign-in expired. Please sign in again.") from None

    @app.post("/v1/live/token")
    def token(req: TokenRequest, authorization: str | None = Header(default=None)):
        uid = caller(authorization)
        if req.mode == "huddle" and not req.memberId:
            raise failure(422, "INVALID_REQUEST", "Choose a teammate for this voice room.")
        persona = req.memberId if req.mode == "huddle" else None
        try:
            workspace_id, _member_id = backend.workspace(uid, persona)
        except PermissionError as error:
            raise failure(403, "FORBIDDEN", str(error)) from None
        except Exception:
            raise failure(503, "UNAVAILABLE", "Workspace access could not be checked. Please try again.") from None
        now = datetime.now(timezone.utc)
        request_id = uuid4().hex
        try:
            reserved = backend.reserve(workspace_id, uid, request_id, now, 10)
        except Exception:
            raise failure(503, "UNAVAILABLE", "Voice usage could not be checked. Please try again.") from None
        if reserved == "busy":
            raise failure(429, "VOICE_ACTIVE", "Voice is already open for you. End the other voice session, then try again.")
        if reserved != "reserved":
            raise failure(429, "RATE_LIMITED", "Your voice budget is used for now. Please continue by text.")
        expires = now + timedelta(seconds=SESSION_SECONDS)
        try:
            minted = backend.mint(req.mode, persona, expires, now + timedelta(seconds=60))
        except Exception:
            # Never log a provider exception which might contain the API key or token.
            try:
                backend.refund(workspace_id, uid, request_id, now, 10)
            except Exception:
                LOGGER.warning("Could not refund failed voice reservation %s", request_id)
            raise failure(503, "UNAVAILABLE", "Voice could not connect. Please try again or use text.") from None
        return {"token": minted, "model": settings.model, "expiresAt": expires.isoformat(), "sessionId": request_id}

    @app.post("/v1/live/release")
    def release(req: ReleaseRequest, authorization: str | None = Header(default=None)):
        uid = caller(authorization)
        try:
            workspace_id, _member_id = backend.workspace(uid, None)
            backend.release(workspace_id, uid, req.sessionId)
        except PermissionError as error:
            raise failure(403, "FORBIDDEN", str(error)) from None
        except Exception:
            raise failure(503, "UNAVAILABLE", "Voice could not be released. It will free up within ten minutes.") from None
        return {"released": True}
    return app

app = create_app()
