import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sb(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_today_schedule",
  title: "Get today's schedule",
  description:
    "Return the signed-in user's tasks scheduled for today (in UTC), ordered by start time.",
  inputSchema: {
    date: z
      .string()
      .optional()
      .describe("Optional YYYY-MM-DD date to query instead of today (UTC)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const day = date ?? new Date().toISOString().slice(0, 10);
    const start = `${day}T00:00:00.000Z`;
    const end = `${day}T23:59:59.999Z`;
    const { data, error } = await sb(ctx)
      .from("tasks")
      .select("id,title,status,priority,start_time,end_time")
      .eq("user_id", ctx.getUserId())
      .eq("is_scheduled", true)
      .gte("start_time", start)
      .lte("start_time", end)
      .order("start_time", { ascending: true });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { date: day, items: data ?? [] },
    };
  },
});
