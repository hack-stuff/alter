from hashlib import sha256
import hmac
from a2a.types import (
    AgentCard,
    AgentCapabilities,
    AgentSkill,
    SendMessageRequest,
    SendMessageSuccessResponse,
    Message,
    DataPart,
    TextPart,
)
from app.a2a.client import signature
from app.errors import error
from app.util import identifier, new_id, iso, now
from app.auth import Caller, MemberContext


def agent_card(engine, wid, mid):
    return AgentCard(
        name="Alter AI representative",
        description="A bounded, read-only representative. Requests require signed service metadata.",
        url=f"{engine.settings.service_url.rstrip('/')}/a2a/{wid}/{mid}",
        version="1.0.0",
        capabilities=AgentCapabilities(streaming=False),
        defaultInputModes=["text/plain"],
        defaultOutputModes=["application/json", "text/plain"],
        skills=[
            AgentSkill(
                id="answer_question",
                name="Answer a work question",
                description="Answer with approved sources and sharing rules.",
                tags=["knowledge"],
            ),
            AgentSkill(
                id="request_commitment",
                name="Request an owner decision",
                description="Escalate commitments to the owner.",
                tags=["approval"],
            ),
        ],
    ).model_dump(mode="json", by_alias=True)


async def receive(engine, wid, mid, body):
    try:
        request = SendMessageRequest.model_validate(body)
        message = request.params.message
        parts = [part.root for part in message.parts]
        if (
            message.role != "user"
            or len(parts) != 1
            or not isinstance(parts[0], TextPart)
        ):
            raise ValueError()
        question = parts[0].text
        if not 0 < len(question) <= 10000:
            raise ValueError()
        metadata = message.metadata or {}
        if (
            metadata["workspaceId"] != wid
            or metadata["ownerMember"] != mid
            or metadata["askerMember"] != metadata["askerAlter"]
            or metadata["depth"] != 1
        ):
            raise ValueError()
        if abs(now().timestamp() - float(metadata["timestamp"])) > 60:
            raise ValueError()
        if sha256(question.encode()).hexdigest() != metadata["questionHash"]:
            raise ValueError()
        if not hmac.compare_digest(
            signature(engine.hmac_secret, metadata), metadata["signature"]
        ):
            raise ValueError()
        asker = identifier(metadata["askerMember"])
        nonce = identifier(metadata["nonce"])
        trace = identifier(metadata["traceId"])
    except Exception:
        raise error(
            401, "INVALID_A2A_SIGNATURE", "Signed A2A identity is required."
        ) from None

    def consume(tx):
        key = "a2aNonces/" + sha256((wid + ":" + nonce).encode()).hexdigest()
        if tx.get(key):
            raise error(409, "A2A_REPLAY", "This A2A request was already received.")
        from datetime import timedelta

        tx.set(key, {"expiresAt": (now() + timedelta(minutes=5)).isoformat()})
        member = tx.get(f"workspaces/{wid}/members/{asker}")
        workspace = tx.get(f"workspaces/{wid}")
        if (
            not member
            or not workspace
            or workspace["expiresAt"] <= iso()
            or workspace.get("state") == "deleting"
        ):
            raise error(403, "FORBIDDEN", "A2A membership is not valid.")

    engine.store.atomic(consume)
    answer = await engine.ask_core(
        MemberContext("service", wid, asker, Caller("service")), mid, question, trace
    )
    response = SendMessageSuccessResponse(
        id=request.id,
        result=Message(
            messageId=new_id(),
            role="agent",
            parts=[TextPart(text=answer["answer"]), DataPart(data={"answer": answer})],
        ),
    )
    return response.model_dump(mode="json", by_alias=True)
