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
   * The calendar for the next 7 days AFTER today (owner, 2026-10-15: "then the next 7 days
   * following (as available)"). Same undefined/[] contract. `upcomingLabel` comes from `nextDays`.
   */
  upcomingMeetings?: BriefingMeeting[];
  upcomingLabel?: string;
  /**
   * EVERY task scheduled today / in the next 7 days (owner, 2026-10-15: "Where are the tasks
   * scheduled for that day? they are missing from that day forward"). When the caller passes these,
   * the body renders three timelines -- THIS WINDOW, REST OF TODAY, NEXT 7 DAYS -- each listing its
   * tasks and then its meetings under their own heading (never interleaved, so meetings are not lost
   * among tasks). The old `tasks` list (call-window only) is then not shown.
   */
  todayTasks?: BriefingTask[];
  upcomingTasks?: BriefingTask[];
  /**
   * This call's own time window in LOCAL hours, e.g. morning = { name:'morning', start:6, end:9 }.
   * Today's items starting inside it are listed first ("the window"); everything else today is
   * "Rest of today". Omitted (a custom call with no [WINDOW:x]) -> today is one "Today" list.
   */
  window?: { name: string; start: number; end: number } | null;
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
 * The local dates of the "next 7 days" section, as YYYY-MM-DD (inclusive): tomorrow through
 * today+7. Pure date math on the local calendar date, so it cannot drift with DST.
 */
export function nextDays(todayLocal: string, count = 7): { start: string; end: string; label: string } {
  const base = new Date(`${todayLocal}T12:00:00Z`);
  const add = (n: number) => new Date(base.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return { start: add(1), end: add(count), label: `Next ${count} days` };
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

  // ---- Timelines: THIS WINDOW, REST OF TODAY, NEXT 7 DAYS (used whenever the caller passes tasks) ----
  if (input.todayTasks !== undefined || input.upcomingTasks !== undefined) {
    type Item = { at: number; allDay: boolean; line: string; kind: 'meeting' | 'task' };
    const items = (ms: BriefingMeeting[] | undefined, ts: BriefingTask[] | undefined): Item[] => {
      const out: Item[] = [];
      for (const m of real(ms ?? [])) {
        out.push({ at: new Date(m.start_time ?? 0).getTime() || 0, allDay: !!m.is_all_day, line: meetingLine(m), kind: 'meeting' });
      }
      for (const t of ts ?? []) {
        if (String(t?.status ?? '').toUpperCase() === 'DONE') continue;
        const title = String(t?.title ?? '').trim() || '(untitled)';
        const time = formatTime(t?.start_time, tz);
        out.push({ at: new Date(t?.start_time ?? 0).getTime() || 0, allDay: false, line: `${time ? `${time} — ` : ''}${title}`, kind: 'task' });
      }
      // All-day first, then by start time.
      return out.sort((a, b) => (a.allDay === b.allDay ? a.at - b.at : a.allDay ? -1 : 1));
    };
    const counts = (list: Item[]) => {
      const m = list.filter((i) => i.kind === 'meeting').length;
      const t = list.length - m;
      return `${m} meeting${m === 1 ? '' : 's'}, ${t} task${t === 1 ? '' : 's'}`;
    };
    // Owner, 2026-10-15: "Meetings should be pulled out separately from the tasks or they will get
    // lost. They can be shown after the tasks for a day but they need their own summary section."
    // So every section lists its tasks, THEN its meetings under their own heading -- never interleaved.
    // A today-section with no meetings says "Meetings: none." so an empty calendar is explicit; a
    // day in the next 7 days omits the empty heading (the day header already carries the counts).
    const block = (indent: string, list: Item[], sayNoMeetings: boolean) => {
      const ts = list.filter((i) => i.kind === 'task');
      const ms = list.filter((i) => i.kind === 'meeting');
      if (ts.length > 0) {
        parts.push(`${indent}Tasks (${ts.length}):`);
        for (const i of ts) parts.push(`${indent}  ${i.line}`);
      }
      if (ms.length > 0) {
        parts.push(`${indent}Meetings (${ms.length}):`);
        for (const i of ms) parts.push(`${indent}  ${i.line}`);
      } else if (sayNoMeetings) {
        parts.push(`${indent}Meetings: none.`);
      }
    };
    const localHour = (at: number) =>
      Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date(at))) % 24;
    const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;

    if (input.meetingsError) {
      parts.push('', 'Your calendar could not be read just now, so meetings may be missing below (tasks are complete).');
    }
    // After a failed read "Meetings: none." would be a false claim; the notice above covers it.
    const sayNone = !input.meetingsError;

    const today = items(input.meetingsError ? [] : input.meetings, input.todayTasks);
    const w = input.window;
    if (w) {
      const inWin = today.filter((i) => !i.allDay && localHour(i.at) >= w.start && localHour(i.at) < w.end);
      const rest = today.filter((i) => !inWin.includes(i));
      const winName = w.name.replace(/_/g, ' ');
      if (inWin.length > 0) {
        parts.push('', `This window — ${winName}, ${hourLabel(w.start)}–${hourLabel(w.end)} (${counts(inWin)}):`);
        block('  ', inWin, sayNone);
      } else {
        parts.push('', `This window — ${winName}, ${hourLabel(w.start)}–${hourLabel(w.end)}: nothing scheduled.`);
      }
      if (rest.length > 0) {
        parts.push('', `Rest of today (${counts(rest)}):`);
        block('  ', rest, sayNone);
      } else {
        parts.push('', 'Rest of today: nothing else scheduled.');
      }
    } else if (today.length > 0) {
      parts.push('', `Today (${counts(today)}):`);
      block('  ', today, sayNone);
    } else {
      parts.push('', 'Nothing on your calendar or task list today.');
    }

    // Next 7 days: grouped under each item's own local day; days with nothing are skipped.
    const label = input.upcomingLabel || 'Next 7 days';
    const upcoming = items(input.meetingsError ? [] : input.upcomingMeetings, input.upcomingTasks);
    if (upcoming.length > 0) {
      parts.push('', `${label} (${counts(upcoming)}):`);
      const byDay = new Map<string, Item[]>();
      for (const i of upcoming) {
        const key = new Date(i.at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz });
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key)!.push(i);
      }
      for (const [day, list] of byDay) {
        parts.push(`  ${day}`);
        block('    ', list, false);
      }
    } else {
      parts.push('', `${label}: nothing scheduled.`);
    }

    return parts.join('\n').trim();
  }

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
    if (input.upcomingMeetings !== undefined) {
      const label = input.upcomingLabel || 'Next 7 days';
      const week = real(input.upcomingMeetings);
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
