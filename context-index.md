# Context Index

AI's map of hidden knowledge in this repo. Before acting on any task, read this file first. If a relevant file is listed, read it explicitly — never assume its content.

## How to use

- **Before acting**: check this index. If a file matches your task, read it.
- **After discovery**: if a file proves useful, add it here immediately.
- **Format**: `- file_path | purpose | when_to_read`

---

## Project identity

- `CLAUDE.md` | Internal dev guide — architecture, conventions, critical rules, UIA capture details | Always read first. Contains system architecture, request flow, sandbox enforcement, PowerShell bridge docs, UIA context capture findings.
- `AGENTS.md` | AI agent operational instructions — build commands, architecture notes, security rules, key files table | Read when starting any session. Compact version of CLAUDE.md for agents.
- `.opencode/instructions.md` | LLM coding rules — simplicity, surgical changes, goal-driven execution | Read when making code changes.
- `.opencode/agent/readonly.md` | Sandbox rules for OpenCode agent — tool allowlist | Read when working with OpenCode subprocess.

## Architecture & design

- `src/shared/types.ts` | Single source of truth for IPC names, `ActionType`, `Config`, `ContextPayload` | Read when adding IPC channels or modifying action types.
- `src/shared/prompts.ts` | `SYSTEM_PROMPT` template; `buildSystemPrompt()` composes BASE + ACTION + GUIDE blocks | Read when modifying AI behavior or prompt structure.
- `src/shared/providers.ts` | Provider→env-var mapping; `buildCleanOpenCodeEnv` | Read when adding/modifying LLM providers.
- `webpack.config.js` | Eight webpack bundles (main, preload, area-preload, renderer, guide-overlay, calibrate) | Read when modifying build config or adding new entry points.

## UIA & context capture (core feature)

- `src/main/context-reader.ts` | PowerShell script generation for UIA tree walking — wake-up, TreeWalker traversal, element extraction | Read when modifying UIA capture, tree walking, or element detection. Script version: v28.
- `src/main/area-scanner.ts` | PowerShell script for area-based UIA scanning from RootElement | Read when modifying area selection capture. Script version: v11.
- `src/main/actions/action-executor-heavy.ts` | PowerShell scripts for element finding (find-element v10) and UIA actions (uia-action v5) | Read when modifying click/type/invoke actions.
- `src/main/powershell-runner.ts` | Spawns PowerShell scripts, handles temp file I/O | Read when modifying PS script execution.
- `D:\SandBoX\Mudrik-Plan\UIA-Chromium-Expert-Reference.md` | Deep-dive UIA + Chromium reference — architecture, wake-up, tree walking, OOPIF, edge cases, CDP | Read when investigating UIA issues or iframe problems.
- `D:\SandBoX\Mudrik-Plan\docs\specs\2026-05-13-uia-architecture-and-perf-analysis.md` | UIA performance analysis and architecture spec | Read when optimizing UIA capture performance.

## Guide system (auto-guide)

- `src/main/guide/guide-overlay.ts` | Owl overlay window — virtual desktop span, physical→logical coordinate conversion | Read when modifying overlay positioning or multi-monitor support.
- `src/main/guide/guide-controller.ts` | Guide session state machine, `boundsHintToPhysical()` | Read when modifying guide flow or coordinate handling.
- `src/main/guide/guide-overlay-preload.ts` | Preload for guide overlay window | Read when modifying overlay IPC.
- `src/main/guide/active-window.ts` | HWND utilities, `getActiveHwnd`, `setForegroundHwnd`, `sendCtrlV` | Read when working with window focus or keyboard input.
- `D:\SandBoX\Mudrik-Plan\docs\specs\2026-05-03-auto-guide-design.md` | Full auto-guide design spec — state machine, prompt content, edge cases | Read when modifying guide behavior.
- `D:\SandBoX\Mudrik-Plan\docs\plans\2026-05-03-auto-guide-plan.md` | Auto-guide implementation plan | Read when planning guide-related changes.

## Calibration tool

- `src/main/calibrate/calibrate-window.ts` | Calibration IPC handlers — capture, test-target, cursor tracking | Read when modifying calibration diagnostics.
- `src/main/calibrate/calibrate-renderer.ts` | Calibration UI renderer — candidate display, test cursor | Read when modifying calibration UI.
- `src/main/calibrate/calibrate.html` | Calibration window HTML/CSS | Read when modifying calibration layout.
- `src/main/calibrate/calibrate-preload.ts` | Preload for calibration window | Read when modifying calibration IPC bridge.

## Actions & execution

- `src/main/action-executor.ts` | Action dispatcher — `parseActionsFromResponse`, `validateAction`, thin dispatcher | Read when adding/modifying action types or parsing logic.
- `src/main/ipc-handlers.ts` | All IPC wiring, context formatting, auto-guide lazy init | Read when adding new IPC channels or modifying context flow.

## Config & state

- `src/main/config-store.ts` | Config persistence, legacy migration, agent file provisioning | Read when modifying config handling.
- `src/main/index.ts` | Main entry — window lifecycle, hotkey wiring, tray | Read when modifying app startup or window management.
- `src/main/opencode-client.ts` | Spawns and streams from OpenCode CLI binary | Read when modifying AI subprocess communication.
- `src/main/vision.ts` | Screenshot capture and optimization | Read when modifying image capture.
- `src/main/ocr.ts` | OCR script for text extraction from screenshots | Read when modifying text recognition.

## Build & CI

- `package.json` | Dependencies, scripts (`build`, `start`, `dev`, `test`, `pack:dir`) | Read when modifying dependencies or scripts.
- `tsconfig.json` | TypeScript config — `strict: true` | Read when modifying TS settings.
- `electron-builder.yml` | Electron builder config — Windows target, asar unpack | Read when modifying packaging.
- `.github/workflows/build.yml` | CI: `npm ci` → `tsc --noEmit` → `npm run build` → `npm run check:no-env` → `electron-builder --win --dir` | Read when modifying CI pipeline.
- `.github/workflows/release.yml` | Release: same + `electron-builder --win --publish always` on `v*.*.*` tags | Read when modifying release process.
- `vitest.config.ts` | Test config — `node` environment, `src/**/*.test.ts` | Read when modifying test setup.
- `scripts/prune-platform-bins.js` | Post-install: prunes cross-platform native binaries | Read when modifying install scripts.
- `scripts/check-no-env.js` | Pre-release: scans for leaked `.env` files and token strings | Read when modifying security checks.

## Tests

- `src/shared/prompts.test.ts` | 21 tests for prompt generation | Read when modifying prompts.
- `src/main/action-executor.test.ts` | 17 tests for action parsing | Read when modifying action parsing.
- `src/main/guide/guide-controller.test.ts` | 20 tests for guide controller | Read when modifying guide logic.

## External references (Mudrik-Plan repo)

- `D:\SandBoX\Mudrik-Plan\README.md` | Project overview and assets | Read for project context.
- `D:\SandBoX\Mudrik-Plan\docs\ROADMAP.md` | Product roadmap | Read when planning features.
- `D:\SandBoX\Mudrik-Plan\docs\CLAUDE.md` | Plan repo's internal guide | Read when working in plan repo.
- `D:\SandBoX\Mudrik-Plan\marketing\` | Marketing strategy, hooks, posts, video scripts | Read when working on public messaging.
- `D:\SandBoX\Mudrik-Plan\proposal\` | Project proposal and documentation | Read for project pitch context.

## Key conventions

- **Script versioning**: bump `SCRIPT_NAME` version (e.g. `v27` → `v28`) to force cached `.ps1` rewrite on next launch.
- **TreeWalker over FindAll**: `TreeWalker.RawViewWalker` crosses UIA fragment boundaries that `FindAll(Children)` misses. Use TreeWalker for all tree traversal.
- **Document elements never skipped**: `ControlType.Document` is excluded from scaffolding skip — iframe containers must always be visible in the tree.
- **Physical vs logical coordinates**: UIA returns physical pixels. Electron expects logical. `showOverlay` handles the conversion internally.
- **Chromium wake-up**: register UIA focus handler (no-op) + send `WM_GETOBJECT` to foreground HWND. Both are needed.
