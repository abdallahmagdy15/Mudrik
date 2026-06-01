# TESTING.md

## Testing Overview

### Test Framework
- **Vitest 4** — Test runner
- **Environment**: `node` (configured in `vitest.config.ts`)
- **No DOM tests** — renderer process components are not tested
- **No browser tests** — all tests run in Node.js environment

### Test File Locations
```
src/
├── main/
│   ├── action-executor.test.ts      # Action parsing and validation
│   └── guide/
│       └── guide-controller.test.ts # Guide movement logic
└── shared/
    └── prompts.test.ts              # System prompt building
```

### Running Tests
```bash
# All tests
npm test

# Single test file
npx vitest run src/main/action-executor.test.ts
npx vitest run src/main/guide/guide-controller.test.ts
npx vitest run src/shared/prompts.test.ts
```

### Test Coverage Areas

#### 1. Action Executor (`src/main/action-executor.test.ts`)
Tests for `parseActionsFromResponse()` and action validation:
- Parses `<!--ACTION:{json}-->` markers from LLM response text
- Validates action payload structure
- Handles edge cases (malformed JSON, missing fields)
- Tests `guide_offer` payload fields (regression test)
- Tests `validateAction()` with various action types

#### 2. Guide Controller (`src/main/guide/guide-controller.test.ts`)
Tests for cursor auto-guidance logic:
- Movement calculations
- Step estimation
- Option parsing
- Regression tests for guide behavior

#### 3. Prompts (`src/shared/prompts.test.ts`)
Tests for `buildSystemPrompt()`:
- Base prompt structure
- Action block inclusion/exclusion based on `Config.actionsEnabled`
- Guide block inclusion/exclusion based on `Config.autoGuideEnabled`
- Dynamic prompt composition

### What's NOT Tested
- Renderer process (React components) — no DOM environment
- Main process window management — requires Electron runtime
- PowerShell scripts — require Windows + UIA
- Native modules (robotjs, koffi) — require real OS APIs
- IPC handlers — require full Electron context
- OpenCode client — requires external CLI binary
- Screenshot/vision — requires display capture

### CI Integration
Tests run automatically in GitHub Actions:
```
npm ci → npx tsc --noEmit → npm run build → npm test → npm run check:no-env
```

### Adding Tests
When implementing features:
1. Prefer unit tests for pure functions (parsing, validation, formatting)
2. Co-locate test files: `foo.ts` → `foo.test.ts`
3. Use `node` environment (no `jsdom` or `happy-dom`)
4. Mock external dependencies (fs, child_process, etc.)

### Test Data
- Use inline test data (no fixtures directory)
- Mock config with `DEFAULT_CONFIG` from `types.ts`
- Mock context payloads with minimal valid structures
