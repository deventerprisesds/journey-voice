// WHAT:       The ONE scheduling model call (batch-calendar-scheduler placement, smart-calendar-scheduler hint):
//             OpenAI first, the Lovable AI gateway only as a fallback when OpenAI refuses for a reason a second
//             provider can fix (credits, rate limit, outage). Returns the reply text or a reason; never throws.
//             Owner 2026-11-15: "I don't use loveable that is old... I use openai. Just make loveable the
//             fallback instead of the other way around." (#119 had it the other way round.)
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
  opts: { system?: string; temperature?: number } = {},
): Promise<{ status: number; content: string | null; error?: string }> {
  const messages = [
    ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
    { role: 'user', content: prompt },
  ];
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}) }),
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

export interface CallOptions {
  /** Optional system message sent before the prompt. */
  system?: string;
  temperature?: number;
}

export async function callSchedulerAI(
  prompt: string,
  keys: { lovable?: string | null; openai?: string | null },
  doFetch: FetchLike,
  opts: CallOptions = {},
): Promise<SchedulerAIResult> {
  // Order matters: OpenAI is the owner's provider; Lovable is the old one, kept only as a fallback.
  const order: Array<{ provider: 'openai' | 'lovable'; url: string; key?: string | null; model: string }> = [
    { provider: 'openai', url: OPENAI_URL, key: keys.openai, model: OPENAI_MODEL },
    { provider: 'lovable', url: LOVABLE_URL, key: keys.lovable, model: LOVABLE_MODEL },
  ];
  const attempts: SchedulerAIResult['attempts'] = [];
  let last: { status: number; error?: string } = { status: 0, error: 'no AI provider key configured' };
  for (const p of order) {
    if (!p.key) continue;
    const r = await attempt(doFetch, p.url, p.key, p.model, prompt, opts);
    attempts.push({ provider: p.provider, status: r.status, error: r.error });
    if (r.content) return { ok: true, content: r.content, provider: p.provider, status: r.status, attempts };
    last = r;
    if (!shouldFallBack(r.status) && r.status !== 200) break;
  }
  return { ok: false, content: null, provider: null, status: last.status, error: last.error, attempts };
}
