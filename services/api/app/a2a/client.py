"""Signed standard A2A JSON-RPC transport (a2a-sdk fallback documented in Track A)."""

from hashlib import sha256
from datetime import datetime, timezone
from urllib.parse import urlparse
import json, hmac, secrets
import httpx
from a2a.client import A2AClient
from a2a.types import SendMessageRequest, MessageSendParams, Message, TextPart
from app.util import new_id

FIELDS = (
    "workspaceId",
    "ownerMember",
    "askerMember",
    "askerAlter",
    "traceId",
    "timestamp",
    "nonce",
    "depth",
    "questionHash",
)


def signature(secret, metadata):
    data = {key: metadata[key] for key in FIELDS}
    return hmac.new(
        secret.encode(),
        json.dumps(data, sort_keys=True, separators=(",", ":")).encode(),
        sha256,
    ).hexdigest()


def signed(secret, wid, asker, question, trace, target):
    metadata = {
        "workspaceId": wid,
        "ownerMember": target,
        "askerMember": asker,
        "askerAlter": asker,
        "traceId": trace,
        "timestamp": datetime.now(timezone.utc).timestamp(),
        "nonce": secrets.token_hex(24),
        "depth": 1,
        "questionHash": sha256(question.encode()).hexdigest(),
    }
    return {**metadata, "signature": signature(secret, metadata)}


class A2ATransport:
    def __init__(self, engine, transport=None):
        self.engine, self.transport = engine, transport

    async def ask(self, ctx, target, question, trace_id):
        metadata = signed(
            self.engine.hmac_secret,
            ctx.workspace_id,
            ctx.member_id,
            question,
            trace_id,
            target,
        )
        url = f"{self.engine.settings.service_url.rstrip('/')}/a2a/{ctx.workspace_id}/{target}"
        # Loopback test/dev requests are local. Internet requests retain the inherited proxy and CA.
        trust = urlparse(url).hostname not in ("localhost", "127.0.0.1", "::1")
        async with httpx.AsyncClient(
            timeout=30, trust_env=trust, transport=self.transport
        ) as http:
            client = A2AClient(http, url=url)
            request = SendMessageRequest(
                id=new_id(),
                params=MessageSendParams(
                    message=Message(
                        messageId=new_id(),
                        role="user",
                        parts=[TextPart(text=question)],
                        metadata=metadata,
                    )
                ),
            )
            response = await client.send_message(request)
            payload = response.model_dump(mode="json", by_alias=True)
            if "error" in payload:
                raise RuntimeError("The remote Alter could not process the request.")
            for part in payload["result"]["parts"]:
                if part.get("kind") == "data" and "answer" in part.get("data", {}):
                    return part["data"]["answer"]
        raise RuntimeError("The remote Alter returned no answer.")
