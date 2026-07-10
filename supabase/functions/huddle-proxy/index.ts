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
import { getToolDefinitions } from "../_shared/tool-definitions.ts";
import { GLOBAL_VERSION } from "../_shared/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-huddle-proxy",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROXY_TOKEN = (Deno.env.get("JOURNEY_PROXY_TOKEN") ?? "").trim();

const toolDefs = getToolDefinitions();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .ilike("email", email) // exact, case-insensitive
    .limit(1)
    .maybeSingle();
  if (error) return { error: `profile lookup failed: ${error.message}` };
  if (!data?.user_id) return { error: `no journey-voice account found for ${email}` };
  return { userId: data.user_id as string };
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
    return json({ ok: true, version: GLOBAL_VERSION, toolCount: toolDefs.length });
  }
  if (req.method === "GET" && path.endsWith("/tools")) {
    return json({ ok: true, tools: toolDefs });
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
