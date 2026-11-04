// WHAT:       In the task detail view: "Part of 📚 Research Paper" with every work session of that
//             assignment and its time, shown on a session or on an assignment that has sessions.
// WHY:        Owner 2026-11-04 chose ONE assignment with "1 of x" time blocks. Opening any block from
//             Today/calendar must show the whole assignment, not an isolated card. Read-only.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   src/lib/workSessions.ts (parseSessionKey, sessionsOf)
import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { parseSessionKey, sessionsOf } from '@/lib/workSessions';
import { CheckCircle2, Circle } from 'lucide-react';

interface Row { id: string; title: string; assignment_id: string | null; status: string; completed_at: string | null; start_time: string | null; tags: string[] | null }

const fmt = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'not scheduled yet';

const WorkSessionFamily: React.FC<{ task: { id: string; assignment_id?: string | null } }> = ({ task }) => {
  const base = parseSessionKey(task.assignment_id)?.assignmentId ?? task.assignment_id ?? null;
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!base) { setRows(null); return; }
    let live = true;
    supabase
      .from('tasks')
      .select('id, title, assignment_id, status, completed_at, start_time, tags')
      .or(`assignment_id.eq.${base},assignment_id.like.${base}::session-%`)
      .then(({ data }) => { if (live) setRows((data as Row[]) ?? []); });
    return () => { live = false; };
  }, [base]);

  if (!base || !rows) return null;
  const parent = rows.find((r) => r.assignment_id === base);
  const sessions = parent ? sessionsOf(parent, rows) : [];
  if (!parent || !sessions.length) return null;
  const done = sessions.filter((s) => s.status === 'DONE' || s.completed_at).length;

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="text-sm">
        Part of <span className="font-medium">{parent.title}</span> — {done} of {sessions.length} sessions done
      </div>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {sessions.map((s, i) => {
          const isDone = s.status === 'DONE' || !!s.completed_at;
          return (
            <li key={s.id} className={`flex items-center gap-1 ${s.id === task.id ? 'font-medium text-foreground' : ''}`}>
              {isDone ? <CheckCircle2 className="h-3 w-3 text-green-600" /> : <Circle className="h-3 w-3" />}
              <span className={isDone ? 'line-through' : ''}>Session {i + 1} of {sessions.length} — {fmt(s.start_time)}</span>
              {s.id === task.id && <span>(this one)</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default WorkSessionFamily;
