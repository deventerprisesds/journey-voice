// WHAT:       Topic-name matching for classify-task-topic, as pure functions: the normalizer that
//             recognises near-duplicate names, and the one lookup every code path uses
//             (exact, case-insensitive name first, then the normalized name).
// WHY:        the classifier forked a new topic whenever the model's name differed slightly from an
//             existing one: 119 topics for one user on 2026-08-25, and 38 -> 95 live since the cleanup
//             (RESTORE-J1-J15-diff.md J11). J11 (1eda8f2) fixed it inline in index.ts on a parked
//             branch; this module restores it where a test can reach it (index.ts calls `serve` and
//             reads Deno.env on import).
// SUPERSEDES: the inline TOPIC_FILLER_WORDS / normalizeTopicName / name-match `find`s in index.ts.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/RESTORE-step5-j11.md; run: node --experimental-strip-types --test
//             supabase/functions/classify-task-topic/topic-match.test.ts

/**
 * FRAGMENTATION GUARD — normalize a topic name for duplicate detection.
 *
 * Lowercases, strips punctuation, drops filler words that the classifier tacks on inconsistently
 * ("tasks", "management", "projects", ...), and sorts the remaining tokens. So these all collapse
 * to the same key and are recognised as ONE topic instead of forking new rows:
 *   "Career Development" / "Career Development Tasks" / "Development Career"
 *   "Family Grooming Plans" / "Family Grooming Management" / "Family Grooming Tasks"
 * Deliberately conservative: it only collapses names that are the same words plus filler, never
 * merges genuinely different subjects (e.g. "Vehicle Maintenance" vs "Vehicle Rental" stay apart).
 */
export const TOPIC_FILLER_WORDS = new Set([
  'task', 'tasks', 'management', 'managing', 'project', 'projects', 'plan', 'plans', 'planning',
  'activities', 'activity', 'general', 'misc', 'miscellaneous', 'related', 'and', 'the', 'of', 'for',
]);
export function normalizeTopicName(name: string): string {
  const tokens = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !TOPIC_FILLER_WORDS.has(w));
  // If filler was ALL there was, fall back to the raw words so we don't collapse to an empty key.
  const base = tokens.length > 0
    ? tokens
    : (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  return [...base].sort().join(' ');
}

/**
 * The single name lookup: an exact (case-insensitive) match wins; otherwise the first topic whose
 * normalized name equals the candidate's. Exact-first matters when both an exact and a near match
 * exist in the same list (e.g. dormant "Career Development" and "Career Development Tasks").
 */
export function findMatchingTopic<T extends { topic_name: string }>(
  topics: readonly T[],
  name: string,
): T | undefined {
  const lower = (name || '').toLowerCase();
  const key = normalizeTopicName(name);
  return topics.find((t) => t.topic_name.toLowerCase() === lower) ??
    topics.find((t) => normalizeTopicName(t.topic_name) === key);
}
