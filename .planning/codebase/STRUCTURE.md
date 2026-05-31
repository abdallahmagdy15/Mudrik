# STRUCTURE.md

## Directory Structure

```
hoverbuddy/
├── .github/
│   └── workflows/
│       ├── build.yml              # CI: typecheck → build → check:no-env → pack
│       └── release.yml            # CI: same + publish on v*.*.* tags
│   ├── issue_templates/
│   │   ├── bug_report.yml
│   │   └── feature_request.yml
│   └── PULL_REQUEST_TEMPLATE.md
│
├── .opencode/
│   └── agent/
│       └── readonly.md            # Sandboxed agent rules (copied on launch)
│
├── .planning/
│   └── codebase/                  # GSD codebase map (this directory)
│
├── assets/
│   └── icon.ico                   # Application icon
│
├── dist/                          # Webpack build output (gitignored)
│   ├── main.js
│   ├── preload.js
│   ├── renderer.js
│   ├── area-preload.js
│   └── ... (guide, calibrate bundles)
│
├── release/                       # electron-builder output (gitignored)
│   └── win-unpacked/
│
├── scripts/
│   └── prune-platform-bins.js     # postinstall: removes linux/mac binaries
│
├── src/
│   ├── main/                      # Main process (Node.js/Electron)
│   │   ├── index.ts               # Entry point, window lifecycle, hotkeys
│   │   ├── ipc-handlers.ts        # All IPC wiring, context formatting
│   │   ├── preload.ts             # Standard preload (renderer bridge)
│   │   ├── area-preload.ts        # Preload for area selection overlay
│   │   ├── config-store.ts        # Config persistence, legacy migration
│   │   ├── hotkey.ts              # Global hotkey registration
│   │   ├── tray.ts                # System tray icon and menu
│   │   ├── updater.ts             # Auto-updater logic
│   │   ├── logger.ts              # Logging utility
│   │   ├── vision.ts              # Screenshot capture and optimization
│   │   ├── context-reader.ts      # UIA context reading via PowerShell
│   │   ├── area-scanner.ts        # Area screenshot scanning
│   │   ├── area-selector.ts       # Drag-to-select area overlay
│   │   ├── highlight.ts           # Visual element highlighting
│   │   ├── opencode-client.ts     # OpenCode CLI spawn and streaming
│   │   ├── action-executor.ts     # Action parsing, validation, dispatcher
│   │   ├── findOpenCodeBin.ts     # Resolve opencode binary path
│   │   ├── guide/                 # LAZY-LOADED: Auto-Guide feature
│   │   │   ├── index.ts           # Guide controller entry
│   │   │   ├── guide-controller.ts
│   │   │   ├── guide-controller.test.ts
│   │   │   └── ...
│   │   └── actions/
│   │       └── action-executor-heavy.ts  # LAZY-LOADED: desktop automation
│   │
│   ├── renderer/                  # Renderer process (React)
│   │   ├── index.tsx              # React entry point
│   │   ├── index.html             # HTML template
│   │   ├── global.css             # Global styles
│   │   ├── App.tsx                # Main app component
│   │   ├── ChatInput.tsx          # Message input component
│   │   ├── ChatInputOptions.tsx   # Input options/settings
│   │   ├── ResponseView.tsx       # LLM response display
│   │   ├── ActionBar.tsx          # Action buttons bar
│   │   ├── ContextPreview.tsx     # UI context preview
│   │   ├── OwlMascot.tsx          # Owl mascot component
│   │   └── ErrorBoundary.tsx      # Error boundary
│   │
│   └── shared/                    # Shared between main and renderer
│       ├── types.ts               # IPC names, Action types, Config, ContextPayload
│       ├── prompts.ts             # SYSTEM_PROMPT template, buildSystemPrompt()
│       ├── providers.ts           # Provider→env mapping, buildCleanOpenCodeEnv
│       └── prompts.test.ts        # Prompt tests
│
├── package.json
├── tsconfig.json                  # strict: true, @shared/* alias
├── webpack.config.js              # 8 entry points (4 core + 4 secondary)
├── vitest.config.ts               # node environment, src/**/*.test.ts
├── electron-builder.yml           # Windows NSIS installer config
├── AGENTS.md                      # This project: build/dev/test notes
├── CLAUDE.md                      # Full architecture and design specs
└── .opencode/instructions.md      # General LLM coding rules
```

## Key File Responsibilities

| File | Role |
|------|------|
| `src/main/index.ts` | Main entry, window creation/lifecycle, hotkey wiring, tray, DWM effects |
| `src/main/ipc-handlers.ts` | All IPC handlers, context formatting, auto-guide lazy init |
| `src/main/opencode-client.ts` | Spawns `opencode` CLI, streams JSON events, manages sessions |
| `src/main/action-executor.ts` | Marker parsing, validation, thin dispatcher |
| `src/main/config-store.ts` | Config read/write, legacy path migration, agent file provisioning |
| `src/main/context-reader.ts` | PowerShell UIA bridge for reading UI element context |
| `src/main/vision.ts` | GDI+ screenshot capture, image optimization |
| `src/shared/types.ts` | **Single source of truth** for IPC names, Action, Config, ContextPayload |
| `src/shared/prompts.ts` | System prompt template, dynamic block composition |
| `src/shared/providers.ts` | API provider configuration, env var building |
| `src/preload.ts` | `ipcRenderer` bridge exposed as `window.hoverbuddy` |
| `src/renderer/App.tsx` | Root React component, panel layout |
| `webpack.config.js` | 8 webpack configs: main, preload, renderer, area-preload, guide-preload, guide-renderer, calibrate-preload, calibrate-renderer |

## Lazy-Loaded Modules

| Module | Trigger | Reason |
|--------|---------|--------|
| `src/main/guide/*` | First auto-guide request | Avoids mouse-hook in cold-start path |
| `src/main/actions/action-executor-heavy.ts` | Non-clipboard actions | Avoids robotjs in cold-start path |

## Config File Locations

| File | Path | Purpose |
|------|------|---------|
| Config | `%APPDATA%/mudrik/config.json` | User settings, API keys |
| Legacy config | `%APPDATA%/hoverbuddy/` | Migrated on startup to new path |
| OpenCode auth | `~/.local/share/opencode/auth.json` | CLI credential sync |
| Isolated auth | `<workingDir>/opencode-data/opencode/auth.json` | Mudrik-spawned runs |
| Agent rules | `.opencode/agent/readonly.md` | Sandboxed agent definition |
| Temp scripts | `%TEMP%/hoverbuddy/*.ps1` | Cached PowerShell scripts |
| Temp images | `%TEMP%/*.png` | Screenshots (cleaned up via `cleanupImage`) |
