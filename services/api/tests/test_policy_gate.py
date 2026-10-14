import pytest

from app.policy.gate import evaluate, load_rules, load_team

RULES = load_rules("rahul")
TEAM = load_team()


@pytest.mark.parametrize(
    ("asker", "intent", "expected"),
    [
        ("arjun", "ask_rationale", "allow"),
        ("priya", "ask_status", "allow"),
        ("meera", "request_commitment", "ask"),
        ("priya", "request_send_on_behalf", "ask"),
        ("arjun", "request_personal", "deny"),
        ("arjun", "other", "ask"),
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
    assert evaluate(rules, TEAM, "priya", "request_write").outcome == "ask"
    assert evaluate(rules, TEAM, "priya", "ask_status").outcome == "allow"
