// WHAT:       Turns a scheduled call's stored configuration into a body a PERSON can read, for
//             the email and Slack channels.
// WHY:        journey shipped the VOICE ASSISTANT'S SCRIPT as the email body. Measured verbatim
//             from the live payload 2026-09-08:
//               "Time for your morning kickstart. [WINDOW:morning]\nMorning kickstart call.\n\n
//                BRANCH 1 (morning tasks exist):\n- Greet: \"Hello Sir.\"\n- List morning tasks..."
//             Those are stage directions for Iris to PERFORM on a phone call. On a call they are
//             correct; in an inbox they are nonsense, because nothing ever rendered a message FROM
//             them. Fixing the transport alone would only have delivered stage directions faster.
// SUPERSEDES: the inline template at notification-delivery/index.ts:239.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/actions.md "none of my emails are working"; .claude/memory.md 2026-09-13.
//
// SCOPE, deliberately narrow: this changes what EMAIL and SLACK say. The phone path still gets the
// script verbatim through buildCallContext -- it is the correct input for a voice agent, and
// rewriting it for both would break the working channel to fix the broken one.

/** A task as the window fetchers return it. Only the fields this renderer reads are required. */
export interface BriefingTask {
  title?: string | null;
  start_time?: string | null;
  category?: string | null;
  status?: string | null;
}

export interface BriefingInput {
  callName: string;
  /** The stored call context. May contain [WINDOW:x] markers and BRANCH directives. */
  context?: string | null;
  tasks?: BriefingTask[];
  /**
   * The rest of TODAY, outside this window. The stored prompts ask for it explicitly —
   * Morning Kickstart's own BRANCH 1 reads "List morning tasks for this time window / List all
   * remaining tasks for the rest of the day" — and the renderer only ever did the first half.
   *
   * That omission is not cosmetic. The morning window is 06:00-09:00 ET and the owner's tasks
   * begin at 09:00, so a window-only briefing is EMPTY BY CONSTRUCTION for the 8am email
   * (measured 2026-09-14 against his real board: 0 of 9 tasks in-window, all 9 later that day).
   * Reporting "Nothing is scheduled" to someone with nine tasks is technically true and useless.
   */
  restOfDay?: BriefingTask[];
  timezone?: string;
}

/**
 * Strip the parts of a stored context that only make sense to a voice agent.
 *
 * Removed: the `[WINDOW:x]` routing marker, `BRANCH n (...)` headers, and the dash-prefixed stage
 * directions beneath them (`- Greet: "Hello Sir."`, `- List morning tasks...`, `- If confirm: ...`).
 *
 * KEPT: any free prose the user typed themselves. That is the whole point — a custom call whose
 * context reads "make sure teeth were brushed, Madison is ready" is a genuine instruction to the
 * reader and must survive. Only the SCRIPT scaffolding goes.
 *
 * Returns '' when nothing human-readable remains, so callers can omit the section entirely rather
 * than print an empty heading.
 */
export function stripVoiceScript(context?: string | null): string {
  if (!context) return '';
  const lines = String(context).split('\n');
  const kept: string[] = [];
  let inBranch = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (kept.length && kept[kept.length - 1] !== '') kept.push(''); continue; }

    // BRANCH headers open a block of directions; everything dash-prefixed under one is script.
    if (/^BRANCH\s+\d+/i.test(line)) { inBranch = true; continue; }
    if (inBranch && line.startsWith('-')) continue;
    // A non-dash line ends the branch block (but is itself judged on its own merits below).
    if (inBranch && !line.startsWith('-')) inBranch = false;

    // Routing marker: drop the marker, keep anything else on the line.
    const withoutMarker = line.replace(/\[WINDOW:\w+\]/gi, '').trim();
    if (!withoutMarker) continue;

    // Directions that appear OUTSIDE a branch block, e.g. a bare '- Greet: "Hello Sir."'
    if (/^-\s*(greet|say|ask|list|if\s|capture|transition)\b/i.test(withoutMarker)) continue;

    kept.push(withoutMarker);
  }

  // DROP AN ORPHANED HEADING. A line like `WRAP-UP FLOW:` is not itself a direction, so it
  // survives the filters above — but every `- Ask: ...` beneath it is stripped by the
  // outside-a-branch rule, leaving a heading introducing nothing. Measured 2026-09-14: the real
  // Daily Wrap-up body read "End of day wrap-up call.\n\nWRAP-UP FLOW:\n\nOn your schedule (1):",
  // where the heading appears to introduce the task list it has no relationship to — worse than
  // noise, because it misattributes.
  //
  // A heading is dropped only when NOTHING substantive follows it: the next kept line is absent,
  // blank, or itself another heading. A heading with real content under it is untouched.
  const isHeading = (s: string) => /:$/.test(s) && !/\s-\s/.test(s);
  const pruned = kept.filter((line, i) => {
    if (!isHeading(line)) return true;
    for (let j = i + 1; j < kept.length; j++) {
      if (kept[j] === '') continue;
      return !isHeading(kept[j]);
    }
    return false; // nothing at all follows it
  });

  return pruned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function formatTime(iso?: string | null, timezone = 'America/New_York'): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: timezone,
  });
}

/**
 * Render the body a person receives.
 *
 * Structure is deliberately plain text: it renders identically in an inbox and in Slack, and the
 * delivery path carries no content-type negotiation, so HTML would arrive as visible markup in one
 * of the two.
 *
 * A call with NO tasks says so explicitly. Silence would be indistinguishable from a broken
 * briefing, which is the failure mode this whole area has been suffering from.
 */
export function renderBriefingBody(input: BriefingInput): string {
  const tz = input.timezone || 'America/New_York';
  const name = (input.callName || 'check-in').trim();
  const open = `Time for your ${name.toLowerCase()}.`;

  const open_tasks = (input.tasks ?? []).filter(
    (t) => String(t?.status ?? '').toUpperCase() !== 'DONE',
  );

  const parts: string[] = [open];

  const guidance = stripVoiceScript(input.context);
  if (guidance) parts.push('', guidance);

  if (open_tasks.length > 0) {
    parts.push('', `On your schedule (${open_tasks.length}):`);
    for (const t of open_tasks) {
      const time = formatTime(t.start_time, tz);
      const title = String(t.title ?? '').trim() || '(untitled)';
      parts.push(time ? `  ${time} — ${title}` : `  ${title}`);
    }
  } else {
    parts.push('', 'Nothing is scheduled for this window.');
  }

  const later = (input.restOfDay ?? []).filter(
    (t) => String(t?.status ?? '').toUpperCase() !== 'DONE',
  );
  if (later.length > 0) {
    parts.push('', `Later today (${later.length}):`);
    for (const t of later) {
      const time = formatTime(t.start_time, tz);
      const title = String(t.title ?? '').trim() || '(untitled)';
      parts.push(time ? `  ${time} — ${title}` : `  ${title}`);
    }
  }

  return parts.join('\n').trim();
}
