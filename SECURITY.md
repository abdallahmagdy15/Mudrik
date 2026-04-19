# Security policy

## Threat model

HoverBuddy runs an AI model that can observe your screen and synthesize actions which are executed on your desktop. The core invariant is:

**The model can only affect the desktop via allow-listed UI-automation actions parsed from its plain-text reply. It cannot run shell commands, write files, or make network requests.**

This is enforced in layers:

1. **Sandboxed agent.** HoverBuddy spawns OpenCode with `--agent readonly` and provisions `.opencode/agent/readonly.md` into the working directory on startup. The agent declares `bash`, `edit`, `write`, `webfetch`, `websearch`, `task`, `todowrite`, and `skill` as denied.
2. **Runtime kill-switch.** `src/main/opencode-client.ts` inspects every JSON event streamed from OpenCode. If a `permission.asked` or `part.tool` event names any disallowed tool the OpenCode subprocess is `SIGKILL`ed, the session is aborted, and the UI shows a "Blocked: model attempted to use X" error. This is the enforcement that matters — the agent file is advisory in OpenCode 1.4.x.
3. **Action allowlist at parse time.** `parseActionsFromResponse` only emits `Action`s whose `type` is in a hardcoded set (`src/main/action-executor.ts#ALLOWED_ACTION_TYPES`). Any other marker — notably legacy `run_command` — is captured in a `blocked` list surfaced to the UI, never executed.
4. **IPC schema validation.** Both `EXECUTE_ACTION` and `RETRY_ACTION` handlers run the renderer-supplied payload through `validateAction`, which coerces fields to the right types and rejects unknown action types. A compromised renderer cannot send a `run_command`-shaped payload to the main process.

Out-of-scope (not defended against):

- A malicious user with local administrator access. HoverBuddy runs as the logged-in user.
- A malicious OpenCode binary installed globally via `npm i -g opencode-ai`. We trust the CLI the user has on PATH.
- Screenshot/UIA content being included in the prompt the user authored. Attackers can craft UI content that says "ignore all your rules"; the model is still free to act on any allowed action type, so the blast radius is the allowed action set.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Email the maintainer directly (see the repo's "About" section on GitHub for the current contact address) with:

- A description of the issue and the impact.
- Reproduction steps or a proof-of-concept.
- The HoverBuddy version and your Windows build number.

We aim to acknowledge within 72 hours and ship a fix or mitigation within 14 days for high-severity issues. Coordinated disclosure: we'd appreciate you holding public disclosure until a fix is released or 90 days have elapsed, whichever comes first.

## Supported versions

Only the most recent minor release line. Older versions receive no updates.

## Dependencies

- `electron-updater` verifies release artifacts using the signature of `latest.yml` on GitHub Releases.
- The installer is currently **unsigned**. This is a known limitation; users will see a SmartScreen warning on first run. A signing certificate is planned for a future release.
