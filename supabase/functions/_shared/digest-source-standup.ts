// WHAT:       pulls Terry's stand-up CONTENT from Huddle and maps it into journey's
//             StandupDigestPayload, so the stand-up can be delivered on email/Slack/phone like the
//             other two digests instead of only appearing in Huddle's chat.
// WHY:        the owner's third digest: "I forgot a 3rd digest which is the output of Terry's
//             stand-up which is currently in chat only" (2026-09-13). Huddle's runScheduledStandup
//             used to deliver into Terry's DM and return only COUNTS, so nothing could render it
//             elsewhere; huddle-extension-app now returns `digest` and accepts `deliver:false`.
// SUPERSEDES: nothing
// SUPERSEDED-BY: nothing -- current
// EVIDENCE:   src/utils/digestSourceStandup.test.ts; the Huddle half is
//             huddle-extension-app scripts/standup-deliver-mode.test.ts (12/12, 2 mutations FIRED).

import {
  type StandupDigestPayload,
  buildDeepLink,
  APP_BASE_URL_ENV,
} from "./digest-content.ts";
import { HUDDLE_STANDUP_URL_DEFAULT, HUDDLE_STANDUP_URL_ENV } from "./digest-source.ts";

/** Exactly the shape Huddle's `StandupRunResult.digest` returns. */
export interface HuddleStandupContent {
  produced: { title: string; agent?: string | null }[];
  blocked: { title: string; reason?: string | null; agent?: string | null }[];
  inReview: { title: string; agent?: string | null }[];
  priorities: { title: string; agent?: string | null }[];
  brief: string;
}

export interface HuddleStandupResponse {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  digest?: HuddleStandupContent | null;
}

/**
 * Fetch the stand-up content server-to-server.
 *
 * `deliver: false` is the load-bearing argument: it tells Huddle to ASSEMBLE and RETURN without
 * posting in Terry's DM and without advancing its change-gate watermark. Omitting it would make
 * this pull double-post the stand-up in chat AND silence the real one later the same morning.
 *
 * Auth reuses `JOURNEY_PROXY_TOKEN` -- the standing rule is never to mint a new org secret for
 * Huddle<->journey traffic.
 */
export async function fetchHuddleStandup(params: {
  userEmail: string;
  timeZone: string;
  proxyToken: string;
  url?: string;
  fetchImpl?: typeof fetch;
  runId?: string;
}): Promise<HuddleStandupResponse | null> {
  const url = (params.url || "").trim() || HUDDLE_STANDUP_URL_DEFAULT;
  const doFetch = params.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": params.proxyToken,
      },
      body: JSON.stringify({
        caller: { entra_email: params.userEmail },
        timeZone: params.timeZone,
        deliver: false,
        runId: params.runId,
      }),
    });
    if (!res.ok) {
      console.error(`[digest-standup] Huddle returned ${res.status} for ${params.userEmail}`);
      return null;
    }
    return (await res.json()) as HuddleStandupResponse;
  } catch (err) {
    // A digest is a best-effort morning message. Huddle being unreachable must degrade to "no
    // stand-up section today", never fail the whole digest run and cost the user their day plan.
    console.error(`[digest-standup] fetch failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Map Huddle's content onto journey's payload.
 *
 * `priorities` arrive from Huddle ALREADY RANKED by `rankTasks` -- the single source of
 * prioritization truth every Huddle agent reads. Their position in the array IS the rank, so it is
 * recorded as `rank: i + 1` rather than re-sorted here. Re-ranking on this side would be a second
 * ordering brain that could disagree with the one the user sees in Huddle, which is the exact
 * divergence the cross-surface guard over there exists to prevent.
 */
export function toStandupPayload(
  content: HuddleStandupContent,
  opts: { date: string; timezone: string; deepLink: string },
): StandupDigestPayload {
  return {
    kind: "standup",
    date: opts.date,
    timezone: opts.timezone,
    produced: (content.produced ?? []).map((x) => ({ title: x.title, agent: x.agent ?? null })),
    blocked: (content.blocked ?? []).map((x) => ({ title: x.title, reason: x.reason ?? null })),
    inReview: (content.inReview ?? []).map((x) => ({ title: x.title, agent: x.agent ?? null })),
    priorities: (content.priorities ?? []).map((x, i) => ({ title: x.title, rank: i + 1 })),
    deepLink: opts.deepLink,
  };
}

/** True when there is genuinely nothing to report, so no stand-up digest should be sent. */
export function standupDigestIsEmpty(p: StandupDigestPayload): boolean {
  return (
    p.produced.length === 0 &&
    p.blocked.length === 0 &&
    p.inReview.length === 0 &&
    p.priorities.length === 0
  );
}

/**
 * The whole lane: fetch from Huddle, map, and return `null` when there is nothing to send.
 *
 * Throws `MissingDeepLinkBaseError` when APP_BASE_URL is unset -- deliberately NOT caught. A digest
 * with a dead link is worse than no digest, so the run fails closed rather than emailing a human a
 * relative path.
 */
export async function loadStandupDigestPayload(params: {
  userEmail: string;
  date: string;
  timezone: string;
  proxyToken: string;
  env?: { get(key: string): string | undefined };
  fetchImpl?: typeof fetch;
  runId?: string;
}): Promise<StandupDigestPayload | null> {
  const env = params.env ?? Deno.env;
  // Built BEFORE the network call: if the deployment cannot produce a link, there is no point
  // waking Huddle up to assemble content nobody can be sent.
  const deepLink = buildDeepLink(env.get(APP_BASE_URL_ENV));

  const res = await fetchHuddleStandup({
    userEmail: params.userEmail,
    timeZone: params.timezone,
    proxyToken: params.proxyToken,
    url: env.get(HUDDLE_STANDUP_URL_ENV),
    fetchImpl: params.fetchImpl,
    runId: params.runId,
  });
  // `skipped` is Huddle's own change gate saying nothing happened since the last stand-up. That is
  // a legitimate "nothing to report", not a failure -- and not an empty email either.
  if (!res || res.ok === false || res.skipped || !res.digest) return null;

  const payload = toStandupPayload(res.digest, {
    date: params.date,
    timezone: params.timezone,
    deepLink,
  });
  return standupDigestIsEmpty(payload) ? null : payload;
}
