# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — bundles all four webpack targets into `dist/` (main, preload, area-preload, renderer).
- `npm run dev` — webpack in watch mode. Re-run `electron .` manually to pick up main/preload changes; renderer changes hot-reload on window reload.
- `npm start` — one-shot build + launch (`webpack && electron .`).
- No test runner, linter, or formatter is configured.

Electron loads `dist/main.js` (set in `package.json > main`), so a build is required before launching.

## Architecture

Mudrik (مدرك — Arabic for "perceiver") is a Windows-only Electron tray app that acts as a cursor-anchored AI assistant for any desktop application. It reads the UI element under the cursor, sends it plus a user prompt to an LLM, and executes UI actions the LLM requests. The repository folder is still named `hoverbuddy` — that is the previous name; all user-facing strings and published artifacts have been rebranded to Mudrik.

### Four webpack bundles (see `webpack.config.js`)

The build produces four entry points because Electron requires separate bundles per process + sandboxed `<webview>`:

1. **`main.js`** (`src/main/index.ts`) — Electron main process. Owns hotkeys, tray, panel window, PowerShell integration, OpenCode client.
2. **`preload.js`** (`src/preload.ts`) — bridges `ipcRenderer` into the panel renderer as `window.hoverbuddy`.
3. **`area-preload.js`** (`src/main/area-preload.ts`) — preload for the fullscreen area-selection overlay.
4. **`renderer.js`** (`src/renderer/index.tsx`) — React UI of the panel.

`robotjs` is marked `externals` in the main bundle because it's a native module.

The `@shared/*` alias maps to `src/shared/*` — the single source of truth for `IPC` event names, `ContextPayload`, `Action`, and `Config` types. When adding an IPC channel, add the name to `IPC` in `src/shared/types.ts`, wire it in `src/preload.ts`, and handle it in `src/main/ipc-handlers.ts`.

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
  → SEND_PROMPT → opencode-client.ts (spawns `opencode run --format json`)
  → streams JSON events back as STREAM_TOKEN / TOOL_USE / STREAM_DONE
  → action-executor.ts parses <!--ACTION:{...}--> markers from the text
  → EXECUTE_ACTION → UIA/robotjs performs the action, ACTION_RESULT goes back
```

`Ctrl+Space` (area hotkey) replaces the context-reader step with `area-selector.ts` (fullscreen overlay drag) + `area-scanner.ts` (captures the region + scans contained UIA elements).

### The LLM is text-only; actions are embedded markers

This is the central architectural decision, documented in `src/shared/prompts.ts`. The LLM has **no tool-calling ability** — the app spawns OpenCode CLI (`opencode-client.ts`) and parses its streaming text output for `<!--ACTION:{json}-->` markers. When editing `SYSTEM_PROMPT`, keep this contract intact: adding a tool-call story would bypass `parseActionsFromResponse` in `action-executor.ts` and break action execution.

Action types are defined by the `ActionType` union in `src/shared/types.ts`. Each maps to a handler in `action-executor.ts` that uses either (a) PowerShell UIA scripts for element targeting by `automationId`/`selector`, or (b) `robotjs` for raw keyboard/mouse. UIA is strongly preferred — `click_element` is explicitly documented as "last resort".

### PowerShell is the UIA bridge

`context-reader.ts`, `area-scanner.ts`, `vision.ts`, and `action-executor.ts` all embed PowerShell scripts as string literals and write them to `%TEMP%/hoverbuddy/` on first use (see `powershell-runner.ts`). They use `System.Windows.Automation` (UIA) and GDI+ for screen capture. Script file names are versioned (`-v3`, `-v6`) — bumping the version string forces a rewrite of the cached `.ps1`, which is the mechanism to deploy PowerShell changes to already-installed users.

Scripts write their JSON output to a temp file (`-OutputFile`) rather than stdout. `runPowerShell` in `powershell-runner.ts` reads and deletes this file. Do not switch PS scripts back to stdout without understanding the encoding issues this pattern avoids.

### OpenCode client + session continuity

`opencode-client.ts` spawns the `opencode` CLI binary (from `npm i -g opencode-ai` or `@opencode-ai/sdk`) as a child process per message. `resetSession()` clears the session ID so the next send omits `--continue`; `setRestoredSession(id)` re-attaches to a prior session. `activeProcess` tracks the current child so `STOP_RESPONSE` can kill it mid-stream.

### Context dedup + image lifecycle

`ipc-handlers.ts#computeContextHash` avoids re-sending the same element to the model when the panel is reopened on the same UI. `cleanupImage` deletes the screenshot temp file when context changes — always funnel image deletion through it rather than `fs.unlink` directly, so the bookkeeping for `currentContext.imagePath` / `areaImagePath` stays consistent.

### Windows-only assumptions

This codebase is not cross-platform. UIA, PowerShell script embedding, robotjs build, DPI-aware GDI capture, and `findOpenCodeBin` path resolution are all Windows-specific. Don't add `process.platform` branches unless you're also porting the PS layer.
