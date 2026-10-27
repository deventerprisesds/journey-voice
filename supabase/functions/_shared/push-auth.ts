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

/** The bearer credential of a request, or '' when there is none. */
export function bearerToken(req: Request): string {
  const m = /^Bearer\s+(\S+)\s*$/i.exec((req.headers.get("authorization") ?? "").trim());
  return m ? m[1] : "";
}

/**
 * Constant-time string equality: both sides are hashed to 32 bytes first, so neither the
 * position of the first difference nor the secret's length shows up in the timing.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = (await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ])).map((d) => new Uint8Array(d));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export type MintCaller = "service_role" | "owner_jwt" | "none";

/**
 * Who may cause an action token to be minted for `userId`:
 *  - "service_role": the bearer is SUPABASE_SERVICE_ROLE_KEY (every server caller: scheduler,
 *    notification-delivery, send-unified-notification, send-chat-message, execute-tool);
 *  - "owner_jwt": the bearer is a user access token that auth.getUser() resolves to exactly `userId`
 *    (the signed-in web app pushing about its own task);
 *  - "none": anything else (no bearer, the anon key, another user's JWT, a forged JWT).
 */
export async function mintCaller(req: Request, client: Client, userId: unknown, serviceKey: string): Promise<MintCaller> {
  const tok = bearerToken(req);
  if (!tok) return "none";
  if (serviceKey && await constantTimeEqual(tok, serviceKey)) return "service_role";
  if (typeof userId !== "string" || !userId || !client?.auth?.getUser) return "none";
  try {
    const { data, error } = await client.auth.getUser(tok);
    const id = data?.user?.id;
    return !error && typeof id === "string" && id === userId ? "owner_jwt" : "none";
  } catch {
    return "none";
  }
}

/**
 * Device REGISTRATION (owner-approved Option A, 2026-10-27): true only when the request's bearer is a
 * user access token that `auth.getUser()` resolves to exactly `userId`. Unlike `mintCaller`, the
 * service-role key does NOT count here — nothing server-side registers through manage-push, and the
 * only legitimate callers (web app, Android native registrar >= 1.0.13) hold the user's own login.
 * No bearer, the anon key, another user's JWT, a forged/expired JWT, or a getUser error -> false.
 */
export async function callerIsUser(req: Request, client: Client, userId: unknown): Promise<boolean> {
  return (await mintCaller(req, client, userId, "")) === "owner_jwt";
}
