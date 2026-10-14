"""Deterministic policy gate (track-a §3). The LLM only classifies intent; this decides."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.config import SEED_DIR

Intent = Literal[
    "ask_rationale",
    "ask_status",
    "request_commitment",
    "request_personal",
    "request_send_on_behalf",
    "request_write",
    "other",
]
Mode = Literal["allow", "ask", "deny"]


@dataclass(frozen=True)
class Rule:
    id: str
    label: str
    intents: tuple[str, ...]
    mode: Mode


@dataclass(frozen=True)
class Decision:
    outcome: Mode
    rule_id: str
    reason: str


def load_team(seed_dir: Path = SEED_DIR) -> set[str]:
    # Seeded members only. TODO: union with human members from Firestore per workspace.
    return set(json.loads((seed_dir / "team.json").read_text())["members"])


def load_rules(owner: str, seed_dir: Path = SEED_DIR) -> list[Rule]:
    raw = json.loads((seed_dir / "policies" / f"{owner}.json").read_text())
    return [Rule(r["id"], r["label"], tuple(r["intents"]), r["mode"]) for r in raw["rules"]]


def evaluate(rules: list[Rule], team: set[str], asker: str, intent: Intent) -> Decision:
    if asker not in team:
        return Decision("deny", "membership", "Requester is not on the team.")
    for rule in rules:
        if intent in rule.intents:
            return Decision(rule.mode, rule.id, rule.label)
    # Anything the owner hasn't covered goes back to the owner.
    return Decision("ask", "default", "Not covered by the owner's rules.")
