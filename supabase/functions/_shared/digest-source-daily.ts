// =============================================================================
// WHAT:          Loads the rows the 8am DAILY BRIEF is built from, and returns a
//                ready `DailyBriefPayload` (or null when the day is genuinely
//                empty). This is the DATA-GATHERING half of the daily digest.
// WHY:           `buildDailyBriefPayload` (digest-content.ts) needs a DayContext;
//                `buildDayContextServer` (build-day-context.ts) needs ROWS and
//                says so in its own docstring -- "Caller is responsible for the
//                queries (so this stays free of supabase client dependencies)".
//                Nothing in this repo was that caller: a repo-wide grep for
//                `buildDayContextServer` found the definition, two comments and
//                an import of its TYPES -- and ZERO call sites. This module is
//                the missing caller, not a second builder.
// SUPERSEDES:    nothing.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:      .claude/IMPL-digest-source-daily.md (grep output, column ground
//                truth, every mutation outcome verbatim).
//
// EXTEND, DON'T DUPLICATE -- what this module deliberately does NOT do:
//   * it defines NO DayContext shape and NO payload shape (both imported);
//   * it does NOT decide which tasks are "today" -- `buildDayContextServer` owns
//     that (`dateInTz(t.start_time, tz) === todayStr`);
//   * it does NOT build or sort the priority lane -- `buildDayContextServer`
//     selects it and `buildDailyBriefPayload` re-sorts it by rank ASC.
//   The only judgement here is WHICH ROWS to fetch and WHEN to send nothing.
// =============================================================================

import {
  buildDayContextServer,
  type DayContext,
} from "./build-day-context.ts";
import {
  buildDailyBriefPayload,
  buildDeepLink,
  APP_BASE_URL_ENV,
  DEFAULT_TIMEZONE,
  PRIORITIES_PATH,
  type DailyBriefPayload,
} from "./digest-content.ts";
import { getTodayInTimezone, localDateToUtcBounds } from "./timezone.ts";

// ---------------------------------------------------------------------------
// The narrow slice of supabase-js this module uses.
//
// Typed structurally rather than imported from `@supabase/supabase-js` so that
// (a) the edge function passes its real service-role client unchanged, and
// (b) a test can hand over a small fake without pulling the SDK into a node
// test run. A PostgREST filter builder is a THENABLE, which is what makes
// `await client.from(t).select(c).eq(...)` work -- the fake mirrors that.
// ---------------------------------------------------------------------------

export interface PostgrestResult<T> {
  data: T[] | null;
  error: unknown;
}

export interface PostgrestSingleResult<T> {
  data: T | null;
  error: unknown;
}

export interface DigestQuery extends PromiseLike<PostgrestResult<any>> {
  select(columns: string): DigestQuery;
  eq(column: string, value: unknown): DigestQuery;
  gte(column: string, value: unknown): DigestQuery;
  lt(column: string, value: unknown): DigestQuery;
  is(column: string, value: unknown): DigestQuery;
  not(column: string, op: string, value: unknown): DigestQuery;
  maybeSingle(): PromiseLike<PostgrestSingleResult<any>>;
}

export interface DigestSupabaseClient {
  from(table: string): DigestQuery;
}

// ---------------------------------------------------------------------------
// Tables + columns. Every name here was read out of
// `src/integrations/supabase/types.ts` this session, not typed from memory.
//
// NOTE the two columns that are CONSPICUOUSLY ABSENT: `build-day-context.ts`
// reads `t.original_due_date` and `t.program_id`, and NEITHER is a column on
// `tasks` (the nightly builder writes `original_due_date` as a key inside the
// `scheduling_context` JSON). Naming a non-existent column in a PostgREST
// select 400s the ENTIRE query, so selecting them "just in case" would take the
// whole digest down. They are omitted deliberately; the fields they feed
// (`rolledOver`, `programId`) are not part of `DailyBriefPayload`.
// ---------------------------------------------------------------------------

export const PREFS_TABLE = "user_scheduling_prefs";
export const TASKS_TABLE = "tasks";
export const EVENTS_TABLE = "external_calendar_events";

export const TASK_COLUMNS =
  "id, title, start_time, end_time, due_date, status, category, priority, " +
  "is_priority, priority_rank, pushed_count, external_event_id, assignment_id, " +
  "assignment_url, scheduling_context, completed_at";

export const EVENT_COLUMNS = "id, title, start_time, end_time";

/** Statuses a closed task can carry. PostgREST `not.in` list syntax. */
const CLOSED_STATUS_LIST = '("DONE","CANCELLED")';

export interface LoadDailyBriefOptions {
  /** Override the user's timezone (skips the prefs read). */
  timezone?: string | null;
  /** Override "today" as YYYY-MM-DD local. Defaults to today in `timezone`. */
  todayStr?: string;
  /** Override the deep-link base. Defaults to the APP_BASE_URL env var. */
  appBaseUrl?: string | null;
  /** Path the deep link points at. Defaults to the priorities widget. */
  deepLinkPath?: string;
}

/**
 * Read APP_BASE_URL.
 *
 * Deno is reached through `globalThis` rather than as a bare identifier so this
 * module can be exercised by the repo's node test runner -- a bare `Deno` is a
 * ReferenceError there, and an untestable fail-closed path is not fail-closed,
 * it is unverified. The env NAME comes from `APP_BASE_URL_ENV`, so there is one
 * spelling of it in the codebase and not two.
 *
 * Returns undefined when unset; it is `buildDeepLink` that THROWS, and that
 * throw is what must reach the caller.
 */
function readAppBaseUrl(): string | undefined {
  const deno = (globalThis as {
    Deno?: { env?: { get(key: string): string | undefined } };
  }).Deno;
  return deno?.env?.get(APP_BASE_URL_ENV);
}

/**
 * Resolve the user's timezone.
 *
 * A missing prefs row, a null column, or a whitespace-only value all fall back
 * to DEFAULT_TIMEZONE -- the user is never SKIPPED for missing config, which is
 * the same posture `shouldSendAtLocalHour` takes in digest-content.ts. A read
 * ERROR falls back too: a transient prefs failure must not silence the digest.
 */
export async function resolveTimezone(
  client: DigestSupabaseClient,
  userId: string,
): Promise<string> {
  try {
    const { data } = await client
      .from(PREFS_TABLE)
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();
    const tz = (data?.timezone ?? "").trim();
    return tz || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function rowsOf(result: PostgrestResult<any> | null | undefined): any[] {
  return Array.isArray(result?.data) ? (result as PostgrestResult<any>).data! : [];
}

/** Merge row sets by `id`, first occurrence wins. */
function mergeById(...sets: any[][]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const set of sets) {
    for (const row of set) {
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

/**
 * Fetch the rows `buildDayContextServer` needs and hand them straight to it.
 *
 * TWO task queries, because the day context needs two different populations and
 * neither is a subset of the other:
 *   1. SCHEDULED TODAY -- anything with `start_time` inside today's local
 *      bounds, INCLUDING already-completed items (the schedule is a record of
 *      the day, not a to-do list);
 *   2. OPEN -- every unfinished task regardless of scheduling, which is what
 *      the priority lane and the overdue list are drawn from.
 * They are merged by id; the module downstream does the filtering.
 */
export async function loadDayContext(
  client: DigestSupabaseClient,
  userId: string,
  tz: string,
  todayStr: string,
): Promise<DayContext> {
  const bounds = localDateToUtcBounds(todayStr, tz);

  const [scheduledResult, openResult, eventsResult] = await Promise.all([
    client
      .from(TASKS_TABLE)
      .select(TASK_COLUMNS)
      .eq("user_id", userId)
      .gte("start_time", bounds.start)
      .lt("start_time", bounds.end),
    client
      .from(TASKS_TABLE)
      .select(TASK_COLUMNS)
      .eq("user_id", userId)
      .is("completed_at", null)
      .not("status", "in", CLOSED_STATUS_LIST),
    client
      .from(EVENTS_TABLE)
      .select(EVENT_COLUMNS)
      .eq("user_id", userId)
      .gte("start_time", bounds.start)
      .lt("start_time", bounds.end),
  ]);

  const tasks = mergeById(rowsOf(scheduledResult), rowsOf(openResult));
  const externalEvents = rowsOf(eventsResult);

  return buildDayContextServer({
    tasks,
    externalEvents,
    // Same rows, narrowed -- an assignment task IS a task. A third round trip
    // for a subset of what is already in hand would be waste, and the
    // status/slice filtering is `buildDayContextServer`'s anyway.
    pendingAssignmentTasks: tasks.filter((t) => t.assignment_id),
    builderLog: null,
    tz,
    todayStr,
  });
}

/**
 * THE ENTRY POINT. `DailyBriefPayload`, or null when there is nothing to send.
 *
 * ORDER OF OPERATIONS IS LOAD-BEARING: the deep link is built BEFORE the
 * empty-day check. A missing APP_BASE_URL is a DEPLOY defect, and it must
 * surface on every run -- if the empty check came first, a misconfigured deploy
 * would return a silent null on every quiet day and look healthy right up until
 * the first busy one. `MissingDeepLinkBaseError` propagates untouched: the
 * caller records the run as FAILED and sends nothing. It is never caught and
 * never substituted with a relative path (AC-LINK-1).
 */
export async function loadDailyBriefPayload(
  client: DigestSupabaseClient,
  userId: string,
  opts: LoadDailyBriefOptions = {},
): Promise<DailyBriefPayload | null> {
  const tz = (opts.timezone ?? "").trim() ||
    (await resolveTimezone(client, userId));
  const todayStr = opts.todayStr || getTodayInTimezone(tz);

  const deepLink = buildDeepLink(
    opts.appBaseUrl ?? readAppBaseUrl(),
    opts.deepLinkPath ?? PRIORITIES_PATH,
  );

  const ctx = await loadDayContext(client, userId, tz, todayStr);

  // Nothing scheduled AND nothing ranked = no brief. A calendar hold alone is
  // deliberately NOT enough: holds already live in the user's calendar app, and
  // an email that only says "you have the meeting you already accepted" is the
  // empty-state mail nobody asked for.
  if (ctx.schedule.length === 0 && ctx.priorityLane.length === 0) {
    return null;
  }

  return buildDailyBriefPayload(ctx, { deepLink });
}
