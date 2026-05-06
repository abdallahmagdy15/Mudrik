# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — bundles all four webpack targets into `dist/` (main, preload, area-preload, renderer).
- `npm run dev` — webpack in watch mode. Re-run `electron .` manually to pick up main/preload changes; renderer changes hot-reload on window reload.
- `npm start` — one-shot build + launch (`webpack && electron .`).
- No test runner, linter, or formatter is configured.

Electron loads `dist/main.js` (set in `package.json > main`), so a build is required before launching.

## Architecture

Mudrik (مدرك — Arabic for "perceiver") is a Windows-only Electron tray app that acts as a cursor-anchored AI assistant for any desktop application. On each Alt+Space, it reads the active window's full UI tree (every visible control, via Windows UI Automation), the list of visible windows on the desktop, and the element under the cursor (marked as the focal anchor in the tree); sends all of that plus a user prompt to an LLM; and executes UI actions the LLM requests. The repository folder is still named `hoverbuddy` — that is the previous name; all user-facing strings and published artifacts have been rebranded to Mudrik.

### Four webpack bundles (see `webpack.config.js`)

The build produces four entry points because Electron requires separate bundles per process + sandboxed `<webview>`:

1. **`main.js`** (`src/main/index.ts`) — Electron main process. Owns hotkeys, tray, panel window, PowerShell integration, OpenCode client.
2. **`preload.js`** (`src/preload.ts`) — bridges `ipcRenderer` into the panel renderer as `window.hoverbuddy`.
3. **`area-preload.js`** (`src/main/area-preload.ts`) — preload for the fullscreen area-selection overlay.
4. **`renderer.js`** (`src/renderer/index.tsx`) — React UI of the panel.

`robotjs` is marked `externals` in the main bundle because it's a native module.

The `@shared/*` alias maps to `src/shared/*` — the single source of truth for `IPC` event names, `ContextPayload`, `Action`, and `Config` types. When adding an IPC channel, add the name to `IPC` in `src/shared/types.ts`, wire it in `src/preload.ts`, and handle it in `src/main/ipc-handlers.ts`.

`src/shared/` also contains `prompts.ts` (the `SYSTEM_PROMPT` template), `providers.ts` (provider→env-var mapping for API keys), and `i18n.ts` (UI strings keyed by `Config.lang`). All four are imported by both main and renderer; only put pure types/constants/string maps here, no Node or DOM dependencies.

### Request flow (pointer hotkey)

```
Alt+Space
  → hotkey.ts                  (global shortcut, robotjs for cursor pos)
  → index.ts#handlePointerActivate
  → context-reader.ts          (spawns powershell running a UIA script → JSON)
  → ipc-handlers.ts#setContext (stores ContextPayload, hashes to dedupe)
  → highlight.ts               (brief frameless overlay around the element)
  → panel window               (created or repositioned near cursor)
  → renderer receives CONTEXT_READY, user types a prompt
  → SEND_PROMPT → opencode-client.ts (spawns `opencode run --format json --agent readonly`)
  → streams JSON events back as STREAM_TOKEN / TOOL_USE / STREAM_DONE
  → action-executor.ts parses <!--ACTION:{...}--> markers from the text
  → EXECUTE_ACTION → UIA/robotjs performs the action, ACTION_RESULT goes back
```

The pointer hotkey deliberately does NOT capture a screenshot — UIA data only. Vision is opt-in via the renderer's 📸 button (`ATTACH_SCREENSHOT` IPC → `vision.ts#captureAndOptimize`). The area hotkey IS pixel-based: `Ctrl+Space` replaces context-reader with `area-selector.ts` (fullscreen overlay drag) + `area-scanner.ts` (captures the region + scans contained UIA elements).

### Desktop actions are embedded markers, not tool calls

Central architectural decision, documented in `src/shared/prompts.ts`. The LLM may use OpenCode's read-only tools (`read`, `grep`, `glob`, `list`) for looking up local files, but **all desktop side effects** (click, type, paste, press keys, guide cursor) must flow through `<!--ACTION:{json}-->` markers in the LLM's plain text. The app parses those markers via `parseActionsFromResponse` in `action-executor.ts`. When editing `SYSTEM_PROMPT`, keep this split intact: do NOT introduce a tool-call story for desktop actions, and do NOT widen the runtime tool allowlist beyond reads.

Action types are defined by the `ActionType` union in `src/shared/types.ts`. Each maps to a handler in `action-executor.ts` that uses either (a) PowerShell UIA scripts for element targeting by `automationId`/`selector`, or (b) `robotjs` for raw keyboard/mouse. UIA is strongly preferred — `click_element` is explicitly documented as "last resort".

### Sandbox enforcement

Two layers limit what the LLM subprocess can do:

1. **Agent config**: `.opencode/agent/readonly.md` declares `bash`/`edit`/`write`/`webfetch`/`websearch`/`task`/`todowrite`/`skill` as denied. `config-store.ts#ensureAgentInWorkingDir` copies this file into the working dir on **every launch** (overwrites, so updates propagate after upgrade). OpenCode 1.4.x treats this as advisory — it's enforcement layer 1 of 2.
2. **Runtime kill-switch** (`opencode-client.ts#detectDisallowedTool`): inspects every JSON event streamed from OpenCode; if a `permission.asked` or `part.tool` event names a tool in `DISALLOWED_TOOLS`, the subprocess is `SIGKILL`ed and a `Blocked: model attempted to use X` error surfaces. This is the authoritative enforcement.

A second IPC-level guard (`validateAction` in `action-executor.ts`) defends against a compromised renderer sending a forged action payload. Never wire a new IPC handler that forwards renderer-supplied actions to an executor without going through `validateAction`.

### Action gating is live (no snapshot)

`Config.actionsEnabled` is the user's master switch for desktop-interactive actions (everything except `copy_to_clipboard`). It is read **live** in two places, never cached:

1. **Runtime action guards** — auto-execute loop, `EXECUTE_ACTION`, `RETRY_ACTION` all read `config.actionsEnabled` directly at execution time. Toggling the setting in ⚙ blocks (or unblocks) the very next action attempt, even mid-stream.
2. **System-prompt actionsBlock** — built fresh on every non-followup send (i.e. every Alt+Space / Ctrl+Space that captures new context, since `setContext` / `setAreaContext` flip `contextNeedsSending = true`). The block reads `config.actionsEnabled` at that moment.

What this means for the user-facing model:

- Mid-conversation toggles do **not** auto-trigger a re-send. A follow-up message after a toggle still goes out as a follow-up (no system prompt) — the model continues to believe whatever the most recent system block told it.
- The new setting lands on the **next context capture** (Alt+Space / Ctrl+Space), which is when the system prompt is rebuilt anyway.
- Earlier turns of the conversation may carry the opposite `actionsEnabled` instruction in their history; the actionsBlock explicitly tells the model to trust the latest block over older ones.

This matches the user's mental model: "what's been sent is done; the next snapshot of context picks up my latest settings." If you add another setting that the model must see, build it into the same actionsBlock-style block so it refreshes naturally on every non-followup send.

### PowerShell is the UIA bridge

`context-reader.ts`, `area-scanner.ts`, `vision.ts`, and `action-executor.ts` all embed PowerShell scripts as string literals and write them to `%TEMP%/hoverbuddy/` on first use (see `powershell-runner.ts`). They use `System.Windows.Automation` (UIA) and GDI+ for screen capture. Script file names are versioned (`-v3`, `-v6`) — bumping the version string forces a rewrite of the cached `.ps1`, which is the mechanism to deploy PowerShell changes to already-installed users.

Scripts write their JSON output to a temp file (`-OutputFile`) rather than stdout. `runPowerShell` in `powershell-runner.ts` reads and deletes this file. Do not switch PS scripts back to stdout without understanding the encoding issues this pattern avoids.

### OpenCode client + session continuity

`opencode-client.ts` spawns the `opencode` CLI binary (from `npm i -g opencode-ai` or `@opencode-ai/sdk`) as a child process per message, always with `--agent readonly`. `resetSession()` clears the session ID so the next send omits `--continue`; `setRestoredSession(id)` re-attaches to a prior session. `activeProcess` tracks the current child so `STOP_RESPONSE` can kill it mid-stream.

### API key plumbing

`Config.apiKeys` is a `provider → key` map persisted in `config.json` (plaintext — see comment on the field for the safeStorage trade-off). `src/shared/providers.ts#buildProviderEnv` translates the map into env vars per the convention OpenCode reads (`anthropic` → `ANTHROPIC_API_KEY`, `openai` → `OPENAI_API_KEY`, etc.) and is injected into both `OpenCodeClient.sendMessage` spawns and the `VALIDATE_MODEL` `opencode models` lookup. Existing shell-level env vars win over config — intentional, lets users override without editing the file.

`SAVE_API_KEY` IPC writes a single `provider/key` pair (empty key clears). There is no pre-flight validation — OpenCode has no test endpoint, so a bad key surfaces as a runtime error on first message send. The renderer exposes per-row "edit key" (✎) and "remove model" (×) actions in the settings panel for recovery.

### Config migration

`config-store.ts#migrateLegacyConfig` runs once at startup to copy `%APPDATA%\hoverbuddy\` → `%APPDATA%\mudrik\` for users upgrading across the rebrand. `logger.ts` falls back to the legacy log dir until the migration runs. Do not rename the legacy paths until pre-rebrand installs are presumed extinct.

### Context dedup + image lifecycle

`ipc-handlers.ts#computeContextHash` avoids re-sending the same element to the model when the panel is reopened on the same UI. `cleanupImage` deletes the screenshot temp file when context changes — always funnel image deletion through it rather than `fs.unlink` directly, so the bookkeeping for `currentContext.imagePath` / `areaImagePath` stays consistent.

### Windows-only assumptions

This codebase is not cross-platform. UIA, PowerShell script embedding, robotjs build, DPI-aware GDI capture, and `findOpenCodeBin` path resolution are all Windows-specific. Don't add `process.platform` branches unless you're also porting the PS layer.
