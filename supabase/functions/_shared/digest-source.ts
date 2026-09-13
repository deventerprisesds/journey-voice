// WHAT:       decides WHICH APP supplies each digest's content, so journey and Huddle can each
//             produce digests alone AND produce one coherent set when they are integrated.
// WHY:        journey and Huddle "need to be able to run independently or integrated. when
//             integrated huddle handles agents and prioritizing but journey does the scheduling"
//             (owner, standing constraint), and on the digest question specifically: "by default it
//             should be pulling from whatever the source app is unless integrated and if integrated
//             journey would be the switch so in our case it should be using journey" (owner,
//             2026-09-13). Without one named place for that rule, each digest would re-decide it and
//             they would drift -- the exact failure mode the org's "one core funnel" rule exists for.
// SUPERSEDES: nothing
// SUPERSEDED-BY: nothing -- current
// EVIDENCE:   src/utils/digestSourceStandup.test.ts (the switch is tested there alongside the pull
//             it feeds); integration detection matches the existing Huddle
//             reach pattern in huddle-task-sync/index.ts:18-20 and drain-huddle-turns/index.ts:15-17.

/**
 * The app a piece of digest content comes FROM.
 *
 * - `journey` -- journey's own Postgres (tasks, external_calendar_events, the schedule the nightly
 *   builder placed). journey owns scheduling, so this is always journey's answer for the day plan.
 * - `huddle`  -- fetched from Huddle over the existing server-to-server route. Huddle owns the
 *   agents, so the stand-up's content can only come from there.
 */
export type DigestSource = "journey" | "huddle";

/** The three digests the owner asked for, named the same everywhere. */
export type DigestName = "daily_brief" | "meetings" | "standup";

/**
 * Is this journey deployment integrated with a Huddle?
 *
 * Integration is a DEPLOYMENT fact, not a user setting: it is true exactly when this function has
 * both a Huddle endpoint and the shared token to authenticate against it. That is the same pair
 * every existing Huddle call in this repo already requires (huddle-task-sync, drain-huddle-turns,
 * huddle-proxy), so nothing new has to be provisioned to turn it on -- and nothing silently
 * half-works, because a URL without a token cannot authenticate and a token without a URL has
 * nowhere to go.
 *
 * Deliberately NOT inferred from "the user has Huddle tasks in the mirror": a user with stale
 * mirrored rows and a decommissioned Huddle would read as integrated and every stand-up pull would
 * time out.
 */
export function isHuddleIntegrated(env: {
  huddleUrl?: string | null;
  proxyToken?: string | null;
}): boolean {
  return Boolean((env.huddleUrl || "").trim() && (env.proxyToken || "").trim());
}

/**
 * THE SWITCH. Which app supplies `digest`'s content.
 *
 * Standalone journey answers every digest from itself -- including the stand-up, whose content is
 * then whatever journey can say about the day, because there are no agents to report on. Integrated,
 * journey stays the one that DECIDES and DELIVERS (it owns scheduling and the notification
 * transport), and pulls only the content it does not own: the stand-up.
 *
 * Read the return value as "where do I fetch this from", never as "who sends it" -- journey always
 * sends, which is the whole point of journey being the switch.
 */
export function resolveDigestSource(digest: DigestName, integrated: boolean): DigestSource {
  if (!integrated) return "journey";
  // Integrated: Huddle owns the agents, so only the stand-up's content lives over there. The day
  // plan and the calendar are journey's either way -- pulling them from Huddle when integrated
  // would route journey's own data through a network hop to get back what it already has.
  return digest === "standup" ? "huddle" : "journey";
}

/** Default endpoint, overridable per deployment -- same shape as HUDDLE_SYNC_URL / HUDDLE_RUN_TURN_URL. */
export const HUDDLE_STANDUP_URL_ENV = "HUDDLE_STANDUP_URL";
export const HUDDLE_STANDUP_URL_DEFAULT =
  "https://icy-flower-0f415200f.7.azurestaticapps.net/api/public/run-standup";
