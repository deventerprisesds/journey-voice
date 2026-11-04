// WHAT:       The "2 of 4 sessions done · next Wed 7:00 pm" line on an assignment card, with the sessions
//             listed underneath on tap. Rendered by TaskCard only when the list was grouped
//             (src/lib/workSessions.ts groupWorkSessions), i.e. Kanban and Grid with display 'grouped'.
// WHY:        Owner 2026-11-04: one assignment with its "1 of x" time blocks, not a card per block.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   src/lib/workSessions.test.ts
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Circle } from 'lucide-react';
import type { WorkSessionSummary as Summary } from '@/lib/workSessions';

const fmt = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'not scheduled yet';

interface Props {
  summary: Summary<any>;
  onOpenSession?: (task: any) => void;
}

const WorkSessionSummary: React.FC<Props> = ({ summary, onOpenSession }) => {
  const [open, setOpen] = useState(false);
  const { total, done, next, sessions } = summary;
  return (
    <div className="mt-1 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="flex items-center gap-1 hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>
          {done} of {total} sessions done
          {next ? ` · next ${fmt(next.start_time)}` : done < total ? ' · next not scheduled yet' : ''}
        </span>
      </button>
      {open && (
        <ul className="mt-1 ml-4 space-y-0.5">
          {sessions.map((s, i) => {
            const isDone = s.status === 'DONE' || !!s.completed_at;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="flex items-center gap-1 hover:text-foreground text-left"
                  onClick={() => onOpenSession?.(s)}
                >
                  {isDone ? <CheckCircle2 className="h-3 w-3 text-green-600" /> : <Circle className="h-3 w-3" />}
                  <span className={isDone ? 'line-through' : ''}>
                    Session {i + 1} of {total} — {fmt(s.start_time)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default WorkSessionSummary;
