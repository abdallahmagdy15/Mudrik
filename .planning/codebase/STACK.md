# Technology Stack

**Analysis Date:** 2026-05-24

## Languages

**Primary:**
- TypeScript 5.9.3 — all application source code (`src/**/*.ts`, `src/**/*.tsx`)
- PowerShell — embedded as string literals inside TypeScript files (`src/main/context-reader.ts`, `src/main/vision.ts`, `src/main/actions/action-executor-heavy.ts`, `src/main/area-scanner.ts`) and written to temp files at runtime

**Secondary:**
- CSS — renderer styling (`src/renderer/styles/global.css`)
- JS (Node.js) — build scripts (`scripts/check-no-env.js`, `scripts/prune-platform-bins.js`)

## Runtime

**Environment:**
- Node.js 20+ (CI target per `.github/workflows/build.yml`)
- Electron 35.7.5 — main process + Chromium renderer

**Package Manager:**
- npm — lockfile present (`package-lock.json`)
- `type: "commonjs"` in `package.json`

## Frameworks

**Core:**
- Electron 35.7.5 — desktop tray app with frameless transparent `BrowserWindow`
- React 18.3.1 + React DOM 18.3.1 — renderer UI panel (`src/renderer/index.tsx`)

**Build/Dev:**
- Webpack 5.106.0 + webpack-cli 7.0.2 — eight separate bundles (`webpack.config.js`)
- ts-loader 9.5.7 — TypeScript compilation
- css-loader 7.1.4 + style-loader 4.0.0 — CSS bundling for renderer
- html-webpack-plugin 5.6.6 — `index.html` generation for renderer bundle
- copy-webpack-plugin 14.0.0 — static asset copying

**Testing:**
- Vitest 4.1.5 — `vitest.config.ts`, runs in `node` environment, includes `@vitest/ui` 4.1.5

**Packaging:**
- electron-builder 26.8.1 — NSIS installer for Windows (`electron-builder.yml`)
- electron-updater 6.8.3 — auto-update from GitHub releases

## Key Dependencies

**Critical AI/LLM:**
- `@opencode-ai/sdk` ^1.4.6 — SDK for the OpenCode CLI binary that Mudrik spawns per message (`src/main/opencode-client.ts`)

**Native/Desktop Automation:**
- `robotjs` ^0.7.0 — global mouse/keyboard simulation (marked webpack `externals`, native `.node` module, `asarUnpack` in `electron-builder.yml`)
- `koffi` ^2.16.1 — native FFI for loading Windows DLLs (`dwmapi.dll` for rounded corners) (webpack `externals`)

**React Ecosystem:**
- `react` ^18.3.1 / `react-dom` ^18.3.1
- `@types/react` ^19.2.14 / `@types/react-dom` ^19.2.3 (dev)

## Configuration

**TypeScript:**
- `tsconfig.json` — `strict: true`, `target: ES2022`, `module: commonjs`, `jsx: react-jsx`
- Path alias `@shared/*` → `src/shared/*`

**Electron Builder:**
- `electron-builder.yml` — NSIS target, `asarUnpack` for robotjs, outputs to `release/`
- `appId: com.mudrik.app`, publishes to GitHub (`abdallahmagdy15/mudrik`)

**Environment:**
- `.env.example` present — only for OpenCode CLI consumption, not read directly by Mudrik
- `scripts/check-no-env.js` — leak guard scanning `dist/` and `release/` for env files and token-shaped strings

## Build Outputs

Eight webpack bundles in `dist/`:
1. `main.js` — Electron main process (`src/main/index.ts`)
2. `preload.js` — panel preload (`src/preload.ts`)
3. `area-preload.js` — area-selection overlay preload (`src/main/area-preload.ts`)
4. `guide-overlay-preload.js` — guide overlay preload (`src/main/guide/guide-overlay-preload.ts`)
5. `guide-overlay-renderer.js` — guide overlay renderer (`src/main/guide/guide-overlay-renderer.ts`)
6. `calibrate-preload.js` — calibration overlay preload (`src/main/calibrate/calibrate-preload.ts`)
7. `calibrate-renderer.js` — calibration overlay renderer (`src/main/calibrate/calibrate-renderer.ts`)
8. `renderer.js` — React panel UI (`src/renderer/index.tsx`) + `index.html`

## Platform Requirements

**Development:**
- Windows only — UIA, PowerShell scripts, robotjs, GDI+, and `findOpenCodeBin` path resolution are all Windows-specific
- Node.js 20+
- OpenCode CLI globally installed (`npm i -g opencode-ai`) or discoverable via npm global prefix

**Production:**
- Windows 10/11 — `dwmapi.dll` for rounded window corners, `WH_MOUSE_LL` global hook for Auto-Guide
- `%APPDATA%/mudrik/` for config and logs (migrated from legacy `%APPDATA%/hoverbuddy/`)
- `%TEMP%/hoverbuddy/` for cached PowerShell scripts

## CI/CD

**GitHub Actions:**
- `.github/workflows/build.yml` — `npm ci` → `tsc --noEmit` → `npm run build` → `npm run check:no-env` → `electron-builder --win --dir`
- `.github/workflows/release.yml` — same + `electron-builder --win --publish always` on `v*.*.*` tags
- `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` required for publish step

---

*Stack analysis: 2026-05-24*
