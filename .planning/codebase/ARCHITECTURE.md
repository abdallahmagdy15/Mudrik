# ARCHITECTURE.md

## System Architecture

### Overview
Mudrik is an **Electron tray application** that provides an AI-powered desktop assistant overlay. It captures UI context from any Windows application, sends it to an LLM via OpenCode CLI, and can execute desktop actions (click, type, navigate) based on the response.

### Process Model
```
┌─────────────────────────────────────────────────────────────┐
│                      Electron Main Process                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Main       │  │   IPC        │  │   OpenCode       │  │
│  │   Window     │  │   Handlers   │  │   Client         │  │
│  │   (index.ts) │  │              │  │   (spawns CLI)   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                  │
│         ▼                 ▼                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Tray       │  │   Config     │  │   Action         │  │
│  │   (tray.ts)  │  │   Store      │  │   Executor       │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Hotkey     │  │   Context    │  │   Guide          │  │
│  │   Listener   │  │   Reader     │  │   Controller     │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ ipcRenderer
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   App.tsx    │  │   Chat       │  │   Response       │  │
│  │              │  │   Input      │  │   View           │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Action     │  │   Context    │  │   Owl            │  │
│  │   Bar        │  │   Preview    │  │   Mascot         │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Key Architectural Patterns

#### 1. IPC Bridge (`src/preload.ts`)
The preload script exposes a `window.hoverbuddy` API to the renderer:
- All IPC event names defined in `src/shared/types.ts` `IPC` object
- Renderer calls methods → `ipcRenderer.invoke()` → Main handlers
- Two-way communication for streaming responses

#### 2. Lazy Loading
Two modules are entirely lazy-loaded via dynamic `import()`:
- `src/main/guide/` — Auto-Guide feature (mouse-hook, overlay window)
  - Static import would pull native dependencies into cold-start path
- `src/main/actions/action-executor-heavy.ts` — Desktop automation
  - Thin dispatcher (`action-executor.ts`) handles `copy_to_clipboard` inline
  - Everything else forwarded via `await import("./actions/action-executor-heavy")`

#### 3. Context Lifecycle
```
Hotkey Press → Capture Screenshot → Read UIA Context → 
Build Prompt → Send to OpenCode → Stream Response → 
Parse Actions → Validate → Execute
```

**Deduplication**: `computeContextHash()` in `ipc-handlers.ts` prevents re-sending identical context when panel reopened on same UI.

**Cleanup**: `cleanupImage()` deletes screenshot temp files when context changes. Always funnel through this function.

#### 4. Action Execution Pipeline
```
LLM Response Text → parseActionsFromResponse() → 
Extract <!--ACTION:{json}--> markers → validateAction() → 
executeAction() (thin) → action-executor-heavy.ts (heavy)
```

All desktop side effects flow through `<!--ACTION:{json}-->` markers in plain text.

#### 5. Security: Two-Layer Sandbox
1. **Static**: `.opencode/agent/readonly.md` copied to working dir on every launch
2. **Runtime**: `detectDisallowedTool()` kills process if model uses unauthorized tools
3. **IPC**: `validateAction()` sanitizes every renderer-supplied action payload

#### 6. Config Live-Reading
`Config.actionsEnabled` and `Config.autoGuideEnabled` are read **live** at execution time:
- Never cached in closures
- `buildSystemPrompt()` builds fresh action/guide blocks on every non-followup send
- Mid-conversation toggles land on next context capture (not auto-triggered)

#### 7. PowerShell as UIA Bridge
PowerShell scripts embedded as string literals in:
- `context-reader.ts`
- `area-scanner.ts`
- `vision.ts`
- `action-executor-heavy.ts`

Scripts versioned (e.g., `-v3`, `-v6`) to force cache invalidation on updates.

### Window Types
1. **Main Panel** — Frameless, transparent, positioned near cursor, acrylic background
2. **Area Selection Overlay** — Fullscreen overlay for drag-to-select regions
3. **Guide Overlay** — Fullscreen overlay for cursor auto-guidance
4. **Calibration Overlay** — For guide calibration

### State Management
No Redux or global state library. State managed via:
- `config-store.ts` — persisted config (`%APPDATA%/mudrik/config.json`)
- Module-level variables in main process (e.g., `mainWindow`, `config`)
- React `useState` / `useEffect` in renderer
- IPC for cross-process state sync
