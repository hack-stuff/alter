"""Explicit local/live configuration; no guessed model IDs or production auth bypass."""

from dataclasses import dataclass, field
import os
import sys
from pathlib import Path

_source_seed = Path(__file__).resolve().parent.parent / "seed"
SEED_DIR = (
    _source_seed if _source_seed.exists() else Path(sys.prefix) / "share/alter/seed"
)


@dataclass(frozen=True)
class Settings:
    dev_mode: bool = False
    store_backend: str = "firestore"
    database_path: str = "/tmp/alter.sqlite3"
    ai_backend: str = "vertex"
    google_backend: str = "google"
    project: str = ""
    region: str = "us-central1"
    vertex_location: str = ""
    model_fast: str = ""
    model_pro: str = ""
    public_origin: str = "http://127.0.0.1:5173"
    service_url: str = "http://127.0.0.1:8080"
    cors_origins: tuple[str, ...] = ()
    a2a_secret: str = ""
    a2a_secret_name: str = ""
    director_key: str = ""
    director_secret_name: str = ""
    google_oauth_secret: str = ""
    template_ids: dict[str, str] = field(default_factory=dict)
    search_serving_config: str = ""
    welcome_delay: float = 20
    scheduler_audience: str = ""
    scheduler_email: str = ""
    admin_email: str = ""
    allow_forwarded_ip: bool = False
    trace_delay: float = 0.3
    # Hourly model-call limits: per member so one person can't use up the team's
    # allowance, and per workspace as the overall cost cap.
    model_calls_per_member: int = 120
    model_calls_per_workspace: int = 400

    @property
    def model_location(self):
        return self.vertex_location or self.region

    @classmethod
    def from_env(cls):
        import json

        dev = os.getenv("DEV_MODE", "0") == "1"
        return cls(
            dev_mode=dev,
            store_backend=os.getenv("STORE_BACKEND", "sqlite" if dev else "firestore"),
            database_path=os.getenv("DATABASE_PATH", "/tmp/alter.sqlite3"),
            ai_backend=os.getenv("AI_BACKEND", "local" if dev else "vertex"),
            google_backend=os.getenv("GOOGLE_BACKEND", "local" if dev else "google"),
            project=os.getenv("GCP_PROJECT", ""),
            region=os.getenv("GCP_REGION", "us-central1"),
            vertex_location=os.getenv("VERTEX_LOCATION", ""),
            model_fast=os.getenv("MODEL_FAST", ""),
            model_pro=os.getenv("MODEL_PRO", ""),
            public_origin=os.getenv("PUBLIC_ORIGIN", "http://127.0.0.1:5173"),
            service_url=os.getenv("SERVICE_URL", "http://127.0.0.1:8080"),
            cors_origins=tuple(
                x.strip()
                for x in os.getenv(
                    "CORS_ORIGINS",
                    "http://127.0.0.1:5173,http://localhost:5173" if dev else "",
                ).split(",")
                if x.strip()
            ),
            a2a_secret=os.getenv("A2A_HMAC_SECRET", "") if dev else "",
            a2a_secret_name=os.getenv("A2A_HMAC_SECRET_NAME", ""),
            director_key=os.getenv("DIRECTOR_KEY", "") if dev else "",
            director_secret_name=os.getenv("DIRECTOR_KEY_SECRET_NAME", ""),
            google_oauth_secret=os.getenv("GOOGLE_OAUTH_SECRET_NAME", ""),
            template_ids=json.loads(os.getenv("GOOGLE_TEMPLATE_IDS", "{}")),
            search_serving_config=os.getenv("SEARCH_SERVING_CONFIG", ""),
            welcome_delay=float(os.getenv("WELCOME_DELAY_SECONDS", "20")),
            # The deploy script strips the trailing slash from the job audience too.
            scheduler_audience=os.getenv("SCHEDULER_AUDIENCE", "").rstrip("/"),
            scheduler_email=os.getenv("SCHEDULER_SERVICE_ACCOUNT", ""),
            admin_email=os.getenv("ADMIN_EMAIL", ""),
            allow_forwarded_ip=os.getenv("TRUST_FORWARDED_IP", "0") == "1",
            trace_delay=float(os.getenv("TRACE_DELAY_SECONDS", ".3")),
            model_calls_per_member=int(
                os.getenv("MODEL_CALLS_PER_MEMBER_PER_HOUR", "120")
            ),
            model_calls_per_workspace=int(
                os.getenv("MODEL_CALLS_PER_WORKSPACE_PER_HOUR", "400")
            ),
        )

    def missing(self):
        if self.dev_mode:
            return []
        required = {
            "GCP_PROJECT": self.project,
            "MODEL_FAST": self.model_fast,
            "MODEL_PRO": self.model_pro,
            "A2A_HMAC_SECRET_NAME": self.a2a_secret_name,
            "GOOGLE_OAUTH_SECRET_NAME": self.google_oauth_secret,
            "CORS_ORIGINS": self.cors_origins,
        }
        missing = [key for key, value in required.items() if not value]
        if (
            self.store_backend != "firestore"
            or self.google_backend != "google"
            or self.ai_backend != "vertex"
        ):
            missing.append("live backends (Firestore, Agent Platform, Google)")
        if not self.service_url.startswith(
            "https://"
        ) or not self.public_origin.startswith("https://"):
            missing.append("HTTPS SERVICE_URL and PUBLIC_ORIGIN")
        return missing
