import hashlib
from datetime import timedelta
from app.util import now
from app.errors import error


def take(tx, scope, limit, window=3600):
    instant = now()
    key = hashlib.sha256(scope.encode()).hexdigest()
    path = f"rateLimits/{key}"
    state = tx.get(path) or {"used": 0, "window": int(instant.timestamp()) // window}
    period = int(instant.timestamp()) // window
    used = state["used"] if state["window"] == period else 0
    if used >= limit:
        raise error(
            429, "RATE_LIMITED", "This workspace is busy. Please try again later."
        )
    tx.set(
        path,
        {
            "used": used + 1,
            "window": period,
            "expiresAt": (instant + timedelta(seconds=window * 2)).isoformat(),
        },
    )
