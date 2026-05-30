# Testing Patterns

**Analysis Date:** 2026-05-24

## Test Framework

**Runner:**
- Vitest 4.1.5
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`, `describe`, `it`, `vi`, `beforeEach`, `afterEach`)

**Run Commands:**
```bash
npm test              # Run all tests (vitest run)
npm run test:watch    # Watch mode
npx vitest run <path> # Run a single test file (e.g., src/main/action-executor.test.ts)
```

**Environment:**
- `node` environment only (no DOM or renderer tests)
- Configured in `vitest.config.ts`: `environment: "node"`
- Alias `@shared` resolves to `src/shared` (same as `tsconfig.json` paths)

## Test File Organization

**Location:**
- Co-located tests: every `.test.ts` lives next to the module it tests
  - `src/main/action-executor.ts` → `src/main/action-executor.test.ts`
  - `src/main/guide/guide-controller.ts` → `src/main/guide/guide-controller.test.ts`
  - `src/shared/prompts.ts` → `src/shared/prompts.test.ts`

**Naming:**
- `*.test.ts` (no `.spec.ts` used in this repo)

**Config (`vitest.config.ts`):**
```ts
{
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
}
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("ComponentName", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("phase or concern", () => {
    it("descriptive condition → expected result", async () => {
      // arrange
      const deps = makeDeps();
      const ctrl = new GuideController(deps);

      // act
      await ctrl.handleAction(...);

      // assert
      expect(ctrl.getPhase()).toBe("offer");
      expect(deps.onStateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ phase: "offer" })
      );
    });
  });
});
```

**Patterns:**
- Tests are `async` when exercising async logic; await actions
- Use fake timers for timeout / timer-dependent code (e.g., `vi.useFakeTimers()`, `vi.advanceTimersByTimeAsync()`)
- Return to real timers in `afterEach` to avoid cross-test leakage

## Mocking

**Framework:** Vitest built-in `vi`

**Patterns:**
```typescript
vi.mock("electron", () => ({
  screen: {
    getDisplayNearestPoint: vi.fn(() => ({ scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } })),
    getPrimaryDisplay: vi.fn(() => ({ scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } })),
    getAllDisplays: vi.fn(() => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }]),
  },
}));
```

- Prefer constructor injection or factory `makeDeps()` functions, not global mocks
- `makeDeps(overrides?)` pattern used throughout `guide-controller.test.ts` to build dependency objects with `vi.fn()` defaults

**What to Mock:**
- Electron APIs (`screen`, `dialog`, `Notification`) — stub via `vi.mock()` at the top of test files
- IO-bound dependencies (`sendFollowUp`, `overlay.show/hide`, `getActiveHwnd`) — mock with `vi.fn()` factories
- Timers — use `vi.useFakeTimers()` for interval/timeout assertions

**What NOT to Mock:**
- Internal pure utility functions (e.g., `buildSystemPrompt`, `validateAction`) — call directly with test inputs
- Data structures and constants (`IPC`, `DEFAULT_CONFIG`)

**Spying on call counts and arguments:**
```typescript
const sendFollowUpCallsBefore = (deps.sendFollowUp as ReturnType<typeof vi.fn>).mock.calls.length;
```
- When using injected interfaces, cast known `vi.fn()` fields to extract `mock.calls` and `mockClear()`

## Fixtures and Factories

**Test Data:**
- Inline sample objects named `sampleOffer`, `sampleStep`, `sampleStepNonTrackable` (`guide-controller.test.ts`)
- `cfg(autoGuideEnabled, actionsEnabled)` helper factory in `action-executor.test.ts`
- Overriding factory pattern: `makeDeps(overrides: Partial<GuideControllerDeps>)`

**Location:**
- Declared in the same test file that needs them, near the top, after mocks

## Coverage

**Requirements:**
- None enforced; no `coverage` block in `vitest.config.ts`
- No CI coverage gate; no coverage tool installed (no `@vitest/coverage-v8`)

## Test Types

**Unit Tests:**
- Scope: pure logic, validation functions, prompt builders, state machines
- Example: `prompts.test.ts` tests that `buildSystemPrompt` includes/excludes the correct prompt blocks
- Example: `action-executor.test.ts` tests that `validateAction` accepts/rejects payloads and that `parseActionsFromResponse` preserves fields

**Integration Tests:**
- Scope: stateful controller with mocked dependencies (e.g., `guide-controller.test.ts` tests state transitions and side-effects like overlay show/hide)
- Not testing across process boundaries or real Electron windows

**E2E Tests:**
- Not used

## Common Patterns

**Async Testing:**
```typescript
await ctrl.handleAction(sampleOffer as unknown as Action);
await vi.advanceTimersByTimeAsync(sampleStepNonTrackable.waitMs + 50);
expect(ctrl.getPhase()).toBe("awaiting-ai");
```

**Error Testing (rejection):**
```typescript
await expect(ctrl.handleAction(somePayload)).rejects.toThrow(/no active offer/i);
```

**Partial matching with `expect.objectContaining`:**
```typescript
expect(deps.onStateUpdate).toHaveBeenCalledWith(
  expect.objectContaining({ phase: "offer", summary: sampleOffer.summary })
);
```

**Regression tests:**
- Test descriptions explicitly label behavior that was previously broken and should stay fixed:
  - "preserves guide_offer payload fields (summary/estSteps/options) — regression for stripped-fields bug"
  - "still accepts a valid paste_text payload (regression)"

## How to Add New Tests

**For a new module:**
1. Create `src/<module-path>/<module>.test.ts` next to the implementation file
2. Export the logic as pure functions when possible (not tied to Electron lifecycle)
3. Use `makeDeps()` factories for injected dependencies
4. Run single file: `npx vitest run src/<module-path>/<module>.test.ts`

**For a new test in an existing suite:**
- Append to the relevant `describe` block
- Keep the same `beforeEach` / `afterEach` patterns (fake timers, real timers)
- Use inline fixtures when small; extract factory only when reused across multiple describe blocks

---

*Testing analysis: 2026-05-24*
