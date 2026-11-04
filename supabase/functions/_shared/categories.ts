// WHAT:          The ONE list of task categories (keys, canonical order, default labels) and the helpers
//                every surface uses to recognise, normalise and compare a category: the screens (Vite),
//                the edge functions (Deno), the scheduler's keyword rule and the category AI prompts.
// WHY:           The category list was hand-copied across ~40 files (docs/qc-evidence/AC-job-category.md,
//                section 0 F-13..F-23). Adding JOB (owner, 2026-11-03: "all job tasks go to JOB") through
//                40 copies is how a copy gets missed: voice mapped "JOB" to CAREER and smart-calendar-scheduler
//                rebuilt the config from 4 hard-coded keys, so JOB would have been silently dropped on both.
// SUPERSEDES:    the hand-written category unions/arrays in the files that now import from here.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:      docs/qc-evidence/AC-job-category.md (AC-E1, AC-D5, section 3b); categories.test.ts.
//
// Pure module: no imports, no Deno/Node/browser APIs, so the Vite app imports it by relative path the same
// way it already imports ./activities.ts.
//
// STYLES ARE DELIBERATELY NOT HERE. Several screens draw the same category in different shades on purpose
// (a light badge vs a solid card). Each screen keeps its own style map, typed Record<TaskCategory, ...>, so a
// screen that forgets JOB fails the type check instead of rendering an unstyled chip.

/** Every value of the Postgres enum public.task_category, in display order (JOB directly before CAREER). */
export const CATEGORY_KEYS = [
  'LIFE',
  'JOB',
  'CAREER',
  'VENTURES',
  'EDUCATION',
  'PROF_EDUCATION',
  'PERSONAL',
] as const;

export type TaskCategory = typeof CATEGORY_KEYS[number];

/** Default human label per category. A screen that has always shown a different wording keeps its own. */
export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  LIFE: 'Life',
  JOB: 'Job',
  CAREER: 'Career',
  VENTURES: 'Ventures',
  EDUCATION: 'Education',
  PROF_EDUCATION: 'Prof. Education',
  PERSONAL: 'Personal',
};

/** One-line meaning of each category, used to brief the category AI. Owner rulings 2026-11-03. */
export const CATEGORY_MEANINGS: Record<TaskCategory, string> = {
  LIFE: 'personal life: family, friends, health, fitness, errands, household, money, social',
  JOB: 'work for the owner\'s employer: anything the employer pays for or expects, stated or implied (my manager, my team, standups, onboarding, timesheets, benefits, compliance training, the employer\'s tools, colleagues and clients). SDLC / software-delivery work, ops decks and ops process diagrams are JOB by default',
  CAREER: 'getting the NEXT role: job applications, interviews, recruiters, LinkedIn, résumé/CV, career coaching, career research',
  VENTURES: 'the owner\'s OWN products, businesses and clients: building, fixing, selling or supporting them',
  EDUCATION: 'self-paced learning with no institution deadlines: online courses, tutorials, certifications, reading',
  PROF_EDUCATION: 'formal degree programs with fixed deadlines (DBA, EMBA, MIT courses): papers, assignments, classes, advisors',
  PERSONAL: 'personal admin that is not a LIFE activity',
};

const STRIPPED_KEYS = new Map<string, TaskCategory>(
  CATEGORY_KEYS.map((k) => [k.replace(/_/g, ''), k]),
);

function strip(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s_-]+/g, '');
}

/**
 * The category a string NAMES exactly (case, spaces, '-' and '_' ignored), or null.
 * "job", " Job ", "prof education", "PROF-EDUCATION" all resolve; "work" and "job search" do not.
 */
export function toCategoryKey(raw: unknown): TaskCategory | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  return STRIPPED_KEYS.get(strip(raw)) ?? null;
}

export function isCategory(raw: unknown): raw is TaskCategory {
  return typeof raw === 'string' && (CATEGORY_KEYS as readonly string[]).includes(raw);
}

/**
 * Map a free-form category string (from a model or a tool argument) onto a real category.
 *
 * An exact category name ALWAYS wins and maps to itself, before any synonym rule runs. That ordering is the
 * fix: the voice assistant used to send "JOB" to CAREER (it contains "job") and "PROF_EDUCATION" to EDUCATION.
 * The synonym rules after it are the voice assistant's existing ones, with two corrections: "job search" /
 * "job hunt" stay CAREER (next role), and plain work/job words now mean JOB (owner: "all job tasks go to JOB").
 * Anything unrecognised is LIFE, exactly as before.
 */
export function normalizeCategory(raw: unknown): TaskCategory {
  const exact = toCategoryKey(raw);
  if (exact) return exact;
  if (typeof raw !== 'string' || raw.trim() === '') return 'LIFE';
  const c = raw.toLowerCase().replace(/[_\s-]+/g, '');

  if (c.includes('jobsearch') || c.includes('jobhunt')) return 'CAREER';

  if (c.includes('education') || c.includes('professional') ||
      c.includes('mit') || c.includes('emba') || c.includes('degree') ||
      c.includes('college') || c.includes('school') || c.includes('class') ||
      c.includes('coursework') || c.includes('homework') || c.includes('learning') || c.includes('study')) {
    return 'EDUCATION';
  }

  if (c.includes('career')) return 'CAREER';
  if (c.includes('work') || c.includes('job') || c.includes('employer')) return 'JOB';

  if (c.includes('venture') || c.includes('startup') || c.includes('business')) return 'VENTURES';

  return 'LIFE';
}

/**
 * Categories that schedule as another one, for the KEYWORD rule only. PERSONAL tasks schedule as LIFE
 * (defaultStatus 'LIFE'), and EDUCATION is the self-paced sibling of PROF_EDUCATION, so a LIFE-lane keyword
 * still steers a PERSONAL task and a PROF_EDUCATION-lane keyword still steers an EDUCATION task -- otherwise
 * "Go to the mall" (PERSONAL) and "Finish homework" (EDUCATION) would lose the windows they have today.
 */
const KEYWORD_LANE_ALIASES: Partial<Record<TaskCategory, TaskCategory>> = {
  PERSONAL: 'LIFE',
  EDUCATION: 'PROF_EDUCATION',
};

/** Does a keyword whose lane names category `lane` apply to a task filed under `taskCategory`? */
export function laneCoversCategory(lane: TaskCategory, taskCategory: unknown): boolean {
  const cat = toCategoryKey(taskCategory);
  if (!cat) return false;
  return cat === lane || KEYWORD_LANE_ALIASES[cat] === lane;
}
