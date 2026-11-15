// WHAT:       The ONE model call batch-calendar-scheduler makes to place a day's tasks: Lovable AI gateway first,
//             OpenAI as the fallback when the gateway refuses for a reason a second provider can fix
//             (credits, rate limit, gateway outage). Returns the reply text or a reason; never throws.
// WHY:        2026-11-14 and 2026-11-15 every placement call returned 403 credit_limit_reached ("Workspace
//             credit limit reached ... requires admin_action") from ai.gateway.lovable.dev, so both nightly
//             builds placed 0 tasks and the owner's weekend was empty. OPENAI_API_KEY was already used by the
//             same function's sanity check (gpt-4o-mini), so the fallback adds no new secret.
// SUPERSEDES: the inline Lovable-only fetch in batch-calendar-scheduler/index.ts.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   _shared/scheduler-ai.test.ts; function_logs 2026-11-15 05:00:09 "AI API error: 403 credit_limit_reached".

export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface SchedulerAIResult {
  ok: boolean;
  content: string | null;
  provider: 'lovable' | 'openai' | null;
  status: number;
  error?: string;
  /** Every attempt in order, for the log. */
  attempts: Array<{ provider: 'lovable' | 'openai'; status: number; error?: string }>;
}

export const LOVABLE_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
export const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
export const LOVABLE_MODEL = 'google/gemini-2.5-flash';
export const OPENAI_MODEL = 'gpt-4o-mini';

/** Refusals a different provider can get past. 400-style errors (a bad prompt) would fail there too. */
export function shouldFallBack(status: number): boolean {
  return status === 401 || status === 402 || status === 403 || status === 408 || status === 429 || status >= 500 || status === 0;
}

async function attempt(
  doFetch: FetchLike, url: string, key: string, model: string, prompt: string,
): Promise<{ status: number; content: string | null; error?: string }> {
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    });
    const text = await res.text();
    if (!res.ok) return { status: res.status, content: null, error: text.slice(0, 500) };
    try {
      const content = JSON.parse(text)?.choices?.[0]?.message?.content ?? null;
      return content ? { status: res.status, content } : { status: res.status, content: null, error: 'empty reply' };
    } catch {
      return { status: res.status, content: null, error: 'reply was not JSON' };
    }
  } catch (e) {
    return { status: 0, content: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function callSchedulerAI(
  prompt: string,
  keys: { lovable?: string | null; openai?: string | null },
  doFetch: FetchLike,
): Promise<SchedulerAIResult> {
  const attempts: SchedulerAIResult['attempts'] = [];
  let last = { status: 0, error: 'no AI provider key configured' as string | undefined };
  if (keys.lovable) {
    const r = await attempt(doFetch, LOVABLE_URL, keys.lovable, LOVABLE_MODEL, prompt);
    attempts.push({ provider: 'lovable', status: r.status, error: r.error });
    if (r.content) return { ok: true, content: r.content, provider: 'lovable', status: r.status, attempts };
    last = r;
    if (!shouldFallBack(r.status) && r.status !== 200) {
      return { ok: false, content: null, provider: null, status: r.status, error: r.error, attempts };
    }
  }
  if (keys.openai) {
    const r = await attempt(doFetch, OPENAI_URL, keys.openai, OPENAI_MODEL, prompt);
    attempts.push({ provider: 'openai', status: r.status, error: r.error });
    if (r.content) return { ok: true, content: r.content, provider: 'openai', status: r.status, attempts };
    last = r;
  }
  return { ok: false, content: null, provider: null, status: last.status, error: last.error, attempts };
}
