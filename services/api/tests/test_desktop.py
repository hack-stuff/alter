"""Desktop tasks: owner-only sessions, honest step results, and steps the helper accepts."""

from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
import base64
import sys
import pytest
from app.auth import Caller
from app.desktop import Desktop, VertexDesktopPlanner, helper_actions

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "apps/desktop-helper"))
import alter_helper  # noqa: E402

JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\0" * 300).decode()
CHANGED = base64.b64encode(b"\xff\xd8\xff\xe1" + b"\1" * 300).decode()
HELPER_KEYS = {"ctrl", "shift", "alt", "option", "win", "command", "space", "enter", "esc", "tab", "a", "c", "s", "v", "f4"}


def start(client, headers, goal='Open the editor and type "hello"', platform="windows"):
    response = client.post("/v1/desktop/sessions", headers=headers, json={"goal": goal, "platform": platform})
    assert response.status_code == 200, response.text
    return response.json()["sessionId"]


def step(client, headers, sid, results=(), screenshot=JPEG, mime="image/jpeg"):
    return client.post(
        f"/v1/desktop/sessions/{sid}/step",
        headers=headers,
        json={"screenshot": screenshot, "mimeType": mime, "results": list(results)},
    )


def test_local_loop_types_reports_and_ends(team):
    client, engine, headers, _ = team
    sid = start(client, headers)
    first = step(client, headers, sid).json()
    assert first["done"] is False and first["step"] == 1
    [planned] = first["steps"]
    assert planned["label"] == "Type “hello”" and planned["confirm"] is False
    assert planned["actions"] == [{"action": "type", "x": 500, "y": 500, "text": "hello", "enter": False, "clear": True}]
    assert step(client, headers, sid).status_code == 422  # Every step needs its result.
    assert step(client, headers, sid, [{"id": "other", "ok": True}]).status_code == 422
    done = step(client, headers, sid, [{"id": planned["id"], "ok": True}]).json()
    assert done == {"done": True, "message": "Done — I typed it.", "steps": [], "step": 2}
    ended = step(client, headers, sid)
    assert ended.status_code == 409 and ended.json()["detail"]["error"]["code"] == "DESKTOP_TASK_ENDED"


def test_sessions_belong_to_their_owner_and_can_be_stopped(team):
    client, engine, headers, joined = team
    sid = start(client, headers)
    ctx = engine.auth.member(Caller("alice"))
    with pytest.raises(Exception) as other:
        engine.desktop.load(replace(ctx, member_id="kani"), sid)
    assert getattr(other.value, "status_code", None) == 404
    assert client.post(f"/v1/desktop/sessions/{sid}/stop", headers=headers).json() == {"ok": True}
    assert step(client, headers, sid).status_code == 409
    assert client.post("/v1/desktop/sessions/bad id/stop", headers=headers).status_code == 422


def test_screenshots_are_checked_and_may_exceed_the_usual_body_limit(team):
    client, engine, headers, _ = team
    sid = start(client, headers)
    assert step(client, headers, sid, screenshot="not base64!" * 20).status_code == 422
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * 300).decode()
    assert step(client, headers, sid, screenshot=png).status_code == 422  # Labelled JPEG, is PNG.
    assert step(client, headers, sid, screenshot=png, mime="image/png").status_code == 200
    sid = start(client, headers)
    large = base64.b64encode(b"\xff\xd8\xff" + b"\0" * 300_000).decode()
    assert step(client, headers, sid, screenshot=large).status_code == 200
    assert client.post("/v1/chat", headers=headers, json={"message": "x" * 70000}).status_code == 413


@pytest.mark.parametrize("platform", ["windows", "macos", "linux"])
def test_every_mapped_step_is_one_the_helper_accepts(platform):
    calls = [
        ("click_at", {"x": 10, "y": 20}),
        ("double_click_at", {"x": 10.6, "y": 1200}),
        ("right_click_at", {"x": 0, "y": 0}),
        ("hover_at", {"x": 999, "y": 999}),
        ("type_text_at", {"x": 5, "y": 5, "text": "Quarterly notes", "press_enter": False}),
        ("key_combination", {"keys": "Control+S"}),
        ("key_combination", {"keys": "Alt + F4"}),
        ("scroll_document", {"direction": "down"}),
        ("scroll_at", {"x": 400, "y": 400, "direction": "up", "magnitude": 300}),
        ("drag_and_drop", {"x": 1, "y": 2, "destination_x": 3, "destination_y": 4}),
        ("wait_5_seconds", {}),
        ("open_app", {"name": "Notepad"}),
    ]
    for name, args in calls:
        actions = helper_actions(name, args, platform)
        if name == "open_app" and platform == "linux":
            assert actions == []
            continue
        assert actions, name
        alter_helper.parse_actions(actions, HELPER_KEYS, mac=platform == "macos")
    assert helper_actions("double_click_at", {"x": 10.6, "y": 1200}, "windows") == [{"action": "double_click", "x": 11, "y": 999}]
    assert helper_actions("scroll_at", {"x": 1, "y": 1, "direction": "up", "magnitude": 300}, "windows")[0]["amount"] == 3
    assert helper_actions("type_text_at", {"x": 1, "y": 1, "text": "hi"}, "windows")[0] | {"text": ""} == {
        "action": "type", "x": 1, "y": 1, "text": "", "enter": True, "clear": True
    }
    assert helper_actions("navigate", {"url": "https://example.com"}, "windows") == []


class FakeModels:
    def __init__(self, replies):
        self.replies, self.requests = list(replies), []

    def generate_content(self, **request):
        self.requests.append(request)
        return SimpleNamespace(candidates=[SimpleNamespace(content=self.replies.pop(0))])


def test_gemini_steps_need_confirmation_when_flagged_and_keep_only_the_newest_screenshot(team):
    from google.genai import types

    client, engine, headers, joined = team
    risky = types.Content(
        role="model",
        parts=[
            types.Part(text="I'll press Send."),
            types.Part(
                function_call=types.FunctionCall(
                    id="c1",
                    name="click_at",
                    args={"x": 700, "y": 900, "safety_decision": {"decision": "require_confirmation", "explanation": "This sends an email."}},
                ),
                thought_signature=b"signature",
            ),
        ],
    )
    finished = types.Content(role="model", parts=[types.Part(text="The email is sent.")])
    models = FakeModels([risky, finished])
    engine.model_client = SimpleNamespace(models=models)
    engine.settings = replace(engine.settings, ai_backend="vertex", desktop_model="computer-model")
    engine.desktop = Desktop(engine)
    assert isinstance(engine.desktop.planner, VertexDesktopPlanner)
    sid = start(client, headers, goal="Send the draft to Kani")
    first = step(client, headers, sid).json()
    [planned] = first["steps"]
    assert first["message"] == "I'll press Send."
    assert planned["confirm"] is True and planned["reason"] == "This sends an email."
    assert planned["actions"] == [{"action": "click", "x": 700, "y": 900}]
    request = models.requests[0]
    assert request["model"] == "computer-model"
    sent = request["contents"][-1].parts
    assert sent[0].text == "Goal: Send the draft to Kani" and sent[1].inline_data.mime_type == "image/jpeg"
    config = request["config"]
    assert config.tools[0].computer_use.excluded_predefined_functions[:2] == ["open_web_browser", "navigate"]
    assert {f.name for f in config.tools[1].function_declarations} == {"double_click_at", "right_click_at", "open_app"}
    assert "Alice's Alter" in config.system_instruction
    # The owner did the step without confirming it: refused.
    unconfirmed = step(client, headers, sid, [{"id": planned["id"], "ok": True}])
    assert unconfirmed.json()["detail"]["error"]["code"] == "STEP_NOT_CONFIRMED"
    done = step(client, headers, sid, [{"id": planned["id"], "ok": True, "acknowledged": True}], screenshot=CHANGED).json()
    assert done["done"] is True and done["message"] == "The email is sent."
    history = models.requests[1]["contents"]
    response = history[-1].parts[0].function_response
    assert (response.id, response.name) == ("c1", "click_at")
    assert response.response == {"url": "desktop", "safety_acknowledgement": "true"}
    assert response.parts[0].inline_data.data.startswith(b"\xff\xd8\xff")
    # Earlier turns are replayed without their screenshots, signatures intact.
    assert all(not part.inline_data for turn in history[:-1] for part in turn.parts)
    assert history[1].parts[1].thought_signature == b"signature"
    session = engine.store.get(f"workspaces/{joined['workspaceId']}/desktop/{sid}")
    assert session["state"] == "done" and "/9j/" not in str(session["turns"])


def test_an_unchanged_screen_is_reported_and_then_ends_the_task(team):
    from google.genai import types

    client, engine, headers, joined = team

    def again():
        return types.Content(role="model", parts=[types.Part(function_call=types.FunctionCall(id="c", name="click_at", args={"x": 1, "y": 1}))])

    models = FakeModels([again() for _ in range(5)])
    engine.model_client = SimpleNamespace(models=models)
    engine.settings = replace(engine.settings, ai_backend="vertex", desktop_model="computer-model")
    engine.desktop = Desktop(engine)
    sid = start(client, headers, goal="Click the button")
    planned = step(client, headers, sid).json()["steps"][0]
    for attempt in range(2):
        planned = step(client, headers, sid, [{"id": planned["id"], "ok": True}]).json()["steps"][0]
        note = models.requests[-1]["contents"][-1].parts[0].function_response.response["note"]
        assert note.startswith("The screen looked exactly the same")
    stuck = step(client, headers, sid, [{"id": planned["id"], "ok": True}]).json()
    assert stuck["done"] is True and stuck["message"].startswith("I stopped because the screen didn't change")
    assert len(models.requests) == 3
    sid = start(client, headers, goal="Click the button")
    planned = step(client, headers, sid).json()["steps"][0]
    step(client, headers, sid, [{"id": planned["id"], "ok": True}], screenshot=CHANGED)
    assert "note" not in models.requests[-1]["contents"][-1].parts[0].function_response.response
