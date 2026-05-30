# Codebase Structure

**Analysis Date:** 2026-05-24

## Directory Layout

```
[project-root]/
├── src/
│   ├── main/           # Electron main-process logic
│   │   ├── guide/      # Auto-Guide lazy-loaded overlay + controller
│   │   ├── actions/    # Heavy action executor (lazy-loaded)
│   │   └── calibrate/  # Calibration overlay window for UIA misalignment
│   ├── renderer/       # React UI panel
│   │   └── components/ # React components
│   ├── shared/         # IPC contracts, prompts, providers, i18n
│   └── preload.ts      # Panel preload script (bridges ipcRenderer)
├── dist/               # Webpack output (required before launch)
├── release/            # electron-builder output
├── assets/             # Icons, images (owl-wing-pointer.png, icon.png)
├── scripts/            # Postinstall prune + env-leak-check
├── .opencode/          # Agent permission files (readonly.md)
├── .github/workflows/  # CI: build.yml, release.yml
├── webpack.config.js   # Eight-bundle production config
├── package.json
├── tsconfig.json       # strict: true
├── vitest.config.ts    # Node env, src/**/*.test.ts
└── electron-builder.yml
```

## Directory Purposes

**`src/main/`:**
- Purpose: Every file that runs in the Electron main process
- Contains: IPC handlers, window lifecycle, UIA/vision bridges, OpenCode client, config store, updater, tray, hotkeys, logger
- Key files: `src/main/index.ts`, `src/main/ipc-handlers.ts`, `src/main/opencode-client.ts`, `src/main/action-executor.ts`, `src/main/context-reader.ts`, `src/main/vision.ts`, `src/main/config-store.ts`

**`src/renderer/`:**
- Purpose: React-based UI that runs inside the panel BrowserWindow
- Contains: Entry point, root App component, reusable components, global CSS
- Key files: `src/renderer/index.tsx`, `src/renderer/App.tsx`, `src/renderer/styles/global.css`

**`src/shared/`:**
- Purpose: Pure types/constants/string maps shared by both processes
- Contains: IPC names, Action/Config types, system prompt builder, provider mapping, i18n dictionary
- Key files: `src/shared/types.ts`, `src/shared/prompts.ts`, `src/shared/providers.ts`, `src/shared/i18n.ts`

**`src/main/guide/`:**
- Purpose: Auto-Guide multi-step walkthrough system
- Contains: Controller, overlay window/renderer/preload, mouse hook, active-window helpers
- Loaded: Entirely via dynamic `import()` — never statically referenced
- Key files: `src/main/guide/guide-controller.ts`, `src/main/guide/guide-overlay.ts`, `src/main/guide/guide-overlay.html`

**`src/main/actions/`:**
- Purpose: Heavy desktop-interactive action implementation
- Contains: `action-executor-heavy.ts` (robotjs + UIA PowerShell)
- Loaded: Lazy-loaded from `src/main/action-executor.ts` via dynamic import

**`src/main/calibrate/`:**
- Purpose: Optional fullscreen overlay for fixing UIA DPI misalignment
- Contains: Preload, renderer, HTML for a click-through calibration window

## Key File Locations

**Entry Points:**
- `src/main/index.ts` — Electron main process entry (webpack bundle `main.js`)
- `src/renderer/index.tsx` — React mount point (webpack bundle `renderer.js`)
- `src/preload.ts` — Panel preload (webpack bundle `preload.js`)
- `src/main/area-preload.ts` — Area selection overlay preload (webpack bundle `area-preload.js`)

**Configuration:**
- `package.json` — main: `dist/main.js`; dependencies: electron, robotjs, koffi, react, react-dom
- `webpack.config.js` — eight-bundle production config with `electron-main` / `electron-preload` / `web` targets
- `tsconfig.json` — `strict: true`; `paths: { "@shared/*": ["src/shared/*"] }`
- `vitest.config.ts` — `environment: "node"`; only `src/**/*.test.ts`
- `electron-builder.yml` — Windows only; `asarUnpack` for `robotjs`

**Core Logic:**
- `src/shared/types.ts` — IPC names, `ActionType`, `Config`, `ContextPayload`, `UIElement`
- `src/shared/prompts.ts` — `BASE_PROMPT`, `buildSystemPrompt()`, `ACTION_PROMPT_*`, `GUIDE_PROMPT_*`
- `src/shared/providers.ts` — `providerFromModelId()`, `buildCleanOpenCodeEnv()`, `buildProviderEnv()`
- `src/main/ipc-handlers.ts` — All IPC wiring, context formatting, auto-guide lazy init, `sendFollowUp`
- `src/main/index.ts` — Window creation, positioning, pointer/area activation flow
- `src/main/opencode-client.ts` — Spawns `opencode run`, sessions, kill-switch, env isolation
- `src/main/action-executor.ts` — Marker parsing, validation, thin dispatcher (`copy_to_clipboard` inline)
- `src/main/config-store.ts` — Config persistence, rebrand migration, agent provisioning

**Testing:**
- `src/shared/prompts.test.ts`
- `src/main/action-executor.test.ts`
- `src/main/guide/guide-controller.test.ts`
- `vitest.config.ts` — only `src/**/*.test.ts`, node environment

## Naming Conventions

**Files:**
- kebab-case for all source files (`action-executor.ts`, `guide-overlay.ts`)
- `.test.ts` suffix for test files
- `.tsx` for React components only

**Directories:**
- kebab-case (`guide-overlay-preload.ts` inside `guide/`, `action-executor-heavy.ts` inside `actions/`)

**IPC channels:**
- SCREAMING_SNAKE_CASE in `src/shared/types.ts` (`SEND_PROMPT`, `STREAM_TOKEN`, `CONTEXT_READY`)

**Functions / variables:**
- camelCase in TS (`handlePointerActivate`, `calculatePanelPosition`)
- PascalCase for React components (`App`, `ChatInput`, `OwlMascot`)
- UPPER_SNAKE_CASE for module-level consts (`DEFAULT_CONFIG`, `ALLOWED_TOOLS`, `IDLE_TIMEOUT_MS`)

## Where to Add New Code

**New IPC channel:**
- Add name to `IPC` object in `src/shared/types.ts`
- Wire in `src/preload.ts` (expose on `window.hoverbuddy`)
- Handle in `src/main/ipc-handlers.ts`

**New desktop action:**
- Add to `ActionType` union in `src/shared/types.ts`
- Add to `ALLOWED_ACTION_TYPES` in `src/main/action-executor.ts`
- Implement handler in `src/main/actions/action-executor-heavy.ts` (lazy path) or inline in `action-executor.ts` if lightweight
- If the new action should be considered "interactive", add to `INTERACTIVE_ACTION_TYPES` in `action-executor.ts`

**New React component:**
- Create in `src/renderer/components/` as `.tsx`
- Import and use from `src/renderer/App.tsx`
- Styles go in `src/renderer/styles/global.css` (no CSS-in-JS or component CSS modules)

**New shared type or constant:**
- Add to the relevant file in `src/shared/`
- Import via `@shared/*` alias from both main and renderer

**New PowerShell script:**
- Embed as string literal in the calling TS file (e.g., `src/main/context-reader.ts`, `src/main/actions/action-executor-heavy.ts`)
- Name convention: `hoverbuddy-<feature>-v<N>.ps1` where N increments on changes
- First-use caching writes to `%TEMP%/hoverbuddy/` via `src/main/powershell-runner.ts`

**New test file:**
- Co-locate with the source file (same directory, `.test.ts` suffix)
- Run via `npx vitest run <path>`

## Special Directories

**`dist/`:**
- Purpose: Webpack output directory (main.js, preload.js, renderer.js, area-preload.js, etc.)
- Generated: Yes (by `npm run build`)
- Committed: No (ignored)

**`release/`:**
- Purpose: electron-builder output (`win-unpacked/`, installer `.exe`, `latest.yml`)
- Generated: Yes (by `npm run pack:dir`, `npm run dist`, `npm run release`)
- Committed: No (ignored)

**`src/main/guide/`:**
- Purpose: Entirely lazily loaded. Contains the heaviest optional feature.
- Static imports: None anywhere in the codebase. Only `await import("./guide/...")`.

**`src/main/actions/`:**
- Purpose: Contains `action-executor-heavy.ts`, split into its own lazy chunk.
- Static imports: Only from `action-executor.ts` via dynamic import.

**`.opencode/agent/`:**
- Purpose: Copied into the user's working directory on every launch to enforce agent-level sandbox restrictions
- Key file: `readonly.md` (denies bash/edit/write/webfetch/websearch/task/todowrite/skill)
- Overwrites: Yes — so updated versions propagate after app upgrade

---

*Structure analysis: 2026-05-24*
