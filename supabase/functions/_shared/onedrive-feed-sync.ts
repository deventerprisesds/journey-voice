// WHAT:       I/O half of TaskOS's work-calendar feed: reads the owner's appointments snapshot from his EDS
//             OneDrive with the SAME delegated sign-in TaskOS already holds for that Outlook account, and
//             writes the work meetings into external_calendar_events (owned by that connection).
// WHY:        see onedrive-feed.ts. Owner, 2026-11-08: "TaskOS should be enabled to read OneDrive".
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   supabase/functions/_shared/onedrive-feed.test.ts; calendar-delta-sync calls this.
//
// The file-read token is minted from the stored refresh token with scope Files.Read and NEVER stored:
// the connection's stored access token is the calendar one calendar sync uses. Files.Read must have been
// granted at sign-in (calendar-token-manager asks for it); until the owner re-signs in, Microsoft answers
// AADSTS65001 and this reports `needs_reconnect` and changes nothing.

import {
  FEED_CALENDAR_ID,
  isFeedEventId,
  mapFeedEventRows,
  parseTaskosFeedConfig,
  validateSnapshot,
} from "./onedrive-feed.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

const READ_DEADLINE_MS = 10_000;

export interface FeedSyncResult {
  status: "off" | "not_this_account" | "needs_reconnect" | "error" | `rejected:${string}` | "ok";
  upserted?: number;
  removed?: number;
  skipped?: number;
}

export async function syncFeedCalendar(
  supabase: Client,
  connection: { id: string; user_id: string; provider: string; provider_account_email?: string | null },
  refreshToken: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<FeedSyncResult> {
  const cfg = parseTaskosFeedConfig(Deno.env.get("TASKOS_ONEDRIVE_FEED"));
  if (!cfg) return { status: "off" };
  if (connection.provider !== "outlook" && connection.provider !== "office365") return { status: "not_this_account" };
  if (String(connection.provider_account_email ?? "").trim().toLowerCase() !== cfg.driveAccount) {
    return { status: "not_this_account" };
  }
  if (!refreshToken) return { status: "needs_reconnect" };
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
  if (!clientId || !clientSecret) return { status: "error" };
  const signal = AbortSignal.timeout(READ_DEADLINE_MS);
  try {
    const tok = await fetchImpl("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: "https://graph.microsoft.com/Files.Read offline_access",
      }),
      signal,
    });
    if (!tok.ok) {
      const body = await tok.text();
      console.warn("[onedrive-feed] file token refused", tok.status, /AADSTS\d+/.exec(body)?.[0] ?? "");
      return { status: /AADSTS65001|invalid_grant|consent/i.test(body) ? "needs_reconnect" : "error" };
    }
    const accessToken = (await tok.json())?.access_token;
    if (!accessToken) return { status: "error" };
    const path = cfg.appointmentsPath.split("/").map((s) => encodeURIComponent(s)).join("/");
    const res = await fetchImpl(`https://graph.microsoft.com/v1.0/me/drive/root:${path}:/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (!res.ok) {
      console.warn("[onedrive-feed] appointments file read failed", res.status);
      return { status: res.status === 404 ? "rejected:missing" : "error" };
    }
    const text = await res.text();
    if (text.length > cfg.maxBytes) return { status: "rejected:too_large" };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { status: "rejected:not_json" };
    }
    const v = validateSnapshot(json, cfg, "appointments_snapshot", nowMs);
    // A rejected snapshot changes NOTHING: the rows already stored are the last good copy.
    if (!v.ok) return { status: `rejected:${v.reason}` };

    const rows = mapFeedEventRows(v.records, cfg, connection, new Date(nowMs).toISOString());
    if (rows.length) {
      const { error } = await supabase
        .from("external_calendar_events")
        .upsert(rows, { onConflict: "connection_id,external_event_id", ignoreDuplicates: false });
      if (error) {
        console.error("[onedrive-feed] upsert failed", error.message);
        return { status: "error" };
      }
    }
    // Removals ONLY from a complete, validated snapshot: feed rows on this connection that the
    // snapshot no longer contains (cancelled / moved out of the window). Deleted by row id, never by a
    // pattern, and never touching a real Outlook row.
    const keep = new Set(rows.map((r) => r.external_event_id));
    const { data: existing } = await supabase
      .from("external_calendar_events")
      .select("id, external_event_id")
      .eq("connection_id", connection.id)
      .eq("calendar_id", FEED_CALENDAR_ID);
    const stale = (existing ?? [])
      .filter((e: { external_event_id: string }) => isFeedEventId(e.external_event_id) && !keep.has(e.external_event_id))
      .map((e: { id: string }) => e.id);
    if (stale.length) {
      const { error } = await supabase.from("external_calendar_events").delete().in("id", stale);
      if (error) console.error("[onedrive-feed] stale delete failed", error.message);
    }
    return { status: "ok", upserted: rows.length, removed: stale.length, skipped: v.skipped };
  } catch (err) {
    console.error("[onedrive-feed] sync failed", err instanceof Error ? err.message : err);
    return { status: "error" };
  }
}
