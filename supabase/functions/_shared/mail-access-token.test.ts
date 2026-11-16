// WHAT:       Unit tests for getMailAccessToken (the server-only Graph mail+calendar token minter).
// WHY:        It hands out a credential; the account match, the "never write back" rule and the
//             result shape huddle-proxy forwards must not regress silently.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   huddle-extension-app .claude/actions.md ACT:trinnex-mailbox.
import { test } from "node:test";
import assert from "node:assert/strict";

// deno-lint-ignore no-explicit-any
(globalThis as any).Deno = { env: { get: (k: string) => ({ MICROSOFT_CLIENT_ID: "cid", MICROSOFT_CLIENT_SECRET: "sec" } as Record<string, string>)[k] } };
const { getMailAccessToken, classifyTokenError, MAIL_TOKEN_SCOPE } = await import("./mail-access-token.ts");

function fakeDb(rows: unknown[], refresh = "rt-1") {
  const calls = { update: 0, rpc: [] as string[], eqUser: "" };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (col: string, v: unknown) => { if (col === "user_id") calls.eqUser = String(v); return q; },
    in: () => q,
    update: () => { calls.update++; return q; },
    // Like the real table: no user filter -> every user's rows come back.
    then: (res: (v: unknown) => void) => res({ data: calls.eqUser ? rows.filter((r: any) => r.user_id === calls.eqUser) : rows }),
  };
  return {
    calls,
    from: () => q,
    rpc: (name: string) => { calls.rpc.push(name); return Promise.resolve({ data: [{ refresh_token: refresh }] }); },
  };
}
const row = { id: "c1", user_id: "u1", provider: "office365", provider_account_email: "Von.Ellis@Trinnex.io", is_active: true };

test("mints a token for the user's own account, case-insensitively, under `result`", async () => {
  const db = fakeDb([row]);
  let body = "";
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    body = String(init.body);
    return new Response(JSON.stringify({ access_token: "AT", expires_in: 3599 }), { status: 200 });
  }) as typeof fetch;
  const r = await getMailAccessToken(db, "u1", { account_email: " von.ellis@trinnex.IO " }, fetchImpl);
  assert.deepEqual(r, { success: true, result: { access_token: "AT", expires_in: 3599, account_email: "von.ellis@trinnex.io" } });
  assert.match(decodeURIComponent(body.replace(/\+/g, " ")), new RegExp(MAIL_TOKEN_SCOPE.replace(/[./]/g, "\\$&")));
  assert.equal(db.calls.update, 0, "must never write the mail token back over the calendar token");
});

test("another user's account is not connected for this user", async () => {
  const db = fakeDb([row]);
  const r = await getMailAccessToken(db, "u2", { account_email: "von.ellis@trinnex.io" }, (() => { throw new Error("no fetch"); }) as never);
  assert.deepEqual(r, { success: false, error: "account_not_connected" });
});

test("missing account_email is refused before any lookup", async () => {
  const r = await getMailAccessToken(fakeDb([row]), "u1", {}, (() => { throw new Error("no fetch"); }) as never);
  assert.equal(r.success, false);
});

test("employer admin-approval / consent errors map to consent_required", async () => {
  assert.equal(classifyTokenError('{"error_description":"AADSTS65001: The user or administrator has not consented"}'), "consent_required");
  assert.equal(classifyTokenError("AADSTS90094: admin approval required"), "consent_required");
  assert.equal(classifyTokenError("AADSTS70008: expired"), "refresh_failed");
  const fetchImpl = (async () => new Response("AADSTS65001: no consent", { status: 400 })) as typeof fetch;
  const r = await getMailAccessToken(fakeDb([row]), "u1", { account_email: "von.ellis@trinnex.io" }, fetchImpl);
  assert.deepEqual(r, { success: false, error: "consent_required", detail: "AADSTS65001" });
});
