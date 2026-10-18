// WHAT:       Which keyword rules the app shows and saves: the STORED list when there is one, the
//             code defaults only when nothing is stored.
// WHY:        2026-10-18, restoring the owner's September settings: he removed the keywords
//             bill / business / project / startup. `mergeSchedulingConfig` spread the 48 defaults
//             UNDER the stored list, so a removed keyword reappeared on screen and the next Save
//             wrote it back — deleting a keyword in Settings could never stick. The nightly
//             scheduler already reads `config.contextRules.keywords` as stored (no defaults), so the
//             screen and the scheduler disagreed about which keywords were live.
// SUPERSEDES: the `{ ...DEFAULT keywords, ...user keywords }` spread in config/schedulingRules.ts.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   supabase/functions/nightly-schedule-builder/index.ts (contextKeywords = config.contextRules.keywords);
//             huddle-extension-app .claude/actions.md ACT:scheduling-config-restore.

type KeywordMap = Record<string, string[]>;

/** A stored, non-empty keyword map is the owner's complete list and replaces the defaults
 *  wholesale (same rule the nightly scheduler applies). Absent or empty -> the defaults. */
export function resolveKeywords(stored: unknown, defaults: KeywordMap): KeywordMap {
  if (stored && typeof stored === 'object' && !Array.isArray(stored) && Object.keys(stored).length > 0) {
    return { ...(stored as KeywordMap) };
  }
  return { ...defaults };
}
