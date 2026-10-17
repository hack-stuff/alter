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
    elif code in (408, 504) or isinstance(exc, TimeoutError):
        category = "provider_deadline_exceeded"
    elif code in (500, 502, 503):
        category = "provider_unavailable"
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
        "modelFast": settings.model_fast,
        "modelPro": settings.model_pro,
        "frames": [
            {
                "file": Path(frame.filename).name,
                "line": frame.lineno,
                "function": frame.name,
            }
            for frame in traceback.extract_tb(exc.__traceback__)[-10:]
        ],
    }
    # Follow explicit causes only: __context__ can hold an earlier, handled
    # failure, and the bound guards against cyclic chains.
    failed = exc
    for _ in range(5):
        if failed is None or hasattr(failed, "alter_model"):
            break
        failed = failed.__cause__
    if hasattr(failed, "alter_model"):
        payload["failedModel"] = failed.alter_model
    if isinstance(code, int):
        payload["providerCode"] = code
    if isinstance(status, str) and re.fullmatch(r"[A-Z_]{1,64}", status):
        payload["providerStatus"] = status
    print(json.dumps(payload), file=sys.stderr, flush=True)
    return reference


def report_live_failure(exc, settings, stage):
    """Log metadata only; provider reasons can contain credentials and transcripts."""
    from google.auth.exceptions import DefaultCredentialsError, RefreshError

    close_code = getattr(getattr(exc, "rcvd", None), "code", None)
    code = getattr(exc, "code", None) if close_code is None else None
    message = str(exc).lower()
    category = "unclassified"
    detail = "Voice stopped unexpectedly. Retry or use text."
    if isinstance(exc, (DefaultCredentialsError, RefreshError)):
        category = "credentials_unavailable"
        detail = "The API cannot authenticate to Google Cloud. Refresh its application default credentials and restart it."
    elif code == 401:
        category = "credentials_unavailable"
        detail = "Google Cloud rejected the API credentials. Refresh its application default credentials and restart it."
    elif code == 403 or (
        close_code == 1008
        and any(word in message for word in ("permission", "denied", "unauthenticated"))
    ):
        category = "permission_denied"
        detail = "The API identity does not have access to Vertex Live in the configured project."
    elif code == 404 or (
        close_code == 1008
        and any(
            word in message for word in ("not found", "not supported", "not available")
        )
    ):
        category = "model_or_endpoint_not_found"
        detail = "The Live model is unavailable at the configured Vertex location. Check LIVE_MODEL and LIVE_LOCATION."
    elif code == 429 or close_code == 1013 or "resource_exhausted" in message:
        category = "quota_or_capacity"
        detail = (
            "Vertex Live is at its quota or capacity limit. Wait briefly and retry."
        )
    elif isinstance(exc, TimeoutError) or code in (408, 504):
        category = "provider_deadline_exceeded"
        detail = "The voice connection timed out. Retry or use text."
    elif code in (500, 502, 503) or close_code == 1011:
        category = "provider_unavailable"
        detail = "Vertex Live is temporarily unavailable. Retry or use text."
    elif code == 400 or close_code == 1007:
        category = "live_configuration_or_protocol"
        detail = "Vertex Live rejected the session configuration or audio messages. Check the API diagnostic reference."
    elif isinstance(exc, ValueError):
        known_errors = {
            "Another voice session is still active. End it before reconnecting.": "session_already_active",
            "The workspace voice budget is used for now.": "workspace_budget_exhausted",
            "Expired voice ticket": "ticket_expired",
            "Membership changed": "membership_changed",
        }
        if str(exc) in known_errors:
            category = known_errors[str(exc)]
            detail = {
                "ticket_expired": "The voice connection ticket expired. Reconnect to voice.",
                "membership_changed": "Your membership changed. Reload before reconnecting to voice.",
            }.get(category, str(exc))
    reference = uuid4().hex[:12]
    payload = {
        "severity": "ERROR",
        "event": "live_session_failed",
        "reference": reference,
        "stage": stage,
        "category": category,
        "exceptionType": type(exc).__name__,
        "region": settings.region,
        "vertexLocation": settings.live_location or settings.model_location,
        "model": settings.live_model,
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
    if isinstance(close_code, int):
        payload["providerCloseCode"] = close_code
    print(json.dumps(payload), file=sys.stderr, flush=True)
    return {"error": f"{detail} Reference: {reference}", "reference": reference}
