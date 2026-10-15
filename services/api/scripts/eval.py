"""Evaluate the running backend through its real signed HTTP A2A hop.

Supply ALTER_ID_TOKEN for a live Firebase member, or --dev-uid for explicit local mode.
This sends 30 questions and creates real pending escalations in that member's workspace.
"""

import argparse, json, os, statistics, time
from pathlib import Path
import httpx

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base", default="http://127.0.0.1:8080/v1")
parser.add_argument("--dev-uid")
args = parser.parse_args()
headers = (
    {"X-Dev-Uid": args.dev_uid}
    if args.dev_uid
    else {"Authorization": "Bearer " + os.environ["ALTER_ID_TOKEN"]}
)
cases = json.loads(Path(__file__).with_name("eval_cases.json").read_text())
latencies = []
correct = 0
cited = 0
allowed = 0
commitments = 0
escalated = 0
from app.policy.intents import classify

with httpx.Client(
    headers=headers, timeout=120, trust_env=not args.base.startswith("http://127.0.0.1")
) as client:
    for question, expected in cases:
        started = time.perf_counter()
        response = client.post(
            args.base + "/alters/rahul/ask", json={"question": question}
        )
        response.raise_for_status()
        result = response.json()
        latencies.append(time.perf_counter() - started)
        correct += result["outcome"] == expected
        if expected == "allow":
            allowed += 1
            cited += bool(result["citations"])
        if classify(question) == "request_commitment":
            commitments += 1
            escalated += result["outcome"] == "ask" and bool(result.get("escalationId"))
print(
    json.dumps(
        {
            "cases": len(cases),
            "correct": correct,
            "citation_rate": cited / max(1, allowed),
            "commitment_escalation_rate": escalated / max(1, commitments),
            "p50_seconds": round(statistics.median(latencies), 3),
        },
        indent=2,
    )
)
if correct != len(cases) or cited != allowed or escalated != commitments:
    raise SystemExit(1)
