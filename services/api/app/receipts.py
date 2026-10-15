from app.util import new_id, iso


def record(
    tx,
    wid,
    actor,
    action,
    summary,
    visible_to,
    rule="owner-request",
    outcome="allow",
    sources=(),
    ok=True,
    url=None,
    approved_by=None,
    receipt_id=None,
):
    rid = receipt_id or new_id("rcp_")
    ts = iso()
    result = {"ok": ok}
    if url:
        result["externalUrl"] = url
    receipt = {
        "actor": {"alter": actor},
        "action": action,
        "sourcesUsed": [
            {"id": s.get("sourceId", s.get("id", "")), "locator": s["locator"]}
            for s in sources
        ],
        "policy": {"rule": rule, "outcome": outcome},
        "result": result,
        "ts": ts,
        "visibleTo": list(visible_to),
    }
    if approved_by:
        receipt["approval"] = {"by": approved_by, "at": ts}
    tx.set(f"workspaces/{wid}/receipts/{rid}", receipt)
    tx.set(
        f"workspaces/{wid}/activity/{new_id('act_')}",
        {
            "actor": actor,
            "kind": action,
            "summary": summary,
            "receiptId": rid,
            "visibleTo": list(visible_to),
            "ts": ts,
        },
    )
    return rid
