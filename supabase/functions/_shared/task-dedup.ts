// =============================================================================
// Task de-duplication guard (shared across ALL task-creation paths).
//
// Two layers, cheapest first:
//   1. SIGNATURE (deterministic, free): normalize the title — lowercase, strip
//      punctuation, drop filler stopwords, de-dupe + sort the remaining tokens.
//      An exact signature match against the user's OPEN tasks is a high-confidence
//      duplicate. This alone collapses "Make payments to Klarna" and
//      "Make Klarna payments" to the same signature ("klarna make payments").
//   2. SEMANTIC (embeddings): for titles that don't signature-match, cosine-compare
//      OpenAI text-embedding-3-small vectors. >= highThreshold = duplicate;
//      [possibleThreshold, highThreshold) = AMBIGUOUS — we CREATE the task anyway
//      (never silently merge genuinely-distinct work) but flag it 'possible-duplicate'.
//
// Decisions: 'duplicate' -> skip creating; 'possible' -> create + flag; 'unique' -> create.
// Within-batch dedup: a candidate is also compared against siblings already ACCEPTED
// earlier in the same batch (so two identical titles in one parse dedup against each other).
//
// The guard is OFF unless config.dedup.enabled === true. Thresholds are config-driven.
// This module performs NO writes and imports NO supabase client — callers pass data in,
// so the decision logic is pure and unit-testable (embed is injectable).
// =============================================================================

export interface DedupConfig {
  enabled: boolean;
  highThreshold: number;       // cosine >= this => duplicate (skip)
  possibleThreshold: number;   // possibleThreshold <= cosine < high => ambiguous (create + flag)
  semantic: boolean;           // run the embedding layer at all
}

export interface OpenTaskLite {
  id: string;
  title: string;
}

export type DedupDecisionKind = 'unique' | 'duplicate' | 'possible';

export interface DedupDecision {
  index: number;                 // position in the input candidates array
  title: string;
  decision: DedupDecisionKind;
  method?: 'signature' | 'semantic';
  matchedTaskId: string | null;  // existing task id, or null when matched an in-batch sibling
  matchedTitle?: string;
  similarity?: number;           // cosine, for semantic matches
}

// Minimal, SAFE filler-word list. Deliberately excludes verbs/nouns (make, pay, call,
// research, etc.) so we only collapse true grammatical filler and never merge distinct work.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'my', 'your', 'me', 'i',
  'on', 'in', 'at', 'with', 'this', 'that', 'please', 'pls', 'now',
]);

/** Deterministic, order-independent title signature. */
export function titleSignature(title: string): string {
  const tokens = (title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // strip punctuation (unicode-aware)
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
  // de-dupe repeated tokens, then sort so word order doesn't matter
  return Array.from(new Set(tokens)).sort().join(' ');
}

/** Resolve the per-user dedup config from user_scheduling_prefs.config, with seeded defaults. */
export function resolveDedupConfig(config: unknown): DedupConfig {
  const d = (config && typeof config === 'object' ? (config as any).dedup : undefined) || {};
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback;
  return {
    enabled: d.enabled === true,                        // default OFF (opt-in until verified)
    semantic: d.semantic !== false,                     // default ON when the guard is enabled
    highThreshold: num(d.highThreshold, 0.90),
    possibleThreshold: num(d.possibleThreshold, 0.80),
  };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Default embedder: OpenAI text-embedding-3-small, batched. Reuses the existing OPENAI_API_KEY. */
export async function embedTitlesOpenAI(titles: string[]): Promise<number[][]> {
  if (titles.length === 0) return [];
  const key = (globalThis as any).Deno?.env?.get?.('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY not set — cannot run semantic dedup');
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: titles }),
  });
  if (!response.ok) throw new Error(`OpenAI embeddings error: ${await response.text()}`);
  const data = await response.json();
  // API preserves input order in data.data[i].index; sort defensively.
  return (data.data as Array<{ index: number; embedding: number[] }>)
    .slice()
    .sort((x, y) => x.index - y.index)
    .map((e) => e.embedding);
}

/**
 * Build a dedup plan for a batch of candidate titles against the user's open tasks.
 * Pure decision logic; `embed` is injectable (defaults to OpenAI) so it can be unit-tested offline.
 * Semantic failures are NON-FATAL: on any embed error we fall back to signature-only (fail-open to
 * "unique" for the semantic band) so a dedup outage never blocks task creation.
 */
export async function buildDedupPlan(opts: {
  candidates: string[];             // candidate titles, in creation order
  openTasks: OpenTaskLite[];        // user's existing OPEN tasks (exclude DONE/archived)
  cfg: DedupConfig;
  embed?: (titles: string[]) => Promise<number[][]>;
}): Promise<DedupDecision[]> {
  const { candidates, openTasks, cfg } = opts;
  const decisions: DedupDecision[] = [];

  // Signature index of existing open tasks (first task wins for a given signature).
  const openSigToTask = new Map<string, OpenTaskLite>();
  for (const t of openTasks) {
    const sig = titleSignature(t.title);
    if (sig && !openSigToTask.has(sig)) openSigToTask.set(sig, t);
  }

  // Accepted-in-this-batch signatures -> the candidate title that claimed them.
  const acceptedSig = new Map<string, string>();

  // Decide which candidates still need the semantic layer (i.e. no signature match).
  const candSig = candidates.map((t) => titleSignature(t));

  // Pre-compute embeddings only if semantic is on and there is at least one non-signature-matched
  // candidate. We embed every open title + candidate once, in a single batched call.
  let openEmb: number[][] = [];
  let candEmb: number[][] = [];
  let semanticReady = false;
  if (cfg.semantic) {
    // Will any candidate reach the semantic layer? (i.e. not resolved by signature vs existing)
    const anyNeedsSemantic = candSig.some((s) => !s || !openSigToTask.has(s));
    if (anyNeedsSemantic) {
      try {
        const embed = opts.embed || embedTitlesOpenAI;
        const openTitles = openTasks.map((t) => t.title);
        const all = await embed([...openTitles, ...candidates]);
        openEmb = all.slice(0, openTitles.length);
        candEmb = all.slice(openTitles.length);
        semanticReady = candEmb.length === candidates.length;
      } catch (_e) {
        // Fail-open: semantic unavailable -> signature-only for this batch.
        semanticReady = false;
      }
    }
  }

  // Accepted-in-batch embeddings paired with their candidate titles (for within-batch semantic dedup).
  const acceptedEmb: { title: string; vec: number[] }[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const title = candidates[i];
    const sig = candSig[i];

    // ---- Layer 1: signature (existing tasks, then in-batch siblings) ----
    if (sig && openSigToTask.has(sig)) {
      const m = openSigToTask.get(sig)!;
      decisions.push({ index: i, title, decision: 'duplicate', method: 'signature', matchedTaskId: m.id, matchedTitle: m.title });
      continue;
    }
    if (sig && acceptedSig.has(sig)) {
      decisions.push({ index: i, title, decision: 'duplicate', method: 'signature', matchedTaskId: null, matchedTitle: acceptedSig.get(sig) });
      continue;
    }

    // ---- Layer 2: semantic ----
    let best = { sim: 0, taskId: null as string | null, title: undefined as string | undefined };
    if (semanticReady && candEmb[i]) {
      const v = candEmb[i];
      for (let k = 0; k < openEmb.length; k++) {
        const s = cosine(v, openEmb[k]);
        if (s > best.sim) best = { sim: s, taskId: openTasks[k].id, title: openTasks[k].title };
      }
      for (const a of acceptedEmb) {
        const s = cosine(v, a.vec);
        if (s > best.sim) best = { sim: s, taskId: null, title: a.title };
      }
    }

    let decision: DedupDecisionKind = 'unique';
    if (semanticReady && best.sim >= cfg.highThreshold) decision = 'duplicate';
    else if (semanticReady && best.sim >= cfg.possibleThreshold) decision = 'possible';

    decisions.push({
      index: i,
      title,
      decision,
      ...(decision !== 'unique' ? { method: 'semantic' as const, matchedTaskId: best.taskId, matchedTitle: best.title, similarity: Number(best.sim.toFixed(4)) } : { matchedTaskId: null }),
    });

    // Accept 'unique' and 'possible' (they get created) into the in-batch indexes so later
    // candidates dedup against them too. 'duplicate' is skipped, so it is NOT indexed.
    if (decision !== 'duplicate') {
      if (sig) acceptedSig.set(sig, title);
      if (semanticReady && candEmb[i]) acceptedEmb.push({ title, vec: candEmb[i] });
    }
  }

  return decisions;
}

// =============================================================================
// DB orchestration (callers pass a supabase service client — this module never
// creates one). These wrap buildDedupPlan with the load/log/notify side-effects
// so every creation path shares identical behavior.
// =============================================================================

export interface DedupOutcome {
  index: number;
  create: boolean;        // false => skip the insert entirely (high-confidence duplicate)
  extraTags: string[];    // e.g. ['possible-duplicate'] to merge onto the created task
  decision: DedupDecision;
}

export interface DedupRunResult {
  enabled: boolean;
  cfg: DedupConfig;
  outcomes: DedupOutcome[];   // one per candidate, in order
}

/** Load the user's OPEN tasks (DONE/archived excluded so a recurring task can be re-created). */
export async function loadOpenTasks(supabase: any, userId: string): Promise<OpenTaskLite[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title')
    .eq('user_id', userId)
    .neq('status', 'DONE')
    .is('completed_at', null);
  if (error) throw error;
  return (data || []) as OpenTaskLite[];
}

/**
 * Resolve config, and if the guard is enabled, decide skip/flag/create for a batch of candidate
 * titles. Returns a create/extraTags outcome per candidate. When disabled, every candidate is
 * `create:true` with no tags (today's behavior, no embedding call).
 */
export async function runDedup(opts: {
  supabase: any;
  userId: string;
  candidates: string[];
  config?: unknown;                 // user_scheduling_prefs.config if the caller already has it
  embed?: (titles: string[]) => Promise<number[][]>;
}): Promise<DedupRunResult> {
  const { supabase, userId, candidates } = opts;

  let rawConfig = opts.config;
  if (rawConfig === undefined) {
    const { data } = await supabase
      .from('user_scheduling_prefs')
      .select('config')
      .eq('user_id', userId)
      .maybeSingle();
    rawConfig = data?.config;
  }
  const cfg = resolveDedupConfig(rawConfig);

  const passthrough = (): DedupRunResult => ({
    enabled: false,
    cfg,
    outcomes: candidates.map((title, index) => ({
      index, create: true, extraTags: [],
      decision: { index, title, decision: 'unique', matchedTaskId: null },
    })),
  });

  if (!cfg.enabled) return passthrough();

  let openTasks: OpenTaskLite[] = [];
  try {
    openTasks = await loadOpenTasks(supabase, userId);
  } catch (_e) {
    // If we cannot load context, fail OPEN (never block creation on a read error).
    return passthrough();
  }

  const plan = await buildDedupPlan({ candidates, openTasks, cfg, embed: opts.embed });
  return {
    enabled: true,
    cfg,
    outcomes: plan.map((d) => ({
      index: d.index,
      create: d.decision !== 'duplicate',
      extraTags: d.decision === 'possible' ? ['possible-duplicate'] : [],
      decision: d,
    })),
  };
}

export interface DedupLogEntry {
  action: 'skipped' | 'flagged';
  candidate: Record<string, unknown>;   // the full would-be task payload (undo source)
  matched_task_id: string | null;
  matched_title?: string;
  method?: 'signature' | 'semantic';
  similarity?: number;
  created_task_id?: string | null;      // for 'flagged': the task that WAS created
}

/**
 * Persist the dedup audit rows AND queue exactly ONE user notification for the batch (via the
 * existing scheduled_notifications -> notification-delivery pipeline; no new sender). Non-fatal:
 * a logging/notification failure never breaks task creation.
 */
export async function finalizeDedup(
  supabase: any,
  args: { userId: string; boardId: string | null; source: string; entries: DedupLogEntry[] },
): Promise<void> {
  const { userId, boardId, source, entries } = args;
  if (!entries.length) return;

  try {
    await supabase.from('task_dedup_log').insert(
      entries.map((e) => ({
        user_id: userId,
        board_id: boardId,
        action: e.action,
        candidate: e.candidate,
        matched_task_id: e.matched_task_id,
        matched_title: e.matched_title ?? null,
        method: e.method ?? null,
        similarity: e.similarity ?? null,
        source,
        created_task_id: e.created_task_id ?? null,
      })),
    );
  } catch (err) {
    console.error('[dedup] failed to write task_dedup_log:', err);
  }

  try {
    const skipped = entries.filter((e) => e.action === 'skipped');
    const flagged = entries.filter((e) => e.action === 'flagged');

    // Full, untruncated detail lines (this becomes an Iris CHAT message, not just a push body).
    const lines: string[] = [];
    for (const e of skipped) lines.push(`• I skipped "${e.candidate.title}" — it looks like your existing "${e.matched_title}".`);
    for (const e of flagged) lines.push(`• I kept "${e.candidate.title}" but flagged it as a possible duplicate of "${e.matched_title}".`);

    const intro = skipped.length && flagged.length
      ? `Heads up — while adding tasks I caught some likely duplicates:`
      : skipped.length
        ? `Heads up — I skipped ${skipped.length > 1 ? `${skipped.length} new tasks that looked like duplicates` : `a new task that looked like a duplicate`}:`
        : `Heads up — I flagged ${flagged.length > 1 ? `${flagged.length} new tasks as possible duplicates` : `a new task as a possible duplicate`}:`;
    const undoHint = skipped.length
      ? `\n\nIf I got any of these wrong, just reply "undo" and I'll add ${skipped.length > 1 ? 'them' : 'it'} back.`
      : `\n\nReply "undo" if you'd rather I not flag ${flagged.length > 1 ? 'them' : 'it'}.`;
    const message = `${intro}\n\n${lines.join('\n')}${undoHint}`;

    const title = skipped.length && flagged.length
      ? `Caught ${entries.length} possible duplicate task${entries.length > 1 ? 's' : ''}`
      : skipped.length
        ? `Skipped ${skipped.length} duplicate task${skipped.length > 1 ? 's' : ''}`
        : `Flagged ${flagged.length} possible duplicate${flagged.length > 1 ? 's' : ''}`;

    // Route as a 'scheduled_chat' notice: notification-delivery posts `metadata.message` as an Iris
    // message into the user's chat AND sends a push that OPENS that chat on tap (openCommsConsole).
    // This reuses the existing chat/push infra — no new deep-link plumbing. metadata.dedup carries a
    // machine-readable summary for the undo flow.
    await supabase.from('scheduled_notifications').insert({
      user_id: userId,
      notification_type: 'scheduled_chat',
      scheduled_for: new Date().toISOString(),
      title,
      body: message,
      metadata: {
        message,
        source: 'dedup',
        dedup: entries.map((e) => ({ action: e.action, title: e.candidate.title, matched: e.matched_title, method: e.method })),
      },
    });
  } catch (err) {
    console.error('[dedup] failed to queue dedup chat notification:', err);
  }
}
