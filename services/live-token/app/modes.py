"""Locked server-side voice modes. No voice mode has an approval/write tool."""
VOICE_RULES = (
    "Never invent facts, dates or commitments: speak only what the tool returns, in one or two sentences. "
    'Say a short filler like "On it" before slow tool calls. You can never approve anything; approval is the on-screen button.'
)
MODES = {
    "chat": ("You are the user's Alter (AI), their personal work representative. Pass every request to alter_chat. ", "alter_chat", {"message": "Send the user's request to their Alter."}),
    "revise": ("You are the user's Alter (AI). Revise the open proposal with revise_approval; never approve it. ", "revise_approval", {"approvalId": "Open proposal ID", "instruction": "Edit requested by the owner"}),
    "reply": ("You are the user's Alter (AI). Read the pending question and record the owner's answer with respond_escalation. Never claim an unsent draft was sent. ", "respond_escalation", {"escalationId": "Open question ID", "text": "Owner's answer"}),
    "huddle": ("You are another teammate's Alter (AI). Stay silent unless a question concerns their work. Always call ask_alter before answering. ", "ask_alter", {"memberId": "Teammate ID", "question": "Work question"}),
}

# The owner's own Alter and a represented teammate's Alter (huddle) must not sound alike.
VOICES = {"huddle": "Aoede"}


def live_config(mode: str, persona: str | None = None) -> dict:
    instruction, name, arguments = MODES[mode]
    if persona:
        instruction += f"Your teammate ID is {persona}. Only use that ID in ask_alter. "
    return {
        "response_modalities": ["AUDIO"],
        "speech_config": {"voice_config": {"prebuilt_voice_config": {"voice_name": VOICES.get(mode, "Puck")}}},
        "input_audio_transcription": {},
        "output_audio_transcription": {},
        "system_instruction": instruction + VOICE_RULES,
        "tools": [{"function_declarations": [{"name": name, "description": "Delegate to the authenticated Alter API; do not make decisions yourself.", "parameters": {"type": "OBJECT", "properties": {key: {"type": "STRING", "description": description} for key, description in arguments.items()}, "required": list(arguments)}}]}],
    }
