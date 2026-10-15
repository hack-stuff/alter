"""Structured operational errors without exception messages, request data or locals."""

import json
from pathlib import Path
import re
import sys
import traceback
from uuid import uuid4


def report_agent_failure(exc, settings):
    reference = uuid4().hex[:12]
    code = getattr(exc, "code", None)
    status = getattr(exc, "status", None)
    # Provider messages can embed request content. Classify known failures, but
    # never emit the message itself or unrestricted provider response bodies.
    message = str(exc).lower()
    category = "unclassified"
    if code == 404:
        category = "model_or_endpoint_not_found"
    elif code == 403:
        category = "permission_denied"
    elif code == 429:
        category = "quota_or_capacity"
    elif code == 400 and any(
        word in message for word in ("function", "tool", "schema", "mime")
    ):
        category = "model_tool_or_schema_configuration"
    payload = {
        "severity": "ERROR",
        "event": "agent_request_failed",
        "message": "Alter agent request failed",
        "reference": reference,
        "exceptionType": type(exc).__name__,
        "category": category,
        "region": settings.region,
        "vertexLocation": settings.model_location,
        "model": settings.model_fast,
        "frames": [
            {
                "file": Path(frame.filename).name,
                "line": frame.lineno,
                "function": frame.name,
            }
            for frame in traceback.extract_tb(exc.__traceback__)[-10:]
        ],
    }
    if isinstance(code, int):
        payload["providerCode"] = code
    if isinstance(status, str) and re.fullmatch(r"[A-Z_]{1,64}", status):
        payload["providerStatus"] = status
    print(json.dumps(payload), file=sys.stderr, flush=True)
    return reference
