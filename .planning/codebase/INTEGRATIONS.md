# External Integrations

**Analysis Date:** 2026-05-24

## OpenCode CLI (Primary AI Integration)

**What it is:** Mudrik spawns the `opencode` CLI binary (`opencode-ai` package) as a child process per user message. This is the sole bridge to LLM providers.

**Implementation:**
- Spawner: `src/main/opencode-client.ts` (`OpenCodeClient` class)
- Binary discovery: `findOpenCodeBin()` searches known npm global paths (`AppData/Roaming/npm`, `.local/share/npm`, `/usr/local/lib`, and `npm config get prefix`)
- Spawn args: `node <bin> run --format json --model <model> --agent readonly [--continue | --session <id>]`
- Image attachments: `-f <imagePath>` for screenshots

**Session continuity:**
- `--session <id>` for continuation
- `--continue` for fresh continuation of existing session
- `resetSession()` clears ID so next send starts fresh
- `setRestoredSession(id)` re-attaches to prior session

**Environment isolation:**
- `buildCleanOpenCodeEnv()` in `src/shared/providers.ts` — minimal env (Windows essentials + `*_API_KEY` vars) to avoid Bun segfaults from Electron-injected env vars
- `XDG_CONFIG_HOME` overridden to isolated dir (`<workingDir>/opencode-config/`) with empty `mcp: {}` — cuts off user-registered MCP servers before OpenCode starts
- `XDG_DATA_HOME` overridden to `<workingDir>/opencode-data/` so session DB lives under Mudrik

**Runtime sandbox enforcement:**
- `src/main/opencode-client.ts#detectDisallowedTool` — allowlist of tools: `read`, `grep`, `glob`, `list`, `webfetch`, `websearch`
- Any `permission.asked` or `part.tool` event naming anything outside this set triggers immediate `SIGKILL` of the subprocess
- `.opencode/agent/readonly.md` copied into working dir on every launch by `config-store.ts#ensureAgentInWorkingDir`

## LLM Providers (Via OpenCode)

**Provider-to-env-var mapping:** `src/shared/providers.ts#envVarForProvider`

| Provider | Env Var |
|----------|---------|
| anthropic | `ANTHROPIC_API_KEY` |
| openai | `OPENAI_API_KEY` |
| google | `GOOGLE_GENERATIVE_AI_API_KEY` |
| google-vertex | `GOOGLE_VERTEX_API_KEY` |
| groq | `GROQ_API_KEY` |
| deepseek | `DEEPSEEK_API_KEY` |
| mistral | `MISTRAL_API_KEY` |
| openrouter | `OPENROUTER_API_KEY` |
| together | `TOGETHER_API_KEY` |
| xai | `XAI_API_KEY` |
| zai | `ZAI_API_KEY` |
| cerebras | `CEREBRAS_API_KEY` |
| fireworks | `FIREWORKS_API_KEY` |
| perplexity | `PERPLEXITY_API_KEY` |
| cohere | `COHERE_API_KEY` |
| azure | `AZURE_API_KEY` |
| bedrock | `AWS_ACCESS_KEY_ID` |
| ollama | `OLLAMA_API_KEY` |

**API key storage:**
- `Config.apiKeys` map persisted in plaintext `%APPDATA%/mudrik/config.json`
- `SAVE_API_KEY` IPC writes to both Mudrik config AND OpenCode's `auth.json` (global + isolated)
- Shell-level env vars take precedence over config-stored keys

**Model validation:**
- `VALIDATE_MODEL` IPC runs `opencode models` lookup against the provider list
- No pre-flight key validation — bad keys surface as runtime errors on first send

## Windows UI Automation (UIA)

**Integration type:** Native Windows accessibility API, accessed via embedded PowerShell scripts

**Files:**
- `src/main/context-reader.ts` — pointer hotkey context capture (script version v28)
- `src/main/area-scanner.ts` — area selection context capture
- `src/main/actions/action-executor-heavy.ts` — action execution via UIA (script versions v5, v10)

**Mechanism:**
- PowerShell scripts embedded as string literals, written to `%TEMP%/hoverbuddy/` on first use
- Scripts reference `System.Windows.Automation` (PresentationCore, UIAutomationClient, UIAutomationTypes)
- Use `TreeWalker.RawViewWalker` for tree traversal (crosses iframe boundaries)
- Chromium wake-up via `WM_GETOBJECT` + UIA focus event handler registration
- Output written to temp JSON file (`-OutputFile`) rather than stdout to avoid encoding issues

## GDI+ / System.Drawing (Screen Capture)

**Integration type:** .NET/System.Drawing via PowerShell, used for screenshots

**Files:**
- `src/main/vision.ts` — capture + resize optimization (scripts: `hoverbuddy-capture-v3.ps1`, `hoverbuddy-resize-v3.ps1`)

**Mechanism:**
- `System.Drawing.Bitmap` + `Graphics.CopyFromScreen()` for full-screen/area capture
- JPEG quality scaling loop to cap at ~200KB (`MAX_IMAGE_BYTES`), hard cap at 1MB
- `SetProcessDPIAware()` called before capture

## robotjs (Desktop Automation)

**Integration type:** Native Node.js module (`atom/robotjs` fork)

**Usage:**
- `src/main/hotkey.ts` — cursor position reading (`robot.getMousePos()`)
- `src/main/actions/action-executor-heavy.ts` — mouse movement, clicks, keyboard simulation
- `keyTap` via `SendInput` for reliable modifier key chords (Ctrl+V, Alt+F4, etc.)
- `smoothMoveCursorTo()` for animated cursor movement (20 steps over 500ms)

**Webpack config:** Marked as `externals: { robotjs: "commonjs robotjs }` in main bundle
**Packaging:** `asarUnpack` in `electron-builder.yml` so `.node` loads from real disk path

## koffi (Native FFI)

**Integration type:** Native FFI module for loading Windows DLLs

**Usage:**
- `src/main/index.ts` — loads `dwmapi.dll` and calls `DwmSetWindowAttribute` for rounded window corners (`DWMWA_WINDOW_CORNER_PREFERENCE = 33`, `DWMWCP_ROUND = 2`)
- `src/main/guide/active-window.ts` — loads `user32.dll` for `GetForegroundWindow`, `SetForegroundWindow`, `SendMessageTimeoutW`

**Webpack config:** Marked as `externals: { koffi: "commonjs koffi }` in main bundle

## Electron IPC Bridge

**Integration type:** Internal process communication between main and renderer

**Files:**
- IPC channel definitions: `src/shared/types.ts` (`IPC` const object)
- Preload: `src/preload.ts` (panel), `src/main/area-preload.ts` (area overlay), `src/main/guide/guide-overlay-preload.ts` (guide overlay), `src/main/calibrate/calibrate-preload.ts` (calibrate overlay)
- Main handlers: `src/main/ipc-handlers.ts`

**Key channels:**
- `ACTIVATE`, `CONTEXT_READY`, `SEND_PROMPT`, `STREAM_TOKEN`, `STREAM_DONE`, `STREAM_ERROR`, `STREAM_TEXT_RESET`, `TOOL_USE`
- `EXECUTE_ACTION`, `ACTION_RESULT`, `RETRY_ACTION`
- `GET_CONFIG`, `SET_CONFIG`, `SAVE_API_KEY`, `REMOVE_MODEL`
- `ATTACH_SCREENSHOT`, `REMOVE_SCREENSHOT`
- `GUIDE_USER_CHOICE`, `GUIDE_STATE_UPDATE`
- `STOP_RESPONSE`, `NEW_SESSION`, `RESTORE_SESSION`, `SESSION_HISTORY`

## Auto-Update (GitHub Releases)

**Integration type:** `electron-updater` polling GitHub releases

**Files:**
- `src/main/updater.ts`
- `electron-builder.yml` — `publish: github`, owner `abdallahmagdy15`, repo `mudrik`

**Flow:**
- Startup check (packaged apps only), then 6-hour cadence
- Auto-download + `autoInstallOnAppQuit`
- Notification shown when update downloaded
- User-initiated check via tray menu pops modal dialog

## File Storage / State

**Config:** `%APPDATA%/mudrik/config.json` (atomic write via `.tmp` + rename)
**Logs:** `%APPDATA%/mudrik/hoverbuddy.log` (legacy name preserved)
**Screenshots:** Temp files passed to OpenCode via `-f` flag, cleaned up by `cleanupImage()` in `src/main/vision.ts`
**PowerShell cache:** `%TEMP%/hoverbuddy/*.ps1` (versioned filenames force rewrite on change)
**OpenCode isolated config:** `<workingDir>/opencode-config/opencode/opencode.json`
**OpenCode isolated data:** `<workingDir>/opencode-data/opencode/auth.json`

## No Direct External HTTP APIs

Mudrik does NOT make direct HTTP calls to LLM providers, search engines, or APIs. All external communication flows through:
1. The OpenCode CLI subprocess (for LLM inference)
2. Embedded PowerShell scripts (for Windows UIA/GDI)
3. Native modules (robotjs, koffi)
4. electron-updater (GitHub releases)

The renderer process (React) has no network access — `nodeIntegration: false`, `contextIsolation: true`.

## Environment Variables

**Required at runtime:**
- None hard-required; app starts with defaults

**Consumed by OpenCode spawns:**
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_API_KEY`, etc. (from config or shell)
- `OPENCODE_BIN_PATH` — user override for OpenCode binary location
- `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` — OpenCode config/data paths

**Windows essentials for child processes:**
- `PATH`, `PATHEXT`, `SYSTEMROOT`, `SYSTEMDRIVE`, `WINDIR`, `COMSPEC`, `USERPROFILE`, `USERNAME`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, etc.

---

*Integration audit: 2026-05-24*
