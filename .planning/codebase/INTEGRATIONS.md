# INTEGRATIONS.md

## External System Integrations

### OpenCode CLI
**Purpose**: LLM backend for AI interactions
**Integration**: `src/main/opencode-client.ts`
- Spawns `opencode run --format json --agent readonly` as child process
- Uses `--continue` or `--session <id>` for conversation continuity
- `resetSession()` clears ID for fresh conversation
- `setRestoredSession(id)` re-attaches to existing session
- `activeProcess` tracks current child for `STOP_RESPONSE` SIGKILL

**Auth**: Provider API keys stored in `config.json` (`Config.apiKeys` map)
- `buildProviderEnv()` in `src/shared/providers.ts` translates to env vars
- Also syncs to OpenCode's `auth.json` for CLI interoperability
- Existing shell-level env vars win over config

**Kill-switch**: `detectDisallowedTool()` inspects every JSON event stream
- Allowlist: `read`, `grep`, `glob`, `list`, `webfetch`, `websearch`
- Any `permission.asked` or `part.tool` outside allowlist → SIGKILL
- Error: "Blocked: model attempted to use X"

**Environment Isolation**: `buildCleanOpenCodeEnv()` creates minimal env
- Avoids Bun segfaults by stripping unnecessary env vars

### Windows UIA (UI Automation)
**Purpose**: Read UI element context from any Windows application
**Integration**: PowerShell scripts in `src/main/context-reader.ts`
- Embeds PowerShell as string literals
- Scripts written to `%TEMP%/hoverbuddy/` on first use (versioned filenames)
- JSON output to temp file (`-OutputFile`) rather than stdout (encoding safety)
- Also used by `area-scanner.ts` and `vision.ts`

### Windows DWM (Desktop Window Manager)
**Purpose**: Acrylic background and rounded corners
**Integration**: `src/main/index.ts`
- `koffi` FFI loads `dwmapi.dll`
- `DwmSetWindowAttribute` with `DWMWA_WINDOW_CORNER_PREFERENCE = 33`
- `DWMWCP_ROUND = 2` for rounded corners
- `setBackgroundMaterial("acrylic")` for transparency

### PowerShell Runtime
**Purpose**: Bridge to Windows UIA APIs
**Integration**: `src/main/powershell-runner.ts`
- Scripts cached in `%TEMP%/hoverbuddy/`
- Version suffixes (e.g., `-v3`, `-v6`) force rewrite on update
- `runPowerShell()` reads and deletes temp JSON output files

### Native Automation (robotjs)
**Purpose**: Mouse and keyboard automation
**Integration**: `src/main/actions/action-executor-heavy.ts`
- Lazy-loaded to avoid cold-start overhead
- Native `.node` module unpacked from asar
- Functions: click, type, keyTap, getMousePos, moveMouse, mouseToggle

### System Tray
**Purpose**: Persistent application icon and menu
**Integration**: `src/main/tray.ts`
- `createTrayWithShow()` / `destroyTray()`
- Different behavior for `electron .` (dev) vs installed builds

### Auto-Updater
**Purpose**: Silent update downloads
**Integration**: `src/main/updater.ts`
- `electron-updater` with `autoDownload: true`
- `electron-builder` publishes to GitHub releases
- Release triggered on `v*.*.*` tags

### GitHub Releases
**Purpose**: Distribution
**Integration**: `.github/workflows/release.yml`
- `electron-builder --win --publish always`
- Configured in `electron-builder.yml`
- Owner: `abdallahmagdy15`, repo: `mudrik`

### File System Context
**Purpose**: Persistent config, temp images, agent files
**Paths**:
- Config: `%APPDATA%/mudrik/config.json`
- Legacy migration: `%APPDATA%/hoverbuddy/` → `%APPDATA%/mudrik/`
- Agent file: copied from `.opencode/agent/readonly.md` on every launch
- Temp images: screenshot captures, cleaned up via `cleanupImage()`

### Bundled Agent Rules
**Purpose**: Sandbox enforcement for OpenCode
**Integration**: `.opencode/agent/readonly.md`
- Copied into working dir on every launch by `config-store.ts#ensureAgentInWorkingDir`
- Overwrites existing, so updates propagate after app upgrade
