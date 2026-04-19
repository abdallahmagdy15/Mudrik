<!-- Thanks for the patch! Keep the summary tight. -->

## Summary

<!-- 1–3 sentences. What does this change and why? -->

## Test plan

<!-- How did you verify? E.g. "ran the suite, manually triggered flow X, logs show Y." -->

## Checklist

- [ ] `npx tsc --noEmit -p .` passes
- [ ] `npm run build` succeeds
- [ ] `npm run test` passes
- [ ] `npm run check:no-env` passes
- [ ] No new IPC channel bypasses `validateAction`
- [ ] No new subprocess spawn accepts model-derived arguments without allowlisting
- [ ] If a PowerShell script changed, the `-vN` filename was bumped
- [ ] If an `ActionType` was added, `ALLOWED_ACTION_TYPES` + system prompt + schema test were updated
- [ ] I did not re-introduce shell execution
