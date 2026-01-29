-- ============================================
-- Demo Mode RLS Policies for Notification Tables
-- Allows demo user (00000000-0000-0000-0000-000000000001) 
-- to use notification features in preview environment
-- ============================================

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