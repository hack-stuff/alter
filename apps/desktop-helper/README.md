# Alter desktop helper

A small program that lets your Alter move the mouse, click and type on your own computer, in any
app, not just the Alter web app. It is one Python file with no setup beyond Python 3.9 or newer.

## How it works

1. You start the helper on the computer your Alter should use. It listens on `127.0.0.1:47613`
   only, so nothing outside this computer can reach it.
2. On the **Computer** page of your Alter you press **Connect**, and choose **Allow** in the window
   the helper opens on this computer. (Without a window, or with an older helper, you enter the
   six-digit code it prints instead.) That page is now paired; no other website can use it.
3. You give a task, such as "In Notepad, write a note saying the demo moved to 3 pm". You can
   also ask from chat or voice with "on my computer, …"; requests made while a task runs wait
   their turn. A floating window (Chrome and Edge) shows what your Alter is doing above every
   app, with Allow, Skip, Stop, Mute and End voice; you can also just say "allow", "skip" or "stop".
4. The page sends a screenshot to the Alter API, which asks Gemini's computer use model for the
   next step. The page shows the step, then the helper glides the mouse there and does it.
5. Steps run without asking, except those the model flags as changing something outside, like
   sending, posting, buying or deleting, which wait for your approval. "Ask before every step" on
   the Computer page makes every step wait. The task ends when the goal is done,
   after 30 steps, or when the screen stops changing.

## Run it

The Computer page offers a ready-made program for Windows, Mac (Apple silicon and Intel) and
Linux, with Python and every package inside. It shows a one-line command that downloads and
starts it; a command-line download also avoids the "downloaded from the internet" warnings.

The builds come from the [Desktop helper workflow](../../.github/workflows/desktop-helper.yml),
which runs on every change to this folder. To publish the newest ones with the site:

```bash
apps/desktop-helper/fetch-builds.sh   # needs the GitHub CLI, signed in
npm --prefix apps/web run build && npx firebase-tools deploy --only hosting
```

Until builds are published, the page falls back to the Python script. To run the script yourself,
download `alter_helper.py` from the Computer page (or use this folder), then:

| System | Command | Notes |
| --- | --- | --- |
| Windows | `py alter_helper.py` | Use Python from python.org or the Microsoft Store (then `python alter_helper.py`). MSYS2's Python can't install Pillow. |
| macOS | `python3 alter_helper.py` | Allow your terminal under **Privacy & Security → Accessibility** and **Screen Recording**, then start it again. |
| Linux | `python3 alter_helper.py` | Needs an X11 session (not Wayland). Install `xclip` to type text with accents or emoji. |

The first run creates its own Python environment in `~/.alter-helper/venv` and installs
`pyautogui` and `Pillow` there. Pairings are kept in `~/.alter-helper/paired.json` as hashes.

Options:

- `--ask-every-step` shows a confirmation window on this computer before every step.
- `--forget` unpairs every page before starting.
- `--allow-origin URL` lets another web origin pair, such as a local preview build.
- `--port N` listens on another port. The web app expects 47613.
- `--no-install` never installs packages; it fails if they are missing.
- `--check` confirms the helper can see the screen, then exits.

## Staying in control

- **Move the mouse into any screen corner** to stop at once. The helper pauses until you move
  the mouse away and press Resume on the Computer page.
- Press `Ctrl+C` in the helper's terminal to quit it.
- It does at most 30 actions in any ten seconds and types at most 2,000 characters per step.
- Your Alter is told never to type passwords or other secrets, and to treat text on the screen as
  information, never as instructions.
- Screenshots go to the Alter API for the current step only; they are not stored.

## Protocol

All requests are JSON over `http://127.0.0.1:47613/v1`. Requests must use that host (this stops
DNS rebinding) and come from an allowed origin. Everything except `status`, `pair` and `pair/request` needs
`Authorization: Bearer <token>`.

| Request | Body | Reply |
| --- | --- | --- |
| `GET /status` | | `app`, `version`, `platform`, `paired`, `paused`, `askEveryStep`, `confirmations`, `screen` |
| `POST /pair/request` | `{}` | `{"token": "…"}` once Allow is chosen in the helper's window (`403 DECLINED` otherwise) |
| `POST /pair` | `{"code": "123456"}` | `{"token": "…"}` |
| `POST /screenshot` | `{}` | `image` (base64), `mimeType`, `width`, `height` |
| `POST /act` | `{"actions": […], "confirm": false, "summary": "…"}` | `{"ok": true}` |
| `POST /resume` | `{}` | `{"ok": true}` |
| `POST /unpair` | `{}` | `{"ok": true}` |

Positions use a 0–999 grid across the whole screen, the same grid the model uses. Actions:
`move`, `click`, `double_click`, `right_click` (`x`, `y`); `type` (`text`, optional `x`, `y`,
`clear`, `enter`); `key` (`keys`, such as `["ctrl", "s"]`); `scroll` (`direction`, `amount`,
optional `x`, `y`); `drag` (`x`, `y`, `to_x`, `to_y`); `wait` (`seconds`, up to 5).

Errors look like `{"error": {"code": "…", "message": "…"}}`. `401 NOT_PAIRED`,
`403 DECLINED` (you said no), `423 PAUSED` (a corner stop) and `409 IN_CORNER` (resume while the
mouse is still in a corner) are the ones the page acts on.

## Tests

```bash
python -m pytest apps/desktop-helper/tests
```

The tests replace the screen with a fake, so they run without a display.
