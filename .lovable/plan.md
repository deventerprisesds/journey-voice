

## Plan: Use Saved User Settings as Authoritative Source for Category Mappings

### Problem
The category-to-time-window mappings shown in Settings (screenshot) are saved to `user_scheduling_prefs.config` in the database. However, they are ignored in two critical places:

1. **`batch-calendar-scheduler` edge function** (lines 148-154, 232-238) — hardcodes `defaultCategoryMappings` and the AI prompt's RULE 1 section, ignoring the `userConfig` it already loads on line 69
2. **`FocusView.tsx`** (line 128) — uses `DEFAULT_SCHEDULING_CONFIG` instead of loading user config via `loadUserSchedulingConfig`

### Changes

#### 1. `supabase/functions/batch-calendar-scheduler/index.ts`

**Replace hardcoded category mappings (lines 148-154)** with dynamic mappings built from `userConfig`:

```typescript
// Build from user config, fall back to defaults
const categoryMappings = userConfig?.categoryMappings || {
  CAREER: { defaultTimeWindow: ['business_hours'], estimatedDuration: 120 },
  PROF_EDUCATION: { defaultTimeWindow: ['after_work', 'weekends'], estimatedDuration: 90 },
  ...
};
```

**Replace hardcoded RULE 1 in the AI prompt (lines 232-238)** — dynamically generate the "CATEGORY → REQUIRED TIME WINDOW" block from the resolved `categoryMappings`, mapping window names to their hour ranges from the user's `timeWindows` config.

This ensures when a user sets VENTURES to `['business_hours', 'weekends']` in Settings, the AI prompt reflects that.

#### 2. `src/components/FocusView.tsx`

**Replace line 128** `const config = DEFAULT_SCHEDULING_CONFIG` with loading user config:

```typescript
const [config, setConfig] = useState<SchedulingConfig>(DEFAULT_SCHEDULING_CONFIG);

useEffect(() => {
  if (user?.id) {
    loadUserSchedulingConfig(user.id).then(setConfig);
  }
}, [user?.id]);
```

This ensures the Focus View's time window display and drop slots respect user settings.

### Files Modified
- `supabase/functions/batch-calendar-scheduler/index.ts` — use loaded `userConfig` for category mappings + AI prompt
- `src/components/FocusView.tsx` — load user config instead of hardcoded defaults

