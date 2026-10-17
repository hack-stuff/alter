#!/usr/bin/env python3
"""Alter desktop helper: lets your Alter move the mouse, click and type on this computer.

Run it on the computer your Alter should use:

    python alter_helper.py

It listens on 127.0.0.1 only and prints a six-digit pairing code. Enter the code on the
Computer page of your Alter; from then on it acts only for that page. A small window can
ask you before each step, and moving the mouse into any screen corner stops it at once.
"""

import argparse
import base64
import hashlib
import hmac
import io
import json
import os
import queue
import secrets
import string
import subprocess
import sys
import threading
import time
import types
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "1.0.0"
PORT = 47613
REQUIREMENTS = ["pyautogui>=0.9.54", "pillow>=10.0"]
HOME = Path.home() / ".alter-helper"
ORIGINS = (
    "https://myalter.web.app",
    "https://myalter.firebaseapp.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)
MAX_BODY = 64 * 1024
MAX_TEXT = 2000
MAX_ACTIONS = 10
SHOT_WIDTH = 1280
# At most this many actions in any ten seconds, so a runaway loop cannot flood the desktop.
RATE = 30
TYPEABLE = set(string.printable) - set("\r\x0b\x0c")
KEY_ALIASES = {
    "control": "ctrl",
    "return": "enter",
    "escape": "esc",
    "del": "delete",
    "arrowup": "up",
    "arrowdown": "down",
    "arrowleft": "left",
    "arrowright": "right",
    "pgup": "pageup",
    "pgdn": "pagedown",
    "spacebar": "space",
    " ": "space",
    "windows": "win",
}


def platform_name():
    return {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")


class HelperError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ---------------------------------------------------------------------------
# First run: install pyautogui and Pillow into the helper's own environment.


def load_pyautogui():
    try:
        import tkinter  # noqa: F401
    except ImportError:
        # pyautogui imports MouseInfo, which needs tkinter only for a window we never open
        # (and exits on Linux without it).
        sys.modules.setdefault("mouseinfo", types.ModuleType("mouseinfo"))
    import pyautogui

    return pyautogui


def ensure_dependencies(argv):
    try:
        import PIL  # noqa: F401

        load_pyautogui()
        return
    except ImportError:
        pass
    except Exception as exc:  # pyautogui connects to the display as it loads.
        sys.exit(f"Could not reach this computer's screen: {exc}")
    if os.environ.get("ALTER_HELPER_BOOTSTRAPPED") or "--no-install" in argv:
        sys.exit("Missing packages. Install them with: python -m pip install " + " ".join(REQUIREMENTS))
    venv = HOME / "venv"
    python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        print("First run: setting up the helper's own Python environment in", venv)
        subprocess.check_call([sys.executable, "-m", "venv", str(venv)])
    present = "import importlib.util as u, sys; sys.exit(0 if u.find_spec('pyautogui') and u.find_spec('PIL') else 1)"
    if subprocess.call([str(python), "-c", present]) != 0:
        print("Installing pyautogui and Pillow…")
        subprocess.check_call(
            [str(python), "-m", "pip", "install", "--quiet", "--disable-pip-version-check", *REQUIREMENTS]
        )
    env = dict(os.environ, ALTER_HELPER_BOOTSTRAPPED="1")
    sys.exit(subprocess.call([str(python), os.path.abspath(__file__), *argv], env=env))


# ---------------------------------------------------------------------------
# The real desktop. Everything else talks to it through these few methods.


class Desktop:
    def __init__(self):
        pyautogui = load_pyautogui()
        pyautogui.FAILSAFE = True  # The mouse in any screen corner raises FailSafeException.
        pyautogui.PAUSE = 0.05
        self.gui = pyautogui
        self.failsafe = pyautogui.FailSafeException
        self.keys = set(pyautogui.KEYBOARD_KEYS)
        # Windows counts wheel movement in 120ths of a notch; macOS in lines.
        self.notch = {"windows": 120, "macos": 3}.get(platform_name(), 1)

    def size(self):
        width, height = self.gui.size()
        return int(width), int(height)

    def position(self):
        x, y = self.gui.position()
        return int(x), int(y)

    def in_corner(self):
        width, height = self.size()
        return self.position() in {(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)}

    def screenshot(self):
        from PIL import ImageGrab

        return ImageGrab.grab()  # The primary screen, in the same pixels the mouse uses.

    def move(self, x, y):
        cx, cy = self.position()
        distance = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
        # Glide rather than jump, so the person can see where the Alter is going.
        self.gui.moveTo(x, y, duration=min(0.6, max(0.15, distance / 2000)), tween=self.gui.easeInOutQuad)

    def click(self, x, y, button="left", clicks=1):
        self.move(x, y)
        self.gui.click(x, y, clicks=clicks, interval=0.08, button=button)

    def drag(self, x, y, to_x, to_y):
        self.move(x, y)
        self.gui.dragTo(to_x, to_y, duration=0.6, button="left")

    def scroll(self, x, y, dx, dy):
        if x is not None:
            self.move(x, y)
        if dy:
            self.gui.scroll(dy * self.notch)
        if dx:
            self.gui.hscroll(dx * self.notch)

    def press(self, keys):
        self.gui.hotkey(*keys, interval=0.04)

    def write(self, text):
        if set(text) <= TYPEABLE:
            self.gui.write(text, interval=0.012)
            return
        # pyautogui types ASCII only; anything else goes through the clipboard.
        import pyperclip

        try:
            previous = pyperclip.paste()
            pyperclip.copy(text)
        except pyperclip.PyperclipException:
            raise HelperError(501, "NO_CLIPBOARD", "This text needs the clipboard, which isn't available here. On Linux, install xclip.") from None
        self.press(["command" if platform_name() == "macos" else "ctrl", "v"])
        time.sleep(0.25)
        pyperclip.copy(previous)

    def wait(self, seconds):
        time.sleep(seconds)


# ---------------------------------------------------------------------------
# Asking the person at the computer. Tk must run on the main thread (macOS
# requires it), so requests from the server threads queue up for it.


class Confirmer:
    def __init__(self):
        try:
            import tkinter  # noqa: F401

            self.available = True
        except ImportError:
            self.available = False
        self.requests = queue.Queue()

    def ask(self, title, lines, timeout=120):
        if not self.available:
            raise HelperError(501, "CONFIRM_UNAVAILABLE", "This helper cannot show a confirmation window.")
        answer = queue.Queue(maxsize=1)
        self.requests.put((title, lines, answer))
        try:
            return answer.get(timeout=timeout + 5)
        except queue.Empty:
            return False

    def serve(self, stopped):
        while not stopped.is_set():
            try:
                title, lines, answer = self.requests.get(timeout=0.25)
            except queue.Empty:
                continue
            try:
                answer.put(self.window(title, lines))
            except Exception as exc:  # A broken display must never count as approval.
                print("Could not show the confirmation window:", exc)
                answer.put(False)

    def window(self, title, lines, timeout=120):
        import tkinter as tk

        chosen = {"allow": False}
        root = tk.Tk()
        root.title("Alter desktop helper")
        root.attributes("-topmost", True)
        root.resizable(False, False)
        frame = tk.Frame(root, padx=18, pady=14)
        frame.pack()
        tk.Label(frame, text="Your Alter wants to", anchor="w").pack(fill="x")
        tk.Label(frame, text=title, font=("TkDefaultFont", 12, "bold"), wraplength=380, justify="left", anchor="w").pack(fill="x", pady=(2, 6))
        for line in lines:
            tk.Label(frame, text="· " + line, wraplength=380, justify="left", anchor="w").pack(fill="x")
        buttons = tk.Frame(frame, pady=12)
        buttons.pack(anchor="e")

        def choose(value):
            chosen["allow"] = value
            root.destroy()

        tk.Button(buttons, text="Stop", width=10, command=lambda: choose(False)).pack(side="left", padx=(0, 6))
        tk.Button(buttons, text="Allow", width=10, command=lambda: choose(True)).pack(side="left")
        root.protocol("WM_DELETE_WINDOW", lambda: choose(False))
        root.bind("<Escape>", lambda _: choose(False))
        root.after(timeout * 1000, lambda: choose(False))
        root.update_idletasks()
        x = root.winfo_screenwidth() - root.winfo_reqwidth() - 32
        root.geometry(f"+{max(0, x)}+48")
        root.mainloop()
        return chosen["allow"]


# ---------------------------------------------------------------------------
# Pairing: a six-digit code shown here, exchanged once for a long token that is
# kept (hashed) per web origin, so the page stays paired across restarts.


class Pairings:
    def __init__(self, path):
        self.path = path
        try:
            self.tokens = json.loads(path.read_text())
        except (OSError, ValueError):
            self.tokens = {}

    @staticmethod
    def digest(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def add(self, origin):
        token = secrets.token_urlsafe(32)
        hashes = self.tokens.setdefault(origin, [])
        hashes.append(self.digest(token))
        del hashes[:-5]  # Keep the five most recent browsers per origin.
        self.save()
        return token

    def valid(self, origin, token):
        if not token:
            return False
        digest = self.digest(token)
        return any(hmac.compare_digest(digest, known) for known in self.tokens.get(origin, []))

    def remove(self, origin, token):
        digest = self.digest(token)
        self.tokens[origin] = [known for known in self.tokens.get(origin, []) if known != digest]
        self.save()

    def clear(self):
        self.tokens = {}
        self.save()

    def save(self):
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.tokens))
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Actions arrive as JSON on a 0–999 grid over the primary screen.


def grid(value, name):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 999:
        raise HelperError(422, "INVALID_ACTION", f"{name} must be a whole number from 0 to 999.")
    return value


def normalize_keys(keys, known, mac):
    if isinstance(keys, str):
        keys = [part for part in keys.replace(" + ", "+").split("+") if part]
    if not isinstance(keys, list) or not 1 <= len(keys) <= 5:
        raise HelperError(422, "INVALID_ACTION", "Send one to five keys.")
    result = []
    for key in keys:
        if not isinstance(key, str):
            raise HelperError(422, "INVALID_ACTION", "Keys must be names such as ctrl, s or enter.")
        name = key.strip().lower() if len(key.strip()) > 1 else key.lower()
        name = KEY_ALIASES.get(name, name)
        if name in ("meta", "super", "cmd", "command", "win"):
            name = "command" if mac else "win"
        if mac and name == "alt":
            name = "option"
        if name not in known:
            raise HelperError(422, "INVALID_ACTION", f"Unknown key: {key[:20]}")
        result.append(name)
    return result


def parse_actions(raw, known_keys, mac=False):
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_ACTIONS:
        raise HelperError(422, "INVALID_ACTION", f"Send one to {MAX_ACTIONS} actions.")
    actions, typed = [], 0
    for item in raw:
        if not isinstance(item, dict):
            raise HelperError(422, "INVALID_ACTION", "Each action must be an object.")
        kind = item.get("action")
        action = {"action": kind}
        if kind in ("move", "click", "double_click", "right_click", "drag") or (
            kind in ("type", "scroll") and "x" in item
        ):
            action["x"], action["y"] = grid(item.get("x"), "x"), grid(item.get("y"), "y")
        if kind == "drag":
            action["to_x"], action["to_y"] = grid(item.get("to_x"), "to_x"), grid(item.get("to_y"), "to_y")
        elif kind == "type":
            text = item.get("text")
            if not isinstance(text, str) or not text:
                raise HelperError(422, "INVALID_ACTION", "Type needs text.")
            typed += len(text)
            action.update(text=text, clear=item.get("clear") is True, enter=item.get("enter") is True)
        elif kind == "key":
            action["keys"] = normalize_keys(item.get("keys"), known_keys, mac)
        elif kind == "scroll":
            direction = item.get("direction")
            if direction not in ("up", "down", "left", "right"):
                raise HelperError(422, "INVALID_ACTION", "Scroll up, down, left or right.")
            amount = item.get("amount", 5)
            if isinstance(amount, bool) or not isinstance(amount, int) or not 1 <= amount <= 30:
                raise HelperError(422, "INVALID_ACTION", "Scroll 1 to 30 notches.")
            action.update(direction=direction, amount=amount)
        elif kind == "wait":
            seconds = item.get("seconds", 1)
            if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not 0 < seconds <= 5:
                raise HelperError(422, "INVALID_ACTION", "Wait up to five seconds.")
            action["seconds"] = seconds
        elif kind not in ("move", "click", "double_click", "right_click"):
            raise HelperError(422, "INVALID_ACTION", f"Unknown action: {str(kind)[:20]}")
        actions.append(action)
    if typed > MAX_TEXT:
        raise HelperError(422, "INVALID_ACTION", f"Type at most {MAX_TEXT} characters at a time.")
    return actions


def describe(action):
    kind = action["action"]
    where = f" at {action['x']}, {action['y']}" if "x" in action else ""
    if kind == "type":
        text = action["text"] if len(action["text"]) <= 60 else action["text"][:57] + "…"
        return f"Type “{text}”{where}" + (" and press Enter" if action["enter"] else "")
    if kind == "key":
        return "Press " + "+".join(key.capitalize() for key in action["keys"])
    if kind == "scroll":
        return f"Scroll {action['direction']}{where}"
    if kind == "drag":
        return f"Drag from {action['x']}, {action['y']} to {action['to_x']}, {action['to_y']}"
    if kind == "wait":
        return f"Wait {action['seconds']} s"
    return {"move": "Point", "click": "Click", "double_click": "Double-click", "right_click": "Right-click"}[kind] + where


class Helper:
    """Everything the web page may ask for, with the checks in one place."""

    def __init__(self, desktop, pairings, confirmer, origins=ORIGINS, ask_every_step=False, clock=time.monotonic, announce=print):
        self.desktop, self.pairings, self.confirmer = desktop, pairings, confirmer
        self.origins = set(origins)
        self.ask_every_step = ask_every_step
        self.clock, self.announce = clock, announce
        self.lock = threading.Lock()
        self.paused = False
        self.recent = deque()
        self.new_code()

    def new_code(self):
        self.code = f"{secrets.randbelow(10**6):06d}"
        self.code_expires = self.clock() + 600
        self.attempts = 0
        self.announce(f"\n  Pairing code: {self.code[:3]} {self.code[3:]}   (enter it on your Alter's Computer page; valid 10 minutes)\n")

    def pair(self, origin, code):
        if self.clock() > self.code_expires or self.attempts >= 5:
            self.new_code()
            raise HelperError(403, "CODE_EXPIRED", "That code expired. Enter the new code shown by the helper.")
        self.attempts += 1
        if not isinstance(code, str) or not hmac.compare_digest(code.replace(" ", ""), self.code):
            raise HelperError(403, "WRONG_CODE", "That code doesn't match the one shown by the helper.")
        token = self.pairings.add(origin)
        self.announce(f"Paired with {origin or 'a local program'}.")
        self.new_code()
        return {"token": token}

    def status(self, authorized):
        value = {
            "app": "alter-desktop-helper",
            "version": VERSION,
            "platform": platform_name(),
            "paired": authorized,
            "paused": self.paused,
            "askEveryStep": self.ask_every_step,
            "confirmations": self.confirmer.available,
        }
        if authorized:
            width, height = self.desktop.size()
            value["screen"] = {"width": width, "height": height}
        return value

    def screenshot(self):
        from PIL import Image

        with self.lock:
            image = self.desktop.screenshot()
            width, height = self.desktop.size()
        image = image.convert("RGB")
        if image.width > SHOT_WIDTH:
            image = image.resize((SHOT_WIDTH, round(image.height * SHOT_WIDTH / image.width)), Image.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=80)
        return {
            "image": base64.b64encode(buffer.getvalue()).decode(),
            "mimeType": "image/jpeg",
            "width": width,
            "height": height,
        }

    def pixel(self, x, y):
        width, height = self.desktop.size()
        return round(x * (width - 1) / 999), round(y * (height - 1) / 999)

    def throttle(self, count):
        now = self.clock()
        while self.recent and now - self.recent[0] > 10:
            self.recent.popleft()
        if len(self.recent) + count > RATE:
            raise HelperError(429, "TOO_FAST", "Too many actions in a short time. Wait a moment and try again.")
        self.recent.extend([now] * count)

    def act(self, raw, confirm=False, summary=""):
        if self.paused:
            raise HelperError(423, "PAUSED", "Desktop control is stopped. Press Resume on your Alter's Computer page to continue.")
        actions = parse_actions(raw, self.desktop.keys, platform_name() == "macos")
        lines = [describe(action) for action in actions]
        if confirm or self.ask_every_step:
            title = (summary or lines[0]).strip()[:200]
            if not self.confirmer.ask(title, lines):
                self.announce("Declined: " + "; ".join(lines))
                raise HelperError(403, "DECLINED", "You stopped this step on the computer.")
        with self.lock:
            self.throttle(len(actions))
            for action, line in zip(actions, lines):
                self.announce(time.strftime("[%H:%M:%S] ") + line)
                try:
                    self.perform(action)
                except self.desktop.failsafe:
                    self.paused = True
                    self.announce("Stopped: the mouse reached a screen corner.")
                    raise HelperError(423, "PAUSED", "You stopped your Alter by moving the mouse into a screen corner.")
        return {"ok": True, "done": len(actions)}

    def perform(self, action):
        kind, desktop = action["action"], self.desktop
        point = self.pixel(action["x"], action["y"]) if "x" in action else None
        if kind == "move":
            desktop.move(*point)
        elif kind == "click":
            desktop.click(*point)
        elif kind == "double_click":
            desktop.click(*point, clicks=2)
        elif kind == "right_click":
            desktop.click(*point, button="right")
        elif kind == "drag":
            desktop.drag(*point, *self.pixel(action["to_x"], action["to_y"]))
        elif kind == "scroll":
            notches = action["amount"]
            dx = {"left": -notches, "right": notches}.get(action["direction"], 0)
            dy = {"up": notches, "down": -notches}.get(action["direction"], 0)
            desktop.scroll(*(point or (None, None)), dx, dy)
        elif kind == "key":
            desktop.press(action["keys"])
        elif kind == "wait":
            desktop.wait(action["seconds"])
        elif kind == "type":
            if point:
                desktop.click(*point)
            if action["clear"]:
                desktop.press(["command" if platform_name() == "macos" else "ctrl", "a"])
                desktop.press(["backspace"])
            desktop.write(action["text"])
            if action["enter"]:
                desktop.press(["enter"])

    def resume(self):
        if self.desktop.in_corner():
            raise HelperError(409, "IN_CORNER", "Move the mouse away from the screen corner, then press Resume.")
        self.paused = False
        self.announce("Resumed.")
        return {"ok": True}


# ---------------------------------------------------------------------------
# HTTP on 127.0.0.1. Browsers reach it from the allowed Alter origins only.


def make_handler(helper, port):
    hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        server_version = "AlterHelper/" + VERSION

        def log_message(self, *args):
            pass

        def origin(self):
            # The Host check stops DNS rebinding; the Origin check stops other websites.
            if self.headers.get("Host", "") not in hosts:
                raise HelperError(403, "BAD_HOST", "Use http://127.0.0.1 to reach the helper.")
            origin = self.headers.get("Origin")
            if origin is not None and origin not in helper.origins:
                raise HelperError(403, "BAD_ORIGIN", "This website is not allowed to use the helper.")
            return origin or ""

        def send(self, status, body, origin=None):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(data)

        def fail(self, exc, origin=None):
            self.send(exc.status, {"error": {"code": exc.code, "message": exc.message}}, origin)

        def do_OPTIONS(self):
            try:
                origin = self.origin()
            except HelperError as exc:
                return self.fail(exc)
            self.send_response(204)
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def authorized(self, origin):
            header = self.headers.get("Authorization", "")
            token = header[7:] if header.startswith("Bearer ") else ""
            return helper.pairings.valid(origin, token), token

        def do_GET(self):
            origin = None
            try:
                origin = self.origin()
                if self.path != "/v1/status":
                    raise HelperError(404, "NOT_FOUND", "Unknown helper path.")
                self.send(200, helper.status(self.authorized(origin)[0]), origin)
            except HelperError as exc:
                self.fail(exc, origin)

        def do_POST(self):
            origin = None
            try:
                origin = self.origin()
                if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                    raise HelperError(415, "JSON_ONLY", "Send JSON.")
                length = int(self.headers.get("Content-Length") or 0)
                if length > MAX_BODY:
                    raise HelperError(413, "TOO_LARGE", "Request too large.")
                try:
                    body = json.loads(self.rfile.read(length) or b"{}")
                except ValueError:
                    raise HelperError(400, "BAD_JSON", "Send valid JSON.") from None
                if not isinstance(body, dict):
                    raise HelperError(400, "BAD_JSON", "Send a JSON object.")
                if self.path == "/v1/pair":
                    return self.send(200, helper.pair(origin, body.get("code")), origin)
                allowed, token = self.authorized(origin)
                if not allowed:
                    raise HelperError(401, "NOT_PAIRED", "Pair this page with the helper first.")
                if self.path == "/v1/screenshot":
                    result = helper.screenshot()
                elif self.path == "/v1/act":
                    summary = body.get("summary") if isinstance(body.get("summary"), str) else ""
                    result = helper.act(body.get("actions"), body.get("confirm") is True, summary)
                elif self.path == "/v1/resume":
                    result = helper.resume()
                elif self.path == "/v1/unpair":
                    helper.pairings.remove(origin, token)
                    result = {"ok": True}
                else:
                    raise HelperError(404, "NOT_FOUND", "Unknown helper path.")
                self.send(200, result, origin)
            except HelperError as exc:
                self.fail(exc, origin)
            except Exception as exc:  # Report, but never leak a traceback to the page.
                print("Helper error:", repr(exc))
                self.fail(HelperError(500, "HELPER_ERROR", "The helper could not do that."), origin)

    return Handler


def serve(helper, port):
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(helper, port))
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    parser = argparse.ArgumentParser(description="Let your Alter use this computer's mouse and keyboard.")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--allow-origin", action="append", default=[], help="Another web origin allowed to pair, such as http://localhost:4173.")
    parser.add_argument("--ask-every-step", action="store_true", help="Show the confirmation window before every step.")
    parser.add_argument("--forget", action="store_true", help="Forget every paired page, then start.")
    parser.add_argument("--no-install", action="store_true", help="Do not install missing packages.")
    args = parser.parse_args(argv)
    ensure_dependencies(argv)
    pairings = Pairings(HOME / "paired.json")
    if args.forget:
        pairings.clear()
    print(f"Alter desktop helper {VERSION} · {platform_name()} · http://127.0.0.1:{args.port}")
    print("Move the mouse into any screen corner to stop your Alter at once. Press Ctrl+C here to quit.")
    confirmer = Confirmer()
    if args.ask_every_step and not confirmer.available:
        sys.exit("--ask-every-step needs tkinter, which this Python does not include.")
    try:
        desktop = Desktop()
    except Exception as exc:
        sys.exit(f"Could not reach this computer's screen: {exc}")
    helper = Helper(desktop, pairings, confirmer, (*ORIGINS, *args.allow_origin), args.ask_every_step)
    try:
        server = serve(helper, args.port)
    except OSError:
        sys.exit(f"Port {args.port} is busy. Is the helper already running?")
    stopped = threading.Event()
    try:
        helper.confirmer.serve(stopped)
    except KeyboardInterrupt:
        print("\nHelper stopped.")
    finally:
        stopped.set()
        server.shutdown()


if __name__ == "__main__":
    main()
