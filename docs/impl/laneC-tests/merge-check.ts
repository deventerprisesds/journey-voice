// Exercises the REAL src/config/schedulingRules.ts module (it has zero imports, so bun can
// execute it directly). Not a copy.
const MODULE_PATH =
  process.env.MODULE_PATH ?? '/home/user/journey-voice/src/config/schedulingRules.ts';
const mod: any = await import(MODULE_PATH);
const { mergeSchedulingConfig, DEFAULT_SCHEDULING_CONFIG, CONFIG_ROUNDTRIP_PROBE_KEY } = mod;
console.log(`# module under test: ${MODULE_PATH}`);

let pass = 0, fail = 0;
// A THROW IS A FAILURE, NOT AN ABORT. Under the AC-6a spread mutation, `contextRules` is replaced
// wholesale so `priorityMappings.urgent` throws; a checker that dies there reports one failure and
// hides the other three the mutation was meant to expose.
const t = (name: string, cond: () => boolean, extra = '') => {
  let ok = false, err = '';
  try { ok = cond(); } catch (e) { err = ` (threw: ${(e as Error).message})`; }
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}${err}`); }
};

console.log('AC-6a — the six per-field semantics a spread cannot express');
{
  const r = mergeSchedulingConfig({ timeWindows: { morning: { start: 5, end: 8, days: [1] } } as any });
  t('1. partial timeWindows: other windows survive from defaults',
    () => r.timeWindows.business_hours?.start === 9 && r.timeWindows.morning.start === 5);
}
{
  const r = mergeSchedulingConfig({ contextRules: { keywords: { zzz: ['morning', 'LIFE'] } } as any });
  t('2. contextRules two-level: priorityMappings intact when only keywords set',
    () => r.contextRules.priorityMappings.urgent === 4 && r.contextRules.keywords.zzz?.[0] === 'morning');
}
{
  const r = mergeSchedulingConfig({
    categoryMappings: { LIFE: { defaultTimeWindow: 'evening', defaultStatus: 'LIFE', estimatedDuration: 30 } } as any,
  });
  t('3. categoryMappings string -> array migration',
    () => Array.isArray(r.categoryMappings.LIFE.defaultTimeWindow) &&
    r.categoryMappings.LIFE.defaultTimeWindow[0] === 'evening');
}
{
  const r = mergeSchedulingConfig({ customAIInstructions: '   ' });
  t('4. blank customAIInstructions falls back to default',
    () => r.customAIInstructions === DEFAULT_SCHEDULING_CONFIG.customAIInstructions);
}
{
  const r = mergeSchedulingConfig({ scoringModel: 'nonsense' as any });
  t('5. invalid scoringModel -> composite', () => r.scoringModel === 'composite');
}
{
  const r = mergeSchedulingConfig({});
  t('6. absent timezone -> default', () => r.timezone === DEFAULT_SCHEDULING_CONFIG.timezone);
}

console.log('\npriorityBoost round-trip (was absent from the return literal entirely)');
t('absent -> true', () => mergeSchedulingConfig({}).priorityBoost === true);
t('explicit false -> false (the toggle can now round-trip)',
  () => mergeSchedulingConfig({ priorityBoost: false }).priorityBoost === false);
t('explicit true -> true', () => mergeSchedulingConfig({ priorityBoost: true }).priorityBoost === true);

console.log('\nStructural guard: every DEFAULT key is emitted');
{
  const r = mergeSchedulingConfig({});
  const missing = Object.keys(DEFAULT_SCHEDULING_CONFIG).filter((k) => !(k in r));
  t('keys(DEFAULT) subset of keys(output)', () => missing.length === 0, `missing=${missing.join(',')}`);
}

console.log('\nnudges/assignments: no invented defaults, "unset" stays distinguishable');
{
  const r = mergeSchedulingConfig({});
  t('unset -> key omitted entirely (server default applies)',
    () => !('nudges' in r) && !('assignments' in r));
}
{
  const r = mergeSchedulingConfig({ assignments: { soonDays: 7, activeCourseIds: ['a', 'a', ' b '] } });
  t('valid values pass through; ids trimmed + de-duplicated',
    () => r.assignments?.soonDays === 7 &&
    JSON.stringify(r.assignments?.activeCourseIds) === JSON.stringify(['a', 'b']));
}
{
  const r = mergeSchedulingConfig({ nudges: { deliverAtLocalHour: 25 } as any });
  t('out-of-range hour is DROPPED, not clamped to a guess',
    () => r.nudges !== undefined && r.nudges.deliverAtLocalHour === undefined);
}
{
  const r = mergeSchedulingConfig({ nudges: { deliverAtLocalHour: '8am' } as any });
  t('non-numeric hour dropped', () => r.nudges?.deliverAtLocalHour === undefined);
}
{
  const r = mergeSchedulingConfig({ nudges: { deliverAtLocalHour: 0 } });
  t('hour 0 is a legitimate value, not falsy-dropped', () => r.nudges?.deliverAtLocalHour === 0);
}

console.log('\nAC-6c probe key: the normaliser still drops it (correct for a read-time normaliser)');
{
  const r: any = mergeSchedulingConfig({ [CONFIG_ROUNDTRIP_PROBE_KEY]: { v: 1 } } as any);
  t('probe absent from normaliser output', () => !(CONFIG_ROUNDTRIP_PROBE_KEY in r));
  t('probe key constant is the documented string', () => CONFIG_ROUNDTRIP_PROBE_KEY === '__ac6_probe');
}

console.log('\nNo mutation of the caller\'s object or of DEFAULT_SCHEDULING_CONFIG');
{
  const input = { assignments: { soonDays: 3 } };
  const before = JSON.stringify(input);
  mergeSchedulingConfig(input);
  t('input not mutated', () => JSON.stringify(input) === before);
  t('DEFAULT priorityBoost still true', () => DEFAULT_SCHEDULING_CONFIG.priorityBoost === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
