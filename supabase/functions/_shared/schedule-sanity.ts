// WHAT:       The common-sense check that runs after batch-calendar-scheduler picks times: the prompt it
//             sends, and which of the model's objections are allowed to REMOVE a placed task.
// WHY:        2026-10-19 1am build: "Research The Art of CTO Playbooks" was placed 8-10 PM inside the
//             owner's after_work window, then removed by this check — "🧠 SANITY REJECT: ... Researching a
//             book at 8:00 PM may be too late for focused work". The retry could not re-place it, so
//             8-10 PM shipped empty. Owner: "why was the evening and after work blocks empty". A window
//             the owner configured is HIS call on time of day; a model's taste about focus or energy
//             must never override it. Only objections a window cannot express may remove a task.
// SUPERSEDES: the inline sanity prompt + "remove every flagged index" in batch-calendar-scheduler.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   Supabase function logs 2026-10-19T05:00:22Z; supabase/functions/_shared/schedule-sanity.test.ts

/** Objections that may remove a placed task. Everything else (a timing preference) is logged, not obeyed. */
export const ENFORCED_SANITY_KINDS = ['wrong_day', 'place_closed', 'impossible'] as const;
export type SanityKind = (typeof ENFORCED_SANITY_KINDS)[number] | 'timing_preference';

export interface SanityItem {
  title: string;
  /** e.g. "Monday 8:00 PM" */
  when: string;
  /** the owner's window this time sits in, e.g. "after_work 5pm-10pm" */
  window?: string;
}

export interface SanityFlag {
  index: number;
  kind: string;
  reason: string;
}

export function buildSanityPrompt(items: readonly SanityItem[]): string {
  const lines = items
    .map((it, i) => `${i}: "${it.title}" → ${it.when}${it.window ? ` (owner's ${it.window} window)` : ''}`)
    .join('\n');
  return `Review these scheduled tasks for common-sense issues.

Every time below is already inside a window the OWNER chose for that kind of work, so the TIME OF DAY is his
decision. Never object that something is too late, too early, or a poor time for focus, energy or
concentration — that is a preference, not an issue. Reading, research, writing and computer work are fine at
any hour inside his windows.

Flag ONLY these kinds:
- "wrong_day": the activity belongs to a different day of the week (e.g. a Sunday church service on a Tuesday).
- "place_closed": it needs a business or office that is not open then (bank, post office, doctor, a store late at night).
- "impossible": it cannot happen at that time at all (e.g. a social dinner at 6 AM).

Tasks:
${lines}

Reply as JSON: {"flagged":[{"index":<number>,"kind":"wrong_day"|"place_closed"|"impossible","reason":"<short>"}]}
Return {"flagged":[]} if nothing is clearly wrong.`;
}

/** Parse the model's reply into flags (tolerates a bare array or the older "issues" key). */
export function parseSanityFlags(content: string): SanityFlag[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const p = parsed as { flagged?: unknown; issues?: unknown };
  const arr = Array.isArray(parsed) ? parsed : Array.isArray(p?.flagged) ? p.flagged : Array.isArray(p?.issues) ? p.issues : [];
  return (arr as Record<string, unknown>[])
    .map((f) => ({
      index: typeof f?.index === 'number' ? f.index : Number(f?.index),
      kind: String(f?.kind ?? ''),
      reason: String(f?.reason ?? 'common-sense issue'),
    }))
    .filter((f) => Number.isInteger(f.index));
}

/**
 * Split flags into the ones that remove a task and the ones only logged. A flag with no kind, or any
 * kind outside ENFORCED_SANITY_KINDS, is NOT enforced: the placement already passed the owner's window
 * check, so an unexplained objection keeps his placement rather than emptying his evening.
 */
export function splitSanityFlags(flags: readonly SanityFlag[]): { enforced: SanityFlag[]; ignored: SanityFlag[] } {
  const enforced: SanityFlag[] = [];
  const ignored: SanityFlag[] = [];
  for (const f of flags) {
    ((ENFORCED_SANITY_KINDS as readonly string[]).includes(f.kind) ? enforced : ignored).push(f);
  }
  return { enforced, ignored };
}
