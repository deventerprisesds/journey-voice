import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listTasksTool from "./tools/list-tasks";
import createTaskTool from "./tools/create-task";
import completeTaskTool from "./tools/complete-task";
import getTodayScheduleTool from "./tools/get-today-schedule";

// Build issuer from the Vite-inlined project ref so this stays import-safe
// (mcp-js evaluates this module during manifest extraction with no env).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "taskos-mcp",
  title: "TaskOS — Tasks & Schedule",
  version: "0.1.0",
  instructions:
    "Tools for the signed-in user's tasks and daily schedule. Use `list_tasks` to browse work, `create_task` to add a task, `complete_task` to mark one done, and `get_today_schedule` to see what's on the calendar today.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listTasksTool, createTaskTool, completeTaskTool, getTodayScheduleTool],
});
