"""Runtime configuration. Pin model IDs here on Day 1 (track-a §2)."""

import os
from pathlib import Path

SEED_DIR = Path(__file__).resolve().parent.parent / "seed"
FIXTURES_DIR = Path(__file__).resolve().parents[3] / "contracts" / "fixtures"

GCP_PROJECT = os.getenv("GCP_PROJECT", "")
GCP_REGION = os.getenv("GCP_REGION", "us-central1")

# TODO(Day 1): replace with exact model IDs verified in Vertex AI for GCP_REGION.
MODEL_FAST = os.getenv("MODEL_FAST", "gemini-flash-latest")
MODEL_PRO = os.getenv("MODEL_PRO", "gemini-pro-latest")

# When true, routes return contract fixtures and auth accepts an X-Sandbox-Id header.
DEV_MODE = os.getenv("DEV_MODE", "1") == "1"

# Fixed recipients for team email (contract §6). Never taken from the model or client.
TEAM_EMAIL_RECIPIENTS = [
    e for e in os.getenv("TEAM_EMAIL_RECIPIENTS", "").split(",") if e
]
