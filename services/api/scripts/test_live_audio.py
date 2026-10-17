"""Opt-in real Vertex native-audio smoke check, using only a synthetic greeting."""

import argparse
import asyncio
import os

from google import genai


async def check(args):
    client = genai.Client(
        vertexai=True,
        project=args.project,
        location=args.location,
        http_options={"timeout": 30000},
    )
    config = {
        "response_modalities": ["AUDIO"],
        "input_audio_transcription": {},
        "output_audio_transcription": {},
        "system_instruction": "This is a synthetic connectivity check. Say only: Hello from Alter.",
    }
    if args.with_tools:
        config["system_instruction"] = (
            "This is a synthetic connectivity check. First call alter_chat with message 'hello'. "
            "After receiving its result, speak that confirmed result in one sentence."
        )
        config["tools"] = [
            {
                "function_declarations": [
                    {
                        "name": "alter_chat",
                        "description": "Synthetic check only; returns a fixed greeting without accessing any apps.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {"message": {"type": "STRING"}},
                            "required": ["message"],
                        },
                    }
                ]
            }
        ]
    try:
        async with client.aio.live.connect(
            model=args.model,
            config=config,
        ) as session:
            await session.send_client_content(
                turns=[{"role": "user", "parts": [{"text": "Please say hello."}]}],
                turn_complete=True,
            )
            audio_bytes = 0
            tool_calls = 0
            complete = False
            async with asyncio.timeout(45):
                while not complete:
                    async for message in session.receive():
                        if message.tool_call:
                            responses = []
                            for call in message.tool_call.function_calls:
                                if call.name != "alter_chat" or not args.with_tools:
                                    raise RuntimeError(
                                        "Unexpected synthetic tool call."
                                    )
                                tool_calls += 1
                                responses.append(
                                    {
                                        "id": call.id,
                                        "name": call.name,
                                        "response": {
                                            "result": {"text": "Hello from Alter."}
                                        },
                                    }
                                )
                            if tool_calls > 3:
                                raise RuntimeError(
                                    "Synthetic tool call did not finish."
                                )
                            await session.send_tool_response(
                                function_responses=responses
                            )
                        content = message.server_content
                        for part in (
                            content.model_turn.parts
                            if content and content.model_turn
                            else []
                        ):
                            if part.inline_data and part.inline_data.data:
                                audio_bytes += len(part.inline_data.data)
                        if content and content.turn_complete and audio_bytes:
                            complete = True
            if audio_bytes == 0:
                raise RuntimeError("The provider returned no native audio.")
            if args.with_tools and not tool_calls:
                raise RuntimeError(
                    "The provider did not exercise the synthetic tool round trip."
                )
            print(
                f"Real Vertex Live passed: {audio_bytes} audio bytes received, {tool_calls} tool calls; no workspace data sent."
            )
    finally:
        await client.aio.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--with-tools",
        action="store_true",
        help="Also exercise the tool round trip used by the app, with a fixed synthetic result.",
    )
    parser.add_argument(
        "--project",
        default=os.getenv("GCP_PROJECT"),
        required=not os.getenv("GCP_PROJECT"),
    )
    parser.add_argument(
        "--model",
        required=True,
        help="An exact available native-audio model ID; text model access is insufficient.",
    )
    parser.add_argument(
        "--location",
        required=True,
        help="A Vertex location supporting that Live model.",
    )
    asyncio.run(check(parser.parse_args()))
