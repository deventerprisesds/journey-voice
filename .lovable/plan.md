

# Systematic Prevention: Supabase Integration Checklist

## Problem Analysis

You're right - we have checklists but they don't cover this failure mode:

| Existing Checklist | What It Covers | Gap |
|-------------------|----------------|-----|
| `cloudflare/PREFLIGHT_CHECKLIST.md` | Cloudflare worker deployments | No Supabase coverage |
| `docs/DEBUG_TRACKER.md` | UI bugs and attempted fixes | Not preventive for new features |

The Realtime oversight happened because there's no checklist that says: *"When implementing Realtime subscriptions, verify the table is in the publication."*

## Solution: Create Supabase Integration Checklist

Create `docs/SUPABASE_CHECKLIST.md` with mandatory verification steps for common Supabase features:

### Proposed Checklist Sections

**1. Realtime Subscriptions**
```text
When adding a Realtime subscription to a table:
- [ ] Table added to publication: `ALTER PUBLICATION supabase_realtime ADD TABLE public.<table>`
- [ ] Verify with query: `SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime'`
- [ ] RLS policies allow SELECT for the subscribing user
- [ ] Test subscription receives events (INSERT, UPDATE, DELETE as needed)
```

**2. New Tables**
```text
When creating a new table:
- [ ] RLS enabled: `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY`
- [ ] RLS policies created for all required operations (SELECT, INSERT, UPDATE, DELETE)
- [ ] If Realtime needed, add to publication
- [ ] Types regenerated: verify `src/integrations/supabase/types.ts` updated
```

**3. Edge Functions Calling Database**
```text
When an edge function writes to a table:
- [ ] Uses SUPABASE_SERVICE_ROLE_KEY for admin operations
- [ ] Uses user's auth token for user-scoped operations
- [ ] Error handling includes RLS denial cases
```

**4. Common Mistakes Log**
```text
| Date | Mistake | Resolution |
|------|---------|------------|
| 2026-02-04 | Realtime subscription created but table not in publication | Always run ALTER PUBLICATION after creating subscription code |
```

## Update Debug Tracker

Add this incident to `docs/DEBUG_TRACKER.md` Lessons Learned:

```text
4. **Supabase Realtime requires explicit publication registration**: Creating a frontend subscription (`.channel().on('postgres_changes')`) does NOT automatically enable events. The table must be added to the `supabase_realtime` publication via `ALTER PUBLICATION`. Always verify with `pg_publication_tables` query.
```

## How This Prevents Future Oversights

1. **Before implementing Realtime**: I read the checklist and see the publication step
2. **After implementing Realtime**: I verify with the `pg_publication_tables` query
3. **When a new mistake is discovered**: We add it to the Common Mistakes Log

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `docs/SUPABASE_CHECKLIST.md` | CREATE | Preventive checklist for Supabase integrations |
| `docs/DEBUG_TRACKER.md` | UPDATE | Add Realtime lesson to Lessons Learned |

