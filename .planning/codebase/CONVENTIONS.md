# CONVENTIONS.md

## Code Conventions

### Language & Style
- **TypeScript** with `strict: true` (no implicit any, strict null checks, etc.)
- No linter or formatter configured — rely on TypeScript compiler
- Functional React components with hooks (no class components in renderer)
- Module-level state in main process (no classes, just functions and variables)

### Naming Conventions
| Pattern | Example | Used For |
|---------|---------|----------|
| PascalCase | `BrowserWindow`, `ActionType` | Types, interfaces, classes, React components |
| camelCase | `mainWindow`, `buildSystemPrompt` | Variables, functions, methods |
| UPPER_SNAKE | `IPC`, `DEFAULT_CONFIG` | Constants, enums, IPC event names |
| kebab-case | `action-executor.ts` | File names |

### Import Conventions
- Use `@shared/*` alias for shared modules: `import { IPC } from "@shared/types"`
- Group imports: built-in → external → internal (shared) → local
- No `*` imports for external libraries (except `import * as path`)

### Error Handling
- Try/catch with typed errors: `catch (e: any)` (common in main process)
- Log errors via `logger.ts` (not console.log in main process)
- Renderer errors go to console (dev) or ErrorBoundary

### IPC Conventions
When adding an IPC channel:
1. Add name to `IPC` object in `src/shared/types.ts`
2. Wire it in `src/preload.ts` (or `area-preload.ts`)
3. Handle it in `src/main/ipc-handlers.ts`
4. Call via `window.hoverbuddy.<name>()` in renderer

### PowerShell Script Conventions
- Embed scripts as string literals in TypeScript files
- Version filenames (e.g., `context-reader-v3.ps1`) for cache invalidation
- Write JSON to `-OutputFile` (not stdout) to avoid encoding issues
- Read and delete output file in `runPowerShell()`

### Action Marker Format
```
<!--ACTION:{"type":"click","x":100,"y":200}-->
```
- All desktop actions MUST be embedded markers, NOT tool calls
- Never introduce tool-call story for desktop actions
- `parseActionsFromResponse()` extracts markers from plain text

### Security Conventions
- Never log or expose API keys
- Never commit secrets to repository
- `check:no-env` scans dist/ and release/ for leaks before distribution
- `validateAction()` sanitizes every renderer-supplied action
- Never wire IPC handler that forwards renderer actions without validation

### Window Conventions
- Main panel: frameless, transparent, positioned near cursor
- Acrylic background via `setBackgroundMaterial("acrylic")`
- Rounded corners via DWM API (Windows 11+)
- `window-all-closed` suppressed so tray survives
- Window shown/hidden (not created/destroyed) for performance

### Config Conventions
- `Config.actionsEnabled` and `Config.autoGuideEnabled` read **live** at execution
- Never cache config values in closures that outlive the read
- `saveConfig()` writes to `%APPDATA%/mudrik/config.json`
- Legacy config auto-migrated from `%APPDATA%/hoverbuddy/` on startup

### Native Module Conventions
- `robotjs` and `koffi` are externals in main webpack config
- `robotjs` unpacked from asar (its `.node` must load from real path)
- Lazy-load heavy native dependencies to improve cold-start

### Comment Style
- Minimal comments — code should be self-explanatory
- Comments explain "why", not "what"
- JSDoc for public APIs only
- No inline comments for obvious code

### File Organization
- One component per file in renderer
- Group related utilities in directories (e.g., `src/main/guide/`)
- Test files co-located: `foo.ts` → `foo.test.ts`
