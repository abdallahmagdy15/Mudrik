# AGENTS.md — Mudrik (hoverbuddy)

Compact, high-signal notes for OpenCode sessions working in this repo. For full architecture, threat model, and design specs, see [`CLAUDE.md`](CLAUDE.md).

> **Behavioral guidelines:** Also see [`.opencode/instructions.md`](.opencode/instructions.md).

## Critical Rule: Manual Approval Required

**NEVER commit, submit, push, publish, release, or delete any changes without explicit manual review and approval by the owner/user.** This covers git mutations, publishing, deleting files/branches/resources, PRs, merging, and deploying.

**Approval is per-request only.** *"commit and push now"* grants permission for that **specific action at that moment** — not blanket permission for future commits. Ask again before **every** git mutation unless the user has given a standing instruction.

## Behavioral Guidelines

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- Present multiple interpretations — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

### 2. Simplicity First
- Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked. No abstractions for single-use code.
- If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes
- Don't "improve" adjacent code, comments, or formatting.
- Match existing style. Don't refactor things that aren't broken.
- Remove only imports/variables/functions that YOUR changes made unused.

### 4. Goal-Driven Execution
- Define success criteria. Loop until verified.
- For multi-step tasks, state a brief plan with verification checks.

### General Coding Behavior
- **NEVER** use credentials, secrets, API keys, or sensitive configurations without explicit user permission.
- Keep comments concise and brief.
- When developing UI, check helper skills like impeccable.

## Update Summary Format
After making project updates, end every response with a bold bullet list:
- **Summary** — root cause, changes, notes
- **Files touched** — every file modified or created, with brief context
- **Pending actions** — manual follow-up needed (deploy, publish, migrate, restart)
- **Changes to review** — checklist of recent requirements/fixes to verify

## Context Gathering

Before any action — gather first; do not judge or assume.

### Every Session Start
- Read harness instruction files: `CLAUDE.md`, `AGENTS.md`, `.opencode/instructions.md`, etc.
- Restore from memory/local state after compaction events.

### Context Index
Maintain `context-index.md` at project root as a map of visible structure + hidden knowledge (codebase structure, hidden docs, conventions). Before every task, check if doc context is needed first. Never infer file contents — read explicitly.

### External Context & Post-Work Updates
When work depends on external context (schemas, APIs, SDKs), proactively offer to fetch and save it locally. After completing features/bugfixes, update requirements/specs/docs accordingly. Do not update README or published docs without offering first.

## Explaining Technical Concepts
- **Tell a technical story** with direct terminology (no metaphors).
- **Use diagrams** — ASCII art, shapes, connected ideas.
- **Organize logically** — parts, dependencies, execution sequence.
- **Emphasize critical, hard-to-assume parts**.

## TODOs
Maintain a side section or dedicated file (`open-items.md`) to track future tasks and reminders. If told to write to todos, just write — don't implement unless explicitly told to.

## Build & run

- `npm run build` — webpack bundles into `dist/`. **Required before launch** because `package.json > main` is `dist/main.js`.
- `npm start` — build + launch (`webpack && electron .`).
- `npm run dev` — webpack watch mode. Re-run `electron .` manually to pick up main/preload changes; renderer changes hot-reload on window reload.
- `npm test` — vitest, `src/**/*.test.ts` only. No linter or formatter is configured.
- `npm run pack:dir` — unsigned unpackaged build (`release/win-unpacked/`). Faster than `dist` for manual QA.
- `npx tsc --noEmit -p .` — standalone typecheck. CI runs this **before** `npm run build`.
- `npx vitest run <path>` — run a single test file (e.g. `src/main/action-executor.test.ts`).

## Architecture (the non-obvious parts)

- **Windows-only, end-to-end**. UIA, PowerShell script embedding, robotjs, GDI+ capture, and `findOpenCodeBin` path resolution are all Windows-specific. Do not add `process.platform` branches unless you are also porting the PowerShell layer.
- **Electron tray app** (`src/main/index.ts`). The panel is a frameless, transparent `BrowserWindow`. `window-all-closed` is suppressed so the tray icon survives.
- **Eight webpack bundles** (see `webpack.config.js`). The four "core" ones are:
  1. `main.js` (`src/main/index.ts`) — main process.
  2. `preload.js` (`src/preload.ts`) — bridges `ipcRenderer` to renderer as `window.hoverbuddy`.
  3. `area-preload.js` (`src/main/area-preload.ts`) — preload for the fullscreen area-selection overlay.
  4. `renderer.js` (`src/renderer/index.tsx`) — React UI of the panel.
  Plus: guide-overlay preload/renderer, calibrate preload/renderer.
- **`@shared/*` alias** maps to `src/shared/*`. The single source of truth for IPC event names, `ContextPayload`, `Action`, and `Config` types lives in `src/shared/types.ts`. When adding an IPC channel, add the name to the `IPC` object there, wire it in `src/preload.ts`, and handle it in `src/main/ipc-handlers.ts`.
- **`robotjs` and `koffi` are externals** in the main bundle (native modules).
- **`tsconfig.json` has `strict: true`** — typecheck failures are blocking in CI.
- **`postinstall` auto-prunes** cross-platform native binaries (`linux/`, `mac/` under `app-builder-bin` and `7zip-bin`). Do not remove `scripts/prune-platform-bins.js` from `package.json`.
- **Tests run in `node` environment** (`vitest.config.ts`) — there are no DOM or renderer-process tests.
- **electron-builder outputs to `release/`** (`electron-builder.yml > directories.output`). `asarUnpack` unpacks `robotjs` because its `.node` must load from a real disk path.

## Security & sandbox (never weaken accidentally)

- **Desktop actions are embedded markers, NOT tool calls**. The LLM may use OpenCode's read-only tools (`read`, `grep`, `glob`, `list`) for local file lookup, but **all desktop side effects** (click, type, paste, press keys, guide cursor) must flow through `<!--ACTION:{json}-->` markers in plain text. `parseActionsFromResponse` in `action-executor.ts` extracts them. When editing `SYSTEM_PROMPT` in `src/shared/prompts.ts`, keep this split intact — do NOT introduce a tool-call story for desktop actions, and do NOT widen the runtime tool allowlist.
- **Two-layer sandbox enforcement**:
  1. `.opencode/agent/readonly.md` is copied into the working dir on **every launch** by `config-store.ts#ensureAgentInWorkingDir` (overwrites, so updates propagate after upgrade).
  2. **Runtime kill-switch** (`opencode-client.ts#detectDisallowedTool`): inspects every JSON event streamed from OpenCode. If a `permission.asked` or `part.tool` event names anything outside the allowlist (`read`, `grep`, `glob`, `list`, `webfetch`, `websearch`), the subprocess is `SIGKILL`ed and a `Blocked: model attempted to use X` error surfaces.
- **IPC-level guard**: `validateAction` in `action-executor.ts` sanitizes every renderer-supplied action payload. Never wire a new IPC handler that forwards renderer-supplied actions to an executor without going through `validateAction`.

## Lazy-loaded modules (do not static-import)

- `src/main/guide/` — entirely lazy-loaded via dynamic `import()`. Nothing in this directory is statically referenced anywhere. A static import would pull `mouse-hook` + the overlay window into the cold-start path for users who never use Auto-Guide.
- `src/main/actions/action-executor-heavy.ts` — lazy-loaded for the same reason. The thin dispatcher (`action-executor.ts`) handles `copy_to_clipboard` inline and forwards everything else via `await import("./actions/action-executor-heavy")`.

## PowerShell as the UIA bridge

- `context-reader.ts`, `area-scanner.ts`, `vision.ts`, and `action-executor-heavy.ts` embed PowerShell scripts as string literals and write them to `%TEMP%/hoverbuddy/` on first use (see `powershell-runner.ts`).
- Script file names are versioned (`-v3`, `-v6`, etc.). Bumping the version string forces a rewrite of the cached `.ps1`, which is the mechanism to deploy PowerShell changes to already-installed users.
- Scripts write JSON output to a temp file (`-OutputFile`) rather than stdout. `runPowerShell` reads and deletes this file. Do not switch PS scripts back to stdout without understanding the encoding issues this pattern avoids.

## Config & state

- `Config.actionsEnabled` is the master switch for desktop-interactive actions. It is read **live** at execution time, never cached:
  - `validateAction` / `executeAction` read it directly.
  - The system-prompt `actionsBlock` is built fresh on every non-followup send (every Alt+Space / Ctrl+Space that captures new context, since `setContext` / `setAreaContext` flip `contextNeedsSending = true`).
  - Mid-conversation toggles do **not** auto-trigger a re-send. The new setting lands on the **next context capture**.
- `Config.autoGuideEnabled` follows the same live-read pattern at three layers: `buildSystemPrompt`, `validateAction`, and `executeAction`.
- `Config.apiKeys` is a `provider → key` map persisted in plaintext `config.json`. `buildProviderEnv` in `src/shared/providers.ts` translates it into env vars per the OpenCode convention (`anthropic` → `ANTHROPIC_API_KEY`). Existing shell-level env vars win over config.
- `saveConfig` writes to `%APPDATA%/mudrik/config.json`. `config-store.ts#migrateLegacyConfig` copies `%APPDATA%\hoverbuddy\` → `%APPDATA%\mudrik\` on startup for pre-rebrand installs. Do not rename legacy paths.

## OpenCode client

- `opencode-client.ts` spawns `opencode run --format json --agent readonly` as a child process per message.
- `--continue` or `--session <id>` is used for continuity. `resetSession()` clears the ID so the next send starts fresh. `setRestoredSession(id)` re-attaches.
- `activeProcess` tracks the current child so `STOP_RESPONSE` can `SIGKILL` it mid-stream.
- `findOpenCodeBin` resolves the CLI binary from known npm global paths. This is Windows-specific.

## Context & image lifecycle

- `computeContextHash` in `ipc-handlers.ts` deduplicates context to avoid re-sending the same element when the panel is reopened on the same UI.
- `cleanupImage` deletes the screenshot temp file when context changes. Always funnel image deletion through it rather than `fs.unlink` directly, so the bookkeeping for `currentContext.imagePath` / `areaImagePath` stays consistent.

## Release & CI

- `npm run check:no-env` is a leak guard. It scans `dist/` and `release/` for `.env` files and token-shaped strings (e.g., `OLLAMA_API_KEY`). It runs automatically before `npm run dist` and `npm run release`.
- `.github/workflows/build.yml`: `npm ci` → `tsc --noEmit` → `npm run build` → `npm run check:no-env` → `electron-builder --win --dir`.
- `.github/workflows/release.yml`: same, plus `electron-builder --win --publish always` on `v*.*.*` tags.

## Key files

| File | What it owns |
|------|--------------|
| `src/shared/types.ts` | IPC names, `ActionType`, `Config`, `ContextPayload` — single source of truth |
| `src/shared/prompts.ts` | `SYSTEM_PROMPT` template; `buildSystemPrompt()` composes BASE + ACTION + GUIDE blocks |
| `src/shared/providers.ts` | Provider→env-var mapping; `buildCleanOpenCodeEnv` (minimal env to avoid Bun segfaults) |
| `src/preload.ts` | `ipcRenderer` bridge exposed as `window.hoverbuddy` |
| `src/main/ipc-handlers.ts` | All IPC wiring, context formatting, auto-guide lazy init |
| `src/main/index.ts` | Main entry; window lifecycle, hotkey wiring, tray |
| `src/main/opencode-client.ts` | Spawns and streams from the `opencode` CLI binary |
| `src/main/action-executor.ts` | Marker parsing, validation, thin dispatcher |
| `src/main/config-store.ts` | Config persistence, legacy migration, agent-file provisioning |
