# LANE A — `get_task_topics` read-only tool (journey-voice)

<!--
WHAT:       Design + implementation record for a read-only `get_task_topics` tool on journey's
            Huddle-facing tool surface, so Huddle can render journey's priorities topic tree
            in a chat widget.
WHY:        Huddle has NO route to journey's topic tree today (zero hits for task_topic_index /
            topic_name / category_affinity in Huddle src/, not a column in Huddle's Azure mirror,
            not among journey's ten existing proxy tools).
SUPERSEDES: nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:   .github/workflows/test-priorities-widget-query.yml (runs these exact queries E2E)
-->

## Status log (append-only, written as work proceeds)

### Step 1 — read the ground-truth workflow (DONE)

`.github/workflows/test-priorities-widget-query.yml` runs three REST queries end-to-end.
**Important correction to the brief:** the topics are NOT in a separate "topics table" — they are
in **`task_topic_index`** itself. The workflow reads `user_id` from `task_topic_index` and then
selects the topic columns from the same table.

Quoted lines that prove the schema:

```
rows, code = get('/rest/v1/task_topic_index', {'select': 'user_id', 'limit': '1'})
...
groups, code = get('/rest/v1/task_topic_index', {
    'select': 'id,topic_name,position,category_affinity,parent_topic_id,window_affinity',
    'user_id': f'eq.{user_id}',
    'order': 'position.asc',
})
```

```
mappings, code = get('/rest/v1/task_topic_mappings', {
    'select': 'task_id,topic_id',
    'topic_id': f'in.({joined})',
})
```

```
tasks, code = get('/rest/v1/tasks', {
    'select': 'id,title,status,is_priority,priority_rank',
    'id': f'in.({joined_tasks})',
    'user_id': f'eq.{user_id}',
    'order': 'is_priority.desc,priority_rank.asc.nullslast',
})
```

Also proven by the workflow: `window_affinity` is an **array** (it does `(g.get('window_affinity')
or [None])[0]`), `category_affinity` can be **null**, `parent_topic_id` null => top-level.

### Tables / columns established from this repo

| table | columns read |
|---|---|
| `task_topic_index` | `id, user_id, topic_name, position, category_affinity, parent_topic_id, window_affinity` |
| `task_topic_mappings` | `task_id, topic_id` |
| `tasks` | `id, user_id, title, status, is_priority, priority_rank` |

### Next steps
- [x] Read `supabase/functions/_shared/tool-definitions.ts` (schema list)
- [x] Read `supabase/functions/execute-tool/` dispatcher + a neighbouring read tool for user scoping
- [x] Read `supabase/functions/huddle-proxy/` — no allow-list there; it re-serves the catalog verbatim
- [x] Implement + register — see DELIVERED below

### Step 2 — the tool surface, read line by line (DONE)

**Flow, confirmed by reading (not assumed):**

1. `supabase/functions/huddle-proxy/index.ts` — Huddle sends `Authorization: Bearer
   <JOURNEY_PROXY_TOKEN>` (line 27: `const PROXY_TOKEN = (Deno.env.get("JOURNEY_PROXY_TOKEN") ??
   "").trim();`, checked at lines 129-133). Routes: `GET /health`, `GET /tools`, `POST /tool`.
2. **User scoping mechanism (copied verbatim in behaviour, not re-implemented):**
   `resolveUserId(supabase, caller)` (huddle-proxy lines 92-123) maps `caller.entra_email` →
   `user_email_aliases.user_id` (**alias first, authoritative**) → else `profiles.user_id`. The
   resulting `userId` is passed to `execute-tool` in the POST body (lines 205-210):
   `{ toolName, args: args ?? {}, userId: resolved.userId, context: { interface: "chat" } }`.
   **The caller's `args` never carry identity.** `execute-tool`'s `serve()` (lines 2698-2711) reads
   `userId` from the body and hands it to `executeToolCall(supabase, toolName, args, userId, context)`.
   => A new tool gets user scoping **for free** by using the `userId` parameter and never reading a
   user id out of `args`. That is exactly what `getTasksByTopic` (index.ts:2053) does:
   `.eq('user_id', userId)`.
3. `supabase/functions/_shared/tool-definitions.ts` — `getToolDefinitions()` is the ONLY schema list
   (its own header: "SINGLE SOURCE OF TRUTH"). `execute-tool` serves it at `GET /definitions`
   (index.ts:2688-2695) and huddle-proxy re-serves it at `GET /tools` (lines 146-150), so a tool added
   to that list is visible to Huddle with **no proxy change at all**.

**So the change is exactly two files — no new function, no new secret, no proxy edit.**

### Step 3 — payload design, and the one thing the screenshot PROVED

Reference implementation for the tree is `src/pages/Priorities.tsx` `loadData()` (lines 215-338).
Its category resolution precedence, copied:
majority category of the topic's OPEN tasks -> else `category_affinity` (if it is a known category
key) -> else `window_affinity[0]` (if known) -> else inherit the parent topic's category
(lines 262-277 + 328-332).
Category keys come from `resolveConfig(user_scheduling_prefs.config).categoryMappings` — **user
editable**, which is why an out-of-the-box key like `FAMILY` can exist (see "not established").

**Count semantics — verified against the spec screenshot, not guessed.** In
`docs/widgets/spec-priorities-widget.jpg` the Career row reads `25`, and its sub-rows read
2, 1, 1, 15, 1, 4, 1 -> **sum = 25 exactly**. So a category's badge is the SUM of its top-level
topics' subtree counts, and a topic's badge is its own open-task count. The payload therefore
returns BOTH `open_task_count` (own) and `subtree_open_task_count` (own + descendants) per topic,
plus a `categories` rollup — so the widget never has to re-derive a number.

Counts are derived server-side from `task_topic_mappings` INTERSECTED with the user's OPEN tasks
(`status NOT IN (DONE, BLOCKED)`), which is how both the workflow and `getTopicGroupsManual`
(`_shared/call-context-builder.ts:204-264`) do it. The stored `task_topic_index.task_count` column is
ALSO returned as-is, but it is denormalized and is NOT what the widget should render.

---

## DELIVERED — what was added (2 files, no new function, no new secret)

| file | change |
|---|---|
| `supabase/functions/_shared/tool-definitions.ts` | registered `get_task_topics` (after `get_tasks_by_topic`). Tool count 26 -> **27**, verified by calling `getToolDefinitions()`. |
| `supabase/functions/execute-tool/index.ts` | `case 'get_task_topics'` in `executeToolCall` + the `getTaskTopics()` handler. |

`huddle-proxy` needed **no change at all** — it re-serves `execute-tool`'s `/definitions`
verbatim, so the tool appears on `GET /tools` the moment `execute-tool` is deployed.

**Advertised params are both implemented** (the `getTasks`-ignored-its-own-`query` trap):
`limit` (clamped to 1..300, bogus/absent -> 300) and `include_empty` (default true; false prunes
any topic whose whole subtree has no open task). Verified by AC20/AC21/AC22 and AC17/AC19 below.

### User scoping — copied, not invented

Identity never comes from `args`. `huddle-proxy.resolveUserId()` maps `caller.entra_email` via
`user_email_aliases` (alias first) then `profiles`, and passes the resolved `userId` in the
`execute-tool` body; `executeToolCall` hands it to the handler. `getTaskTopics` applies
`.eq('user_id', userId)` to **both** the `task_topic_index` read and the `tasks` read — the same
pattern as `getTasksByTopic` (index.ts). `task_topic_mappings` has no `user_id` column, so it is
filtered by the user's OWN topic ids and then intersected with the user's OWN open tasks, which
means a mapping row pointing at somebody else's task contributes nothing. Mutation-proved (M1, M4).

### Caps (a pathological account cannot return unbounded rows)

| constant | value | what it bounds |
|---|---|---|
| `TASK_TOPICS_MAX` | **300** | `task_topic_index` rows returned; also the ceiling on `limit`. `truncated:true` when hit. |
| `TASK_TOPICS_TASK_SCAN_MAX` | **2000** | open tasks scanned to derive counts. `tasks_scan_truncated:true` when hit. |
| `TASK_TOPICS_IN_CHUNK` | **100** | topic ids per `in.()` mappings query, so the query string stays short. |

Live scale is ~5 categories and dozens of sub-topics, so 300 is roughly 5-10x headroom.

### Response shape Huddle should expect

`huddle-proxy` returns `{ ok, output }` where **`output` is a STRING** — `JSON.stringify` of
`execute-tool`'s `result`. Parse it, then read:

```jsonc
{
  "categories": [                      // top-level rows: the coloured category bars
    {
      "key": "CAREER",
      "label": "Career",               // mirrors src/pages/Priorities.tsx CATEGORY_LABELS,
                                       // title-cased for a user-added key (FAMILY -> "Family")
      "open_task_count": 3,            // SUM of its topics' subtree counts  <-- the category badge
      "unclassified_open_task_count": 0, // open tasks in this category mapped to NO topic
      "topics": [                      // NESTED: each node carries `children`
        {
          "id": "tc2",
          "topic_name": "Career Development",
          "topic_summary": null,
          "parent_topic_id": null,     // null = top-level
          "position": 5,               // stable ordering (position, then name)
          "category_affinity": "CAREER",   // RAW column, may be null
          "window_affinity": null,         // RAW column, string[] or null
          "category_key": "CAREER",    // RESOLVED category
          "category": "CAREER",        // same value, under the conventional key
          "open_task_count": 0,        // tasks mapped DIRECTLY to this topic
          "subtree_open_task_count": 1,// this topic + descendants  <-- the topic badge
          "count": 1,                  // == subtree_open_task_count
          "open_count": 1,             // == subtree_open_task_count
          "stored_task_count": 15,     // the DENORMALIZED column. DO NOT RENDER.
          "children": [ /* same node shape */ ]
        }
      ]
    }
  ],
  "uncategorized_topics": [],          // roots whose category could not be resolved at all
  "topics": [ /* FLAT view: same rows, NO `children` key, nest by parent_topic_id */ ],
  "topic_count": 4,
  "open_task_count": 3,                // open tasks classified under some topic
  "unclassified_open_task_count": 1,
  "limit": 300, "truncated": false,
  "tasks_scanned": 4, "tasks_scan_truncated": false
}
```

**Two views, deliberately.** `categories[].topics[]` is pre-nested (render it directly);
`topics` is flat with `parent_topic_id` (nest it yourself). They describe the same rows.

**`stored_task_count` is the trap this payload is shaped to avoid.** In the example above the same
topic reads `stored_task_count: 15` and `subtree_open_task_count: 1` — the stored column is
denormalized and stale. Render `count` / `subtree_open_task_count`.

**No colours.** journey's `CATEGORY_COLORS` are CSS custom properties
(`hsl(var(--category-career))`) and mean nothing outside journey's stylesheet, so the widget must
own the colour bar. Key off `categories[].key`.

### Interop with Lane B — one real defect caught before it could ship

Lane B's consumer (`huddle-extension-app` `lib/tasks/widgets.functions.ts` -> `widgets.server.ts`
`buildTopicTree`) was read (read-only) and its **pure normalizer functions were extracted and run
against this payload**. Two producer-side bugs came out of that and are fixed:

1. **Sub-topics would have rendered TWICE.** `buildTopicTree` auto-detects "already nested?" via
   `flat.some(n => n.children.length > 0)`. The flat `topics` array originally held the SAME node
   objects as the tree, so `t5.children` was populated there too — the whole flat list was treated
   as pre-nested and every sub-topic appeared both nested AND as a top-level root. Fixed by
   stripping `children` from the flat rows. Mutation-proved (M10).
2. **The stale column would have been rendered.** `buildTopicTree` picks a count by key-name
   precedence — `["count","task_count","taskCount","open_count",...]` — so a field literally named
   `task_count` outranked the derived counts. Renamed to `stored_task_count`, and `count` +
   `open_count` added so any conventional key list lands on a derived number.
   Mutation-proved (M11: restoring `task_count` makes the widget read 15 instead of 18).

Also confirmed: `execute-tool`'s default branch answers an unregistered tool with
`Unknown tool: <name>`, which is exactly what Lane B's `absent` detector matches — so before this
is deployed Lane B degrades to `reason:"tool-absent"`, not `"error"`. And `huddle-proxy` **ignores**
the request's `context` field (it always forwards `context:{interface:"chat"}`), so Lane B's
`context:{source:"huddle"}` is inert — harmless, but it is not reaching the handler.

### Verification — 36 assertions, all passing; 8 guards mutation-proved

Run against the REAL handler source (extracted from `execute-tool/index.ts`, not a retyped copy)
with a stubbed postgrest client and the REAL `resolveConfig` from `_shared/scheduling-defaults.ts`.

Highlights: Career's 12 spec rows sum to **25**, matching the screenshot exactly (AC1);
DONE/BLOCKED excluded (AC2); another user's open task not counted (AC3) and their topics absent
(AC4); roll-up arithmetic (AC6); `window_affinity` fallback (AC9); a user-added `FAMILY` key
labelled "Family" (AC10); only SELECTs ever issued — **read-only proved, not asserted** (AC15);
the result is JSON-serializable (AC28a); every topic appears exactly once in Lane B's tree (AC28).

| mutation | outcome |
|---|---|
| M1 drop `.eq('user_id')` on tasks | **FIRED** — another user's task counted |
| M2 drop the DONE/BLOCKED filter | **FIRED** — closed tasks counted |
| M3 drop the `limit` clamp | **FIRED** — unbounded rows |
| M4 drop `.eq('user_id')` on topics | **FIRED** — another user's topics returned |
| M9 drop the structural cycle guard | **FIRED** — result not serializable |
| M10 keep `children` on flat rows | **FIRED** — sub-topics double-rendered |
| M11 rename back to `task_count` | **FIRED** — stale count read (15, not 18) |
| M12 drop the `category` mirror | **FIRED** — consumer loses the resolved category |
| M5 roll-up visited set | **INERT — NOT PROVEN.** Redundant now that cycles are broken structurally; each node has exactly one `parent_topic_id`, so the tree is a forest. Kept as cheap defence, NOT claimed as proven. |
| M7 unreachable-node promotion | **INERT — NOT PROVEN.** Same reason. Kept so a malformed row can never cost a topic its existence. |

**The highest-value find was a 500, not a wrong number.** `execute-tool` serves every result
through `JSON.stringify`, and two topics naming each other as parent produced a genuinely cyclic
object graph — `JSON.stringify` threw `cannot serialize cyclic structures`, which would have
failed the WHOLE tool, not just those two rows. A visited-set during counting did not help; the
cycle was in the structure. Fixed with `wouldCycle()`, which refuses the attachment and promotes
the node to a root instead. (Lane B's `hasAncestorCycle` reached the identical conclusion
independently, and its comment records the same measurement.)

### The exact curl a Huddle server fn uses

`invokeJourneyTool` posts to `${JOURNEY_PROXY_URL}/tool` with the shared bearer — no new secret,
`JOURNEY_PROXY_TOKEN` reused per the standing rule.

```bash
curl -sS -X POST \
  "https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/huddle-proxy/tool" \
  -H "authorization: Bearer $JOURNEY_PROXY_TOKEN" \
  -H "content-type: application/json" \
  -H "x-huddle-proxy: 1" \
  -d '{
        "toolName": "get_task_topics",
        "args": { "limit": 300, "include_empty": true },
        "caller": { "entra_email": "<the signed-in user email>" }
      }'
# -> { "ok": true, "output": "<JSON string: the result object above>" }
```

Catalog check (should now list 27 tools including `get_task_topics`):

```bash
curl -sS "https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/huddle-proxy/tools" \
  -H "authorization: Bearer $JOURNEY_PROXY_TOKEN" | jq '.tools | length, map(.name)'
```

### NOT DEPLOYED, NOT PUSHED — the owner's call

Committed to `claude/journey-widgets-in-chat` only. Per this repo's CLAUDE.md, edge functions
**auto-deploy on push to `main`** (`deploy-supabase-functions.yml`, `on: push: branches:[main]
paths: supabase/functions/**`, deploying the CHANGED functions). To deploy:

```bash
# preferred — manual dispatch against this branch, no merge required:
#   workflow: deploy-supabase-functions.yml   input: function_name = execute-tool
# or with the CLI:
supabase functions deploy execute-tool --project-ref wwxgajrtmslzklnyplah
```

Only `execute-tool` must be deployed for the Huddle path (huddle-proxy reads the catalog from it at
runtime). Three other functions import `_shared/tool-definitions.ts` and would each need their own
redeploy to advertise the tool on their interface: `twilio-realtime-bridge` (phone),
`generate-realtime-token` (in-app voice), and `_shared/persona.ts` (prompt tool list, pulled in by
whoever imports it). **The tool is read-only, so advertising it on those interfaces is additive.**
`tool-definitions.ts`'s own header also says to run the `sync-assistant-tools` edge function after
adding a tool, to refresh the legacy OpenAI Assistant's static list — an owner decision, not run.

### NOT ESTABLISHED (stated, never guessed)

1. **Whether this user actually has a `FAMILY` category.** The screenshot shows a `Family` row with
   a colour bar and no count, but `FAMILY` is not in `DEFAULT_CATEGORY_MAPPINGS`
   (`CAREER, PROF_EDUCATION, EDUCATION, VENTURES, LIFE, PERSONAL`). `categoryMappings` comes from
   `user_scheduling_prefs.config` and is user-editable, so `FAMILY` is plausible but unverified — I
   did not query the live DB. Handled without guessing: any category key that appears on a topic or
   an open task is emitted, and an unknown key gets a title-cased label. If `FAMILY` exists it will
   render; if the screenshot's `Family` is something else entirely, it will not.
2. **Whether a category badge should count a root's OWN directly-mapped tasks in addition to its
   children's.** The screenshot cannot distinguish the two (Career 25 == the sum of its visible
   rows either way). I chose "sum of the roots' FULL subtrees" so no open task is ever uncounted.
   Consequence to be aware of: if a top-level topic has BOTH direct tasks and children, this number
   will exceed the sum of the visible child rows. Both components are exposed per topic
   (`open_task_count` vs `subtree_open_task_count`), so the widget can pick the other reading
   without a journey change.
3. **Whether the screenshot's expand arrows (►) mean "has children" or "has tasks".** Not
   determinable from a collapsed screenshot. The payload carries both facts, so either rule works.
4. **No live/deployed verification.** Everything above is offline evidence against extracted real
   source. The tool has NOT been called against the live project, so the real row counts, and
   whether the live tree matches the screenshot, are unconfirmed. Status: **implemented, mechanism
   verified offline, NOT yet confirmed live.**
