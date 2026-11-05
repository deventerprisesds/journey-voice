// WHAT:       Per-account on/off switch for the NIGHTLY schedule build, plus an optional plain-language label
//             for the account row (config.nightlySchedule = { enabled, label }). Pure; read by
//             nightly-schedule-builder before it does any work for an account.
// WHY:        Owner 2026-11-05: "how do we control in settings which accounts are off or on?" The cron job
//             and the builder ran EVERY user_scheduling_prefs row with no filter (cron.job 11, and
//             nightly-schedule-builder/index.ts loading every row), including the demo placeholder and an
//             account signed into once in February.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   _shared/nightly-switch.test.ts
//
// DEFAULT IS ON. A missing key, a missing object, or anything that is not literally `false` means the
// account builds as it does today -- a switch must never turn an account off by accident.
// The switch governs the SCHEDULED run only (triggerSource 'cron'). A rebuild the owner asks for from the
// app ("reschedule my day") still runs, because asking is consent.

export interface NightlyScheduleSetting {
  enabled?: boolean;
  /** Shown in the builder's log and Settings, e.g. "Demo mode placeholder -- no one signs in to this". */
  label?: string;
}

export function nightlySetting(userConfig: any): { enabled: boolean; label: string | null } {
  const raw = userConfig?.nightlySchedule;
  const enabled = !(raw && typeof raw === 'object' && raw.enabled === false);
  const label = raw && typeof raw === 'object' && typeof raw.label === 'string' && raw.label.trim()
    ? raw.label.trim()
    : null;
  return { enabled, label };
}

/** True when the builder should skip this account for this trigger. */
export function skipNightlyRun(userConfig: any, triggerSource: string): boolean {
  return triggerSource === 'cron' && !nightlySetting(userConfig).enabled;
}
