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

/** A calendar event as `external_calendar_events` stores it. Only the fields rendered are required. */
export interface BriefingMeeting {
  title?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  is_all_day?: boolean | null;
}

export interface BriefingInput {
  callName: string;
  /** The stored call context. May contain [WINDOW:x] markers and BRANCH directives. */
  context?: string | null;
  tasks?: BriefingTask[];
  /**
   * Today's WHOLE calendar (owner, 2026-10-15: "show meetings for the day"). `undefined` = the
   * caller did not look (section omitted); `[]` = looked and found nothing (said explicitly).
   */
  meetings?: BriefingMeeting[];
  /**
   * The rest of the work week's calendar (owner, 2026-10-15: "and a section for the rest of the
   * work week"). Same undefined/[] contract. `weekLabel` comes from `restOfWorkWeek`.
   */
  weekMeetings?: BriefingMeeting[];
  weekLabel?: string;
  /** The calendar read failed. Said plainly, so a failed read is never mistaken for a free day. */
  meetingsError?: string | null;
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

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The local dates the "rest of the work week" section covers, as YYYY-MM-DD (inclusive).
 * Mon-Thu: tomorrow through Friday. Fri/Sat/Sun: there is no rest of THIS week, so the coming
 * Monday through Friday, labelled as next week. Pure date math on the local calendar date, so it
 * cannot drift with DST.
 */
export function restOfWorkWeek(todayLocal: string): { start: string; end: string; label: string } {
  const base = new Date(`${todayLocal}T12:00:00Z`);
  const dow = base.getUTCDay(); // 0 = Sunday
  const add = (n: number) => {
    const d = new Date(base.getTime() + n * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  if (dow >= 1 && dow <= 4) return { start: add(1), end: add(5 - dow), label: 'Rest of the work week' };
  const toMonday = dow === 5 ? 3 : dow === 6 ? 2 : 1;
  return { start: add(toMonday), end: add(toMonday + 4), label: 'Next work week' };
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

  const meetingLine = (m: BriefingMeeting) => {
    const title = String(m.title ?? '').trim() || '(untitled)';
    const where = m.location && String(m.location).trim() ? ` · ${String(m.location).trim()}` : '';
    let when = 'All day';
    if (!m.is_all_day) {
      const start = formatTime(m.start_time, tz);
      const end = formatTime(m.end_time, tz);
      when = start ? (end ? `${start}–${end}` : start) : 'Time not set';
    }
    return `${when} — ${title}${where}`;
  };
  const real = (list: BriefingMeeting[]) => list.filter((m) => m && (m.title || m.start_time));

  if (input.meetingsError) {
    parts.push('', 'Your calendar could not be read just now, so meetings may be missing from this email.');
  } else {
    if (input.meetings !== undefined) {
      const today = real(input.meetings);
      if (today.length > 0) {
        parts.push('', `Today's meetings (${today.length}):`);
        for (const m of today) parts.push(`  ${meetingLine(m)}`);
      } else {
        parts.push('', 'No meetings on your calendar today.');
      }
    }
    if (input.weekMeetings !== undefined) {
      const label = input.weekLabel || 'Rest of the work week';
      const week = real(input.weekMeetings);
      if (week.length > 0) {
        parts.push('', `${label} (${week.length}):`);
        // Grouped under a local day heading, in calendar order.
        let lastDay = '';
        for (const m of week) {
          const d = m.start_time ? new Date(m.start_time) : null;
          const day = d && !Number.isNaN(d.getTime())
            ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz })
            : 'Date not set';
          if (day !== lastDay) { parts.push(`  ${day}`); lastDay = day; }
          parts.push(`    ${meetingLine(m)}`);
        }
      } else {
        parts.push('', `${label}: no meetings on your calendar.`);
      }
    }
  }

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

  return parts.join('\n').trim();
}
