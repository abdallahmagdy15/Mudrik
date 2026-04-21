<div align="center">

<img src="assets/mascot.png" alt="Mudrik owl mascot" width="180" />

# Mudrik &nbsp;·&nbsp; <span dir="rtl">مدرك</span>

### *The owl that perceives your screen.*
##### *Arabic for "perceiver" · pronounced `MUD-rik`*

**An open-source Windows AI assistant that reads whatever UI element your cursor is pointing at — and acts on it.**

*Alt+Space on any element — or Ctrl+Space to capture a region — then just ask. Mudrik types, pastes, clicks, or explains.*

[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0FA8C9?style=flat-square)](https://github.com/abdallahmagdy15/mudrik/releases)
[![License](https://img.shields.io/badge/license-MIT-18BFE1?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/abdallahmagdy15/mudrik?style=flat-square&color=F2A93A)](https://github.com/abdallahmagdy15/mudrik/releases)
[![Electron](https://img.shields.io/badge/built%20with-Electron-5FD8F0?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Good first issues](https://img.shields.io/github/issues/abdallahmagdy15/mudrik/good%20first%20issue?style=flat-square&color=6EE7B7)](https://github.com/abdallahmagdy15/mudrik/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
[![Stars](https://img.shields.io/github/stars/abdallahmagdy15/mudrik?style=flat-square&color=FFC06A)](https://github.com/abdallahmagdy15/mudrik/stargazers)

[Download](#-install) · [What it does](#-what-it-does) · [How it works](#-how-it-works) · [Security](#-privacy--security) · [Contribute](CONTRIBUTING.md) · [Roadmap](#-roadmap)

</div>

---

## ✨ What it does

Hover your cursor over a button, a form field, a paragraph, a menu — anywhere on Windows — press **Alt+Space**, and a small panel slides in anchored to your cursor with the element's full UI-Automation context already loaded. Then:

- **Ask questions** about what you're looking at — "what does this setting do?", "summarize this email"
- **Translate / rewrite / explain / fix** — without copy-pasting into a browser tab
- **Tell the AI to act** — "fill my name here", "paste the draft into the body", "click Save", "press Ctrl+S"
- **Or just chat** — press the tray icon to open the panel without a target

The AI sees your screen's *structure* (UIA), not pixels — unless you explicitly attach a screenshot via the 📸 button.

## 🚀 Install

### Quick (recommended)

1. Install **[Node.js ≥ 20](https://nodejs.org/)**.
2. Install the **OpenCode CLI** and authenticate with any provider you like (OpenAI, Anthropic, Ollama, Z.AI, local models…):
   ```bash
   npm i -g opencode-ai
   opencode auth login
   ```
3. Grab the latest **`Mudrik-Setup-x.y.z.exe`** from [Releases](https://github.com/abdallahmagdy15/mudrik/releases) and run it.

> The installer is **unsigned** (pre-v1.0). Windows SmartScreen will warn on first launch — click *More info → Run anyway*. Code signing is on the [roadmap](#-roadmap).

### From source

```bash
git clone https://github.com/abdallahmagdy15/mudrik
cd mudrik
npm install
npm start
```

## ⌨️ Hotkeys

| Shortcut      | What happens                                                          |
| ------------- | --------------------------------------------------------------------- |
| `Alt+Space`   | Panel opens at the cursor with the UI element under it as context     |
| `Ctrl+Space`  | Draw a rectangle — region is screenshot + UIA-scanned                 |
| `Esc`         | Stop the current response (first tap), close the panel (second tap)   |
| `Enter`       | Send — `Shift+Enter` for a newline                                    |

Both hotkeys are rebindable from the ⚙ menu.

## 🛠 Features

| | |
|---|---|
| 🎯 **Cursor-anchored** | Panel opens near what you're pointing at, not in the middle of your screen |
| 🪟 **Reads any Windows app** | UI Automation picks up buttons, inputs, text, menus, lists — anywhere |
| 🖼️ **Area capture** | Drag a rectangle — screenshot + UIA scan of that region |
| ⚡ **Acts for you** | Types, pastes, clicks, invokes buttons, presses chords, guides your cursor |
| 🔌 **Any LLM** | Bring your own provider via [OpenCode](https://opencode.ai) |
| 🔒 **Sandboxed by default** | No shell, no filesystem, no network — only allow-listed UIA actions |
| 🎨 **Themes + fonts** | Light / dark / auto, adjustable font size |
| 💬 **Session continuity** | Conversation persists across panel opens; `+` starts fresh |
| 📸 **Privacy-first vision** | AI only sees pixels when you manually attach a screenshot |
| 🚀 **Auto-update** | NSIS installer + `electron-updater` checking on launch |

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

### The twist — no tool calling

Mudrik's LLM has **no tool-calling surface**. It replies in plain text. To perform an action it embeds a marker like:

```html
Done. <!--ACTION:{"type":"paste_text","selector":"Body","automationId":"Body","text":"Hi Ahmed, confirming the fix…"}-->
```

The app reads the reply, extracts the marker, validates it against an allow-list, and dispatches it through the UIA layer. This is deliberate:

- Keeps the model honest — actions are visible in the text trail
- Makes the action surface auditable — one regex finds every side effect
- Works with *any* model, not just ones with tool-call APIs
- Simpler to secure than arbitrary tool invocation

Full architecture in **[CLAUDE.md](CLAUDE.md)** (four webpack bundles, PowerShell UIA bridge, OpenCode client, DPI handling, activation-seq race protection).

## 🔒 Privacy & Security

Mudrik is designed for paranoid desktop use. The AI's capabilities are **deliberately narrow**:

| Capability               | Exposed to the model? |
| ------------------------ | --------------------- |
| Shell / PowerShell exec  | ❌ No                 |
| Filesystem read / write  | ❌ No                 |
| Network requests         | ❌ No                 |
| Windows UI Automation    | ✅ Yes (allow-listed) |
| Clipboard write          | ✅ Yes                |
| Keyboard / mouse         | ✅ Yes (UIA fallback) |
| Screen pixels            | 🖐️ Manual attach only |

Enforced in **four layers**:

1. **Sandboxed OpenCode agent** — [`.opencode/agent/readonly.md`](.opencode/agent/readonly.md) declares disallowed tools.
2. **Runtime kill-switch** — the main process SIGKILLs the OpenCode subprocess if a `tool_use` event names a forbidden tool.
3. **Action allow-list at parse time** — `parseActionsFromResponse` only emits actions in a hardcoded set; anything else surfaces as a "blocked" error.
4. **IPC schema validation** — every renderer-supplied payload runs through `validateAction` before execution.

Full threat model + reporting process in **[SECURITY.md](SECURITY.md)**.

## ⚙ Configure

Everything lives in the ⚙ menu inside the panel:

- **Model** — quick-pick recent, or paste any `provider/model` string (validated against `opencode models`)
- **Hotkeys** — rebind pointer and area activation
- **Auto-click guide** — optional: when the AI points you at something, auto-click when the cursor arrives
- **Launch on startup** — registers as a Windows login item
- **Font size** — slider 11–20px
- **Theme** — system / light / dark

State → `%APPDATA%\hoverbuddy\config.json`. Logs → `%APPDATA%\hoverbuddy\hoverbuddy.log` (also reachable from *tray → Show Log*).

> *Note: the on-disk folder is still named `hoverbuddy` for compatibility with pre-rebrand installs. A future release will migrate to `%APPDATA%\mudrik\`.*

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

Produces `Mudrik-Setup-X.Y.Z.exe` + `latest.yml` and drafts a GitHub Release. Publish the draft and installed clients pick up the update on next launch.

The build is **not code-signed**. To sign with an EV or OV certificate add `CSC_LINK` / `CSC_KEY_PASSWORD` ([electron-builder docs](https://www.electron.build/code-signing)).

## 🗺 Roadmap

- [ ] Code signing (removes the SmartScreen warning)
- [ ] Actions enable/disable master switch in settings (read-only mode)
- [ ] Retry button on response errors
- [ ] Session picker — browse and resume previous conversations
- [ ] Migrate on-disk config from `%APPDATA%\hoverbuddy\` to `%APPDATA%\mudrik\`
- [ ] Refined owl mascot SVG (flat vector, 3 poses)
- [ ] macOS + Linux ports (needs Accessibility-API equivalents to UIA)
- [ ] Voice activation
- [ ] Workflow recording — replay a sequence of actions
- [ ] Plugin API for custom action types

Have an idea? [Open an issue](https://github.com/abdallahmagdy15/mudrik/issues/new) or upvote an existing one.

## 🤝 Contributing

PRs welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, coding conventions (single source of truth for IPC + types is `src/shared/types.ts`), and commit style.

Looking for a first PR? Start with issues tagged [`good first issue`](https://github.com/abdallahmagdy15/mudrik/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22). Great first contributions:

- UIA heuristics improvements in `src/main/context-reader.ts`
- New `ActionType`s (with a schema test in `scripts/`)
- Mascot / design-system polish in `src/renderer/components/OwlMascot.tsx` and `src/renderer/styles/global.css`
- Better error messages when actions fail

Not looking for:

- Re-adding `run_command` or any shell-execution path (see [SECURITY.md](SECURITY.md))
- New IPC channels that bypass `validateAction`
- Large-scale refactors without a prior issue discussion

## 💬 Community

- 🐛 **Bugs / features** → [GitHub Issues](https://github.com/abdallahmagdy15/mudrik/issues)
- 🔒 **Security** → see [SECURITY.md](SECURITY.md) — do **not** open public issues for vulnerabilities
- ⭐ **Like the project?** → star the repo, it genuinely helps with visibility

## 🙏 Acknowledgements

- **[OpenCode](https://opencode.ai)** — the CLI that runs the LLM so Mudrik doesn't have to re-implement streaming, provider plumbing, or auth
- **[Electron](https://electronjs.org)**, **[React](https://react.dev)**, **[robotjs](https://github.com/octalmage/robotjs)** — the desktop stack
- **Windows UI Automation** — the accessibility layer that makes all of this possible

## 📄 License

[MIT](LICENSE) — do what you want, just keep the notice.

---

<div align="center">

Made with 💙 for people who are tired of copy-pasting screenshots into chatbots.

**If Mudrik saves you time — star the repo. If it doesn't — [open an issue](https://github.com/abdallahmagdy15/mudrik/issues), the owl wants to help.**

<sub>Mudrik · <span dir="rtl">مدرك</span> · the perceiver</sub>

</div>
