# Changelog

All notable changes to Mudrik are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] — 2026-06-10

### Added
- **Quick-chat hotkey (`Alt+X`).** Opens the panel instantly without capturing UIA context, screenshot, or loading spinner. Pure chat mode — no element awareness needed. Rebindable from ⚙ settings.

### Changed
- **Log pruning on startup.** Log files older than 30 days are auto-deleted on every launch to prevent unbounded disk growth.
- **README rewrite.** Tagline updated to include Auto-Guide, hotkeys table tightened, "What it does" refreshed with Chromium auto-screenshot info, features restructured, "How it works" diagram expanded, roadmap removed, privacy table fixed for current screenshot behavior.
- **Website (`docs/`) refreshed** to match README: updated tagline, features, hotkeys (added Alt+X), privacy section. Removed vestigial "Reads files" card, "EN+AR" card, "How it works" code section, version badge, and "signed installer" claim. Nav trimmed to 4 links.

## [1.5.0] — 2026-06-04

### Changed
- **Image pipeline optimized for speed and token cost.** Screenshots now captured at max 1280px resolution (was full physical pixels), encoded directly as JPEG quality 85 (was PNG→JPEG two-pass), and grid overlay selectively disabled for area-selection images. ~3× fewer vision tokens on 1080p, up to 7× on 4K. Capture+optimize time cut by 300-600ms.

## [1.4.0] — 2026-06-04

### Fixed
- **opencode-ai ≥1.15.x compatibility.** `opencode-ai` 1.15+ ships a native Windows binary (`opencode.exe`) instead of the old JS shim (`opencode`). Mudrik now searches for both and spawns correctly: `.exe` directly, JS shim via `node`. Fixes `spawn opencode ENOENT` on PCs with newer opencode-ai installs.

## [1.3.0] — 2026-06-02

### Changed
- **Dropped XDG_DATA_HOME isolation.** Mudrik's opencode subprocesses no longer override `XDG_DATA_HOME`. Sessions, auth, and all opencode state now live at the platform default (`~/.local/share/opencode/` on Windows), the same location a standalone `opencode` CLI uses. `opencode session list` from any terminal now finds Mudrik's sessions — zero env-var setup. Old isolated data at `%APPDATA%\mudrik\opencode-data/` is auto-migrated to the default location on first launch, and the now-empty isolated dirs are cleaned up.
- **API keys no longer mirrored to global auth.json.** The `syncOpenCodeAuth` → `writeOpenCodeAuth` rename restricts key writes to the default opencode auth store only. Keys pasted into Mudrik settings are no longer silently duplicated to the global `~/.local/share/opencode/auth.json`.
- **Model validation errors improved.** Unknown providers and model IDs missing a `/` now produce clear, actionable error messages instead of the generic "not found" text.

### Fixed
- **Model row UI:** the edit-key button now shows a pen icon (`fa-pen`) instead of an ambiguous `×` that looked like a second delete button.
- **Repo hygiene:** untracked `.impeccable/`, `.planning/`, and `.opencode/instructions.md` from the public repository. Moved the dev-only `oopif-diagnostic.ps1` to `scripts/diagnostics/`.

## [Unreleased]

## [1.0.0] — 2026-05-01

### Changed
- **UIA context capture rewritten** — `context-reader.ts` PowerShell script (v22→v28):
  - `GetChildren` uses pure `TreeWalker` instead of `FindAll(Children)` — reliably traverses iframe fragment boundaries
  - `CollectWindowTree` never skips `Document` elements as scaffolding — iframe containers always visible in tree
  - Chromium wake-up always fires (was skipping when main Document already existed, preventing iframe renderer wake)
  - `DpiHelper` C# class simplified to 3 methods (was 7) — removed `EnumChildWindows`, `WakeAllChildren`, `GetClassName`, delegate
  - `TREE_BUDGET_MS` raised from 2500 to 5000ms
  - `TextPattern`/`ValuePattern` removed from `ElDict` for tree-walk elements (only cursor gets deep text via `GetDeepValue`)
  - Fixed missing `"@` here-string terminator that caused entire script to fail
- **Area-scanner** (`area-scanner.ts` v8→v11):
  - `GetChildren` uses pure `TreeWalker`
  - Added UIA focus handler registration for standalone Chromium wake-up
  - `ControlType.Document` added to container types
- **Action executor** (`action-executor-heavy.ts`):
  - `GetChildren` uses pure `TreeWalker` in both find-element (v9→v10) and UIA-action (v4→v5) scripts
- **Calibration tool simplified** — removed multi-strategy diagnostic (desktop scan), restored single-strategy with 50 samples
- **Auto-Guide mode** — Step-by-step walkthroughs with an owl cursor that points to each target and shows step-by-step instructions in a speech bubble. Panel hides during guide sessions. Coordinate grid overlay on screenshots.
- **High-DPI multi-monitor support** — Pixel-perfect coordinates on any display configuration.
- **Timestamp support** — Sessions carry creation timestamps for the recent-chats picker.

### Fixed
- `HasDocumentElement` used invalid `[ControlTypeCondition]::Document` syntax — always threw, causing Chromium wake-up to wait full 2500ms. Fixed to use `PropertyCondition`.
- OOPIF fragment walk from `RootElement` was unnecessary complexity — test proved `TreeWalker` from `FromHandle(hwnd)` already captures iframe content for normal pages
- Area-scanner had no wake-up logic — Chromium returned skeleton tree (5 elements). Added focus handler registration.

## [0.9.0] — 2026-04-24 (Preview)

First public preview release. Pre-v1 — breaking changes possible while the API surface stabilises and we collect feedback.

### Added
- **Multi-provider API key management**. `Config.apiKeys` (provider → key map) injected into OpenCode subprocess env vars via `src/shared/providers.ts`. New `SAVE_API_KEY` IPC + inline "API key for `<provider>`" input in the Model settings section. Per-row ✎ edit + × remove on recent models.
- **Arabic / English i18n** with full RTL support (`Config.lang`, `src/shared/i18n.ts`). Root element flips `dir="rtl"` when Arabic is selected.
- **Frosted glass panel** via native Windows acrylic (`setBackgroundMaterial`) + DWM rounded corners (`DwmSetWindowAttribute` via `koffi`). Electron upgraded 33 → 35.
- **Error boundary** around the React root with a localized crash screen + restart button.
- **Collapsible settings sections** — Model + Hotkeys collapsed by default; Appearance + Behavior expanded. Summary shown in each header.
- **Read-only tool access** for the LLM: `read`, `grep`, `glob`, `list` are now permitted so the model can look up on-disk docs when a question requires them. Write/execute tools (`bash`, `edit`, `write`, `webfetch`, `websearch`, `task`, `todowrite`, `skill`) remain hard-blocked by the runtime kill-switch.
- Contact / About section in README (GitHub, X, LinkedIn, email).
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- This `CHANGELOG.md`.

### Changed
- README trimmed and restructured for open-source launch.
- `CONTRIBUTING.md` now owns the full Develop + Release pipeline sections.
- Settings dropdown `max-height` tightened to `calc(100vh - 76px)` so it never overflows the panel frame.
- Long stream-error strings (>120 chars) are replaced with a localized friendly message; full error still goes to the renderer console.

### Fixed
- `restoreSessionOnActivate` was ignored on first launch because `CONTEXT_READY` fired before `getConfig()` resolved. Added `configLoadedRef` to gate restore until config is loaded.
- When restore is OFF, messages now clear on every re-activation instead of being kept by the `prev.length > 0` shortcut.

### Removed
- `telemetryEnabled` config field (never wired; removing the placeholder).
- `docs/ROADMAP.md` from the public repo (internal planning lives elsewhere).

## [Internal] — rebrand

### Changed
- HoverBuddy → **Mudrik** (مدرك — Arabic for "perceiver"). User-facing strings, installer artifacts, and config paths migrated. Repo folder stays `hoverbuddy/` for compatibility.
- On-disk config path `%APPDATA%\hoverbuddy\` → `%APPDATA%\mudrik\`, with one-shot migration on first launch.
- Refined owl mascot: steel-blue palette, layered wings, golden eyes, curved ear tufts, circle-shaped blink.

### Added
- Retry button on response errors (`lastPromptRef` captures the last prompt).
- `actionsEnabled` master toggle (replaces `autoClickGuide`). Snapshotted at session start; system prompt advises the user to start a new conversation to change it mid-flow.
- Send button with up-arrow icon in the chat input.
- Option to disable chat-session restoration on popup.

### Fixed
- `robot.keyTap("v", ["control"])` broken on robotjs 0.7.0 — replaced with explicit keyToggle chord + PowerShell fallback.
- Copy-chip state keyed per-chip so duplicate text doesn't toggle every chip.
- Settings dropdown is scrollable and never exceeds panel height.
- Session-history replay preserves `<!--ACTION:...-->` markers (renderer hides them visually).
- Area-capture DPI mismatch (DIPs → physical pixels via `display.scaleFactor`).
- First-activation context-drop race (preload-level buffer replays `CONTEXT_READY`).
- Stale previous-context bug (monotonic `activationSeq` drops superseded reads).
- Auto-screenshot on Alt+Space removed — manual 📸 button only.

[Unreleased]: https://github.com/abdallahmagdy15/mudrik/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/abdallahmagdy15/mudrik/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/abdallahmagdy15/mudrik/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/abdallahmagdy15/mudrik/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/abdallahmagdy15/mudrik/compare/v1.0.0...v1.3.0
[1.0.0]: https://github.com/abdallahmagdy15/mudrik/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/abdallahmagdy15/mudrik/releases/tag/v0.9.0
