// Ambient declaration so MCP tool files (evaluated in Deno at runtime) can
// reference process.env in this TS project without pulling in @types/node.
declare const process: { env: Record<string, string | undefined> };
