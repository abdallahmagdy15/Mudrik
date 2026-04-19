<div align="center">

<img src="assets/icon.png" alt="HoverBuddy owl mascot" width="128" height="128" />

# HoverBuddy

**A friendly owl that lives in your tray, reads whatever your cursor is pointing at, and does stuff for you.**

*Alt+Space → point at anything on Windows → ask an AI → it acts.*

[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0FA8C9?style=flat-square)](https://github.com/abdallahmagdy15/hoverbuddy/releases)
[![License](https://img.shields.io/badge/license-MIT-18BFE1?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/abdallahmagdy15/hoverbuddy?style=flat-square&color=F2A93A)](https://github.com/abdallahmagdy15/hoverbuddy/releases)
[![Electron](https://img.shields.io/badge/built%20with-Electron-5FD8F0?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Stars](https://img.shields.io/github/stars/abdallahmagdy15/hoverbuddy?style=flat-square&color=FFC06A)](https://github.com/abdallahmagdy15/hoverbuddy/stargazers)

[Download](#-install) · [Demo](#-what-it-does) · [How it works](#-how-it-works) · [Roadmap](#-roadmap) · [Contribute](CONTRIBUTING.md)

</div>

---

## 🦉 What it does

HoverBuddy is a tiny tray app for Windows that turns any desktop app into something you can *talk to*.

Hover your cursor over a button, a form field, a line of text, or anything else — hit **Alt+Space**, and a panel slides in anchored to your cursor with the element's UIA context already loaded. Ask questions. Have the model explain, translate, rewrite, summarize. Or tell it to **type, paste, click, press keys, fill forms** — it does the thing.

> No copy-paste dance. No screenshot → upload → back-and-forth. The AI sees what you see and can act where you're pointing.

<div align="center">

<!-- Drop a demo GIF here. Keep it under ~2MB so the README feels light. -->
<!-- <img src="docs/demo.gif" alt="HoverBuddy in action" width="720" /> -->

</div>

## ✨ Features

| | |
|---|---|
| 🎯 **Cursor-anchored** | Panel opens near what you're pointing at, not in the middle of your screen |
| 🪟 **Reads any Windows app** | UI Automation picks up the element under your cursor — buttons, inputs, text, menus |
| 🖼️ **Area capture** | `Ctrl+Space` to drag a rectangle — screenshot + UIA-scan that region |
| ⚡ **Acts for you** | Types, pastes, clicks, invokes buttons, presses keyboard chords, guides your cursor |
| 🔌 **Any LLM** | Bring your own provider via [OpenCode](https://opencode.ai) — OpenAI, Anthropic, Ollama, Z.AI, local models |
| 🔒 **Sandboxed by default** | No shell, no filesystem, no network — only safe UIA actions |
| 🎨 **Themes + fonts** | Light / dark / auto, adjustable font size |
| 💬 **Session continuity** | Conversation persists across panel opens; `+` starts fresh |
| 📸 **On-demand screenshot** | Manual attach button — the AI only sees pixels when you say so |
| 🚀 **Auto-update** | Installed via NSIS with `electron-updater` checking on launch |

## 🚀 Install

### Quick (recommended)

1. Install **[Node.js ≥ 20](https://nodejs.org/)**.
2. Install the **OpenCode CLI** and authenticate with any provider you like:
   ```bash
   npm i -g opencode-ai
   opencode auth login
   ```
3. Grab the latest **`HoverBuddy-Setup-x.y.z.exe`** from [Releases](https://github.com/abdallahmagdy15/hoverbuddy/releases) and run it.

> The installer is **unsigned** (pre-release). Windows SmartScreen will warn on first launch — click *More info → Run anyway*. Config lives at `%APPDATA%\hoverbuddy\`.

### From source

```bash
git clone https://github.com/abdallahmagdy15/hoverbuddy
cd hoverbuddy
npm install
npm start
```

## ⌨️ Hotkeys

| Shortcut      | What happens                                                              |
| ------------- | ------------------------------------------------------------------------- |
| `Alt+Space`   | Panel opens at the cursor with the UI element under it as context        |
| `Ctrl+Space`  | Draw a rectangle — area is captured + scanned for UIA elements           |
| `Esc`         | Stop the current response (first tap), close the panel (second tap)      |
| `Enter`       | Send — `Shift+Enter` for a newline                                        |

Both hotkeys are rebindable from the ⚙ menu.

## 🧠 How it works

```
 Alt+Space
   ↓
 global hotkey reads cursor pos (robotjs)
   ↓
 PowerShell UIA script → JSON description of the element
   ↓
 panel slides in, anchored to your cursor
   ↓
 you type a prompt → streamed to `opencode run --format json`
   ↓
 tokens render live; <!--ACTION:{...}--> markers parsed out of the text
   ↓
 actions execute via UIA (preferred) or robotjs (fallback)
```

**The trick:** HoverBuddy's LLM has **no tool-calling surface**. It replies in plain text. To perform an action it embeds a marker like:

```html
Done. <!--ACTION:{"type":"paste_text","selector":"Body","automationId":"Body","text":"Hi Ahmed, confirming the fix…"}-->
```

The app reads the reply, extracts the marker, and dispatches it through the UIA layer. This is deliberate — it keeps the model honest, makes the action surface auditable, and lets *any* model work (no tool-call API required).

See [CLAUDE.md](CLAUDE.md) for the full architecture (four webpack bundles, PowerShell UIA bridge, OpenCode client, action executor).

## 🔒 Privacy & safety

HoverBuddy is deliberately **sandboxed**:

| Capability               | Exposed to the model? |
| ------------------------ | --------------------- |
| Shell / PowerShell exec  | ❌ No                 |
| Filesystem read / write  | ❌ No                 |
| Network requests         | ❌ No                 |
| Windows UI Automation    | ✅ Yes (filtered)     |
| Clipboard write          | ✅ Yes                |
| Keyboard / mouse         | ✅ Yes (for UIA fallback) |
| Screen pixels            | 🖐️ Manual attach only |

Enforced in two layers:
1. A [sandboxed OpenCode agent](.opencode/agent/readonly.md) declares the disallowed tools.
2. A runtime kill-switch in the main process terminates the OpenCode subprocess if a `tool_use` event names a forbidden tool.

Full threat model in **[SECURITY.md](SECURITY.md)**.

## ⚙ Configure

Everything lives in the ⚙ menu inside the panel:

- **Model** — quick-pick from recent, or paste any `provider/model` string (validated against `opencode models`). Default: `zai-coding-plan/glm-4.6v`.
- **Hotkeys** — rebind pointer and area activation.
- **Auto-click guide** — if on, `guide_to` actions auto-click when the cursor arrives.
- **Launch on startup** — registers as a Windows login item.
- **Font size** — slider (11–20px).
- **Theme** — `system` / `light` / `dark`.

State → `%APPDATA%\hoverbuddy\config.json`. Logs → `%APPDATA%\hoverbuddy\hoverbuddy.log` (also reachable from *tray → Show Log*).

## 🛠 Develop

Requires Node ≥ 20 and the OpenCode CLI on `PATH`.

```bash
npm install
npm run dev          # webpack --watch for all four bundles
electron .           # run — relaunch manually on main/preload changes
```

Useful scripts:

```bash
npm run build        # one-shot bundle into dist/
npm run icons        # regenerate tray + app icons from the SVG
npm run check:no-env # leak guard — fails if credentials land in dist/
npm run pack:dir     # build + package unsigned into release/win-unpacked/
npm run dist         # build the NSIS installer locally
npm run release      # build + publish to GitHub Releases (needs GH_TOKEN)
```

Renderer changes hot-reload on window reload (`Ctrl+R` in DevTools). Main/preload changes need an `electron .` restart.

## 📦 Release pipeline

`electron-builder` → NSIS → GitHub Releases, with auto-update served via `electron-updater`.

```bash
# 1. bump version in package.json
# 2. commit + tag
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z && git push --tags

# 3. publish
set GH_TOKEN=ghp_xxxxxxxx
npm run release
```

Produces `HoverBuddy-Setup-X.Y.Z.exe` + `latest.yml` and drafts a GitHub Release. Publish the draft and installed clients pick up the update on next launch. The build is **not code-signed** — add `CSC_LINK` / `CSC_KEY_PASSWORD` for EV/OV signing ([electron-builder docs](https://www.electron.build/code-signing)).

## 🗺 Roadmap

- [ ] Code signing (removes the SmartScreen warning)
- [ ] macOS + Linux ports (needs an Accessibility-API equivalent to UIA)
- [ ] Voice activation
- [ ] Workflow recording — replay a sequence of actions
- [ ] Plugin API for custom action types

Have an idea? [Open an issue](https://github.com/abdallahmagdy15/hoverbuddy/issues/new) or upvote an existing one.

## 🤝 Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, coding conventions (single source of truth for IPC / types is `src/shared/types.ts`), and commit style. First-timer-friendly issues are tagged `good first issue`.

## 💬 Community

- 🐛 **Bugs / features** → [GitHub Issues](https://github.com/abdallahmagdy15/hoverbuddy/issues)
- ⭐ **Liking the project?** → star the repo, it genuinely helps

## 📄 License

[MIT](LICENSE) — do what you want, just keep the notice.

---

<div align="center">

Made with 💙 for people who are tired of copy-pasting screenshots into chatbots.

**If HoverBuddy saved you time, star it. If it didn't, open an issue — the owl wants to help.**

</div>
