// WHAT:       Owner-defined CONFLICT RULES for the nightly builder: "when tasks compete for the same time,
//             these win". Each rule is a selector (category / tag / linked to a Nexus assignment) plus a
//             weight. Pure; read by nightly-schedule-builder's candidate sort.
// WHY:        Owner 2026-11-04: "a category should be able to be given a weight in the schedule builder
//             only to be used when conflicts ... not some hard coded hyper specific rule". The first
//             attempt (categoryWeights, PR #87) was a hard-coded education seed added to every score,
//             and it lost to is_priority anyway because the sort compares is_priority before score.
// SUPERSEDES: nothing -- categoryWeights (scheduling-defaults.ts) stays until the owner turns it off.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   _shared/conflict-rules.test.ts; builder sort ("Everyone else ... competes") reads
//             is_priority before score, so a score bonus never beat a priority-flagged task.
//
// NO RULES ARE SEEDED IN CODE. An empty list means today's behaviour exactly. Rules live in
// user_scheduling_prefs.config.conflictRules and are edited in Settings.

export type ConflictMatch =
  | { kind: 'category'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'coursework' }; // linked to a Nexus assignment: the assignment card AND its work sessions

export interface ConflictRule {
  id: string;
  label?: string;
  match: ConflictMatch;
  weight: number;
  enabled?: boolean;
}

interface TaskLike {
  category?: string | null;
  tags?: string[] | null;
  assignment_id?: string | null;
}

/** config.conflictRules, cleaned: unknown shapes and non-numeric weights are dropped, never guessed. */
export function resolveConflictRules(userConfig: any): ConflictRule[] {
  const raw = userConfig?.conflictRules;
  if (!Array.isArray(raw)) return [];
  const out: ConflictRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || r.enabled === false) continue;
    const w = r.weight;
    if (typeof w !== 'number' || !Number.isFinite(w)) continue;
    const m = r.match;
    if (!m || typeof m !== 'object') continue;
    if ((m.kind === 'category' || m.kind === 'tag') && typeof m.value === 'string' && m.value.trim()) {
      out.push({ id: String(r.id ?? out.length), label: r.label, match: { kind: m.kind, value: m.value.trim() }, weight: w });
    } else if (m.kind === 'coursework') {
      out.push({ id: String(r.id ?? out.length), label: r.label, match: { kind: 'coursework' }, weight: w });
    }
  }
  return out;
}

export function ruleMatches(rule: ConflictRule, t: TaskLike): boolean {
  const m = rule.match;
  if (m.kind === 'category') return String(t.category ?? '').toUpperCase() === m.value.toUpperCase();
  if (m.kind === 'tag') return (t.tags ?? []).some((x) => String(x).toLowerCase() === m.value.toLowerCase());
  return !!t.assignment_id;
}

/** The highest weight among the rules a task matches; 0 when none match (= today's behaviour). */
export function conflictWeightOf(t: TaskLike, rules: ConflictRule[]): number {
  let best = 0;
  let matched = false;
  for (const r of rules) {
    if (!ruleMatches(r, t)) continue;
    best = matched ? Math.max(best, r.weight) : r.weight;
    matched = true;
  }
  return best;
}
