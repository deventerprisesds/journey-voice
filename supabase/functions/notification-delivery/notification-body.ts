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

/** One rendered line of a briefing: a time (or "All day"), a title and an optional place. */
export interface BriefingRow { when: string | null; title: string; where?: string | null }

/** A day's (or a section's) tasks, then its meetings -- never interleaved (owner, 2026-10-15). */
export interface BriefingGroup {
  day?: string;
  tasks: BriefingRow[];
  meetings: BriefingRow[];
  /** Say "Meetings: none." when this group has no meetings (today-sections, calendar read OK). */
  sayNoMeetings: boolean;
}

export interface BriefingSection {
  /** e.g. "This window — morning, 6 AM–9 AM", "Rest of today", "Next 7 days". '' = a bare line. */
  title: string;
  /** "2 meetings, 11 tasks" -- present when the section has items. */
  counts?: string;
  /** Present INSTEAD of groups when the section is empty, e.g. "nothing scheduled." */
  empty?: string;
  groups: BriefingGroup[];
  /** Totals, for the HTML summary strip. */
  meetingCount: number;
  taskCount: number;
}

export interface BriefingTimeline {
  /** Set when the calendar read failed: meetings may be missing; tasks are complete. */
  notice?: string;
  sections: BriefingSection[];
}

function rowText(r: BriefingRow): string {
  return `${r.when ? `${r.when} — ` : ''}${r.title}${r.where ? ` · ${r.where}` : ''}`;
}

function meetingRow(m: BriefingMeeting, tz: string): BriefingRow {
  const title = String(m.title ?? '').trim() || '(untitled)';
  const where = m.location && String(m.location).trim() ? String(m.location).trim() : null;
  let when = 'All day';
  if (!m.is_all_day) {
    const start = formatTime(m.start_time, tz);
    const end = formatTime(m.end_time, tz);
    when = start ? (end ? `${start}–${end}` : start) : 'Time not set';
  }
  return { when, title, where };
}

/**
 * The structured schedule both renderers draw from: THIS WINDOW, REST OF TODAY (or one TODAY list
 * when the call has no window) and NEXT 7 DAYS grouped by local day. Returns null when the caller
 * passed no day/week tasks -- the legacy meetings-only body is used then.
 */
export function buildTimeline(input: BriefingInput): BriefingTimeline | null {
  if (input.todayTasks === undefined && input.upcomingTasks === undefined) return null;
  const tz = input.timezone || 'America/New_York';
  type Item = { at: number; allDay: boolean; row: BriefingRow; kind: 'meeting' | 'task' };
  const real = (list: BriefingMeeting[]) => list.filter((m) => m && (m.title || m.start_time));
  const items = (ms: BriefingMeeting[] | undefined, ts: BriefingTask[] | undefined): Item[] => {
    const out: Item[] = [];
    for (const m of real(ms ?? [])) {
      out.push({ at: new Date(m.start_time ?? 0).getTime() || 0, allDay: !!m.is_all_day, row: meetingRow(m, tz), kind: 'meeting' });
    }
    for (const t of ts ?? []) {
      if (String(t?.status ?? '').toUpperCase() === 'DONE') continue;
      const title = String(t?.title ?? '').trim() || '(untitled)';
      out.push({ at: new Date(t?.start_time ?? 0).getTime() || 0, allDay: false, row: { when: formatTime(t?.start_time, tz), title }, kind: 'task' });
    }
    // All-day first, then by start time.
    return out.sort((a, b) => (a.allDay === b.allDay ? a.at - b.at : a.allDay ? -1 : 1));
  };
  const tally = (list: Item[]) => {
    const meetingCount = list.filter((i) => i.kind === 'meeting').length;
    const taskCount = list.length - meetingCount;
    return {
      meetingCount, taskCount,
      counts: `${meetingCount} meeting${meetingCount === 1 ? '' : 's'}, ${taskCount} task${taskCount === 1 ? '' : 's'}`,
    };
  };
  // Owner, 2026-10-15: "Meetings should be pulled out separately from the tasks or they will get
  // lost. They can be shown after the tasks for a day but they need their own summary section."
  const group = (list: Item[], sayNoMeetings: boolean, day?: string): BriefingGroup => ({
    day,
    tasks: list.filter((i) => i.kind === 'task').map((i) => i.row),
    meetings: list.filter((i) => i.kind === 'meeting').map((i) => i.row),
    sayNoMeetings,
  });
  const localHour = (at: number) =>
    Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date(at))) % 24;
  const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
  // After a failed read "Meetings: none." would be a false claim; the notice covers it.
  const sayNone = !input.meetingsError;
  const sections: BriefingSection[] = [];
  const full = (title: string, list: Item[], groups: BriefingGroup[]): BriefingSection =>
    ({ title, ...tally(list), groups });
  const emptySec = (title: string, empty: string): BriefingSection =>
    ({ title, empty, groups: [], meetingCount: 0, taskCount: 0 });

  const today = items(input.meetingsError ? [] : input.meetings, input.todayTasks);
  const w = input.window;
  if (w) {
    const inWin = today.filter((i) => !i.allDay && localHour(i.at) >= w.start && localHour(i.at) < w.end);
    const rest = today.filter((i) => !inWin.includes(i));
    const winTitle = `This window — ${w.name.replace(/_/g, ' ')}, ${hourLabel(w.start)}–${hourLabel(w.end)}`;
    sections.push(inWin.length > 0 ? full(winTitle, inWin, [group(inWin, sayNone)]) : emptySec(winTitle, 'nothing scheduled.'));
    sections.push(rest.length > 0 ? full('Rest of today', rest, [group(rest, sayNone)]) : emptySec('Rest of today', 'nothing else scheduled.'));
  } else if (today.length > 0) {
    sections.push(full('Today', today, [group(today, sayNone)]));
  } else {
    sections.push(emptySec('', 'Nothing on your calendar or task list today.'));
  }

  // Next 7 days: grouped under each item's own local day; days with nothing are skipped.
  const label = input.upcomingLabel || 'Next 7 days';
  const upcoming = items(input.meetingsError ? [] : input.upcomingMeetings, input.upcomingTasks);
  if (upcoming.length > 0) {
    const byDay = new Map<string, Item[]>();
    for (const i of upcoming) {
      const key = new Date(i.at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz });
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(i);
    }
    sections.push(full(label, upcoming, [...byDay].map(([day, list]) => group(list, false, day))));
  } else {
    sections.push(emptySec(label, 'nothing scheduled.'));
  }

  return {
    notice: input.meetingsError
      ? 'Your calendar could not be read just now, so meetings may be missing below (tasks are complete).'
      : undefined,
    sections,
  };
}

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The same briefing as a clean HTML email (owner, 2026-10-15: "It should be a rich clean email
 * format"). Email-client-safe: table layout and INLINE styles only (Outlook strips <style> blocks
 * and ignores flex/grid). Every value is HTML-escaped -- task titles are user text.
 *
 * Returns null when there is no timeline to render (legacy meetings-only callers), in which case
 * the caller sends the plain-text body alone.
 */
export function renderBriefingHtml(input: BriefingInput & { dateLabel?: string }): string | null {
  const model = buildTimeline(input);
  if (!model) return null;
  const name = (input.callName || 'Check-in').trim();
  const guidance = stripVoiceScript(input.context);
  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

  const rowsTable = (rows: BriefingRow[]) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
    rows.map((r) =>
      `<tr><td valign="top" style="${font}width:124px;padding:5px 12px 5px 0;font-size:13px;color:#5b6675;white-space:nowrap;">${esc(r.when ?? '')}</td>` +
      `<td valign="top" style="${font}padding:5px 0;font-size:14px;color:#1f2933;line-height:1.4;">${esc(r.title)}` +
      `${r.where ? `<span style="color:#7b8794;"> &middot; ${esc(r.where)}</span>` : ''}</td></tr>`,
    ).join('') + `</table>`;

  const label = (text: string, color: string) =>
    `<div style="${font}font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color};margin:10px 0 2px;">${esc(text)}</div>`;

  const groupHtml = (g: BriefingGroup) => {
    let h = '';
    if (g.day) h += `<div style="${font}font-size:15px;font-weight:600;color:#1f2933;margin:16px 0 0;padding-top:12px;border-top:1px solid #edf0f3;">${esc(g.day)}</div>`;
    if (g.tasks.length) h += label(`Tasks (${g.tasks.length})`, '#5b6675') + rowsTable(g.tasks);
    if (g.meetings.length) {
      h += `<div style="background:#eef4ff;border-left:3px solid #3b6fd8;border-radius:6px;padding:4px 12px 8px;margin:10px 0 4px;">` +
        label(`Meetings (${g.meetings.length})`, '#2f5bb7') + rowsTable(g.meetings) + `</div>`;
    } else if (g.sayNoMeetings) {
      h += `<div style="${font}font-size:13px;color:#7b8794;margin:10px 0 0;">Meetings: none.</div>`;
    }
    return h;
  };

  const sectionHtml = (sec: BriefingSection) => {
    if (sec.empty !== undefined) {
      return `<tr><td style="${font}padding:14px 28px;font-size:14px;color:#5b6675;">` +
        (sec.title ? `<strong style="color:#1f2933;">${esc(sec.title)}</strong> &mdash; ` : '') + `${esc(sec.empty)}</td></tr>`;
    }
    return `<tr><td style="padding:18px 28px 6px;">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
      `<td style="${font}font-size:17px;font-weight:700;color:#1e3a5f;">${esc(sec.title)}</td>` +
      `<td align="right" style="${font}font-size:12px;color:#7b8794;white-space:nowrap;">${esc(sec.counts ?? '')}</td>` +
      `</tr></table>` + sec.groups.map(groupHtml).join('') + `</td></tr>`;
  };

  // Summary strip: today vs the coming week, meetings called out first so they are never lost.
  const todaySecs = model.sections.slice(0, -1);
  const week = model.sections[model.sections.length - 1];
  const sum = (secs: BriefingSection[], k: 'meetingCount' | 'taskCount') => secs.reduce((n, s) => n + s[k], 0);
  const chip = (big: number, small: string) =>
    `<td style="${font}padding:10px 14px;background:#f6f8fa;border-radius:8px;text-align:center;">` +
    `<div style="font-size:20px;font-weight:700;color:#1e3a5f;">${big}</div>` +
    `<div style="font-size:11px;color:#5b6675;text-transform:uppercase;letter-spacing:.06em;">${esc(small)}</div></td>`;
  const gap = `<td style="width:8px;"></td>`;
  const summary =
    `<tr><td style="padding:18px 28px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
    chip(sum(todaySecs, 'meetingCount'), 'Meetings today') + gap +
    chip(sum(todaySecs, 'taskCount'), 'Tasks today') + gap +
    chip(week.meetingCount, 'Meetings next 7 days') +
    `</tr></table></td></tr>`;

  const notice = model.notice
    ? `<tr><td style="padding:12px 28px 0;"><div style="${font}background:#fff7e6;border-left:3px solid #d99a00;border-radius:6px;padding:10px 12px;font-size:13px;color:#6b4e00;">${esc(model.notice)}</div></td></tr>`
    : '';
  const guide = guidance
    ? `<tr><td style="${font}padding:14px 28px 0;font-size:14px;color:#3e4c59;line-height:1.5;">${esc(guidance).replace(/\n/g, '<br>')}</td></tr>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f0f2f5;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">` +
    `<tr><td style="${font}background:#1e3a5f;padding:22px 28px;color:#ffffff;">` +
    (input.dateLabel ? `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#c9d6e8;">${esc(input.dateLabel)}</div>` : '') +
    `<div style="font-size:22px;font-weight:700;margin-top:4px;">${esc(name)}</div></td></tr>` +
    summary + notice + guide +
    model.sections.map(sectionHtml).join('') +
    `<tr><td style="${font}padding:18px 28px 22px;font-size:12px;color:#9aa5b1;border-top:1px solid #edf0f3;">Sent by TaskOS</td></tr>` +
    `</table></td></tr></table></body></html>`;
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
  // The text below and renderBriefingHtml are BOTH drawn from buildTimeline, so the plain-text and
  // HTML emails cannot disagree about what is on the schedule.
  const model = buildTimeline(input);
  if (model) {
    if (model.notice) parts.push('', model.notice);
    for (const sec of model.sections) {
      if (sec.empty !== undefined) {
        parts.push('', sec.title ? `${sec.title}: ${sec.empty}` : sec.empty);
        continue;
      }
      parts.push('', `${sec.title} (${sec.counts}):`);
      for (const g of sec.groups) {
        const ind = g.day ? '    ' : '  ';
        if (g.day) parts.push(`  ${g.day}`);
        if (g.tasks.length > 0) {
          parts.push(`${ind}Tasks (${g.tasks.length}):`);
          for (const r of g.tasks) parts.push(`${ind}  ${rowText(r)}`);
        }
        if (g.meetings.length > 0) {
          parts.push(`${ind}Meetings (${g.meetings.length}):`);
          for (const r of g.meetings) parts.push(`${ind}  ${rowText(r)}`);
        } else if (g.sayNoMeetings) {
          parts.push(`${ind}Meetings: none.`);
        }
      }
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
