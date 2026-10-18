// WHAT:       Merge a settings save into the STORED scheduling config instead of replacing it.
// WHY:        2026-09-13 16:12Z the owner's whole `user_scheduling_prefs.config` (time windows,
//             category mappings, keyword rules) was replaced by `{customAIInstructions}` alone —
//             45s after 9df8b08 shipped a Voice Assistant settings change. That page saves only its
//             own fields, and `saveUserSchedulingConfig` wrote `config: restConfig` wholesale, so
//             every key the page did not send was deleted. The scheduler then ran on code defaults
//             for 5 weeks while the Settings screen showed those defaults as if they were the owner's.
// SUPERSEDES: the wholesale `config: restConfig` write in services/schedulingService.ts.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   huddle-extension-app .claude/actions.md ACT:schedule-audit-2026-10-17;
//             activity_log nightly runs 2026-04-17..2026-09-13 (custom windows) vs after (defaults).

type Json = Record<string, unknown>;

/**
 * Top-level merge: keys present in `patch` (and not `undefined`) replace the stored value; every
 * key the caller did not send is KEPT. A page that only edits `customAIInstructions` therefore
 * can never erase `timeWindows`, `categoryMappings`, `contextRules` or `caveats`.
 *
 * Deliberately shallow: the Scheduling Settings page always sends each section whole (all windows,
 * all categories), so a section it sends is the owner's complete intent for that section.
 */
export function mergeStoredConfig(stored: unknown, patch: Json): Json {
  const base: Json = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...(stored as Json) } : {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v !== undefined) base[k] = v;
  }
  return base;
}
