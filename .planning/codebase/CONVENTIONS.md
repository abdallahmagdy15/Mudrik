# Coding Conventions

**Analysis Date:** 2026-05-24

## Naming Patterns

**Files:**
- kebab-case names: `action-executor.ts`, `guide-controller.ts`, `area-preload.ts`
- Test files: co-located `<module>.test.ts`: `src/main/action-executor.test.ts`, `src/main/guide/guide-controller.test.ts`
- Preload/renderer pairs: `<feature>-preload.ts` and `<feature>-renderer.ts` (e.g., `guide-overlay-preload.ts`, `guide-overlay-renderer.ts`)

**Functions:**
- camelCase, descriptive verb-led names: `executeAction`, `parseActionsFromResponse`, `buildSystemPrompt`, `setLastContextElement`, `migrateLegacyConfig`
- Boolean helpers prefixed with `is` or `has`: `isInteractiveAction`, `isDisallowedToolName`, `hasCompletedWelcome`

**Variables:**
- camelCase
- Readonly allowlists named in UPPER_SNAKE_CASE with `ReadonlySet`: `INTERACTIVE_ACTION_TYPES`, `ALLOWED_TOOLS`
- Single-letter abbreviations avoided unless standard (`i` for loop index, `ms` for milliseconds)
- Prefer `const` for allowlists and configuration objects: `const IPC = { ... } as const;`

**Types:**
- PascalCase interfaces, types: `UIElement`, `ContextPayload`, `GuideStateUpdate`, `BuildPromptConfig`
- Use `interface` for object shapes, `type` for unions (e.g., `ActionType`, `GuidePhase`, `UpdateStatus`)
- Optional fields suffixed with `?`, nullable fields with union `| null` (e.g., `target: { ... } | null;`)

## Code Style

**Formatting:**
- Not configured — no ESLint, Prettier, Biome, or linting step in CI (`AGENTS.md` states "No linter or formatter is configured")
- Hand-formatted; match existing indentation (2 spaces), brace placement (same-line), and spacing
- `tsconfig.json` enforces `strict: true`; typecheck failures are blocking in CI

**TypeScript compiler rules:**
- `target`: ES2022
- `module`: commonjs
- `jsx`: react-jsx
- `paths`: `@shared/*` maps to `src/shared/*`
- `declaration`: true, `sourceMap`: true
- `strict: true` is the primary enforcement mechanism; CI runs `tsc --noEmit` before building (`build.yml` line 26)

## Import Organization

**Order (observed pattern):**
1. Node/Electron built-ins (`fs`, `path`, `os`, `electron`)
2. Third-party dependencies (`react`, `robotjs`)
3. Internal aliases (`@shared/types`, `@shared/providers`, `@shared/i18n`)
4. Relative sibling/parent imports (`./action-executor`, `../shared/types`)

**Path Aliases:**
- `@shared/*` → `src/shared/*` (configured in `tsconfig.json` and Vitest config)
- No barrel files (`index.ts`) in `src/shared/`; import exact module like `import { Config } from "@shared/types"`

## Error Handling

**Patterns:**
- Use `try { } catch (err: any) { }` with minimal typing (the codebase accepts `any` for caught errors due to `strict: true`)
- Always pass errors through the `log()` function (`src/main/logger.ts`) before returning or discarding
- Validation at boundaries: `validateAction` in `src/main/action-executor.ts` coerces untrusted IPC payloads to typed objects and returns `{ action } | { error }`
- When a module-level operation is best-effort, wrap in try/catch and make it non-fatal (e.g., `migrateLegacyConfig`, `ensureAgentInWorkingDir`)

## Logging

**Framework:** Internal `log()` function in `src/main/logger.ts`
- Writes to `%appData%/mudrik/hoverbuddy.log` and console
- Does not depend on Electron `app` (avoids crash before `app.ready`)
- Call `log(msg: string)` everywhere; avoid `console.log` in main process

**Patterns:**
- Prefix with context: `log("copy_to_clipboard: completed")`
- Error prefix: `log("updateAuthFile: write failed (${err.message})")`
- Include state in log line: `log("setLastContextElement: name=... type=... automationId=...")`

## Comments

**When to Comment:**
- File header comments explaining ownership and design decisions (see `src/main/action-executor.ts` header)
- Explain the "why", not the "what". Every major security constraint or lazy-loading decision has a multi-line `//` block
- Mark tradeoffs explicitly: "The ONLY way...", "Do NOT introduce..."

**JSDoc/TSDoc:**
- Use JSDoc blocks for exported functions that cross module boundaries (`validateAction`, `buildSystemPrompt`)
- Inline `//` comments for implementation notes and warnings
- Comments are concise but thorough (per `.opencode/instructions.md`)

## Function Design

**Size:**
- Keep functions focused, but the codebase tolerates longer functions when they encapsulate a single concern (e.g., `validateGuideAction` is a single switch, `buildSystemPrompt` is small)
- No hard limit; preference for readability over splitting for its own sake

**Parameters:**
- Prefer interfaces / objects for configs passed across layers (`ValidationConfig`, `BuildPromptConfig`)
- Destructure when receiving config objects: `function buildSystemPrompt(cfg: BuildPromptConfig)`

**Return Values:**
- Use discriminated unions for validation results: `{ action: Action } | { error: string }`
- Action results use `ActionResult` interface: `{ success: boolean; error?: string; output?: string; }`

## Module Design

**Exports:**
- Named exports for everything; no default `export default` observed
- Group related constants into const objects with `as const`: `IPC`, `DEFAULT_CONFIG`
- `GUIDE_ACTION_TYPES: ReadonlySet<ActionType>` for allowlist sets

**Barrel Files:**
- Not used. Import directly from the module that owns the code

## Security Rules

**Sandbox enforcement:**
- Two-layer sandbox:
  1. Static: `.opencode/agent/readonly.md` provisioned on every launch
  2. Runtime: `ALLOWED_TOOLS: ReadonlySet<string>` in `src/main/opencode-client.ts` containing only `read`, `grep`, `glob`, `list`, `webfetch`, `websearch`
- Any tool call outside this set triggers `SIGKILL` and surfaces a `Blocked: model attempted to use X` error
- Never widen the tool allowlist. Never add `bash`, `edit`, `write`, `task`, or browser automation tools

**Action security:**
- Validate every IPC payload carrying actions through `validateAction` in `src/main/action-executor.ts`
- Gate interactive actions behind `actionsEnabled` config flag read live at execution time (not cached)
- Auto-Guide markers gated behind `autoGuideEnabled` flag
- `copy_to_clipboard` is the only action that works in read-only mode

**Never weaken accidentally:**
- Do not add `process.platform` branches unless also porting the PowerShell layer
- Do not switch PowerShell scripts back to stdout (encoding issues)
- Do not introduce a tool-call story for desktop actions (must remain markers in text)
- Do not wire a new IPC handler that forwards renderer-supplied actions without going through `validateAction`

## TypeScript Strictness

**`strict: true` blocking:**
- CI runs `tsc --noEmit` before `npm run build`; type errors block release
- `unknown` is used for untrusted payloads (`payload: unknown`) to force narrowing before cast
- Use `as ReadonlySet<ActionType>` for const allowlists
- Interfaces in `src/shared/types.ts` are the single source of truth (e.g., `Config`, `Action`, `ContextPayload`)
- When adding IPC channels, add names to `IPC` const object in `src/shared/types.ts`, then wire in `src/preload.ts` and `src/main/ipc-handlers.ts`

## Lazy Loading Discipline

**Mandatory pattern:**
- Heavy modules must be lazy-loaded via `await import()`; never static-import them
- Examples: `src/main/guide/` (entire directory), `src/main/actions/action-executor-heavy.ts`
- Static imports must not pull these into the cold-start path
- Every lazy entry point must have a comment warning against static import (see `src/main/action-executor.ts`)

---

*Convention analysis: 2026-05-24*
