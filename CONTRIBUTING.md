# Contributing to HoverBuddy

Thanks for your interest. This doc covers the minimum you need to send a patch.

## Start here

Read [CLAUDE.md](CLAUDE.md) for the architecture map — it's intentionally short. The high-points to keep in mind:

- Four webpack bundles (main / preload / area-preload / renderer) built from `src/`.
- `@shared/*` (= `src/shared/*`) is the single source of truth for IPC names, `ContextPayload`, `Action`, and `Config`.
- **The LLM is text-only.** All desktop effects flow through `<!--ACTION:{...}-->` markers parsed in `src/main/action-executor.ts`. Do **not** reintroduce shell execution or any tool-call story. See [SECURITY.md](SECURITY.md) for why.
- PowerShell scripts are embedded as string literals and written to `%TEMP%\hoverbuddy\` on demand. Bumping the `-vN` suffix in the filename is the cache-invalidation mechanism — do this if you change a script.

## Local setup

```
npm install
npm run dev          # webpack --watch
electron .           # in another terminal
```

Before sending a PR:

```
npx tsc --noEmit -p .     # typecheck
npm run build             # webpack production
npm run test              # unit/integration suite
npm run check:no-env      # leak guard
```

## What we want

- Bug fixes with reproduction steps.
- New allowed action types, with a schema test in `scripts/safety-cut-test.ts`.
- Better UIA heuristics in `src/main/context-reader.ts` / `area-scanner.ts`.
- Icon, mascot, and design-system improvements (see `src/renderer/components/OwlMascot.tsx` and `src/renderer/styles/global.css`).

## What we don't want (in PRs, not in issues)

- Re-adding `run_command` or any shell-exec path. Shell commands are disabled by design.
- Adding new IPC channels that forward renderer-supplied action payloads directly to an executor without going through `validateAction` in `src/main/action-executor.ts`.
- Code-signing certs checked in.
- `.env` files checked in. `scripts/check-no-env.js` will fail the build.

## PR checklist

Your PR template asks you to confirm:

- [ ] `npx tsc --noEmit -p .` passes.
- [ ] `npm run test` passes.
- [ ] No new IPC handler bypasses `validateAction`.
- [ ] No new subprocess spawn accepts model-derived arguments without allowlisting.
- [ ] If you added/changed a PowerShell script, you bumped its `-vN` filename.
- [ ] If you added an allowed `ActionType`, you updated `ALLOWED_ACTION_TYPES`, the `Action` interface, the system prompt, and added a schema test.

## Code style

- TypeScript strict mode. Keep it.
- No runtime dependencies added lightly — the installer stays small.
- Prefer editing existing files over creating new ones. Small diffs.

## License

By contributing you agree your contribution is licensed under the [MIT License](LICENSE).
