// WHAT:          The category briefing every task-category AI prompt includes: what each category means, who the
//                owner's employer is, and the owner's own name hints (product names, employer tools).
// WHY:           Owner 2026-11-03: "it should be able to intelligently know a work hours or job task and
//                automatically push it to job even if trinnex isnt explicitly stated", and "dont drop the
//                connection to the configuration in the settings so that i can change these things without code".
//                Before this, each prompt hand-typed its own category list and defined CAREER as BOTH "work tasks"
//                and "career advancement" -- the exact split the owner is now making.
// SUPERSEDES:    the hand-typed CATEGORY INFERENCE text in ai-task-parser/index.ts.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:      docs/qc-evidence/AC-job-category.md AC-D1..D4, eval set section 4; category-guide.test.ts.
//
// WHERE THE OWNER CHANGES IT (no code):
//   - employer name  -> Profile > Company          (profiles.company)
//   - name hints     -> Settings > Keyword Detection Rules: a row whose time window is "Flexible" and whose lane
//                       is a category is a NAME HINT only. It never moves a task in the schedule (the scheduler
//                       skips Flexible rows) and it tells the AI "titles naming this usually belong to <lane>".

import { CATEGORY_KEYS, CATEGORY_MEANINGS, toCategoryKey, type TaskCategory } from './categories.ts';

/** Name hints = keyword rows whose window is 'flexible' and whose lane is a real category. */
export function categoryHintsFromKeywords(
  keywords: Record<string, unknown> | null | undefined,
): Array<{ name: string; category: TaskCategory }> {
  if (!keywords || typeof keywords !== 'object') return [];
  const out: Array<{ name: string; category: TaskCategory }> = [];
  for (const [keyword, mapping] of Object.entries(keywords)) {
    if (!Array.isArray(mapping) || mapping[0] !== 'flexible') continue;
    const category = toCategoryKey(mapping[1]);
    const name = keyword.replace(/_/g, ' ').trim();
    if (category && name.length >= 2) out.push({ name, category });
  }
  return out;
}

/**
 * The names a task might use for the employer. Profile > Company is free text: "Trinnex (a CDM Smith company)"
 * (owner, 2026-11-08) gives ["Trinnex", "CDM Smith"], because a task says "Trinnex" or "CDM Smith", never the
 * whole parenthetical. A plain value gives just itself.
 */
export function employerNames(employer: string): string[] {
  const m = employer.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (!m) return [employer];
  const parent = m[2].trim()
    .replace(/^(?:a|an|the|part of|a part of|subsidiary of|a subsidiary of|owned by)\s+/i, '')
    .replace(/\s+(?:company|subsidiary|group)$/i, '')
    .trim();
  return [m[1].trim(), parent].filter((n, i, a) => n.length >= 2 && a.indexOf(n) === i);
}

/** The briefing text. `employer` may be null/empty: the JOB rules still apply, just without a name. */
export function buildCategoryGuide(opts: {
  employer?: string | null;
  hints?: Array<{ name: string; category: TaskCategory }>;
}): string {
  const employer = typeof opts.employer === 'string' ? opts.employer.trim() : '';
  const hints = opts.hints ?? [];

  const lines: string[] = [];
  lines.push(`CATEGORY (one of: ${CATEGORY_KEYS.join(', ')}). Decide by what the task is FOR, not by keywords.`);
  for (const k of CATEGORY_KEYS) lines.push(`- ${k}: ${CATEGORY_MEANINGS[k]}.`);

  lines.push('');
  if (employer) {
    const names = employerNames(employer);
    lines.push(`THE OWNER'S EMPLOYER is ${employer}. Work for ${names.join(' or ')} is JOB whether or not ${names.map((n) => `"${n}"`).join(' or ')} appears in the task.`);
  } else {
    lines.push(`The owner's employer is not named. Work for an employer is still JOB.`);
  }

  if (hints.length) {
    const byCat = new Map<TaskCategory, string[]>();
    for (const h of hints) byCat.set(h.category, [...(byCat.get(h.category) ?? []), h.name]);
    lines.push('THE OWNER\'S NAME HINTS (a task naming one of these belongs to that category -- this beats the SDLC default in rule 2 below):');
    for (const k of CATEGORY_KEYS) {
      const names = byCat.get(k);
      if (names?.length) lines.push(`- ${k}: ${names.join(', ')}`);
    }
  }

  lines.push('');
  lines.push('HOW TO DECIDE BETWEEN THE WORK-LIKE CATEGORIES:');
  lines.push('1. A task that names one of the owner\'s own products or clients is VENTURES -- even SDLC work for it (owner ruling 2026-11-04: "Write the SDLC doc for Sidecar" is a side project, VENTURES).');
  lines.push('2. Otherwise, SDLC / software-delivery-process work, ops decks and ops process diagrams are JOB by default.');
  lines.push('3. Employer signals (my manager, my team, standup, onboarding, timesheet, benefits, compliance training, the employer\'s tools, colleagues or clients) mean JOB.');
  lines.push('4. Getting the next role (applying, interviewing, recruiters, LinkedIn, résumé/CV, career coach) is CAREER -- even if a company or tool is named, e.g. an interview with a recruiter from a tool vendor is CAREER.');
  lines.push('4b. Adding the CURRENT job to LinkedIn or a résumé (the new role\'s job-history entry, certificates earned for it) is JOB (owner ruling 2026-11-08). Any other LinkedIn work (headline, profile, posts, networking) stays CAREER.');
  lines.push('5. Generic work with no owner signal at all ("prepare slides for the client meeting", "finish the quarterly deck") is JOB.');
  lines.push('6. Learning a tool on a self-paced course is EDUCATION; a formal degree program\'s work is PROF_EDUCATION.');
  return lines.join('\n');
}

/** Longest request context the parser prompt carries; a longer message is cut, never dropped. */
export const REQUEST_CONTEXT_MAX_CHARS = 1000;

/**
 * The user's own message that asked for these tasks, as a prompt block for the category AI -- or '' when there is
 * none. Added 2026-11-08 (docs/qc-evidence/FIX-parse-context-categories.md): Huddle sent 23 work lines as bare
 * titles and dropped the owner's preface, so "Hang my panel on the wall" and "Clean my office" read as LIFE.
 * The context is guidance only: the parser must never turn it into a task of its own.
 */
export function buildRequestContextBlock(context: unknown): string {
  if (typeof context !== 'string') return '';
  const flat = context.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const text = flat.length > REQUEST_CONTEXT_MAX_CHARS ? `${flat.slice(0, REQUEST_CONTEXT_MAX_CHARS)}…` : flat;
  return [
    "THE USER'S OWN MESSAGE THAT REQUESTED THESE TASKS (context only -- never create a task from it):",
    `"""${text}"""`,
    'Use it to decide category. A framing it states explicitly (e.g. "for work", "my work priorities today", "these are all job tasks") applies to EVERY task in this input unless a line clearly says otherwise (a personal errand, family, health, a class).',
    'An explicit work framing means JOB for every such line -- even one that names one of the owner\'s own products (rule 1) or matches a name hint: the user has said what these tasks are for.',
    'Wording that only means DOING something ("things I need to work on", "priorities for today") is NOT a work framing (owner ruling 2026-11-08): decide those lines one by one as usual.',
  ].join('\n');
}

/**
 * System prompt for choosing the category of ONE title, used after a multi-task parse. Added 2026-11-08: one
 * gpt-4o-mini completion over 23 titles let whole runs drift (one run filed most lines VENTURES, the next
 * EDUCATION) while the same titles parsed one at a time were right (docs/qc-evidence/FIX-parse-context-categories.md
 * section 2). Same briefing (buildCategoryGuide) and the same request context the batch prompt sees.
 */
export function buildCategoryClassifierPrompt(opts: {
  employer?: string | null;
  hints?: Array<{ name: string; category: TaskCategory }>;
  context?: unknown;
  /** Every title parsed from the same input, so one line is read alongside its siblings (a list of work items). */
  list?: string[];
}): string {
  const ctx = buildRequestContextBlock(opts.context);
  const list = (opts.list ?? []).filter((t) => typeof t === 'string' && t.trim()).slice(0, 60);
  return [
    `You choose the CATEGORY of ONE task on the owner's task board: the task in the user message. Reply with JSON only: {"category": "<one of ${CATEGORY_KEYS.join('|')}>"}.`,
    '',
    buildCategoryGuide({ employer: opts.employer, hints: opts.hints }),
    ...(ctx ? ['', ctx] : []),
    ...(list.length > 1 ? ['', 'THE LIST THIS TASK CAME FROM (context only -- read the task alongside its siblings, but categorize ONLY the task in the user message):', ...list.map((t) => `- ${t}`)] : []),
  ].join('\n');
}

/** The category in a classifier reply, or null for anything that is not exactly one real category. */
export function parseCategoryReply(content: unknown): TaskCategory | null {
  if (typeof content !== 'string') return null;
  try {
    return toCategoryKey(JSON.parse(content)?.category);
  } catch {
    return null;
  }
}
