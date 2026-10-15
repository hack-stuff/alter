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
    # Seed-only helper for fixture evaluations. Runtime gates load current workspace membership.
    return set(json.loads((seed_dir / "team.json").read_text())["members"])


def load_rules(owner: str, seed_dir: Path = SEED_DIR) -> list[Rule]:
    raw = json.loads((seed_dir / "policies" / f"{owner}.json").read_text())
    return [
        Rule(r["id"], r["label"], tuple(r["intents"]), r["mode"]) for r in raw["rules"]
    ]


def evaluate(rules: list[Rule], team: set[str], asker: str, intent: Intent) -> Decision:
    if asker not in team:
        return Decision("deny", "membership", "Requester is not on the team.")
    for rule in rules:
        if intent in rule.intents:
            return Decision(rule.mode, rule.id, rule.label)
    # Anything the owner hasn't covered goes back to the owner.
    return Decision("ask", "default", "Not covered by the owner's rules.")


def enforce(
    rules, team, asker, owner, intent, *, driving=False, payload=None, resources=None
):
    """The same organization checks run at proposal and application time."""
    if asker not in team or owner not in team:
        return Decision(
            "deny", "membership", "Requester is not a member of this workspace."
        )
    payload = payload or {}
    if payload.get("to_members") and any(
        member not in team for member in payload["to_members"]
    ):
        return Decision(
            "deny",
            "org-external-email",
            "External email is denied by the organization.",
        )
    if payload.get("attendees") and any(
        member not in team for member in payload["attendees"]
    ):
        return Decision(
            "deny",
            "org-external-attendees",
            "Calendar attendees must be workspace members.",
        )
    if payload.get("fileId") and payload["fileId"] not in set(
        (resources or {}).values()
    ):
        return Decision(
            "deny",
            "org-workspace-folder",
            "File changes are limited to the workspace folder.",
        )
    if driving and asker == owner:
        return Decision(
            "allow",
            "owner-approval"
            if intent
            in ("request_write", "request_send_on_behalf", "request_commitment")
            else "owner-read",
            "Owner request; external changes still require approval.",
        )
    decision = evaluate(rules, team, asker, intent)
    if intent == "request_commitment" and decision.outcome == "allow":
        # Dates are never committed for another owner without their explicit decision.
        return Decision("ask", "commit-dates", "The owner must confirm commitments.")
    return decision
