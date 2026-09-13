// WHAT:       the per-user digest run -- for one planned user, load each digest from its resolved
//             source, deliver it, and account for every one with exactly one outcome row.
// WHY:        this loop lived inside `send-digests/index.ts`, an edge function whose only entry is
//             `serve()` and which NOTHING imports, so it could not be tested at all. Loop 2 of
//             verification named that directly: the silent-stand-up-drop it had refuted and seen
//             fixed was "undefended behaviour", and it observed the loop was cheaply extractable
//             because every dependency is already a `_shared/` import. It was right on both counts.
//             The earlier defect is exactly the kind a test catches and a reading does not: a
//             `continue` with no outcome row looks fine in isolation and only shows up as "three
//             digests planned, two rows emitted".
// SUPERSEDES: the inline loop in supabase/functions/send-digests/index.ts (same behaviour, moved)
// SUPERSEDED-BY: nothing -- current
// EVIDENCE:   src/utils/digestRun.test.ts; .claude/VERIFY-digest-delivery-loop2.md challenge (2).

import { type DigestPayload } from "./digest-content.ts";
import { type DigestPlan } from "./digest-delivery.ts";
import { type DigestName, resolveDigestSource } from "./digest-source.ts";

/** One line of the run report. Exactly one per digest per user per run. */
export interface DigestOutcome {
  digest: DigestName | string;
  channels: string[];
  ok: boolean;
  error?: string;
}

/**
 * Everything the run needs from the outside world, injected so the loop is testable without a
 * database, a network, or Deno. The edge function supplies the real ones.
 */
export interface DigestRunDeps {
  loadDailyBrief(userId: string, opts: { timezone: string; todayStr: string }): Promise<DigestPayload | null>;
  loadMeetings(userId: string, opts: { now: Date; timezone: string }): Promise<DigestPayload | null>;
  resolveUserEmail(userId: string): Promise<string | null>;
  loadStandup(args: { userEmail: string; date: string; timezone: string; runId: string }): Promise<DigestPayload | null>;
  deliver(userId: string, payload: DigestPayload, channels: DigestPlan["channels"]): Promise<DigestOutcome[]>;
  /** Thrown by a loader when the deploy cannot build an absolute link. Rethrown, never swallowed. */
  isFatalConfigError(err: unknown): boolean;
}

/**
 * Run every planned digest for ONE user.
 *
 * THE INVARIANT, and the reason this is a function rather than a loop in a file nobody can import:
 * every path through it appends exactly one outcome row per digest, including the paths that send
 * nothing. A `continue` that emits no row makes a run report "two digests" where three were planned,
 * which reads as a bug and hides one. `digestRunIsComplete` below is the assertion form of that.
 */
export async function runDigestsForUser(
  plan: DigestPlan,
  integrated: boolean,
  deps: DigestRunDeps,
  now: Date = new Date(),
): Promise<DigestOutcome[]> {
  const outcomes: DigestOutcome[] = [];

  for (const digest of plan.digests) {
    const source = resolveDigestSource(digest, integrated);
    const note = (ok: boolean, error?: string) =>
      outcomes.push({ digest, channels: [], ok, error });
    try {
      let payload: DigestPayload | null = null;

      if (digest === "daily_brief") {
        // The 8am message: today's schedule, the current ranking, and a deep link to the
        // drag-to-rank widget. journey's own day plan -- it owns scheduling.
        payload = await deps.loadDailyBrief(plan.userId, {
          timezone: plan.timezone,
          todayStr: plan.date,
        });
        // null = nothing scheduled AND nothing ranked. A calendar hold alone is not a brief.
        if (!payload) { note(true, "empty_day"); continue; }

      } else if (digest === "meetings") {
        payload = await deps.loadMeetings(plan.userId, { now, timezone: plan.timezone });
        // null = no meetings WITH A PERSON in the horizon. The owner asked for this digest only
        // when there ARE meetings, so silence here is the requirement, not a failure.
        if (!payload) { note(true, "no_meetings"); continue; }

      } else {
        // STAND-UP. Its content is Huddle's: produced by Huddle's agents, about their own work.
        // journey has no agents, so when this deployment is NOT integrated there is genuinely no
        // stand-up to send and nothing to fall back to. Reported as its own outcome rather than
        // skipped -- a run that quietly emitted two rows where three were planned is
        // indistinguishable from a bug.
        if (source !== "huddle") { note(true, "standup_requires_huddle"); continue; }

        const email = await deps.resolveUserEmail(plan.userId);
        if (!email) { note(false, "no_user_email"); continue; }

        payload = await deps.loadStandup({
          userEmail: email,
          date: plan.date,
          timezone: plan.timezone,
          runId: `digest-${plan.date}-${plan.userId}`,
        });
        // Huddle's own change gate: nothing happened since the last stand-up.
        if (!payload) { note(true, "nothing_to_report"); continue; }
      }

      outcomes.push(...(await deps.deliver(plan.userId, payload, plan.channels)));
    } catch (err) {
      // A deploy that cannot build an absolute link fails the whole run CLOSED rather than mailing
      // a human a dead relative path. Every other error is this digest's alone.
      if (deps.isFatalConfigError(err)) throw err;
      note(false, err instanceof Error ? err.message : String(err));
    }
  }

  return outcomes;
}

/**
 * Did every planned digest account for itself?
 *
 * Exported so the edge function can assert it at runtime and a test can assert it over every branch
 * combination. This is the defect loop 1 found, in assertion form: a digest that produced no row at
 * all is the silent drop, and it is invisible in a report that only lists what DID happen.
 */
export function digestRunIsComplete(plan: DigestPlan, outcomes: DigestOutcome[]): boolean {
  return plan.digests.every((d) => outcomes.some((o) => o.digest === d));
}
