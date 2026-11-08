// WHAT:       I/O half of TaskOS's work-calendar feed: reads the owner's appointments snapshot from his EDS
//             OneDrive with the SAME app-only Microsoft Graph key Huddle uses (client credentials), and
//             writes the work meetings into external_calendar_events (owned by the EDS Outlook connection).
// WHY:        see onedrive-feed.ts. Owner, 2026-11-08: "TaskOS should be enabled to read OneDrive" and
//             "graph unlocks it all with the existing key". An app key does not depend on anyone's sign-in,
//             so it cannot lapse on a password change, sign-out, revocation or 90 idle days.
// SUPERSEDES: the delegated-sign-in version of this file (#102: Files.Read minted from the owner's refresh
//             token). That depended on a personal sign-in staying valid and needed a re-consent.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   supabase/functions/_shared/onedrive-feed.test.ts; calendar-delta-sync calls this.
//
// Key: AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET edge secrets -- the same values as
// Huddle's, synced from journey-voice repo secrets by deploy-supabase-functions.yml. Missing -> `needs_key`
// and nothing changes. The connection is only the OWNER ANCHOR for the rows (connection_id is NOT NULL);
// its tokens are not used.

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
  status: "off" | "not_this_account" | "needs_key" | "error" | `rejected:${string}` | "ok";
  upserted?: number;
  removed?: number;
  skipped?: number;
}

export async function syncFeedCalendar(
  supabase: Client,
  connection: { id: string; user_id: string; provider: string; provider_account_email?: string | null },
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<FeedSyncResult> {
  const cfg = parseTaskosFeedConfig(Deno.env.get("TASKOS_ONEDRIVE_FEED"));
  if (!cfg) return { status: "off" };
  if (connection.provider !== "outlook" && connection.provider !== "office365") return { status: "not_this_account" };
  if (String(connection.provider_account_email ?? "").trim().toLowerCase() !== cfg.driveAccount) {
    return { status: "not_this_account" };
  }
  const tenant = Deno.env.get("AZURE_TENANT_ID");
  const clientId = Deno.env.get("AZURE_CLIENT_ID");
  const clientSecret = Deno.env.get("AZURE_CLIENT_SECRET");
  if (!tenant || !clientId || !clientSecret) return { status: "needs_key" };
  const signal = AbortSignal.timeout(READ_DEADLINE_MS);
  try {
    const tok = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
      signal,
    });
    if (!tok.ok) {
      const body = await tok.text();
      console.warn("[onedrive-feed] app token refused", tok.status, /AADSTS\d+/.exec(body)?.[0] ?? "");
      return { status: "error" };
    }
    const accessToken = (await tok.json())?.access_token;
    if (!accessToken) return { status: "error" };
    const path = cfg.appointmentsPath.split("/").map((s) => encodeURIComponent(s)).join("/");
    const user = encodeURIComponent(cfg.driveAccount);
    const res = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${user}/drive/root:${path}:/content`, {
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
