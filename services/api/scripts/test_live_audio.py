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
    try:
        async with client.aio.live.connect(
            model=args.model,
            config={
                "response_modalities": ["AUDIO"],
                "output_audio_transcription": {},
                "system_instruction": "This is a synthetic connectivity check. Say only: Hello from Alter.",
            },
        ) as session:
            await session.send_client_content(
                turns=[{"role": "user", "parts": [{"text": "Please say hello."}]}],
                turn_complete=True,
            )
            audio_bytes = 0
            async with asyncio.timeout(45):
                async for message in session.receive():
                    for part in (
                        message.server_content.model_turn.parts
                        if message.server_content and message.server_content.model_turn
                        else []
                    ):
                        if part.inline_data and part.inline_data.data:
                            audio_bytes += len(part.inline_data.data)
            if audio_bytes == 0:
                raise RuntimeError("The provider returned no native audio.")
            print(
                f"Real Vertex Live passed: {audio_bytes} audio bytes received; no workspace data sent."
            )
    finally:
        await client.aio.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
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
