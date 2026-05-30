# Codebase Concerns

**Analysis Date:** 2026-05-24

## Tech Debt

### PowerShell Script String Literals
- **Issue:** Large PowerShell scripts are embedded as TypeScript string-array concatenations in `context-reader.ts`, `area-scanner.ts`, `vision.ts`, and `action-executor-heavy.ts`. This makes editing, reviewing, and testing the scripts extremely difficult.
- **Files:** `src/main/context-reader.ts` (v28, 725 lines), `src/main/actions/action-executor-heavy.ts` (980+ lines), `src/main/vision.ts` (288 lines)
- **Impact:** Script changes require re-building the entire Electron main bundle. Debugging a PS issue means console-logging inside TS string interpolation.
- **Fix approach:** Move scripts to `.ps1` files under `src/main/scripts/` and load them via `fs.readFileSync` at compile time (webpack `raw-loader`) or runtime. Bumping the version string (`-v28`, `-v10`) would then be a file rename, not a code edit.

### Monolithic IPC Handlers (`ipc-handlers.ts`)
- **Issue:** `registerIpcHandlers` is 1678 lines — it mixes IPC wiring, prompt formatting, context lifecycle, image lifecycle, session restoration, idle-timeout logic, guide lazy-init, action dispatch, and OpenCode event handling.
- **Files:** `src/main/ipc-handlers.ts`
- **Impact:** Any change to one flow (e.g., screenshot attach) risks regressing another (e.g., guide follow-up). Unit testing is nearly impossible because the module exports almost no pure functions.
- **Fix approach:** Extract `formatWindowTree`, `formatVisibleWindows`, `computeContextHash`, `filterToolArtifactLines`, `cleanAssistantContent` into a `src/main/prompt-builders/` module. Extract session/state management into a `SessionManager` class. Extract guide follow-up logic into `src/main/guide/follow-up.ts`.

### Versioned Script Caching in `%TEMP%/hoverbuddy/`
- **Issue:** Script paths are cached in module-level variables (`scriptPath`, `findScriptPath`, `uiaScriptPath`, `captureScriptPath`). Changing the version string in source does **not** invalidate the cached path if the old file still exists on disk — the code skips writing when `fs.existsSync(path)` is true.
- **Files:** `src/main/context-reader.ts:494-508`, `src/main/actions/action-executor-heavy.ts:568-580`, `src/main/vision.ts:130-150`
- **Impact:** A user with an old `-v3` capture script on disk will never receive the `-v4` fix because the code sees the old file and returns it.
- **Fix approach:** Always write the script on first use (overwrite), or hash the script content and store the hash alongside the file to detect drift.

## Known Bugs

### `findOpenCodeBin` Path Resolution Fragility
- **Symptoms:** On some Windows installs the binary is not found even when `opencode-ai` is globally installed, causing "Could not find opencode binary" errors.
- **Files:** `src/main/opencode-client.ts:396-433`
- **Trigger:** `npm` installed to a non-default global prefix, or the user used `bun` / `pnpm` instead of `npm`.
- **Workaround:** Manually check known paths, then fall back to `npm config get prefix`. Better: also check `which opencode` equivalent via `where.exe opencode` or `npm root -g`.

### Robotjs Keyboard Input Broken on Node 25.5+
- **Symptoms:** `robotjs.keyTap("v", ["ctrl"])` throws `"Invalid key code specified"`, causing every `paste_text` to fall through to slower fallback paths.
- **Files:** `src/main/actions/action-executor-heavy.ts:119-169`
- **Trigger:** Node.js >= 25.5 (or any Electron bump that pulls in a newer Node ABI).
- **Current mitigation:** The paste path was rewritten to use `koffi` `keybd_event` inside the Electron process (`sendCtrlV` in `active-window.ts`). The `press_keys` path still relies on robotjs and has a PowerShell `SendKeys` fallback that is known to steal foreground.

### PowerShell Foreground Steal
- **Symptoms:** When an action spawns PowerShell, the PS window briefly becomes foreground, so `GetForegroundWindow()` inside the script returns PowerShell's own HWND instead of the user's app. This causes element-find to walk the wrong UIA tree.
- **Files:** `src/main/actions/action-executor-heavy.ts:606-624`, `src/main/context-reader.ts:516-531`
- **Trigger:** Every `findElementBounds` call that doesn't have a cached `lastUserAppHwnd`.
- **Current mitigation:** Pass `TargetHwnd` explicitly from the Node side (`getLastUserAppHwnd()` or `getActiveHwnd()`). This is fragile because `lastUserAppHwnd` is cached at `setContext` time and may be stale if the user alt-tabbed after opening the panel.

## Security Considerations

### API Keys in Plaintext `config.json`
- **Risk:** `Config.apiKeys` (provider → key map) is persisted in `%APPDATA%/mudrik/config.json` as plaintext. No `safeStorage` or OS keychain integration.
- **Files:** `src/main/config-store.ts:194-205`
- **Current mitigation:** File is in the user's own profile; not world-readable. The leak guard (`scripts/check-no-env.js`) prevents shipping keys in build artifacts.
- **Recommendations:** Evaluate Electron `safeStorage` for at-rest encryption of keys. Document the plaintext trade-off clearly in any security audit.

### Two-Layer Sandbox Enforcement
- **Risk:** The AI subprocess is sandboxed by (1) copying `.opencode/agent/readonly.md` into the working dir, and (2) a runtime kill-switch in `opencode-client.ts`. If either layer is bypassed (e.g., OpenCode ignores the agent file, or a new tool name is not in `ALLOWED_TOOLS`), the model could execute arbitrary code.
- **Files:** `src/main/opencode-client.ts:44-80`, `src/main/config-store.ts:57-77`
- **Current mitigation:** The kill-switch is now an **allowlist** (not a denylist) after the `playwright_browser_navigate` leak. `detectDisallowedTool` SIGKILLs the subprocess on any tool outside `{read, grep, glob, list, webfetch, websearch}`. Additionally, `ensureIsolatedOpenCodeConfig` overrides `XDG_CONFIG_HOME` with an empty-MCP config, cutting off any globally registered MCP servers before OpenCode starts.
- **Never weaken accidentally:** Any new built-in read tool from OpenCode must be appended to `ALLOWED_TOOLS`. Any new IPC handler that forwards renderer actions must go through `validateAction`.

### IPC-Level Action Validation (`validateAction`)
- **Risk:** A compromised renderer could forge action payloads (e.g., `click_element` with malicious coordinates) to drive the desktop.
- **Files:** `src/main/action-executor.ts:144-181`
- **Current mitigation:** `validateAction` coerces and whitelists `type`, strips unknown fields, and enforces schema bounds (`boundsHint` must be numeric, `options` must include `"Cancel"` for guide steps, `waitMs` clamped to 100–10000). The IPC handlers `EXECUTE_ACTION` and `RETRY_ACTION` call `validateAction` before executing.

## Performance Bottlenecks

### UIA Tree Walk (Context Capture)
- **Problem:** `CollectWindowTree` in the PowerShell script can take 1–5 seconds on apps with large UIA trees (Excel, Word, PowerPoint). The wall-clock budget is capped at 5000 ms, but the user still waits.
- **Files:** `src/main/context-reader.ts` (embedded PS v28)
- **Cause:** Every element is a COM round-trip; 2000 elements × 150 bytes ≈ 300 KB JSON, but the latency is DOM/COM-bound, not bandwidth-bound.
- **Improvement path:** Parallel subtree walking (multiple `TreeWalker` threads) is hard in PowerShell. Long-term: consider a C-native UIA bridge or caching the tree across hotkey presses when the HWND/classname hasn't changed.

### Screenshot + UIA Parallel Capture in Guide Follow-Up
- **Problem:** After every guide step, the app hides the panel, restores foreground, runs a full-screen screenshot, and re-reads the entire UIA tree — a 1–4 second gap.
- **Files:** `src/main/ipc-handlers.ts:388-461`
- **Cause:** Panel must be hidden so it doesn't appear in the screenshot or UIA tree; Windows foreground restoration is unreliable and requires retry + sleep.
- **Improvement path:** Cache the previous tree and do a shallow diff; only re-walk the subtree around the expected next target. Alternatively, use a smaller region screenshot instead of full-screen.

### Idle Timeout (3 Minutes)
- **Problem:** The `IDLE_TIMEOUT_MS` is 180000 ms. Some genuinely slow models (deep reasoning) hit this on large context. Earlier it was 90 s (too short) then 5 min (too long).
- **Files:** `src/main/ipc-handlers.ts:1086`
- **Improvement path:** Make the timeout user-configurable, or auto-detect based on average token latency.

## Fragile Areas

### `press_keys` Robotjs + SendKeys Fallback Chain
- **Files:** `src/main/actions/action-executor-heavy.ts:171-239`
- **Why fragile:** Robotjs keyboard input is already broken on newer Node versions. The fallback spawns a PowerShell process that can steal foreground, misdirecting the keystroke. The `SendKeys` fallback itself is deprecated by Microsoft and has known timing bugs.
- **Safe modification:** Any change to key-input logic must be tested on both old-node (Electron bundled) and any future Node bump. Prefer the `koffi` path (`sendCtrlV`) for all keyboard events if possible.

### `findElementBounds` HWND Cache (`lastUserAppHwnd`)
- **Files:** `src/main/guide/active-window.ts` (lazy-cached), `src/main/actions/action-executor-heavy.ts:607-609`
- **Why fragile:** The cached HWND is set at `setContext` time. If the user alt-tabs between setting context and executing the action, the cached HWND points to the wrong window. The fallback `getActiveHwnd()` then returns Mudrik's own panel because it was foreground when the IPC handler ran.
- **Safe modification:** Never remove the explicit `TargetHwnd` parameter from the PowerShell scripts. Add a foreground-verification step before `findElementBounds` executes.

### Guide Controller Singleton (`getController`)
- **Files:** `src/main/guide/guide-controller.ts:406-417`
- **Why fragile:** Global mutable singleton with no lifecycle management. Tests must manually call `_resetSingletonForTests()`. If the main process reloads (e.g., in dev), the old controller state may persist.
- **Safe modification:** Wrap controller creation in a factory function that the main process explicitly owns, rather than a module-level singleton.

### `getPanelWindow()` URL Heuristic
- **Files:** `src/main/ipc-handlers.ts:136-145`
- **Why fragile:** It iterates `BrowserWindow.getAllWindows()` and skips any URL containing `"guide-overlay.html.html"`. If a future overlay URL changes, or if another window is added (calibrate, updater), this heuristic breaks and IPC sends end up in the wrong window.
- **Safe modification:** Store the reference to the panel window in a typed variable at creation time instead of re-discovering it by URL.

## Scaling Limits

### Context Block Budget (60 000 chars)
- **Current capacity:** The maximum context block is 60 000 characters, which becomes ~15 000 tokens for typical models.
- **Limit:** On apps like Excel with 2000+ cells, the tree alone can approach this cap, forcing truncation of the "YOU POINTED AT" section which is the most important part.
- **Scaling path:** Truncation currently keeps the target section intact and trims the tail (window tree / visible windows). A smarter tiered prioritization (keep target, keep ancestors, keep siblings, then cap the rest) would improve signal.

### Image Size Cap (200 KB / 1 MB hard)
- **Current capacity:** Screenshots are compressed to ~200 KB JPEG. If compression fails, anything > 1 MB is discarded entirely.
- **Limit:** High-DPI 4K screens can produce PNGs > 5 MB before compression. The aggressive resize loop (scale down to 0.25×, quality 15) may produce unusable images.
- **Scaling path:** Use a faster native capture library (e.g., `screenshot-desktop`) or capture only the region around the target element instead of full-screen.

## Dependencies at Risk

### `robotjs`
- **Risk:** Unmaintained (last commit 2022). Native module rebuild is fragile on Node version bumps. Keyboard input is already broken on Node 25.5+.
- **Impact:** Every desktop action (click, type, key press) depends on it. The `paste_text` path was rewritten to `koffi`, but mouse clicks and generic `press_keys` still use `robotjs`.
- **Migration plan:** Gradually replace `robotjs` with `koffi` bindings to `SendInput` / `mouse_event`. Mouse movement (`moveMouse`, `mouseClick`) is the last remaining `robotjs` surface.

### `koffi`
- **Risk:** Native FFI module. Works for now, but any Electron major version upgrade may require a rebuild.
- **Impact:** Used for `sendCtrlV` (paste) and `setForegroundHwnd` / `getActiveHwnd` (HWND manipulation).
- **Mitigation:** It is marked as `externals` in webpack, so it loads from `node_modules` at runtime, not bundled.

### `opencode-ai` CLI Binary
- **Risk:** The app depends on a globally installed `npm i -g opencode-ai` binary found via hardcoded paths + `npm config get prefix`. No bundled fallback.
- **Impact:** If the binary is missing or moved, the app is unusable. If OpenCode releases a breaking change in CLI JSON format, the parser in `opencode-client.ts` will break.
- **Migration plan:** Consider bundling a pinned version of the OpenCode CLI or switching to the `@opencode-ai/sdk` package for programmatic usage.

## Missing Critical Features

### No DOM / WebView Testing
- **Problem:** There are no automated tests for the renderer IPC bridge (`preload.ts`), the React UI (`src/renderer/`), or the guide overlay. All existing tests are Node-side vitest (`src/main/**/*.test.ts`).
- **Files:** `vitest.config.ts`
- **Blocks:** UI refactoring is risky because there is no regression safety net for renderer-side changes.

### No Linter / Formatter
- **Problem:** `CLAUDE.md` and `AGENTS.md` both state "No test runner, linter, or formatter is configured." `package.json` has no `eslint`, `prettier`, or `biome` scripts.
- **Blocks:** Enforcing consistent code style across contributors; catching common TypeScript issues before CI.

## Test Coverage Gaps

### `ipc-handlers.ts` (1678 lines, 0 tests)
- **What's not tested:** Prompt formatting, context deduplication (`computeContextHash`), idle timeout logic, session restoration (`RESTORE_SESSION`), image lifecycle (`cleanupImage`), guide follow-up wiring.
- **Risk:** Any change to the system prompt format or the context block truncation logic could break the model's ability to parse UIA data. No automated way to verify.
- **Priority:** High

### `opencode-client.ts` (434 lines, 0 tests)
- **What's not tested:** `detectDisallowedTool` kill-switch, silent-failure diagnostics, session continuity (`--continue` / `--session`), `findOpenCodeBin` resolution.
- **Risk:** A refactor of the allowlist or the event parsing could accidentally disable the sandbox or misidentify a benign tool as malicious.
- **Priority:** High

### `action-executor-heavy.ts` (980+ lines, 0 tests)
- **What's not tested:** `findElementBounds`, `uiaAction`, `pressKeys`, `pasteText`, `smoothMoveCursorTo`, `showPulseHighlight`.
- **Risk:** The PowerShell script generation and execution paths are entirely untested. A typo in the embedded PS (e.g., a missing closing brace) will only be discovered at runtime.
- **Priority:** Medium — these require mocking `runPowerShell` and `robotjs`.

### `context-reader.ts` (725 lines, 0 tests)
- **What's not tested:** `readContextAtPoint`, `readElementAtPoint`, `readForegroundWindow`, `dotNetToUIElement`, the embedded PowerShell script v28.
- **Risk:** UIA tree parsing changes (e.g., a new field from the PS script) could crash `dotNetToUIElement`.
- **Priority:** Medium

---

*Concerns audit: 2026-05-24*
