// WHAT:       Mints a short-lived Microsoft Graph access token (mail + calendar) for ONE of the user's
//             own connected Outlook accounts, from the refresh token journey already stores.
// WHY:        Huddle's app-only Graph key only reaches mailboxes inside the EnterpriseDS tenant. The
//             owner's work mailbox (@trinnex.io) is in another company's tenant, reachable only with
//             the delegated sign-in he gave journey's "Connect Outlook" (2026-11-05: Trinnex tenant
//             returned "Need admin approval"; journey #98 added Mail.ReadWrite to that sign-in).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   huddle-extension-app .claude/actions.md ACT:trinnex-mailbox; journey-voice #98.
//
// The minted token is NEVER written back to calendar_connections: that row's access_token is the
// calendar-scoped one calendar sync uses, and overwriting it with this one would break sync until it
// expired. Microsoft does not revoke a refresh token when it is redeemed, so not storing a rotated one
// is safe.

export const MAIL_TOKEN_SCOPE =
  "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite offline_access";

const MICROSOFT_PROVIDERS = ["outlook", "office365"];

export type MailTokenResult =
  | { success: true; result: { access_token: string; expires_in: number; account_email: string } }
  | { success: false; error: "account_not_connected" | "consent_required" | "refresh_failed" | "not_configured"; detail?: string };

/** Pure: the AADSTS code Microsoft put in a token-endpoint error, mapped to what the caller can do. */
export function classifyTokenError(body: string): "consent_required" | "refresh_failed" {
  // AADSTS65001: consent missing. AADSTS90094 / 90095: admin approval required (employer tenant).
  return /AADSTS(65001|90094|90095)/.test(body) ? "consent_required" : "refresh_failed";
}

// deno-lint-ignore no-explicit-any
type Client = any;

export async function getMailAccessToken(
  supabase: Client,
  userId: string,
  args: { account_email?: unknown },
  fetchImpl: typeof fetch = fetch,
): Promise<MailTokenResult> {
  const email = typeof args?.account_email === "string" ? args.account_email.trim().toLowerCase() : "";
  if (!email) return { success: false, error: "account_not_connected", detail: "account_email required" };

  const { data: rows } = await supabase
    .from("calendar_connections")
    .select("id, provider, provider_account_email, is_active")
    .eq("user_id", userId)
    .in("provider", MICROSOFT_PROVIDERS)
    .eq("is_active", true);
  const conn = (rows ?? []).find(
    (r: { provider_account_email?: string }) => String(r.provider_account_email ?? "").trim().toLowerCase() === email,
  );
  if (!conn) return { success: false, error: "account_not_connected" };

  const { data: tok } = await supabase.rpc("get_calendar_connection_tokens", { _connection_id: conn.id });
  const refreshToken = tok?.[0]?.refresh_token;
  if (!refreshToken) return { success: false, error: "refresh_failed", detail: "no refresh token stored" };

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
  if (!clientId || !clientSecret) return { success: false, error: "not_configured" };

  const res = await fetchImpl("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: MAIL_TOKEN_SCOPE,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const code = /AADSTS\d+/.exec(body)?.[0];
    console.error("[mail-access-token] refresh failed", res.status, code ?? "");
    return { success: false, error: classifyTokenError(body), detail: code };
  }
  const j = await res.json();
  if (!j?.access_token) return { success: false, error: "refresh_failed", detail: "no access_token" };
  // Under `result`: huddle-proxy forwards exec.result only, so a top-level token would be dropped.
  return {
    success: true,
    result: { access_token: j.access_token, expires_in: Number(j.expires_in) || 3600, account_email: email },
  };
}
