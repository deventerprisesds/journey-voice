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
  name: "create_task",
  title: "Create task",
  description:
    "Create a new task for the signed-in user. Uses the user's first board automatically.",
  inputSchema: {
    title: z.string().trim().min(1).describe("Task title."),
    description: z.string().optional().describe("Optional longer description."),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Task priority."),
    due_date: z
      .string()
      .optional()
      .describe("Optional ISO due date (YYYY-MM-DD or full timestamp)."),
    is_priority: z.boolean().optional().describe("Mark as top priority for the user."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, description, priority, due_date, is_priority }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const client = sb(ctx);
    const userId = ctx.getUserId();

    const { data: board, error: boardErr } = await client
      .from("boards")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (boardErr) return { content: [{ type: "text", text: boardErr.message }], isError: true };
    if (!board) {
      return {
        content: [{ type: "text", text: "No board found for this user. Create one in the app first." }],
        isError: true,
      };
    }

    const payload: Record<string, unknown> = {
      user_id: userId,
      board_id: board.id,
      title,
    };
    if (description) payload.description = description;
    if (priority) payload.priority = priority;
    if (due_date) payload.due_date = due_date;
    if (typeof is_priority === "boolean") payload.is_priority = is_priority;

    const { data, error } = await client.from("tasks").insert(payload).select().single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Created task ${data.id}: ${data.title}` }],
      structuredContent: { task: data },
    };
  },
});
