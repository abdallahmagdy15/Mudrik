# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical rule: manual approval required

**NEVER commit, submit, push, publish, release, or delete any changes without explicit manual review and approval by the owner/user.** This applies to every operation that mutates shared state, including but not limited to:

- Git commits and pushes (also: amend, rebase, force-push, reset --hard)
- Publishing packages or releases
- Deleting files, branches, or resources
- Submitting PRs or merging code
- Deploying or releasing anything

Default flow after making code changes: apply the edits, run build/tests if relevant, then **stop and present the result for review**. Wait for an explicit instruction like "commit", "push", "ship it", or equivalent before performing the destructive/shared-state action. The only exception is when the user gives explicit standing instructions to proceed without per-step review (e.g. "go ahead and commit + push as you finish each task").

## General behavior

- **Concise comments in code.** Default to no comments. When a comment IS warranted (non-obvious WHY, hidden invariant, deliberate workaround), keep it short and load-bearing — no narration of what the code already says.

## Update summary format

After making project updates, **always end the response with a brief bullet section** in this exact shape:

- **Files touched** — every file modified or created in this round (one per line, with a one-phrase note if not obvious)
- **Pending actions** — anything that still needs manual follow-up: commit, push, deploy, publish, migrate, restart, manual test, external service action
- **Changes to review** — a checklist of the user's recent requirements / fixes / requests this round actually addresses, so they can verify nothing was missed

Skip the section only when the response made no project changes (pure Q&A).

## Documentation rules

After any feature ships, bug is fixed, or design decision is made — **after the user has reviewed it and the commit has landed** — update the relevant **internal** docs to match reality. That includes this `CLAUDE.md`, design specs, system architecture notes, and any in-repo planning files. The Mudrik internal-planning repo lives at `D:\SandBoX\Mudrik-Plan` (separate git repo, private). Specs/plans this codebase references live under `D:\SandBoX\Mudrik-Plan\docs\specs\` and `D:\SandBoX\Mudrik-Plan\docs\plans\` — same `Mudrik-Plan/...` paths used elsewhere in this file are shorthand for that repo.

**Internal docs auto-update.** Don't ask permission for these — keep them in sync as part of the same task.

**Public / user-facing docs require user permission first.** Never edit `README.md`, the published landing page (`docs/index.html`), `SECURITY.md`, `CONTRIBUTING.md`, release notes, or anything else a public reader might see — without first proposing the change and getting explicit approval. Suggest the edit, show what would change, wait for "yes."

The split exists because internal docs are tools for the dev (drift = future bugs) while public docs are part of the product surface (drift = trust + brand risk).

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

### Auto-Guide mode (multi-step UI walkthroughs)

Opt-in feature, off by default (toggle in ⚙ → "Enable Auto-Guide"). When on, the AI walks the user through 3+ step UI tasks instead of doing them itself: shows an owl-wing pointer over each target, waits for the user to click, then captures the new screen state and decides the next step.

`src/main/guide/` is **entirely lazy-loaded** via dynamic `import()` — nothing in this directory is statically referenced anywhere; the modules don't enter the runtime graph until the user toggles the feature on AND the AI emits a `guide_*` marker. Same pattern as `src/main/actions/action-executor-heavy.ts` (lazy-loaded for read-only mode). Keep it that way: a static import here would pull `mouse-hook` + the overlay window into the cold-start path for users who never use the feature.

`buildSystemPrompt({ actionsEnabled, autoGuideEnabled })` in `src/shared/prompts.ts` composes three blocks: `BASE_PROMPT` (always) + `ACTION_PROMPT_FULL`/`ACTION_PROMPT_AWARE` + `GUIDE_PROMPT_FULL`/`GUIDE_PROMPT_AWARE`. The AWARE stubs (~50 words each) keep the model capability-aware when a feature is OFF — it knows the feature exists and can suggest enabling it, without spending tokens on the full instructions. When ON, the model gets the full constitution.

`Config.autoGuideEnabled` is read live at three layers, never cached:

1. `buildSystemPrompt` reads it on every non-followup send (same lifecycle as `actionsEnabled` above).
2. `validateAction` in `action-executor.ts` blocks `guide_*` markers if false — the IPC-level guard against a forged renderer payload.
3. `executeAction` reads it from caller-supplied `cfg`, so toggling false mid-stream blocks the next guide marker even after the prompt was built with it true.

`src/main/guide/mouse-hook.ts` uses a Windows global low-level mouse hook (WH_MOUSE_LL) via PowerShell + C# `Add-Type`. It runs **only** during the `STEP_ACTIVE` phase of a guide session — started in `handleStep`, stopped on every transition out of STEP_ACTIVE. Scoped to the foreground HWND so panel clicks don't trigger it.

Full design rationale, state machine, prompt content, and edge cases live in `Mudrik-Plan/docs/specs/2026-05-03-auto-guide-design.md`.

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
