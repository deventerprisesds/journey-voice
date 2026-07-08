/**
 * Pure gate function — determines whether the DailyReviewModal should auto-open.
 *
 * Extracted from FocusView's useEffect so the logic can be unit-tested without
 * rendering the component or mocking Supabase.
 *
 * Rules:
 *   - Opens when the user hasn't seen the modal today (confirmedDate !== todayKey)
 *   - Suppressed when the user has disabled the feature (reviewEnabled === false)
 *   - Never triggers send-chat-message — that is notification-delivery's responsibility
 */
export function shouldOpenDailyReview(
  confirmedDate: string,
  todayKey: string,
  reviewEnabled: boolean
): boolean {
  return confirmedDate !== todayKey && reviewEnabled;
}
