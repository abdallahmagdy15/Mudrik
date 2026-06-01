# STACK.md

## Technology Stack Overview

### Primary Framework
- **Electron 35** — Desktop application shell
- **React 18** — UI framework for renderer process
- **TypeScript 5** — Primary language (strict mode enabled)
- **Node.js** — Runtime for main process (Electron bundled)

### Bundling & Tooling
- **Webpack 5** — Module bundler with 4 separate entry configurations:
  - `main` (src/main/index.ts) → dist/main.js
  - `preload` (src/preload.ts) → dist/preload.js
  - `renderer` (src/renderer/index.tsx) → dist/renderer.js
  - `area-preload` (src/main/area-preload.ts) → dist/area-preload.js
  - Plus 4 secondary bundles for guide-overlay and calibration UI
- **ts-loader** — TypeScript compilation in webpack
- **tsconfig-paths-webpack-plugin** — Resolves `@shared/*` alias
- **CSS-loader + style-loader** — Stylesheet processing
- **@svgr/webpack** — SVG imports as React components

### Testing
- **Vitest 4** — Test runner (node environment, no DOM)
- Tests located in `src/**/*.test.ts` only
- No browser/renderer process tests

### Build & Package
- **electron-builder** — Creates NSIS installer for Windows
- **GitHub Actions CI** — `.github/workflows/build.yml` and `release.yml`
- Output directory: `release/`

### Native Dependencies
- **robotjs** — Cross-platform native automation (click, type, keyboard)
  - Marked as external in main webpack config
  - Unpacked from asar because `.node` must load from real disk path
- **koffi** — FFI for calling native Windows APIs (DWM, UIA)
  - Used for rounded corners via `dwmapi.dll`

### Key Development Commands
| Command | Purpose |
|---------|---------|
| `npm run build` | Webpack bundles into `dist/` (required before launch) |
| `npm start` | Build + launch (`webpack && electron .`) |
| `npm run dev` | Webpack watch mode |
| `npm test` | Run all Vitest tests |
| `npx tsc --noEmit -p .` | Standalone typecheck (CI runs before build) |
| `npm run pack:dir` | Unsigned unpackaged build for QA |
| `npm run check:no-env` | Leak guard — scans dist/release for secrets |

### Notable Configuration
- `tsconfig.json`: `strict: true` — typecheck failures block CI
- `package.json > main`: `dist/main.js` (build required before launch)
- `@shared/*` path alias maps to `src/shared/*`
- `postinstall` script auto-prunes cross-platform native binaries

### Runtime Architecture
- **Windows-only application** — UIA, PowerShell, robotjs, GDI+ capture are all Windows-specific
- **Tray application** — frameless, transparent `BrowserWindow`, survives `window-all-closed`
- **OpenCode CLI integration** — Spawns `opencode run --format json --agent readonly` as child process per message
