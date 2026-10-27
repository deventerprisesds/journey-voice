/**
 * WHAT: the checks send-push-notification runs before it mints a phone alarm action token.
 * WHY:  VERIFY-restore-j13-alarm-actions-1 C2-SEC1: send-push is `verify_jwt = false` and takes
 *       `userId` and `data.taskId` from the body, so any caller could get a 7-day token minted for
 *       a task that is not that user's. These checks gate ONLY the minting, never the push itself
 *       (browser callers use it too; see the record).
 * SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
 * EVIDENCE: docs/qc-evidence/RESTORE-step3-j13-j14-security.md
 */

// deno-lint-ignore no-explicit-any
type Client = any;

/** True only when `tasks.id = taskId` exists and its `user_id` is exactly `userId`. One read. */
export async function taskBelongsTo(client: Client, taskId: unknown, userId: unknown): Promise<boolean> {
  if (typeof taskId !== "string" || !taskId || typeof userId !== "string" || !userId) return false;
  try {
    const { data, error } = await client.from("tasks").select("user_id").eq("id", taskId).maybeSingle();
    if (error || !data) return false;
    return typeof data.user_id === "string" && data.user_id === userId;
  } catch {
    return false;
  }
}
