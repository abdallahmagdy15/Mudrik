<div align="center">

<img src="assets/mascot.png" alt="Mudrik owl mascot" width="180" />

# Mudrik  ·  <span dir="rtl">مدرك</span>

***Stop pasting screenshots into AI chats.*** **Mudrik is an open-source Windows AI assistant that sees what you see — and answers, types, pastes, or clicks for you.**

[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0FA8C9?style=flat-square)](https://github.com/abdallahmagdy15/mudrik/releases)
[![License](https://img.shields.io/badge/license-MIT-18BFE1?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/abdallahmagdy15/mudrik?style=flat-square\&color=F2A93A\&include_prereleases)](https://github.com/abdallahmagdy15/mudrik/releases)
[![Preview](https://img.shields.io/badge/status-preview-F2A93A?style=flat-square)](CHANGELOG.md)
[![Website](https://img.shields.io/badge/website-mudrik-7499C2?style=flat-square)](https://abdallahmagdy15.github.io/Mudrik/)

[Website](https://abdallahmagdy15.github.io/Mudrik/) · [Install](#-install) · [Hotkeys](#%EF%B8%8F-hotkeys) · [About](#-about)

</div>

***

## ✨ What it does

Hover anywhere on Windows and press **Alt+Space**. A quick floating panel slides in on the **opposite half** of your screen from your cursor — what you're pointing at stays in clear view, and Mudrik's actions land on the real element instead of the panel itself.

The UI element under your cursor (name, label, text, parent window, nearby labels) is preloaded as context — no screenshot needed. From there: ask, translate, fix, summarize — or tell it to *act*: type, paste, click, press a chord, guide your cursor. The AI sees your screen's *structure*, not pixels (unless you attach a screenshot via the 📸 button).

## 🚀 Install

1. Install **[Node.js ≥ 20](https://nodejs.org/)**.
2. Install OpenCode (auth optional — keys can live in-app):
   ```bash
   npm i -g opencode-ai
   ```
3. Download the latest `.exe` from [Releases](https://github.com/abdallahmagdy15/mudrik/releases) and run it.
4. Launch → ⚙ → **Model** → pick or type a `provider/model`. Mudrik will prompt for an API key if needed. No terminal.

> Installer is **unsigned** (pre-v1.0) — SmartScreen will warn on first launch. *More info → Run anyway*.

**From source:** `git clone https://github.com/abdallahmagdy15/mudrik && cd mudrik && npm install && npm start`

## ⌨️ Hotkeys

Two global hotkeys put Mudrik in front of you. Both are rebindable from the ⚙ menu — pick something that doesn't fight your daily shortcuts.

| Shortcut     | What happens                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Alt+Space`  | Panel slides in on the opposite side of your cursor. The UI element under your cursor — its name, label, text content, parent window, nearby labels — is preloaded as context. The AI is now aware of what you're pointing at. |
| `Ctrl+Space` | Switches to area-select. Drag a rectangle — the region is screenshotted *and* any UIA elements inside are scanned. Use this when the target is a chart, image, or custom canvas that UIA alone can't read.                     |
| `Esc`        | Cancels whatever's currently happening: stops a streaming response, exits area-select mode, or closes the panel. Your prompt and chat history are preserved.                                                                   |
| `Enter`      | Sends your prompt. `Shift+Enter` inserts a newline for multi-line prompts.                                                                                                                                                     |

## 🛠 Features

| <br />                       | <br />                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🎯 **Cursor-anchored**       | The panel opens on the opposite half of your screen from your cursor — what you're pointing at stays in clear view. No more switching to a separate AI chat app or browser tab.                               |
| 🪟 **Reads any Windows app** | Uses Windows UI Automation  to pick up buttons, fields, text, menus, lists. Works in Outlook, Excel, browsers, native dialogs, IDEs — anywhere accessibility reaches.                                         |
| ⚡ **Acts for you**           | Beyond chat: Mudrik can type, paste, click, press keyboard chords, and invoke accessibility actions.                                                                                                          |
| 🖼️ **Area capture**         | For when you want Mudrik to focus on a specific area — or when UIA can't see something (charts, images) — drag a rectangle with `Ctrl+Space`. Mudrik captures the pixels *and* scans any UIA elements inside. |
| 🔌 **Any LLM**               | 18 providers out of the box — Anthropic, OpenAI, Google, DeepSeek, OpenRouter, Ollama, and more. Paste your key in settings — no terminal auth dance.                                                         |
| 🔒 **Sandboxed**             | The AI cannot run shell commands or write to your filesystem. It can read files inside your working directory and dispatch a fixed allow-list of UI actions. That's the whole capability surface.             |

## 🧠 How it works

```
 Alt+Space
   ↓  global hotkey reads cursor pos (robotjs)
   ↓  PowerShell UIA script → JSON description of the element
   ↓  panel slides in opposite the cursor (target stays visible)
   ↓  prompt streamed to `opencode run --agent readonly`
   ↓  tokens render live; <!--ACTION:{...}--> markers parsed
   ↓  actions execute via UIA or robotjs
```

Full architecture in **[CLAUDE.md](CLAUDE.md)**.

## 🔒 Privacy & Security

Mudrik is designed for paranoid desktop use. The AI's capabilities are deliberately narrow:

| Capability                                        | Exposed to the model?        |
| ------------------------------------------------- | ---------------------------- |
| Shell / PowerShell exec                           | ❌ No                         |
| Filesystem **write**                              | ❌ No                         |
| Filesystem **read** (`read`/`grep`/`glob`/`list`) | ✅ Yes (within working dir)   |
| Windows UI Automation                             | ✅ Yes (allow-listed actions) |
| Keyboard / mouse                                  | ✅ Yes (UIA fallback)         |
| Screen pixels                                     | 🖐️ Manual attach only       |

Full threat model + reporting in **[SECURITY.md](SECURITY.md)**.

## 🗺 Roadmap

**Next:**

- [ ] Code signing (removes the SmartScreen warning on first launch)
- [ ] Session picker — browse and resume previous conversations
- [ ] Bundled OpenCode binary (drop the `npm i -g opencode-ai` step)
- [ ] Workflow recording — replay a sequence of actions
- [ ] Voice activation
- [ ] macOS + Linux

Have an idea? [Open an issue](https://github.com/abdallahmagdy15/mudrik/issues/new) or upvote an existing one.

## 👋 About

Hi, I'm **Abdullah Magdy**.

A senior dev who got tired of pasting screenshots into ChatGPT — so I built Mudrik on nights and weekends. Open source so you can see (and improve) every line.

- 🐙 GitHub — [@abdallahmagdy15](https://github.com/abdallahmagdy15)
- 🐦 X / Twitter — [@AbdallahMagdyy](https://x.com/AbdallahMagdyy)
- 💼 LinkedIn — [abdallahmagdy15](https://www.linkedin.com/in/abdallahmagdy15/)
- ✉️ `abdallah.magdy1515@gmail.com`

For security issues use **[GitHub Private Vulnerability Reporting](https://github.com/abdallahmagdy15/mudrik/security/advisories/new)** (or email as fallback) — not public issues.

## 🤝 Contributing

PRs welcome. Mudrik is TypeScript end-to-end (main, preload, renderer, shared types) — the single source of truth for IPC channels, action types, and config shape lives in [`src/shared/types.ts`](src/shared/types.ts).&#x20;

Setup, build pipeline, and release flow in **[CONTRIBUTING.md](CONTRIBUTING.md)**. Code of Conduct in **[CODE\_OF\_CONDUCT.md](CODE_OF_CONDUCT.md)**.

## 🙏 Acknowledgements

- **[OpenCode](https://opencode.ai)** — handles streaming, providers, auth so Mudrik doesn't have to.
- **[Electron](https://electronjs.org)** · **[React](https://react.dev)** · **[robotjs](https://github.com/octalmage/robotjs)** · **Windows UI Automation**.

## 📄 License

[MIT](LICENSE) — fork it, modify it, ship it, sell it. Just keep the copyright notice in the LICENSE file.

***

<div align="center"><sub>Mudrik · <span dir="rtl">مدرك</span> · the aware</sub></div>
