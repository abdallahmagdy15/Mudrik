// One-shot invariant test for the Week-0 safety cut (A1 parser, A3 validator).
// Run with: npx tsc -p scripts/tsconfig.test.json && node scripts/out/safety-cut-test.js
// Not run in CI yet; exists to re-verify after edits to action-executor.ts.

import { parseActionsFromResponse, validateAction, ALLOWED_ACTION_TYPES } from "../src/main/action-executor";

let fails = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("FAIL:", msg); fails++; }
  else console.log("ok  ", msg);
}

// 1. run_command marker is blocked, not executed
const r1 = parseActionsFromResponse('Running <!--ACTION:{"type":"run_command","command":"rm"}--> now');
assert(r1.actions.length === 0, "run_command produces zero executable actions");
assert(r1.blocked.length === 1 && r1.blocked[0].type === "run_command", "run_command captured in blocked");

// 2. Unknown types blocked
const r2 = parseActionsFromResponse('<!--ACTION:{"type":"exec_payload"}-->');
assert(r2.actions.length === 0 && r2.blocked.length === 1, "unknown type blocked");
assert(r2.blocked[0].reason.includes("unknown"), "unknown reason set");

// 3. Allowed types pass
const r3 = parseActionsFromResponse('<!--ACTION:{"type":"type_text","selector":"X","text":"hi"}-->');
assert(r3.actions.length === 1 && r3.actions[0].type === "type_text", "type_text parsed");
assert(r3.blocked.length === 0, "no blocked for allowed type");

// validateAction now takes a cfg with actionsEnabled + autoGuideEnabled.
const cfg = { actionsEnabled: true, autoGuideEnabled: false };

// 4. IPC validator rejects run_command
const v1 = validateAction({ type: "run_command", command: "bad" }, cfg);
assert("error" in v1, "validateAction rejects run_command");

// 5. Non-object rejected
assert("error" in validateAction("hello", cfg), "validateAction rejects string");
assert("error" in validateAction(null, cfg), "validateAction rejects null");
assert("error" in validateAction(undefined, cfg), "validateAction rejects undefined");

// 6. Allowed action coerced; unknown fields dropped
const v2 = validateAction({ type: "guide_to", selector: "Save", autoClick: false, extraBad: "nope" }, cfg);
assert("action" in v2, "validateAction accepts guide_to");
if ("action" in v2) {
  assert(v2.action.selector === "Save", "selector preserved");
  assert(v2.action.autoClick === false, "autoClick preserved");
  assert((v2.action as any).extraBad === undefined, "unknown fields dropped");
}

// 7. Wrong-type fields dropped
const v3 = validateAction({ type: "type_text", text: 123 }, cfg);
assert("action" in v3 && (v3 as any).action.text === undefined, "non-string text dropped");

// 8. Allowlist contents
assert(ALLOWED_ACTION_TYPES.has("guide_to"), "guide_to in allowlist");
assert(!(ALLOWED_ACTION_TYPES as any).has("run_command"), "run_command NOT in allowlist");

if (fails > 0) { console.error(`\n${fails} failure(s)`); process.exit(1); }
console.log("\nAll safety-cut invariants hold.");
