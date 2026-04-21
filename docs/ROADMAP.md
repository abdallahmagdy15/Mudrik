# Mudrik Roadmap

*Living plan — updated as features land. For commit-level history see `git log`.*

**Status:** pre-v1.0, opensource launch in preparation. Core engine stable, rebrand complete, near-term UX polish complete.

---

## ✅ Completed (recent)

### Rebrand HoverBuddy → Mudrik (مدرك)

Full user-facing rebrand for opensource launch.

- `package.json`, `electron-builder.yml`, `LICENSE` copyright
- `README.md` — full rewrite with Mudrik hero, badges, feature grid, privacy table, contributing section, Arabic name origin
- `CONTRIBUTING.md`, `SECURITY.md`, `CLAUDE.md`, `.env.example`
- `.github/ISSUE_TEMPLATE/*`, `.opencode/agent/readonly.md`
- Every in-app display string: app title, welcome dialog, tray menu & tooltip, updater dialogs, OpenCode blocked-tool error, system prompt intro
- `scripts/generate-icons.js` palette + comment header
- Tray tooltip hotkey corrected (was `Ctrl+Alt+H`, now `Alt+Space`)
- `assets/mascot.png` added as README hero image

**Deferred intentionally** (to avoid breaking pre-rebrand installs):
- Repo folder name stays `hoverbuddy/` (rename when GitHub repo is transferred)
- PowerShell script filename prefix `hoverbuddy-*.ps1` (internal cache, harmless)
- `%TEMP%\hoverbuddy\` temp dir (internal, harmless)
- `window.hoverbuddy` IPC bridge name (would cascade through ~15 renderer files for zero visible benefit)

### Near-term features

- **#1 Retry button on response errors** — `lastPromptRef` in `App.tsx` captures every submitted prompt; click the Retry button in the error row to re-fire without retyping. `.btn-retry-response` styling.
- **#2 Actions enable/disable master toggle** — replaces `autoClickGuide`. New `Config.actionsEnabled` (default `true`). `isInteractiveAction()` helper blocks the 7 interactive types at three runtime guards (auto-execute, EXECUTE_ACTION, RETRY_ACTION); `copy_to_clipboard` always passes. **Snapshotted at session start** (`sessionActionsEnabled`) — toggling mid-conversation doesn't change runtime behaviour; system prompt tells the AI to advise the user to start a new conversation for the setting to take effect cleanly.
- **#3 Config directory migration** `%APPDATA%\hoverbuddy\` → `%APPDATA%\mudrik\` — `migrateLegacyConfig()` runs before `loadConfig` on first launch after rebrand; copies `config.json` + `hoverbuddy.log` if new dir is empty. `logger.ts` falls back to legacy dir until migration runs.
- **#4 Refined owl mascot** — new character matching `assets/mascot.png`:
  - Steel-blue palette (`#7499C2` body, `#4F7399` wing shading)
  - Two separate folded wings with feather detail
  - Golden yellow eyes (`#F2C94C`) with darker outer rim (`#D99A1E`)
  - Large white sclera (`r=30`) with smaller inner eyeball (pupil r=8, iris r=15) for "visible white around the eye"
  - Iris clipped to white circle so cursor tracking can never escape
  - Circle-shaped blink that exactly covers the white (no gaps, no overshoot)
  - Curved cat/owl-style ear tufts (outward-bulging C-curves, not slim horns)
  - Subtle belly smile, head highlight sheen
  - Synced in `OwlMascot.tsx`, `assets/icon.svg`, and `scripts/generate-icons.js` palette for raster regeneration

### Bug fixes

- Copy chip state keyed per-chip (`<msgKey>::<segIdx>`) — duplicate text no longer toggles all chips together
- `robot.keyTap("v", ["control"])` array-modifier form broken on robotjs 0.7.0 — replaced with explicit `keyToggle` down/up chord; PowerShell `user32!keybd_event` fallback retained
- Settings dropdown now scrolls internally (`max-height` + `overflow-y`) — never exceeds panel height
- Session-history replay preserves `<!--ACTION:...-->` markers (renderer hides them visually; main process no longer strips them)
- Area-capture DPI mismatch fixed (DIPs → physical pixels via `display.scaleFactor`)
- First-activation context drop race fixed (preload-level buffer replays CONTEXT_READY after React mounts)
- Stale previous-context bug fixed (monotonic `activationSeq` drops superseded async reads)
- Auto-screenshot on Alt+Space removed — manual 📸 button only (Ctrl+Space area still captures by design)
- Prompt rule: AI ignores the Mudrik panel itself when it appears in attached screenshots

---

## 🟡 Medium-term (1–2 weeks)

### #5 Previous sessions picker (~1–2 hrs)

- Clock/history icon in header `.header-actions` row (between `+` and `−`)
- Click opens an overlay panel listing the last ~20 OpenCode sessions
- Each row: first-message preview (truncated), relative date ("2 hours ago"), message count
- Click a row → `setRestoredSession(id)` + `resetSession()` + sends history to renderer
- Esc / click-outside closes without switching

**Files:**
- `src/main/ipc-handlers.ts` — new `LIST_SESSIONS` + `LOAD_SESSION` handlers (shell `opencode session list --format json -n 20` and `opencode export <id>`)
- `src/shared/types.ts` — two new IPC channel names
- `src/preload.ts` — bridge the new calls
- `src/renderer/App.tsx` — header button + picker overlay component
- `src/renderer/styles/global.css` — picker styling

### #6 Code signing (~1 hr + cert cost)

- Purchase EV or OV certificate (SSL.com, DigiCert, Sectigo — ~$300-500/year for EV)
- Wire `CSC_LINK` (base64 of .pfx) + `CSC_KEY_PASSWORD` into `electron-builder.yml`
- Add GitHub Actions secrets for release workflow
- Removes Windows SmartScreen warning on first launch
- Reference: https://www.electron.build/code-signing

### Docs gaps to close before launch

- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1
- `CHANGELOG.md` — start tracking per-release notes
- `docs/ACTIONS.md` — full action marker reference (every type, field, example)
- `docs/TROUBLESHOOTING.md` — SmartScreen, OpenCode not found, UIA failures, paste dropped, etc.
- `docs/FAQ.md` — privacy questions, model choice, Windows-only rationale
- Demo GIF recorded → `docs/demo.gif` → uncomment in README

---

## 🔵 Long-term (backlog)

### Workflow recording — replay a sequence of actions (~3–5 days)

Record the user's UIA interactions → replay on demand.

- New capture layer that hooks UIA events (or polls at cadence)
- Save sequence as named macro in `%APPDATA%\mudrik\macros\<name>.json`
- Replay = stream actions through the existing `executeAction` pipeline
- UI: new "Record" button in header; list of saved macros in settings or sidebar
- Open questions: what happens when target UI differs from recorded state? Pause on mismatch?

### Plugin API for custom action types (~3–5 days)

Let users ship their own `ActionType`s.

- Plugin discovery: `%APPDATA%\mudrik\plugins\<name>\index.js` + manifest
- Safe loader: V8 isolate, no Node APIs, only a narrow `registerAction(type, schema, handler)` call
- Schema validation via JSON Schema
- System prompt auto-expands with registered action docs
- Signed plugins only (future: reuse code-signing infra)

### Voice activation (~2–3 days)

- Wake word ("hey Mudrik") or hotkey-to-record
- Windows audio capture via node-record-lpcm16 or similar
- Whisper (local via whisper.cpp) or cloud STT
- Transcribed text → sent as prompt with current UIA context

### macOS + Linux ports (🐉 weeks)

- Rewrite PowerShell UIA bridge using:
  - **macOS**: Accessibility API via `applescript` / `macos-accessibility` / native addon
  - **Linux**: AT-SPI 2 (D-Bus); GNOME/KDE variance is real
- Cross-platform build pipeline in `electron-builder.yml`
- Cross-platform screen capture (already cross-platform via `desktopCapturer`)
- Cross-platform hotkey/input (robotjs works on all three)
- Separate test matrices in GitHub Actions

### Web client (🌙 moonshot)

- Browser extension + WebSocket bridge to a local Mudrik daemon
- Chrome/Firefox UIA equivalent = DOM + ARIA tree
- Lets the same AI work on any webpage a user's looking at

---

## 🗓 Suggested sequencing for opensource launch

1. **This week:** close docs gaps (CODE_OF_CONDUCT, CHANGELOG, ACTIONS.md, FAQ)
2. **Before announcing:** record demo GIF, decide on landing page
3. **Launch week:** Show HN / r/programming / r/opensource, tweet thread, Dev.to post
4. **Post-launch:** #5 session picker, then #6 code signing once there's early usage signal
5. **Stretch goals after v1.1:** workflow recording, plugin API, macOS port

---

## Stats / state (as of rebrand)

- **~33 files changed** in the rebrand + near-term batch (672 insertions, 322 deletions)
- **0 tests** currently — no runner configured. Low priority until API surface stabilises.
- **0 TODO/FIXME comments** in `src/`
- **10 Action types** shipping (`type_text`, `paste_text`, `set_value`, `click_element`, `invoke_element`, `copy_to_clipboard`, `press_keys`, `guide_to`)
- **14 Config keys** (with `actionsEnabled` replacing `autoClickGuide`)
- **25+ IPC channels** in `src/shared/types.ts > IPC`
- **8 PowerShell scripts** under `%TEMP%\hoverbuddy\` (versioned `-vN`)
