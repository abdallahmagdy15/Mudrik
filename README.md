<div align="center">

<img src="assets/mascot.png" alt="Mudrik owl mascot" width="180" />

# Mudrik  ·  <span dir="rtl">مدرك</span>

### *The owl wants to help.*

##### *Arabic for "aware" · pronounced* *`MUD-rik`*

**An open-source Windows AI assistant that sees what you see. Hover anywhere on Windows — ask anything — and it clicks, types, pastes, or just answers.**

[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0FA8C9?style=flat-square)](https://github.com/abdallahmagdy15/mudrik/releases)
[![License](https://img.shields.io/badge/license-MIT-18BFE1?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/abdallahmagdy15/mudrik?style=flat-square\&color=F2A93A\&include_prereleases)](https://github.com/abdallahmagdy15/mudrik/releases)
[![Preview](https://img.shields.io/badge/status-preview-F2A93A?style=flat-square)](CHANGELOG.md)
[![Stars](https://img.shields.io/github/stars/abdallahmagdy15/mudrik?style=flat-square\&color=FFC06A)](https://github.com/abdallahmagdy15/mudrik/stargazers)
[![Website](https://img.shields.io/badge/website-mudrik-7499C2?style=flat-square)](https://abdallahmagdy15.github.io/Mudrik/)

[Website](https://abdallahmagdy15.github.io/Mudrik/) · [Install](#-install) · [What it does](#-what-it-does) · [How it works](#-how-it-works) · [Security](#-privacy--security) · [Contribute](CONTRIBUTING.md) · [About](#-about)

</div>

***

> \[!NOTE]
> **🐣 v0.9.0 Preview.** Mudrik is stable for daily use, but internal APIs may change before v1.0. If anything breaks, [open an issue](https://github.com/abdallahmagdy15/mudrik/issues) to help shape v1.0. See [CHANGELOG](CHANGELOG.md) for details.

***

## ✨ What it does

Hover the cursor over a button, form field, paragraph, or menu — anywhere on Windows — press **Alt+Space**, and a small panel slides in anchored to your cursor with the element's full UI-Automation context already loaded. Then:

- **Ask** about what you're looking at — *"what does this setting do?"*, *"summarize this email"*
- **Translate / rewrite / explain / fix** without copy-pasting into a browser tab
- **Tell the AI to act** — *"fill my name here"*, *"paste the draft into the body"*, *"click Save"*, *"press Ctrl+S"*
- **Or just chat** — open the panel from the tray icon without a target

The AI sees your screen's *structure* (UIA), not pixels — unless you explicitly attach a screenshot via the 📸 button.

## 🚀 Install

1. Install **[Node.js ≥ 20](https://nodejs.org/)**.
2. Install the **OpenCode CLI** (authentication is optional here — you can add keys inside Mudrik too):
   ```bash
   npm i -g opencode-ai
   ```
3. Grab the latest **`Mudrik-Setup-0.9.0.exe`** from [Releases](https://github.com/abdallahmagdy15/mudrik/releases) and run it.
4. Launch Mudrik → ⚙ → **Model** → pick or type a `provider/model` (e.g. `anthropic/claude-sonnet-4-5`). If you haven't authed that provider yet, Mudrik will prompt you to paste an API key right there. No terminal required.

> The installer is **unsigned** (pre-v1.0). Windows SmartScreen will warn on first launch — *More info → Run anyway*. Code signing is on the roadmap.

**From source:** `git clone https://github.com/abdallahmagdy15/mudrik && cd mudrik && npm install && npm start`

## ⌨️ Hotkeys

| Shortcut     | What happens                                                        |
| ------------ | ------------------------------------------------------------------- |
| `Alt+Space`  | Panel opens at the cursor with the UI element under it as context   |
| `Ctrl+Space` | Draw a rectangle — region is screenshot + UIA-scanned               |
| `Esc`        | Stop the current response (first tap), close the panel (second tap) |
| `Enter`      | Send — `Shift+Enter` for a newline                                  |

Both hotkeys are rebindable from the ⚙ menu.

## 🛠 Features

| <br />                       | <br />                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 🎯 **Cursor-anchored**       | Panel opens near what you're pointing at, not in the middle of your screen                                                         |
| 🪟 **Reads any Windows app** | UI Automation picks up buttons, inputs, text, menus, lists — anywhere                                                              |
| 🖼️ **Area capture**         | Drag a rectangle — screenshot + UIA scan of that region                                                                            |
| ⚡ **Acts for you**           | Types, pastes, clicks, invokes buttons, presses chords, guides your cursor                                                         |
| 🔌 **Any LLM**               | Bring your own provider via [OpenCode](https://opencode.ai) — Anthropic, OpenAI, Google, Groq, DeepSeek, Ollama, Z.AI, OpenRouter… |
| 🔑 **Keys live in-app**      | Add or replace an API key from the settings panel; no terminal auth dance                                                          |
| 🧊 **Frosted glass panel**   | Native Windows acrylic blur + DWM rounded corners — not a Chromium fake                                                            |
| 🌐 **English + Arabic**      | Full RTL when Arabic is selected; other languages land as contributors add them                                                    |
| 🔒 **Sandbox first**         | No shell, no network, no filesystem writes — only allow-listed UIA actions + read-only file lookups                                |
| 💬 **Session continuity**    | Conversation persists across panel opens; `+` starts fresh                                                                         |
| 📸 **Privacy-first vision**  | AI only sees pixels when you manually attach a screenshot                                                                          |

## 🧠 How it works

```
 Alt+Space
   ↓  global hotkey reads cursor pos (robotjs)
   ↓  PowerShell UIA script → JSON description of the element
   ↓  panel slides in, anchored to your cursor
   ↓  prompt streamed to `opencode run --agent readonly`
   ↓  tokens render live; <!--ACTION:{...}--> markers parsed
   ↓  actions execute via UIA or robotjs
```

### The twist — actions are text, not tool calls

Mudrik deliberately splits its tool surface:

- **Desktop actions** (click, type, paste) are **never** tool calls. The model embeds them in plain text:
  ```html
  Done. <!--ACTION:{"type":"paste_text","selector":"Body","text":"Hi Ahmed…"}-->
  ```
  The app extracts the marker, validates it against an allow-list, and dispatches it. This works with *any* model, makes side effects highly auditable, and avoids opaque tool payloads.
- **File reading** (code, docs in working dir) **is** allowed via OpenCode's `read`, `grep`, and `glob` tools. A runtime kill-switch blocks heavier tools (`bash`, `write`, `websearch`).

Full architecture in **[CLAUDE.md](CLAUDE.md)**.

## 🔒 Privacy & Security

Mudrik is designed for paranoid desktop use. The AI's capabilities are **deliberately narrow**:

| Capability                                        | Exposed to the model?        |
| ------------------------------------------------- | ---------------------------- |
| Shell / PowerShell exec                           | ❌ No                         |
| Filesystem **write**                              | ❌ No                         |
| Network requests (fetch/search)                   | ❌ No                         |
| Filesystem **read** (`read`/`grep`/`glob`/`list`) | ✅ Yes (within working dir)   |
| Windows UI Automation                             | ✅ Yes (allow-listed actions) |
| Clipboard write                                   | ✅ Yes                        |
| Keyboard / mouse                                  | ✅ Yes (UIA fallback)         |
| Screen pixels                                     | 🖐️ Manual attach only       |

Enforced in four layers — sandboxed OpenCode agent, runtime kill-switch that `SIGKILL`s the subprocess on any disallowed tool, parse-time action allow-list, IPC schema validation. Full threat model + reporting in **[SECURITY.md](SECURITY.md)**.

## 🗺 Roadmap

**Next (toward v1.0):**

- [ ] Code signing (removes the SmartScreen warning on first launch)
- [ ] Session picker — browse and resume previous conversations
- [ ] Bundled OpenCode binary (drop the `npm i -g opencode-ai` step)
- [ ] More languages — French / Spanish / German / etc. (PRs welcome)

**Later:**

- [ ] macOS + Linux ports (needs Accessibility-API equivalents to UIA)
- [ ] Voice activation
- [ ] Workflow recording — replay a sequence of actions
- [ ] Plugin API for custom action types

Have an idea? [Open an issue](https://github.com/abdallahmagdy15/mudrik/issues/new) or upvote an existing one.

## 🤝 Contributing

PRs welcome! See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, and please follow the **[Code of Conduct](CODE_OF_CONDUCT.md)**.

- **To start:** Grab a [`good first issue`](https://github.com/abdallahmagdy15/mudrik/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) (like UI polish, new `ActionType`s, or UIA tweaks).
- **Avoid:** Shell execution features (see [SECURITY.md](SECURITY.md)), IPC bypasses, or large refactors without prior discussion.

## 👋 About

Hi, I'm **Abdullah Magdy**.
A developer who got tired of pasting screenshots into ChatGPT — so I built Mudrik.

If Mudrik saves you time — ⭐ the repo, open an issue, or say hi. All three make my day.

- 🐙 GitHub — [@abdallahmagdy15](https://github.com/abdallahmagdy15)
- 🐦 X / Twitter — [@AbdallahMagdyy](https://x.com/AbdallahMagdyy)
- 💼 LinkedIn — [abdallahmagdy15](https://www.linkedin.com/in/abdallahmagdy15/)
- ✉️ Email — `abdallah.magdy1515@gmail.com`

For security issues, please use the email above (or [SECURITY.md](SECURITY.md) once Private Vulnerability Reporting is enabled) — **not** public issues.

## 🙏 Acknowledgements

- **[OpenCode](https://opencode.ai)** — runs the LLM so Mudrik doesn't have to re-implement streaming, providers, or auth
- **[Electron](https://electronjs.org)**, **[React](https://react.dev)**, **[robotjs](https://github.com/octalmage/robotjs)** — the desktop stack
- **Windows UI Automation** — the accessibility layer that makes all of this possible

## 📄 License

[MIT](LICENSE) — do what you want, just keep the notice.

***

<div align="center">

**If Mudrik saves you time, star the repo. If it doesn't,** **[open an issue](https://github.com/abdallahmagdy15/mudrik/issues)** **— the owl wants to help.**

<sub>Mudrik · <span dir="rtl">مدرك</span> · the aware</sub>

</div>
