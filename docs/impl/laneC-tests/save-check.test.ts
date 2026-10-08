// Exercises the REAL saveUserSchedulingConfig from src/services/schedulingService.ts.
// `@supabase/supabase-js` is not installed here (no node_modules), so the supabase CLIENT module is
// mock.module'd BEFORE the service is imported — the service itself is the genuine article, not a
// re-implementation. Testing a re-implementation is the exact failure recorded in
// .claude/accuracy-log.md ("my tests called my new function directly, never the path the data takes").
import { test, expect, mock, beforeEach } from 'bun:test';

// ── fake supabase: a single-row store with PostgREST-ish upsert semantics ────────────────────
let store: Record<string, any> | null = null;   // the row, or null for "no row"
let readError: any = null;
let lastUpsert: any = null;

const fakeFrom = () => {
  const q: any = {
    _select: null as string | null,
    select(cols: string) { q._select = cols; return q; },
    eq() { return q; },
    async maybeSingle() {
      if (readError) return { data: null, error: readError };
      return { data: store ? { ...store } : null, error: null };
    },
    async upsert(row: any) {
      lastUpsert = row;
      store = { ...(store ?? {}), ...row };   // only provided columns are written
      return { error: null };
    },
  };
  return q;
};

mock.module('@/integrations/supabase/client', () => ({ supabase: { from: fakeFrom } }));
mock.module('@/lib/timezone', () => ({
  getBrowserTimezone: () => 'America/New_York',
  TIMEZONE_OPTIONS: [],
  formatTimezoneWithOffset: (s: string) => s,
}));
mock.module('@/lib/date', () => ({ getTimePartsInTimezone: () => ({ hour: 0, minute: 0 }) }));

const { saveUserSchedulingConfig } = await import('@/services/schedulingService');
const { CONFIG_ROUNDTRIP_PROBE_KEY } = await import('@/config/schedulingRules');

const USER = 'u-1';
const seeded = () => ({
  user_id: USER,
  config: {
    timeWindows: { morning: { start: 6, end: 9, days: [1] } },
    categoryMappings: { LIFE: { defaultTimeWindow: ['flexible'] } },
    contextRules: { keywords: { study: ['evening', 'PROF_EDUCATION'] } },
    scoringModel: 'composite',
    dedup: { enabled: true, threshold: 0.8 },
    nudges: { deliverAtLocalHour: 7 },
    assignments: { soonDays: 21 },
    priorityBoost: false,
    [CONFIG_ROUNDTRIP_PROBE_KEY]: { v: 1 },
  },
});

beforeEach(() => { store = seeded(); readError = null; lastUpsert = null; });

// AC-6c — the key that proves the MECHANISM, not the four namespaces that happen to be known.
test('AC-6c: an unknown key the code never heard of survives a save', async () => {
  await saveUserSchedulingConfig(USER, { scoringModel: 'priority-rank' } as any);
  expect(store!.config[CONFIG_ROUNDTRIP_PROBE_KEY]).toEqual({ v: 1 });
});

// AC-6b — the four named namespaces survive an unrelated edit.
test('AC-6b: dedup/nudges/assignments/priorityBoost survive an unrelated save', async () => {
  const before = JSON.parse(JSON.stringify(store!.config));
  await saveUserSchedulingConfig(USER, { scoringModel: 'priority-rank' } as any);
  for (const k of ['dedup', 'nudges', 'assignments', 'priorityBoost']) {
    expect(store!.config[k]).toEqual(before[k]);
  }
  expect(store!.config.scoringModel).toBe('priority-rank');   // the edit did land
});

// §1.3 row 3 — the wipe that fires TODAY, not a latent one.
test('CeremonySettings-shaped partial save leaves config completely untouched', async () => {
  const before = JSON.parse(JSON.stringify(store!.config));
  await saveUserSchedulingConfig(USER, { ceremony_schedule: [{ id: 'planning' }] } as any);
  expect(store!.config).toEqual(before);
  expect('config' in lastUpsert).toBe(false);       // config is not even written
  expect(lastUpsert.ceremony_schedule).toBeDefined();
});

// §1.3 row 4 — the auto-timezone save inside loadUserSchedulingConfig.
test('timezone-only save leaves config completely untouched', async () => {
  const before = JSON.parse(JSON.stringify(store!.config));
  await saveUserSchedulingConfig(USER, { timezone: 'Europe/London' });
  expect(store!.config).toEqual(before);
  expect(lastUpsert.timezone).toBe('Europe/London');
});

// §1.3 row 2 — VoiceAssistantSettings reduces to {customAIInstructions}.
test('VoiceAssistantSettings-shaped save writes only its own key', async () => {
  await saveUserSchedulingConfig(USER, {
    core_instructions: 'x', customAIInstructions: 'hello', tts_provider: 'openai',
  } as any);
  expect(store!.config.customAIInstructions).toBe('hello');
  expect(store!.config.timeWindows).toEqual(seeded().config.timeWindows);
  expect(store!.config.categoryMappings).toEqual(seeded().config.categoryMappings);
  expect(store!.config[CONFIG_ROUNDTRIP_PROBE_KEY]).toEqual({ v: 1 });
});

// AC-6d.3 — accidental omission preserves.
test('AC-6d.3: a section absent from the payload is preserved, never deleted', async () => {
  await saveUserSchedulingConfig(USER, { scoringModel: 'composite' } as any);
  expect(store!.config.contextRules).toEqual(seeded().config.contextRules);
});

// AC-6d.1 — a deliberate clear of a value the UI owns still persists.
test('AC-6d.1: clearing a UI-owned value persists the cleared value', async () => {
  await saveUserSchedulingConfig(USER, { customAIInstructions: '' } as any);
  expect(store!.config.customAIInstructions).toBe('');
});

// AC-6d — deliberate removal is expressible, and by a DIFFERENT mechanism from absence.
test('AC-6d: removeConfigKeys deletes; absence does not', async () => {
  await saveUserSchedulingConfig(USER, {}, { removeConfigKeys: [CONFIG_ROUNDTRIP_PROBE_KEY] });
  expect(CONFIG_ROUNDTRIP_PROBE_KEY in store!.config).toBe(false);
  expect(store!.config.dedup).toEqual(seeded().config.dedup);   // nothing else went with it
});

// AC-6d.2 — a section reset touches only that section.
test('AC-6d.2: resetting one section leaves other sections and the probe intact', async () => {
  await saveUserSchedulingConfig(USER, {
    contextRules: { keywords: {}, priorityMappings: { urgent: 4 } },
  } as any);
  expect(store!.config.contextRules).toEqual({ keywords: {}, priorityMappings: { urgent: 4 } });
  expect(store!.config.timeWindows).toEqual(seeded().config.timeWindows);
  expect(store!.config[CONFIG_ROUNDTRIP_PROBE_KEY]).toEqual({ v: 1 });
});

// `undefined` must mean "not mentioned", or JSON dropping it reintroduces deletion-by-absence.
test('an explicit undefined value does not delete the stored key', async () => {
  await saveUserSchedulingConfig(USER, { dedup: undefined } as any);
  expect(store!.config.dedup).toEqual(seeded().config.dedup);
});

// Fail closed: a failed read must NOT fall back to writing the patch alone (= the original wipe).
test('a failed read of the stored config FAILS the save rather than replacing it', async () => {
  readError = { message: 'boom' };
  const ok = await saveUserSchedulingConfig(USER, { scoringModel: 'priority-rank' } as any);
  expect(ok).toBe(false);
  expect(lastUpsert).toBeNull();          // nothing was written at all
});

// First-ever save for a user with no row yet.
test('no existing row: the patch becomes the config', async () => {
  store = null;
  const ok = await saveUserSchedulingConfig(USER, { scoringModel: 'composite' } as any);
  expect(ok).toBe(true);
  expect(store!.config).toEqual({ scoringModel: 'composite' });
});
