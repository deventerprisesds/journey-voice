

# Plan: Add Demo Mode RLS Policies for Notification Tables

## Problem

When demo users (running in the Lovable preview without auth) try to create tasks, they encounter the error:
> "new row violates row-level security policy for table 'scheduled_notifications'"

This happens because several notification-related tables are missing RLS policies for the demo user ID (`00000000-0000-0000-0000-000000000001`).

---

## Tables Requiring Demo Mode Policies

| Table | Current Policies | Demo Policies Needed |
|-------|-----------------|---------------------|
| `scheduled_notifications` | Only `auth.uid() = user_id` | SELECT, INSERT, UPDATE, DELETE |
| `notification_prefs` | Only `auth.uid() = user_id` | SELECT, INSERT, UPDATE |
| `profiles` | Only `auth.uid() = user_id` | SELECT, INSERT, UPDATE |
| `delivery_logs` | SELECT via join to `scheduled_notifications` | SELECT with demo check |

---

## Implementation: SQL Migration

Create a migration file to add demo mode RLS policies following the existing pattern from tables like `tasks`, `boards`, `conversation_messages`.

### Policies to Add

```sql
-- ============================================
-- scheduled_notifications demo mode policies
-- ============================================

-- SELECT: Demo user can view their scheduled notifications
CREATE POLICY "Demo user can view scheduled_notifications"
  ON public.scheduled_notifications
  FOR SELECT
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- INSERT: Demo user can insert scheduled notifications  
CREATE POLICY "Demo user can insert scheduled_notifications"
  ON public.scheduled_notifications
  FOR INSERT
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- UPDATE: Demo user can update their scheduled notifications
CREATE POLICY "Demo user can update scheduled_notifications"
  ON public.scheduled_notifications
  FOR UPDATE
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- DELETE: Demo user can delete their scheduled notifications
CREATE POLICY "Demo user can delete scheduled_notifications"
  ON public.scheduled_notifications
  FOR DELETE
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- ============================================
-- notification_prefs demo mode policies
-- ============================================

-- SELECT: Demo user can view their notification preferences
CREATE POLICY "Demo user can view notification_prefs"
  ON public.notification_prefs
  FOR SELECT
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- INSERT: Demo user can insert notification preferences
CREATE POLICY "Demo user can insert notification_prefs"
  ON public.notification_prefs
  FOR INSERT
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- UPDATE: Demo user can update their notification preferences
CREATE POLICY "Demo user can update notification_prefs"
  ON public.notification_prefs
  FOR UPDATE
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- ============================================
-- profiles demo mode policies
-- ============================================

-- SELECT: Demo user can view their profile
CREATE POLICY "Demo user can view profiles"
  ON public.profiles
  FOR SELECT
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- INSERT: Demo user can insert their profile
CREATE POLICY "Demo user can insert profiles"
  ON public.profiles
  FOR INSERT
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- UPDATE: Demo user can update their profile
CREATE POLICY "Demo user can update profiles"
  ON public.profiles
  FOR UPDATE
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- ============================================
-- delivery_logs demo mode policy
-- ============================================

-- SELECT: Demo user can view delivery logs for their notifications
CREATE POLICY "Demo user can view delivery_logs"
  ON public.delivery_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM scheduled_notifications sn
      WHERE sn.id = delivery_logs.notification_id
      AND sn.user_id = '00000000-0000-0000-0000-000000000001'::uuid
    )
  );
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/migrations/[timestamp]_add_demo_mode_notification_policies.sql` | SQL migration with all demo policies |

---

## Technical Details

### Policy Pattern
Following the existing demo mode policy pattern used in `tasks`, `boards`, `ai_threads`, etc:
- **SELECT/UPDATE/DELETE**: Use `USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)`
- **INSERT**: Use `WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid)`
- **UPDATE** also needs `WITH CHECK` for the new row values

### Why These Tables?

1. **scheduled_notifications**: Client-side code in `UpcomingReminders.tsx` directly inserts/updates/deletes notifications
2. **notification_prefs**: Edge functions query this to get user preferences
3. **profiles**: Edge functions query for user email/phone for notifications
4. **delivery_logs**: Logs are queried to show notification status in dashboard

---

## Expected Outcome

After the migration:
1. Demo users can create tasks with AI parsing without RLS errors
2. Task reminders/notifications will be properly scheduled
3. The UpcomingReminders component will work in demo mode
4. NotificationStatusDashboard will display correctly

---

## Summary

| Change | Complexity |
|--------|------------|
| Add 1 migration file with ~60 lines of SQL | Low |

**Total estimated effort: Low**

