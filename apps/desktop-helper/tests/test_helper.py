"""The helper's checks, against a fake desktop and a real local HTTP server."""

import base64
import http.client
import json
import socket
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import alter_helper as h  # noqa: E402

ORIGIN = "https://myalter.web.app"
KEYS = {"ctrl", "a", "s", "v", "enter", "backspace", "win", "command", "option", "alt", "shift", "esc", "space", "pageup"}


class FakeDesktop:
    failsafe = type("FailSafe", (Exception,), {})

    def __init__(self, width=1920, height=1080):
        self.width, self.height = width, height
        self.calls = []
        self.keys = KEYS
        self.trip = False
        self.corner = False

    def in_corner(self):
        return self.corner

    def size(self):
        return self.width, self.height

    def screenshot(self):
        from PIL import Image

        return Image.new("RGB", (self.width, self.height), "white")

    def record(self, *call):
        if self.trip:
            raise self.failsafe()
        self.calls.append(call)

    def move(self, x, y):
        self.record("move", x, y)

    def click(self, x, y, button="left", clicks=1):
        self.record("click", x, y, button, clicks)

    def drag(self, x, y, to_x, to_y):
        self.record("drag", x, y, to_x, to_y)

    def scroll(self, x, y, dx, dy):
        self.record("scroll", x, y, dx, dy)

    def press(self, keys):
        self.record("press", *keys)

    def write(self, text):
        self.record("write", text)

    def wait(self, seconds):
        self.record("wait", seconds)


class FakeConfirmer:
    available = True

    def __init__(self, answer=True):
        self.answer, self.asked = answer, []

    def ask(self, title, lines):
        self.asked.append((title, lines))
        return self.answer


@pytest.fixture
def helper(tmp_path):
    return h.Helper(FakeDesktop(), h.Pairings(tmp_path / "paired.json"), FakeConfirmer(), announce=lambda *_: None)


def test_actions_are_validated_and_keys_normalized():
    actions = h.parse_actions(
        [
            {"action": "click", "x": 0, "y": 999},
            {"action": "type", "text": "hello", "x": 500, "y": 500, "clear": True, "enter": True},
            {"action": "key", "keys": "Control+S"},
            {"action": "scroll", "direction": "down"},
            {"action": "drag", "x": 1, "y": 2, "to_x": 3, "to_y": 4},
        ],
        KEYS,
    )
    assert actions[2]["keys"] == ["ctrl", "s"] and actions[3]["amount"] == 5
    assert h.normalize_keys(["Meta", "space"], KEYS, mac=True) == ["command", "space"]
    assert h.normalize_keys("meta", KEYS, mac=False) == ["win"]
    assert h.normalize_keys(["Alt"], KEYS, mac=True) == ["option"]
    for bad in (
        [{"action": "click", "x": 1000, "y": 1}],
        [{"action": "click", "x": 5.5, "y": 1}],
        [{"action": "click", "x": True, "y": 1}],
        [{"action": "launch_missiles"}],
        [{"action": "key", "keys": ["ctrl", "f13"]}],
        [{"action": "type", "text": "x" * 2001}],
        [{"action": "wait", "seconds": 60}],
        [{"action": "move", "x": 1, "y": 1}] * 11,
        [],
    ):
        with pytest.raises(h.HelperError):
            h.parse_actions(bad, KEYS)


def test_grid_maps_onto_the_whole_screen_and_actions_run_in_order(helper):
    assert helper.pixel(0, 0) == (0, 0)
    assert helper.pixel(999, 999) == (1919, 1079)
    helper.act(
        [
            {"action": "type", "text": "hi", "x": 500, "y": 500, "clear": True, "enter": True},
            {"action": "double_click", "x": 999, "y": 0},
            {"action": "scroll", "direction": "up", "amount": 2},
        ]
    )
    assert helper.desktop.calls == [
        ("click", 960, 540, "left", 1),
        ("press", "ctrl", "a"),
        ("press", "backspace"),
        ("write", "hi"),
        ("press", "enter"),
        ("click", 1919, 0, "left", 2),
        ("scroll", None, None, 0, 2),
    ]


def test_pairing_codes_are_single_use_and_limited(helper, tmp_path):
    with pytest.raises(h.HelperError) as wrong:
        helper.pair(ORIGIN, "000000" if helper.code != "000000" else "111111")
    assert wrong.value.code == "WRONG_CODE"
    code = helper.code
    token = helper.pair(ORIGIN, code[:3] + " " + code[3:])["token"]
    assert helper.pairings.valid(ORIGIN, token)
    assert not helper.pairings.valid("http://localhost:5173", token)
    assert helper.code != code
    with pytest.raises(h.HelperError):
        helper.pair(ORIGIN, code)
    # The page stays paired after the helper restarts.
    assert h.Pairings(tmp_path / "paired.json").valid(ORIGIN, token)
    helper.new_code()
    for _ in range(5):
        with pytest.raises(h.HelperError):
            helper.pair(ORIGIN, "999999" if helper.code != "999999" else "888888")
    last = helper.code
    with pytest.raises(h.HelperError) as expired:
        helper.pair(ORIGIN, last)
    assert expired.value.code == "CODE_EXPIRED" and helper.code != last


def test_declined_and_corner_stops_never_touch_the_desktop_again(helper):
    helper.confirmer.answer = False
    with pytest.raises(h.HelperError) as declined:
        helper.act([{"action": "click", "x": 1, "y": 1}], confirm=True, summary="Click Save")
    assert declined.value.code == "DECLINED" and helper.desktop.calls == []
    assert helper.confirmer.asked == [("Click Save", ["Click at 1, 1"])]
    helper.desktop.trip = True
    with pytest.raises(h.HelperError) as stopped:
        helper.act([{"action": "click", "x": 1, "y": 1}])
    assert stopped.value.status == 423 and helper.paused
    helper.desktop.trip = False
    with pytest.raises(h.HelperError):
        helper.act([{"action": "click", "x": 1, "y": 1}])
    # Resuming with the mouse still in the corner would trip the stop again at once.
    helper.desktop.corner = True
    with pytest.raises(h.HelperError) as corner:
        helper.resume()
    assert corner.value.code == "IN_CORNER" and helper.paused
    helper.desktop.corner = False
    helper.resume()
    helper.act([{"action": "click", "x": 1, "y": 1}])
    assert len(helper.desktop.calls) == 1


def test_rate_limit(helper):
    helper.act([{"action": "move", "x": 1, "y": 1}] * 10)
    helper.act([{"action": "move", "x": 1, "y": 1}] * 10)
    helper.act([{"action": "move", "x": 1, "y": 1}] * 10)
    with pytest.raises(h.HelperError) as fast:
        helper.act([{"action": "move", "x": 1, "y": 1}])
    assert fast.value.status == 429


@pytest.fixture
def server(helper):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    running = h.serve(helper, port)
    yield helper, port
    running.shutdown()


def call(port, method, path, body=None, origin=ORIGIN, token=None, host=None, headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    sent = {"Host": host or f"127.0.0.1:{port}", **(headers or {})}
    if origin:
        sent["Origin"] = origin
    if token:
        sent["Authorization"] = "Bearer " + token
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        sent.setdefault("Content-Type", "application/json")
    connection.request(method, path, data, sent)
    response = connection.getresponse()
    raw = response.read()
    return response.status, dict(response.getheaders()), json.loads(raw) if raw else None


def test_http_guards_host_origin_and_pairing(server):
    helper, port = server
    assert call(port, "GET", "/v1/status", host="evil.example:80")[0] == 403
    assert call(port, "GET", "/v1/status", origin="https://evil.example")[0] == 403
    status, headers, body = call(port, "OPTIONS", "/v1/act", headers={"Access-Control-Request-Private-Network": "true"})
    assert status == 204 and headers["Access-Control-Allow-Origin"] == ORIGIN
    assert headers["Access-Control-Allow-Private-Network"] == "true"
    assert call(port, "GET", "/v1/status")[2]["paired"] is False
    assert call(port, "POST", "/v1/screenshot", {})[0] == 401
    assert call(port, "POST", "/v1/pair", {"code": helper.code}, headers={"Content-Type": "text/plain"})[0] == 415
    token = call(port, "POST", "/v1/pair", {"code": helper.code})[2]["token"]
    status, headers, body = call(port, "GET", "/v1/status", token=token)
    assert body["paired"] and body["screen"] == {"width": 1920, "height": 1080}
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    # A token belongs to the page that paired.
    assert call(port, "POST", "/v1/screenshot", {}, origin="http://localhost:5173", token=token)[0] == 401


def test_http_screenshot_act_and_stop(server):
    pytest.importorskip("PIL")
    helper, port = server
    token = call(port, "POST", "/v1/pair", {"code": helper.code})[2]["token"]
    status, _, shot = call(port, "POST", "/v1/screenshot", {}, token=token)
    assert status == 200 and shot["mimeType"] == "image/jpeg" and shot["width"] == 1920
    assert base64.b64decode(shot["image"])[:3] == b"\xff\xd8\xff"
    status, _, result = call(port, "POST", "/v1/act", {"actions": [{"action": "click", "x": 500, "y": 500}]}, token=token)
    assert (status, result) == (200, {"ok": True, "done": 1})
    status, _, error = call(port, "POST", "/v1/act", {"actions": [{"action": "nope"}]}, token=token)
    assert status == 422 and error["error"]["code"] == "INVALID_ACTION"
    helper.desktop.trip = True
    assert call(port, "POST", "/v1/act", {"actions": [{"action": "click", "x": 1, "y": 1}]}, token=token)[0] == 423
    assert call(port, "GET", "/v1/status", token=token)[2]["paused"] is True
    assert call(port, "POST", "/v1/resume", {}, token=token)[0] == 200
    assert call(port, "POST", "/v1/unpair", {}, token=token)[0] == 200
    assert call(port, "POST", "/v1/screenshot", {}, token=token)[0] == 401
