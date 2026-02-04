# Supabase Integration Checklist

## Purpose
Mandatory verification steps before and after implementing Supabase features. Prevents common integration oversights.

---

## 1. Realtime Subscriptions

When adding a Realtime subscription to a table:

- [ ] Table added to publication: `ALTER PUBLICATION supabase_realtime ADD TABLE public.<table>`
- [ ] Verify with query: `SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime'`
- [ ] RLS policies allow SELECT for the subscribing user
- [ ] Test subscription receives events (INSERT, UPDATE, DELETE as needed)

---

## 2. New Tables

When creating a new table:

- [ ] RLS enabled: `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY`
- [ ] RLS policies created for all required operations (SELECT, INSERT, UPDATE, DELETE)
- [ ] If Realtime needed, add to publication (see section 1)
- [ ] Types regenerated: verify `src/integrations/supabase/types.ts` updated

---

## 3. Edge Functions Calling Database

When an edge function writes to a table:

- [ ] Uses `SUPABASE_SERVICE_ROLE_KEY` for admin operations
- [ ] Uses user's auth token for user-scoped operations
- [ ] Error handling includes RLS denial cases
- [ ] Secrets verified in Supabase dashboard before deployment

---

## 4. Common Mistakes Log

| Date | Mistake | Resolution |
|------|---------|------------|
| 2026-02-04 | Realtime subscription created but table not in publication | Always run `ALTER PUBLICATION` after creating subscription code |

---

## Quick Reference

### Verify Realtime Tables
```sql
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

### Add Table to Realtime
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.<table_name>;
```

### Check RLS Status
```sql
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
```
