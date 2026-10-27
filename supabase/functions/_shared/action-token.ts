/**
 * Signed, single-task "action tokens" for phone alarm buttons (Done / Doing).
 *
 * WHY: the Android bridge used to PATCH public.tasks with the user's own Supabase JWT, copied out
 * of the WebView. That JWT expires ~1h after the app is dismissed and is blanked on sign-out, so a
 * Done tap on a full-screen alarm failed silently, the task stayed open, the 3am builder rolled it
 * forward, and the same alarm fired again the next day. An action token travels WITH the push and
 * authorises exactly one thing — changing one task's status for one user — with no login needed.
 *
 * FORMAT: `v1.<b64url(JSON{u,t,exp})>.<b64url(HMAC-SHA256)>`
 *
 * KEY: derived from the existing SUPABASE_SERVICE_ROLE_KEY with a domain-separation label, so no
 * new secret is introduced (standing rule) and the raw service key is never used directly as an
 * HMAC key for anything else. Rotating the service key invalidates outstanding tokens; the phone
 * then falls back to its login path, or shows a "couldn't mark done" notification.
 *
 * Never log a token. Log only `token=present|absent`.
 */

const LABEL = "journey/alarm-action/v1";
const PREFIX = "v1";
export const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cachedKey: CryptoKey | null = null;
let cachedFor = "";

/** HMAC key = HMAC-SHA256(serviceRoleKey, LABEL). `secret` is injectable for tests. */
async function signingKey(secret?: string): Promise<CryptoKey> {
  const root = secret ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!root) throw new Error("action-token: SUPABASE_SERVICE_ROLE_KEY not set");
  if (cachedKey && cachedFor === root) return cachedKey;
  const rootKey = await crypto.subtle.importKey(
    "raw", enc.encode(root), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const derived = new Uint8Array(await crypto.subtle.sign("HMAC", rootKey, enc.encode(LABEL)));
  cachedKey = await crypto.subtle.importKey(
    "raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
  cachedFor = root;
  return cachedKey;
}

export interface ActionClaims {
  userId: string;
  taskId: string;
  exp: number; // unix seconds
}

export async function mintActionToken(
  userId: string,
  taskId: string,
  opts: { ttlSec?: number; nowSec?: number; secret?: string } = {},
): Promise<string> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const body = b64urlEncode(
    enc.encode(JSON.stringify({ u: userId, t: taskId, exp: now + (opts.ttlSec ?? DEFAULT_TTL_SEC) })),
  );
  const key = await signingKey(opts.secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${PREFIX}.${body}`)));
  return `${PREFIX}.${body}.${b64urlEncode(sig)}`;
}

/**
 * Returns the claims when the signature is valid, else null. `expired` is reported rather than
 * rejected so callers can choose a grace window (trace lines accept recently-expired tokens; a
 * status change does not). Signature check is constant-time (crypto.subtle.verify).
 */
export async function verifyActionToken(
  token: string,
  opts: { nowSec?: number; graceSec?: number; secret?: string } = {},
): Promise<(ActionClaims & { expired: boolean }) | null> {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  let sig: Uint8Array;
  try {
    sig = b64urlDecode(parts[2]);
  } catch {
    return null;
  }
  const key = await signingKey(opts.secret);
  const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(`${PREFIX}.${parts[1]}`));
  if (!ok) return null;
  let claims: { u?: unknown; t?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(dec.decode(b64urlDecode(parts[1])));
  } catch {
    return null;
  }
  if (typeof claims.u !== "string" || typeof claims.t !== "string" || typeof claims.exp !== "number") {
    return null;
  }
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const expired = now > claims.exp;
  if (expired && now > claims.exp + (opts.graceSec ?? 0)) return null;
  return { userId: claims.u, taskId: claims.t, exp: claims.exp, expired };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);
