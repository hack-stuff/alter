import pytest

from app.policy.gate import evaluate, load_rules, load_team

RULES = load_rules("siddhi")
TEAM = load_team()


@pytest.mark.parametrize(
    ("asker", "intent", "expected"),
    [
        ("sahil", "ask_rationale", "allow"),
        ("dev", "ask_status", "allow"),
        ("kani", "request_commitment", "ask"),
        ("dev", "request_send_on_behalf", "ask"),
        ("sahil", "request_personal", "deny"),
        ("sahil", "other", "ask"),
        ("stranger", "ask_status", "deny"),
    ],
)
def test_rahul_policy(asker, intent, expected):
    assert evaluate(RULES, TEAM, asker, intent).outcome == expected


def test_commitments_never_allowed_for_anyone_on_team():
    for asker in TEAM:
        assert evaluate(RULES, TEAM, asker, "request_commitment").outcome != "allow"


def test_slot_defaults_ask_before_writing_for_others():
    rules = load_rules("slot-default")
    assert evaluate(rules, TEAM, "dev", "request_write").outcome == "ask"
    assert evaluate(rules, TEAM, "dev", "ask_status").outcome == "allow"
