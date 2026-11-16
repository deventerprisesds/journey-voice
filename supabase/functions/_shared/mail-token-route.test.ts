// WHAT:       Pins WHERE the mail access token may be minted: huddle-proxy only, never execute-tool.
// WHY:        journey's own model executors (tool-executor.ts, hybrid-assistant-api, twilio bridges) call
//             execute-tool with the service-role key and a MODEL-CHOSEN tool name, so any tool living there
//             is model-reachable. Found by VERIFY-second-mailbox-1.md (huddle-extension-app), 2026-11-05.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   huddle-extension-app docs/qc-evidence/VERIFY-second-mailbox-1.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const exec = read("../execute-tool/index.ts");
const proxy = read("../huddle-proxy/index.ts");

test("execute-tool cannot mint a mail token (no dispatch case, no import)", () => {
  assert.doesNotMatch(exec, /case\s+['"]get_mail_access_token['"]/);
  assert.doesNotMatch(exec, /getMailAccessToken/);
});

test("execute-tool refuses the tool name for every caller, service role included", () => {
  assert.match(exec, /if \(toolName === 'get_mail_access_token'\) \{\s*\n\s*console\.warn/);
});

test("huddle-proxy mints it, after its own token check and user resolution", () => {
  const i = proxy.indexOf('if (toolName === "get_mail_access_token")');
  assert.ok(i > 0, "huddle-proxy handles the tool");
  assert.ok(proxy.indexOf("resolveUserId(supabase, caller)") < i, "user is resolved first");
  assert.ok(i < proxy.indexOf("const execRes = await fetch("), "handled before the execute-tool delegation");
});
