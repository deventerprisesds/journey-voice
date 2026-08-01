// huddle-proxy — bridge that lets the Huddle app call journey-voice's tools.
//
// Huddle (a separate app, authenticated via Entra) has no Supabase user. This
// function is the missing endpoint Huddle's client is coded against:
//   GET  /health  → { ok, version, toolCount }
//   GET  /tools   → { ok, tools: ToolDefinition[] }
//   POST /tool    → run one tool as the resolved Supabase user
//
// Auth: a shared bearer token (JOURNEY_PROXY_TOKEN) — the same secret is set on
// both sides. Identity: the caller's Entra email is mapped to a Supabase user
// via profiles.email → profiles.user_id. Execution is delegated to the existing
// `execute-tool` function (single source of truth for the tool logic), which is
// verify_jwt=false so we can invoke it internally.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-huddle-proxy",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROXY_TOKEN = (Deno.env.get("JOURNEY_PROXY_TOKEN") ?? "").trim();

const EXECUTE_TOOL_URL = `${SUPABASE_URL}/functions/v1/execute-tool`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Tool definitions are owned by the execute-tool function (single source of
// truth); fetch them at runtime so this proxy stays a thin, self-contained
// adapter and never drifts from the real catalog.
async function fetchToolDefs(): Promise<{ ok: boolean; tools: unknown[]; error?: string }> {
  try {
    const res = await fetch(`${EXECUTE_TOOL_URL}/definitions`, {
      method: "GET",
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    });
    if (!res.ok) return { ok: false, tools: [], error: `execute-tool/definitions ${res.status}` };
    const body = (await res.json()) as { tools?: unknown[] };
    return { ok: true, tools: body.tools ?? [] };
  } catch (err) {
    return { ok: false, tools: [], error: err instanceof Error ? err.message : String(err) };
  }
}

interface JourneyTask {
  id: string;
  title: string;
  status: string;
  category?: string | null;
  topic_group?: string | null;
  updated_at?: string;
  origin: "journey-voice";
}

// Best-effort: pull any task rows a tool returned so Huddle can mirror them onto
// its board. Journey tools return tasks under result.tasks or result.task.
function extractTasks(result: unknown): JourneyTask[] {
  const out: JourneyTask[] = [];
  const push = (t: Record<string, unknown> | null | undefined) => {
    if (!t || typeof t !== "object") return;
    const id = t.id ?? t.task_id;
    const title = t.title ?? t.name;
    if (!id && !title) return;
    out.push({
      id: String(id ?? crypto.randomUUID()),
      title: String(title ?? "(task)"),
      status: String(t.status ?? t.lane ?? "BACKLOG"),
      category: (t.category as string | null | undefined) ?? null,
      topic_group: (t.topic_group as string | null | undefined) ?? null,
      updated_at: (t.updated_at as string | undefined) ?? undefined,
      origin: "journey-voice",
    });
  };
  if (!result || typeof result !== "object") return out;
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.tasks)) (r.tasks as Record<string, unknown>[]).forEach(push);
  if (r.task) push(r.task as Record<string, unknown>);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveUserId(
  supabase: any,
  caller: { entra_email?: string; entra_object_id?: string } | undefined,
): Promise<{ userId?: string; error?: string }> {
  const email = (caller?.entra_email ?? "").trim();
  if (!email) return { error: "no caller email provided — cannot map to a journey-voice user" };
  // 1) ALIAS FIRST (authoritative). An aliased address always belongs to its canonical owner —
  //    that's the whole point of "one user, many emails". Checking the alias table BEFORE
  //    profiles.email prevents a DUPLICATE/shadow profiles row for an aliased address from
  //    hijacking resolution away from the canonical account. Real incident (2026-08-01): an
  //    auto-created profile for the aliased sign-in `von.ellis@` shadowed its alias → dev@, so the
  //    user's agents read an empty board instead of their real one. A canonical (non-aliased) email
  //    is never in this table, so normal users fall straight through to step 2 unchanged.
  const alias = await supabase
    .from("user_email_aliases")
    .select("user_id")
    .ilike("email", email) // exact, case-insensitive
    .limit(1)
    .maybeSingle();
  if (alias.error) return { error: `alias lookup failed: ${alias.error.message}` };
  if (alias.data?.user_id) return { userId: alias.data.user_id as string };
  // 2) Otherwise the email IS the canonical identity: profiles.email.
  const prof = await supabase
    .from("profiles")
    .select("user_id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (prof.error) return { error: `profile lookup failed: ${prof.error.message}` };
  if (prof.data?.user_id) return { userId: prof.data.user_id as string };
  return { error: `no journey-voice account found for ${email}` };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Shared-token auth. Huddle sends Authorization: Bearer <JOURNEY_PROXY_TOKEN>.
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!PROXY_TOKEN || token !== PROXY_TOKEN) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const path = new URL(req.url).pathname;

  if (req.method === "GET" && path.endsWith("/health")) {
    const defs = await fetchToolDefs();
    return json({
      ok: defs.ok,
      version: "huddle-proxy-1",
      toolCount: defs.tools.length,
      error: defs.ok ? undefined : defs.error,
    });
  }
  if (req.method === "GET" && path.endsWith("/tools")) {
    const defs = await fetchToolDefs();
    if (!defs.ok) return json({ ok: false, tools: [], error: defs.error });
    return json({ ok: true, tools: defs.tools });
  }
  if (req.method === "POST" && path.endsWith("/tool")) {
    try {
      const body = await req.json().catch(() => ({}));
      const { toolName, args, caller } = body ?? {};
      if (!toolName) {
        return json({ ok: false, output: JSON.stringify({ error: "toolName required" }), error: "toolName required" }, 400);
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const resolved = await resolveUserId(supabase, caller);
      if (!resolved.userId) {
        // Return 200 with ok=false so Huddle surfaces a visible fallback rather
        // than a hard error — the agent reply degrades gracefully.
        return json({ ok: false, output: JSON.stringify({ error: resolved.error }), error: resolved.error });
      }

      // Identity resolution for Huddle's read-side scoping: map the caller's Entra sign-in email
      // (possibly an alias like von.ellis@) to the canonical journey user_id + profile email
      // (dev@) that the task-sync writes the mirror under. Handled here, before execute-tool.
      if (toolName === "whoami") {
        const prof = await supabase
          .from("profiles")
          .select("email")
          .eq("user_id", resolved.userId)
          .limit(1)
          .maybeSingle();
        return json({
          ok: true,
          output: JSON.stringify({ user_id: resolved.userId, email: prof.data?.email ?? null }),
        });
      }

      // Delegate to the deployed execute-tool function (single source of truth).
      const execRes = await fetch(`${SUPABASE_URL}/functions/v1/execute-tool`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          toolName,
          args: args ?? {},
          userId: resolved.userId,
          context: { interface: "chat" },
        }),
      });

      const execText = await execRes.text();
      let exec: { success?: boolean; result?: unknown; message?: string; error?: string };
      try {
        exec = JSON.parse(execText);
      } catch {
        exec = { success: false, error: `execute-tool returned non-JSON (${execRes.status})` };
      }

      const ok = !!exec.success;
      const payload = ok ? (exec.result ?? exec.message ?? {}) : { error: exec.error ?? "tool failed" };
      const tasks = ok ? extractTasks(exec.result) : [];
      return json({
        ok,
        output: typeof payload === "string" ? payload : JSON.stringify(payload),
        tasks: tasks.length ? tasks : undefined,
        error: ok ? undefined : (exec.error ?? "tool failed"),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ ok: false, output: JSON.stringify({ error: msg }), error: msg });
    }
  }

  return json({ ok: false, error: `unknown route ${req.method} ${path}` }, 404);
});
