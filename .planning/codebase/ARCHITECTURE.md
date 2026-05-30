<!-- refreshed: 2026-05-24 -->
# Architecture

**Analysis Date:** 2026-05-24

## System Overview

Mudrik (formerly hoverbuddy) is a Windows-only Electron tray app that acts as a cursor-anchored AI assistant for any desktop application. On each Alt+Space it reads the active window's full UI tree via Windows UI Automation (UIA), sends the context plus a user prompt to an LLM via the OpenCode CLI, and executes UI actions the LLM requests through embedded `<!--ACTION:{...}-->` markers.

```text
┌──────────────────────────────────────────────────────────────────────┐
│                         User Interaction Layer                        │
│   Hotkeys (Alt+Space / Ctrl+Space)  ──► tray click                  │
│   `src/main/hotkey.ts`   `src/main/tray.ts`                          │
└──────────────────────────────────────┬───────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Main Process (Electron)                          │
│  `src/main/index.ts`                                                 │
│  ├─ Window lifecycle (frameless, transparent)                         │
│  ├─ IPC handlers (`src/main/ipc-handlers.ts`)                        │
│  ├─ UIA bridge (`src/main/context-reader.ts`)                        │
│  ├─ OpenCode client (`src/main/opencode-client.ts`)                  │
│  ├─ Action dispatcher (`src/main/action-executor.ts`)               │
│  ├─ Vision/screenshots (`src/main/vision.ts`)                        │
│  ├─ Config/store (`src/main/config-store.ts`)                        │
│  └─ Auto-Guide (lazy) (`src/main/guide/`)                            │
└──────────────────────────────────────┬───────────────────────────────┘
                                       │ IPC (contextBridge)
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Renderer Process (React)                       │
│  `src/renderer/index.tsx`  ──►  `src/renderer/App.tsx`                 │
│  ├─ Chat input, settings, message history                            │
│  ├─ Owl mascot, copy chips, guide options                            │
│  └─ CSS via `src/renderer/styles/global.css`                       │
└──────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         External / LLM Layer                        │
│  OpenCode CLI (`opencode-ai`) spawned per message                     │
│  Streams JSON events → text, tool_use, error, step_finish             │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Main entry | App lifecycle, tray, hotkeys, window positioning | `src/main/index.ts` |
| IPC handlers | All IPC wiring, context formatting, prompt building | `src/main/ipc-handlers.ts` |
| OpenCode client | Spawns `opencode run`, streams JSON events, session continuity | `src/main/opencode-client.ts` |
| Action executor | Marker parsing, validation, thin dispatcher | `src/main/action-executor.ts` |
| Action heavy | UIA/robotjs desktop side effects (lazy-loaded) | `src/main/actions/action-executor-heavy.ts` |
| Context reader | PowerShell UIA scripts, wakes Chromium accessibility | `src/main/context-reader.ts` |
| Guide controller | Auto-Guide state machine, overlay, mouse hook (lazy) | `src/main/guide/guide-controller.ts` |
| Config store | Config persistence, rebrand migration, sandbox agent | `src/main/config-store.ts` |
| Preload | Bridges `ipcRenderer` into renderer as `window.hoverbuddy` | `src/preload.ts` |
| Renderer (App) | React UI, chat, settings, streaming display | `src/renderer/App.tsx` |

## Pattern Overview

**Overall:** Electron multi-process tray app with context-driven LLM interactions and sandboxed desktop actions.

**Key Characteristics:**
- **Process-isolated bundles**: Eight separate webpack bundles for main, preload, renderer, area-preload, guide overlay, and calibration.
- **Lazy loading by feature**: Guide modules and heavy action executor are never statically imported; they load dynamically only when needed.
- **Sandbox enforcement (two-layer)**: Agent-level `.opencode/agent/readonly.md` + runtime kill-switch (`detectDisallowedTool` in `opencode-client.ts`).
- **Live config reads**: `actionsEnabled` and `autoGuideEnabled` are read at execution time, never cached.
- **PowerShell as UIA bridge**: All UIA interaction is done via embedded PowerShell scripts written to `%TEMP%/hoverbuddy/`.

## Layers

**User Interaction Layer:**
- Purpose: Capture user intent (hotkeys, tray clicks, renderer UI)
- Location: `src/main/hotkey.ts`, `src/main/tray.ts`
- Contains: GlobalShortcut registration, tray icon/menu, debounce logic
- Depends on: `src/main/index.ts` (window show/hide callbacks)
- Used by: The main process event loop

**Main Process Layer:**
- Purpose: Orchestrate context capture, LLM communication, action execution, and window management
- Location: `src/main/`
- Contains: Electron main-process code, IPC handlers, UIA/vision bridges
- Depends on: Electron APIs, `robotjs`, `koffi`, PowerShell, OpenCode CLI
- Used by: The Electron runtime; it owns the renderer BrowserWindow

**Renderer Process Layer:**
- Purpose: Display the panel UI and handle user chat/settings input
- Location: `src/renderer/`
- Contains: React 18 app, CSS, audio, components
- Depends on: `window.hoverbuddy` exposed by `src/preload.ts`
- Used by: Electron `BrowserWindow` that loads `index.html`

**Shared Contracts Layer:**
- Purpose: Type definitions, IPC channel names, prompt templates, i18n strings, provider mappings
- Location: `src/shared/`
- Contains: `types.ts`, `prompts.ts`, `providers.ts`, `i18n.ts`
- Depends on: Nothing (pure data/constants)
- Used by: Both main and renderer (via `@shared/*` alias)

**External / LLM Layer:**
- Purpose: Provide the AI model interface
- Location: System-installed `opencode-ai` CLI
- Contains: The OpenCode binary (`opencode run --format json --agent readonly`)
- Depends on: Network-accessible LLM providers
- Used by: `src/main/opencode-client.ts`

## Data Flow

### Primary Request Path (Pointer Hotkey)

1. **Hotkey trigger** — `src/main/hotkey.ts:registerPointer()` (`Alt+Space`)
2. **Panel hidden + target HWND captured** — `src/main/index.ts:handlePointerActivate()` (`lastCursorX/Y`, `getActiveHwnd()`)
3. **UIA context read** — `src/main/context-reader.ts:readContextAtPoint()` → PowerShell script `hoverbuddy-read-context-v28.ps1`
4. **Context stored + hashed** — `src/main/ipc-handlers.ts:setContext()` (dedup via `computeContextHash`)
5. **Panel shown near cursor** — `src/main/index.ts:showPanel()` / `showPanelWithLoading()`
6. **Renderer receives CONTEXT_READY** — `src/preload.ts` buffers if early
7. **User types prompt → SEND_PROMPT** — `src/renderer/App.tsx:handleSubmit()` → `window.hoverbuddy.sendPrompt()`
8. **Main builds full prompt** — `src/main/ipc-handlers.ts:on(IPC.SEND_PROMPT)` (`buildSystemPrompt()` + context block + actions block + user message)
9. **OpenCode spawned** — `src/main/opencode-client.ts:sendMessage()` (`node <opencodeBin> run --format json ...`)
10. **JSON events stream back** (`text`, `tool_use`, `error`, `step_finish`) → `handleOpenCodeEvent()`
11. **Text streamed to renderer** — `IPC.STREAM_TOKEN`
12. **Response complete** — `parseActionsFromResponse()` extracts `<!--ACTION:...-->` markers
13. **Actions validated + executed** — `validateAction()` → `executeAction()` → heavy executor or guide controller
14. **Result sent back to renderer** — `IPC.ACTION_RESULT`

### Area Hotkey Path (`Ctrl+Space`)

1. **Hotkey trigger** — `src/main/hotkey.ts:registerArea()`
2. **Fullscreen overlay selection** — `src/main/area-selector.ts:startAreaSelection()` (`area-preload.js` overlay)
3. **Area scanned** — `src/main/area-scanner.ts:scanArea()` (capture + UIA elements inside rect)
4. **Context stored as area context** — `src/main/ipc-handlers.ts:setAreaContext()`
5. **Panel shown with loading** → same SEND_PROMPT flow as above (area context block used instead of pointer context)

### Auto-Guide Follow-Up Path

1. **Guide step emitted** — AI streams `guide_step` marker → parsed in `action-executor.ts`
2. **Overlay shown** — `guide-controller.ts:handleStep()` → `showOverlay()` with owl-wing pointer
3. **Mouse hook armed** (only during `STEP_ACTIVE`) — `src/main/guide/mouse-hook.ts` (WH_MOUSE_LL via PowerShell + C#)
4. **User clicks target** → mouse hook fires → `handleClick()`
5. **Panel hidden, target app re-foregrounded** — `sendFollowUp()` in `ipc-handlers.ts`
6. **Screenshot + UIA recaptured in parallel** — `captureAndOptimize()` + `readContextAtPoint()`
7. **Follow-up prompt built with fresh candidates** — pre-enumerated clickable UIA candidates sent in prompt
8. **OpenCode streamed again** → next `guide_step` / `guide_complete` / `guide_abort`

### Configuration Change Path

1. **User toggles setting in renderer** → `window.hoverbuddy.setConfig({ ... })`
2. **SET_CONFIG handler** — `src/main/ipc-handlers.ts:ipcMain.handle(IPC.SET_CONFIG, ...)`
3. **Persist + propagate** — `saveConfig()`; hotkey re-registration if changed; `applyTheme()`; `ensureAgentInWorkingDir()`
4. **Guide controller init** — if `autoGuideEnabled` flips true, `initGuideControllerIfNeeded()` fires lazily

## Key Abstractions

**ContextPayload:**
- Purpose: Encapsulates everything the AI needs to know about the current UI state
- Fields: `element`, `surrounding`, `cursorPos`, `windowInfo`, `windowTree`, `visibleWindows`, `imagePath`, `hasScreenshot`
- Defined in: `src/shared/types.ts`

**Action:**
- Purpose: Encodes a single desktop operation requested by the AI
- Types: `type_text`, `paste_text`, `click_element`, `set_value`, `invoke_element`, `copy_to_clipboard`, `press_keys`, `guide_to`, plus `guide_offer/step/complete/abort`
- Defined in: `src/shared/types.ts`
- Parsed from: `<!--ACTION:{...}-->` markers in LLM text (`src/main/action-executor.ts`)

**IPC Message Names:**
- Purpose: Single source of truth for all renderer↔main IPC channels
- Defined in: `src/shared/types.ts` as the `IPC` const object
- Used by: `src/preload.ts`, `src/main/ipc-handlers.ts`, and renderer components

**System Prompt Composition:**
- Purpose: Dynamically builds the prompt block that tells the AI what it can/cannot do
- Composed in: `src/shared/prompts.ts#buildSystemPrompt()`
- Blocks: `BASE_PROMPT` (always) + `ACTION_PROMPT_FULL`/`ACTION_PROMPT_AWARE` + `GUIDE_PROMPT_FULL`/`GUIDE_PROMPT_AWARE`

## Entry Points

**Main Process Entry:**
- Location: `src/main/index.ts`
- Triggers: Electron `app.whenReady()`
- Responsibilities: Load config, migrate legacy, create tray, register IPC handlers, start hotkeys, init updater

**Renderer Entry:**
- Location: `src/renderer/index.tsx`
- Triggers: BrowserWindow loads `dist/index.html`
- Responsibilities: Mount React 18 app into `#root`

**Preload Entries:**
- Panel preload: `src/preload.ts` (exposes `window.hoverbuddy`)
- Area selection preload: `src/main/area-preload.ts`
`src/main/area-preload.ts` used by fullscreen drag-to-select overlay
- Guide overlay preload: `src/main/guide/guide-overlay-preload.ts`
- Calibration preload: `src/main/calibrate/calibrate-preload.ts`

## Architectural Constraints

- **Threading:** Single main-process event loop; all UIA/robotjs actions are async. Heavy blocking ops (PowerShell scripts, image encoding) run in spawned child processes or via native modules. No worker threads.
- **Global state (main):** `mainWindow`, `config`, `lastCursorX/Y`, `activationSeq` in `src/index.ts`. `currentContext`, `appConfig`, `client`, `guidePhase`, `lastContextHash` in `ipc-handlers.ts`. These are intentional module-level singletons.
- **Circular imports:** Not detected. Shared layer is leaf-only.
- **Renderer state:** All renderer state lives inside React hooks in `App.tsx`. No external store.
- **Lazy loading mandate:** `src/main/guide/` and `src/main/actions/action-executor-heavy.ts` must never be statically imported. Always use `await import(...)`.
- **Windows-only:** UIA, PowerShell embedding, `robotjs`, GDI+ capture, and `findOpenCodeBin` are all Windows-native. Do not add `process.platform` branches without porting the PS layer.
- **IPC-level guard:** Any new IPC handler that forwards renderer-supplied actions to an executor must route through `validateAction()`.

## Anti-Patterns

### Static-importing lazy modules
**What happens:** Adding `import { executeHeavyAction } from "./actions/action-executor-heavy"` at the top of `action-executor.ts` bundles the heavy code into the main bundle, defeating the lazy-loading split.
**Why it's wrong:** Robotjs + UIA PowerShell code would load on every startup, increasing cold-start time for users who never trigger a desktop action.
**Do this instead:** Keep `await import("./actions/action-executor-heavy")` exactly as in `src/main/action-executor.ts`.

### Caching `actionsEnabled` or `autoGuideEnabled` at the wrong layer
**What happens:** Snapshooting the config in `SEND_PROMPT` and using that cached value during `EXECUTE_ACTION` means a mid-stream toggle has no effect.
**Why it's wrong:** The user expects settings changes to take effect immediately on the next action attempt.
**Do this instead:** Read `config.actionsEnabled` and `config.autoGuideEnabled` live at execution time, as `validateAction()` and `executeAction()` already do.

## Error Handling

**Strategy:** Errors are logged to `src/main/logger.ts` (file + console). Renderer-visible errors flow through `IPC.STREAM_ERROR`. Action failures are sent as `IPC.ACTION_RESULT` with `success: false`.

**Patterns:**
- PowerShell script failures fall back to proceeding without context or showing a generic error.
- OpenCode timeout/kill uses an idle-based timer (3 min) that resets on every streamed event.
- Silent failures (exit 0, no text) surface a diagnostic message that includes any captured stderr.
- `userStoppedCurrentResponse` flag suppresses generic error surfacing when the user intentionally clicks Stop.

## Cross-Cutting Concerns

**Logging:** `src/main/logger.ts` — writes to `%APPDATA%/mudrik/hoverbuddy.log` (legacy name) and console. Used pervasively for main-process diagnostics.

**Validation:** `validateAction()` in `src/main/action-executor.ts` is the single IPC-level guard for all action payloads. Schema checks are strict (type, required fields, bounds ranges).

**Authentication:** API keys are stored in plaintext in `config.json` under `Config.apiKeys`. `buildProviderEnv` maps them to provider-specific env vars. Shell-level env vars take precedence.

---

*Architecture analysis: 2026-05-24*
