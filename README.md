# HoverBuddy

> Press a hotkey, point at anything on your Windows desktop, and ask an AI about it.

HoverBuddy is a small tray app for Windows 10/11. Press **Alt+Space** over any window — a button, a form field, a paragraph — and a panel opens anchored near your cursor with the UI element's context already loaded. Ask questions, have the model explain or translate, or tell it to type/paste/click for you.

Press **Ctrl+Space** and drag a rectangle to grab an on-screen region instead.

The model runs through the [OpenCode](https://opencode.ai) CLI, so you bring your own provider key (OpenAI, Anthropic, Ollama, Z.AI, and so on) and pick any model OpenCode supports.

## Status

Pre-release (v1.0 MVP). Windows 10 and 11 only. The installer is **unsigned** — Windows SmartScreen will warn on first launch; click **More info → Run anyway**.

## Install

1. Install [Node.js ≥ 20](https://nodejs.org/).
2. Install the OpenCode CLI and configure a provider:
   ```
   npm i -g opencode-ai
   opencode auth login
   ```
   (Or edit `~/.config/opencode/opencode.json` directly.)
3. Download `HoverBuddy-Setup-<version>.exe` from the [Releases](https://github.com/abdallahmagdy15/hoverbuddy/releases) page and run it.

The installer is a standard NSIS installer: it prompts for install location, adds a Start Menu and Desktop shortcut, and places config at `%APPDATA%\hoverbuddy\`. Uninstall from **Settings → Apps** keeps your config by default.

## Hotkeys

| Shortcut | What it does |
| --- | --- |
| `Alt+Space` | Open the panel anchored near your cursor, with the UI element under the pointer as context. |
| `Ctrl+Space` | Draw a rectangle to capture an on-screen region and attach it. |

Both are reconfigurable from the ⚙ menu in the panel.

## What the AI can and can't do

HoverBuddy is deliberately sandboxed. The assistant replies with plain text plus optional `<!--ACTION:{...}-->` markers that HoverBuddy parses and executes through Windows UI Automation (UIA). Allowed action types:

- `type_text`, `paste_text`, `set_value`, `press_keys`
- `invoke_element`, `click_element`, `guide_to`
- `copy_to_clipboard`

The following are **not** available, by design:

- **No shell / PowerShell command execution from the model.** HoverBuddy itself uses PowerShell internally to drive UIA, but no tool surface is exposed to the model.
- **No file reads or writes to your filesystem.**
- **No network requests.**

This is enforced in two layers: (1) a [sandboxed OpenCode agent](.opencode/agent/readonly.md) that declares the disallowed tools, and (2) a runtime kill-switch in the main process that terminates the OpenCode subprocess if a `tool_use` or `permission.asked` event names a disallowed tool. See [SECURITY.md](SECURITY.md) for the threat model.

## Configure

Settings live in the ⚙ menu inside the panel:

- **Model** — quick-pick from recent models, or paste any `provider/model` string. Validated against `opencode models`. Default is `zai-coding-plan/glm-4.6v`.
- **Hotkeys** — rebind `Alt+Space` (pointer) and `Ctrl+Space` (area).
- **Auto-click guide** — if enabled, `guide_to` actions also click once the cursor reaches the target.
- **Launch on startup** — registers HoverBuddy as a login item.
- **Font size** — slider (11–20px) applied as `--font-size-base` on the panel root.
- **Theme** — `system` / `light` / `dark`.
- **Telemetry** — off by default; nothing is sent unless you turn this on.

State is persisted to `%APPDATA%\hoverbuddy\config.json`. Logs are at `%APPDATA%\hoverbuddy\hoverbuddy.log` — there's a **Show Log** entry in the tray menu.

## How it works

```
 Alt+Space
   ↓
 Global hotkey → read cursor pos (robotjs)
   ↓
 PowerShell UIA script → JSON description of the element under the cursor
   ↓
 Panel opens anchored near cursor, with element + surrounding context loaded
   ↓
 You type a prompt → streamed to `opencode run --format json`
   ↓
 Streaming tokens rendered; <!--ACTION:{...}--> markers parsed out
   ↓
 Actions dispatched via UIA (preferred) or robotjs (fallback)
```

The architecture details, including the four webpack bundles (main, preload, area-preload, renderer) and why actions are embedded text markers rather than tool calls, are in [CLAUDE.md](CLAUDE.md).

## Develop

Requires Node ≥ 20 and the OpenCode CLI on `PATH`. There is no test runner, linter, or formatter configured in this repository.

```
npm install
npm run dev          # webpack --watch for all four bundles
# in another terminal:
electron .           # relaunch manually after main/preload changes
```

Useful scripts:

```
npm run build        # one-shot bundle into dist/
npm run icons        # regenerate tray + app icons from the embedded vector
npm run check:no-env # leak guard (fails if a credential lands in dist/)
npm run pack:dir     # build + package unsigned into release/win-unpacked/
npm run dist         # build NSIS installer (no publish)
npm run release      # build + publish to GitHub Releases (requires GH_TOKEN)
```

Hot-reload caveat: renderer changes hot-reload on window reload (`Ctrl+R` inside DevTools), but main/preload changes require restarting `electron .`.

## Publishing a release

The release pipeline is electron-builder → NSIS → GitHub Releases, with auto-update served to already-installed clients via `electron-updater`.

1. Bump `version` in `package.json` (SemVer; the installer filename and the auto-update feed key off this).
2. Commit and tag:
   ```
   git commit -am "release: vX.Y.Z"
   git tag vX.Y.Z
   git push && git push --tags
   ```
3. Export a GitHub personal access token with `repo` scope and run:
   ```
   set GH_TOKEN=ghp_xxxxxxxx
   npm run release
   ```
   This produces `release/HoverBuddy-Setup-X.Y.Z.exe` plus `latest.yml` and uploads both as assets on a draft GitHub Release.
4. Open the draft release on GitHub, write the changelog, and **Publish** it. Installed clients will see the update on next launch (electron-updater polls `latest.yml` on startup).

For local testing without publishing, use `npm run dist` (builds the installer into `release/` without pushing to GitHub) or `npm run pack:dir` (unpacked directory — fastest for iteration).

The build is **not code-signed**. To sign with an EV or OV certificate, add the relevant `certificateFile` / `certificatePassword` (or `CSC_LINK` / `CSC_KEY_PASSWORD` env vars) as documented by [electron-builder](https://www.electron.build/code-signing).

## License

[MIT](LICENSE).
