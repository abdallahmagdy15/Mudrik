# CONCERNS.md

## Known Issues, Risks, and Technical Debt

### 1. Windows-Only Platform Lock-In
**Severity**: High (by design)
**Impact**: Cannot port to macOS/Linux without rewriting:
- UIA context reading (PowerShell + UIA)
- GDI+ screenshot capture
- DWM rounded corners and acrylic
- robotjs native module
- `findOpenCodeBin` path resolution

**Mitigation**: None planned — product is intentionally Windows-only.

### 2. PowerShell Encoding Issues
**Severity**: Medium
**Impact**: PowerShell scripts write JSON to temp files (not stdout) to avoid encoding problems.
**Evidence**: `context-reader.ts:15` — "bypasses a real bug we hit in production"
**Risk**: If temp file I/O fails, context reading breaks silently.

### 3. Native Module Dependencies
**Severity**: Medium
**Impact**: 
- `robotjs` requires Visual C++ redistributable on Windows
- `koffi` FFI calls are brittle across Windows versions
- Both are externals in webpack, increasing bundle complexity

**Risk**: Users without VC++ redist get runtime errors.

### 4. DWM Corner Radius Bug
**Severity**: Low-Medium
**Impact**: `index.ts:130` — "corners" bug reference
- `DwmSetWindowAttribute` may fail on older Windows versions
- Graceful fallback logs error but doesn't break app

### 5. Fake Context Synthesis
**Severity**: Low
**Impact**: `index.ts:603` — synthesized "Test Element" context for testing
- Could confuse users if accidentally triggered in production
- Only appears in debug/dev scenarios

### 6. OpenCode CLI Dependency
**Severity**: High
**Impact**: 
- Requires `opencode` binary in PATH or known npm global paths
- `findOpenCodeBin.ts` resolves from hardcoded paths
- If OpenCode updates break JSON format, streaming parser fails

**Risk**: App completely non-functional without working OpenCode CLI.

### 7. API Key Storage
**Severity**: Medium
**Impact**: 
- API keys stored in plaintext `%APPDATA%/mudrik/config.json`
- Also synced to `~/.local/share/opencode/auth.json`
- No encryption at rest

**Risk**: Malware or unauthorized access can read keys.
**Mitigation**: Keys are user-managed; app doesn't store them in code.

### 8. No Renderer Tests
**Severity**: Medium
**Impact**: 
- All UI components (React) are untested
- Changes to renderer can break UI without detection
- Manual QA required for UI changes

**Risk**: UI regressions only caught in manual testing.

### 9. Context Hash Collisions
**Severity**: Low
**Impact**: `computeContextHash()` deduplicates context to avoid re-sends
- Hash function not documented; potential for collisions
- Could skip sending genuinely new context

### 10. Auto-Updater Silent Failures
**Severity**: Low
**Impact**: `updater.ts:45` — debug logging suppressed
- `autoDownload: true` with no user notification
- Failures may go unnoticed

### 11. Legacy Path Migration
**Severity**: Low
**Impact**: `config-store.ts` migrates `%APPDATA%\hoverbuddy\` → `%APPDATA%\mudrik\`
- One-time migration on startup
- If migration fails, user loses config

### 12. Tray Behavior Inconsistency
**Severity**: Low
**Impact**: `tray.ts:108` — different behavior for `electron .` vs installed builds
- Could cause confusion during development
- Dev: `app.isPackaged === false`

### 13. Action Validation Bypass Risk
**Severity**: Medium
**Impact**: 
- `validateAction()` is the single gate for all desktop actions
- New IPC handlers must not bypass it
- History shows at least one attempt to widen tool allowlist (`opencode-client.ts:54`)

**Mitigation**: Code review enforced for any IPC or action changes.

### 14. Bun Segfault Workaround
**Severity**: Low
**Impact**: `buildCleanOpenCodeEnv()` strips environment to avoid Bun segfaults
- OpenCode may use Bun internally
- Minimal env could break future OpenCode features that need env vars

### 15. Memory Leaks (Potential)
**Severity**: Low
**Impact**: 
- `mainWindow` created once and hidden/shown (not destroyed)
- Image files in `%TEMP%` cleaned via `cleanupImage()`
- Guide overlay and area selection windows created on demand
- No evidence of leaks, but long-running tray apps are prone to them

### 16. PowerShell Script Cache Invalidation
**Severity**: Low
**Impact**: 
- Scripts cached by version suffix (e.g., `-v3`)
- Forgetting to bump version on script changes → stale cache for existing users
- No automatic detection of script content changes

### 17. Test Coverage Gaps
**Severity**: Medium
**Impact**: 
- Only 3 test files for entire application
- No integration tests
- No end-to-end tests
- No renderer tests
- IPC handlers untested

**Risk**: Refactors can break critical paths.

### 18. GitHub Release Token Exposure
**Severity**: Low
**Impact**: 
- `electron-builder.yml` publishes to GitHub with owner `abdallahmagdy15`
- Requires `GH_TOKEN` env var for publishing
- `check:no-env` scans for leaked tokens

**Mitigation**: CI-only publishing, token not in repo.

### 19. Image Path Bookkeeping
**Severity**: Low
**Impact**: 
- `currentContext.imagePath` and `areaImagePath` tracked manually
- `cleanupImage()` must always be used (not direct `fs.unlink`)
- Missing cleanup → temp file accumulation

### 20. Strict TypeScript Pressure
**Severity**: Low (positive)
**Impact**: 
- `strict: true` catches many bugs at compile time
- But increases development friction
- Any `any` types (e.g., `catch (e: any)`) are technical debt
