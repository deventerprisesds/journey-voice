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
  lines.push(employer
    ? `THE OWNER'S EMPLOYER is ${employer}. Work for ${employer} is JOB whether or not "${employer}" appears in the task.`
    : `The owner's employer is not named. Work for an employer is still JOB.`);

  if (hints.length) {
    const byCat = new Map<TaskCategory, string[]>();
    for (const h of hints) byCat.set(h.category, [...(byCat.get(h.category) ?? []), h.name]);
    lines.push('THE OWNER\'S NAME HINTS (a task naming one of these usually belongs to that category):');
    for (const k of CATEGORY_KEYS) {
      const names = byCat.get(k);
      if (names?.length) lines.push(`- ${k}: ${names.join(', ')}`);
    }
  }

  lines.push('');
  lines.push('HOW TO DECIDE BETWEEN THE WORK-LIKE CATEGORIES:');
  lines.push('1. SDLC / software-delivery-process work, ops decks and ops process diagrams are JOB, even when one of the owner\'s own products is named.');
  lines.push('2. Otherwise, a task that names one of the owner\'s own products or clients is VENTURES.');
  lines.push('3. Employer signals (my manager, my team, standup, onboarding, timesheet, benefits, compliance training, the employer\'s tools, colleagues or clients) mean JOB.');
  lines.push('4. Getting the next role (applying, interviewing, recruiters, LinkedIn, résumé/CV, career coach) is CAREER -- even if a company or tool is named, e.g. an interview with a recruiter from a tool vendor is CAREER.');
  lines.push('5. Generic work with no owner signal at all ("prepare slides for the client meeting", "finish the quarterly deck") is JOB.');
  lines.push('6. Learning a tool on a self-paced course is EDUCATION; a formal degree program\'s work is PROF_EDUCATION.');
  return lines.join('\n');
}
