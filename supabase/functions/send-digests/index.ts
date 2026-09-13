// WHAT:       the edge function that actually SENDS the owner's three morning digests -- the 8am
//             daily brief (schedule + ranked priorities + a deep link to the re-rank widget), the
//             meetings summary (today, then broken out by day across the next 7), and Terry's
//             stand-up -- on every channel the user selected.
// WHY:        none of the three were arriving. The content layer, the renderers, the channel
//             vocabulary and the meetings classifier all existed; nothing CALLED them. And the one
//             digest that did exist (notification-scheduler's `generateDailyDigest`) reads the
//             user's channel preference into `userChannels` at index.ts:523 and never uses it,
//             invoking send-push-notification unconditionally -- so "I changed it to email" could
//             not have worked, on any run, for anyone.
// SUPERSEDES: nothing. notification-scheduler's count-only `daily_digest` push is left alone; this
//             is the rich brief, a different message with a different trigger.
// SUPERSEDED-BY: nothing -- current
// EVIDENCE:   src/utils/digestDelivery.test.ts, digestSourceStandup.test.ts, digestContent.test.ts.
//
// TRIGGER: cron every 15 minutes (TICK_WINDOW_MINUTES) -- each user is gated to their OWN local 8am,
// so one tick serves every timezone. `{"immediate":true}` runs it now for testing; `{"userId":"..."}`
// narrows it to one user.
//
// HARD REQUIREMENT: `APP_BASE_URL` must be set (`supabase secrets set APP_BASE_URL=https://<host>`).
// Without it every digest FAILS CLOSED rather than emailing a human a relative, dead link.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  type DigestChannel,
  type DigestPayload,
  renderDigest,
  MissingDeepLinkBaseError,
} from "../_shared/digest-content.ts";
import { normalizeChannels } from "../_shared/notification-channels.ts";
import {
  type DigestPrefs,
  planDigestRun,
} from "../_shared/digest-delivery.ts";
import {
  isHuddleIntegrated,
  resolveDigestSource,
  HUDDLE_STANDUP_URL_ENV,
  HUDDLE_STANDUP_URL_DEFAULT,
} from "../_shared/digest-source.ts";
import { loadStandupDigestPayload } from "../_shared/digest-source-standup.ts";
import { loadMeetingsDigestPayload } from "../_shared/digest-source-meetings.ts";
import { loadDailyBriefPayload } from "../_shared/digest-source-daily.ts";
import { runDigestsForUser, digestRunIsComplete } from "../_shared/digest-run.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface SendOutcome {
  digest: string;
  channels: string[];
  ok: boolean;
  error?: string;
}

/**
 * Send one rendered payload to the user's channels.
 *
 * Channels are grouped by the EXACT rendered body: push is truncated and carries no link, email
 * carries the deep link, slack and app_message differ again — so channels that render identically
 * share one invoke and channels that do not get their own. Sending one body to all of them would
 * either put a 300-char truncation in an email or a full brief in a push.
 */
async function deliver(
  supabaseClient: ReturnType<typeof createClient>,
  userId: string,
  payload: DigestPayload,
  channels: DigestChannel[],
): Promise<SendOutcome[]> {
  const byBody = new Map<string, { subject: string; body: string; channels: DigestChannel[] }>();
  for (const ch of channels) {
    const r = renderDigest(payload, ch);
    const key = `${r.subject}\u0000${r.body}`;
    const bucket = byBody.get(key);
    if (bucket) bucket.channels.push(ch);
    else byBody.set(key, { subject: r.subject, body: r.body, channels: [ch] });
  }

  const outcomes: SendOutcome[] = [];
  for (const group of byBody.values()) {
    const canonical = normalizeChannels(group.channels);
    try {
      const { data, error } = await supabaseClient.functions.invoke("send-unified-notification", {
        body: {
          userId,
          title: group.subject,
          body: group.body,
          channels: canonical,
          data: { type: `digest_${payload.kind}`, deepLink: payload.deepLink },
        },
      });
      // `functions.invoke` sets `error` only on a non-2xx, and a PARTIAL fan-out returns 2xx --
      // so the absence of `error` is NOT evidence of delivery. Read the body's own verdict, the
      // same lesson notification-delivery already learned (F2).
      const succeeded = error ? false : (data as any)?.success !== false;
      outcomes.push({
        digest: payload.kind,
        channels: canonical,
        ok: succeeded,
        error: error ? error.message || String(error) : succeeded ? undefined : "partial_or_failed",
      });
    } catch (err) {
      outcomes.push({
        digest: payload.kind,
        channels: canonical,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const immediate: boolean = !!body.immediate;
    const onlyUserId: string | undefined = body.userId;

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const proxyToken = (Deno.env.get("JOURNEY_PROXY_TOKEN") ?? "").trim();
    const huddleUrl = (Deno.env.get(HUDDLE_STANDUP_URL_ENV) ?? HUDDLE_STANDUP_URL_DEFAULT).trim();
    const integrated = isHuddleIntegrated({ huddleUrl, proxyToken });
    console.log(`[send-digests] integrated=${integrated} immediate=${immediate}`);

    let query = supabaseClient.from("notification_prefs").select("*");
    if (onlyUserId) query = query.eq("user_id", onlyUserId);
    const { data: allPrefs, error: prefsError } = await query;
    if (prefsError) {
      console.error("[send-digests] failed to read notification_prefs:", prefsError);
      return json({ ok: false, error: "prefs_read_failed" }, 500);
    }

    const now = new Date();
    const report: unknown[] = [];

    for (const prefs of (allPrefs ?? []) as DigestPrefs[]) {
      const plan = planDigestRun(prefs, now, { immediate });
      if (plan.skipReason) {
        // Every skip carries a reason so a quiet morning is explained rather than merely silent.
        report.push({ userId: plan.userId, skipped: plan.skipReason });
        continue;
      }

      // The loop itself lives in `_shared/digest-run.ts` so it can be TESTED: this file's only
      // entry is `serve()` and nothing imports it, so while the loop lived here the silent-drop
      // fix was undefended behaviour. Dependencies are injected; these are the real ones.
      const outcomes: SendOutcome[] = await runDigestsForUser(
        plan,
        integrated,
        {
          loadDailyBrief: (userId, o) => loadDailyBriefPayload(supabaseClient, userId, o),
          loadMeetings: (userId, o) => loadMeetingsDigestPayload(supabaseClient, userId, o),
          resolveUserEmail: (userId) => resolveUserEmail(supabaseClient, userId),
          loadStandup: (a) => loadStandupDigestPayload({ ...a, proxyToken }),
          deliver: (userId, payload, channels) =>
            deliver(supabaseClient, userId, payload, channels as DigestChannel[]),
          // A deploy that cannot build an absolute link fails the run CLOSED rather than mailing a
          // human a dead relative path.
          isFatalConfigError: (err) => err instanceof MissingDeepLinkBaseError,
        },
        now,
      );

      // The invariant, asserted at runtime and not only in tests: a planned digest that produced no
      // row at all is the silent drop, and it is invisible in a report that lists only what DID
      // happen. Logged rather than thrown -- the user's other digests already went out.
      if (!digestRunIsComplete(plan, outcomes)) {
        console.error(
          `[send-digests] INCOMPLETE RUN for ${plan.userId}: planned ${JSON.stringify(plan.digests)}, ` +
            `accounted ${JSON.stringify(outcomes.map((o) => o.digest))}`,
        );
      }

      report.push({ userId: plan.userId, channels: plan.channels, date: plan.date, outcomes });
    }

    return json({ ok: true, integrated, users: report.length, report });
  } catch (err) {
    if (err instanceof MissingDeepLinkBaseError) {
      // The one configuration error worth a distinct status: nothing is wrong with the code, a
      // secret is missing, and shipping a dead link instead would be worse than sending nothing.
      console.error("[send-digests]", err.message);
      return json({ ok: false, error: "missing_app_base_url", detail: err.message }, 503);
    }
    console.error("[send-digests] unhandled:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: "digest_run_failed" }, 500);
  }
});

/** The address Huddle knows this user by. Profiles is the same source huddle-proxy resolves against. */
async function resolveUserEmail(
  supabaseClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabaseClient
    .from("profiles")
    .select("email")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return (data as { email?: string } | null)?.email ?? null;
}
