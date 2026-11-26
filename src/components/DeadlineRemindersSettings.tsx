// WHAT:       Settings card for DEADLINE REMINDERS -- weekly must-dos (the time card) that nag every hour by
//             full-screen phone alarm, email and TaskOS chat from the start time until the deadline or Done.
//             Edits config.deadlineReminders; the page's Save writes it (only when this card was edited).
// WHY:        Owner 2026-11-22 / 2026-11-26: "an actual feature I can edit, turn on and off, add a similar
//             item". Its OWN card beside Activities: a deadline reminder is a nag, not reserved time.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   src/utils/deadlineReminders.ts (+ .test.ts); supabase/functions/_shared/deadline-reminders.ts.

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bell, Plus, X } from 'lucide-react';
import {
  addDeadlineReminder,
  deadlineRemindersFor,
  deadlineWeekday,
  isSeededList,
  patchDeadlineReminder,
  removeDeadlineReminder,
  withDeadlineWeekday,
  type DeadlineReminder,
} from '@/utils/deadlineReminders';
import type { SchedulingConfig } from '@/config/schedulingRules';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  config: SchedulingConfig;
  onChange: (items: DeadlineReminder[]) => void;
  /** The field-level error from the last Save attempt, if any. */
  error?: { index: number; field: string; error: string } | null;
}

export const DeadlineRemindersSettings: React.FC<Props> = ({ config, onChange, error }) => {
  const items = deadlineRemindersFor(config);
  const seeded = isSeededList(config);
  const patch = (id: string, change: Partial<DeadlineReminder>) => onChange(patchDeadlineReminder(items, id, change));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          <CardTitle>Deadline reminders</CardTitle>
        </div>
        <CardDescription>
          Things that absolutely must be done by a deadline, every week (your time card). From the start time you get
          a full-screen alarm every hour, plus an email and a chat message if switched on, until the deadline or until
          you tap Done. Quiet hours are respected, and after the first day nothing rings before the "not before" time.
          {seeded && ' Below is a starting example, switched off. It starts reminding you once you switch it on and press Save.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length === 0 && <p className="text-sm text-muted-foreground">No deadline reminders.</p>}
        {items.map((r, i) => (
          <div key={r.id} className="space-y-3 p-4 border rounded-lg" data-testid="deadline-reminder">
            <div className="flex items-center gap-2">
              <Input aria-label="Reminder name" value={r.name} className="font-medium"
                onChange={(e) => patch(r.id, { name: e.target.value })} />
              <div className="flex items-center gap-1 text-sm whitespace-nowrap">
                <Checkbox id={`${r.id}-enabled`} checked={r.enabled !== false}
                  onCheckedChange={(v) => patch(r.id, { enabled: v === true })} />
                <Label htmlFor={`${r.id}-enabled`} className="text-sm">On</Label>
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${r.name}`}
                onClick={() => onChange(removeDeadlineReminder(items, r.id))}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-sm">Starts</Label>
                <Select value={String(r.days?.[0] ?? 5)} onValueChange={(v) => {
                  const day = Number(v);
                  const keepDeadlineDay = deadlineWeekday(r);
                  onChange(patchDeadlineReminder(items, r.id, withDeadlineWeekday({ ...r, days: [day] }, keepDeadlineDay)));
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DAYS.map((d, n) => <SelectItem key={d} value={String(n)}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-sm">at</Label>
                <Input type="time" value={r.start} onChange={(e) => patch(r.id, { start: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Deadline</Label>
                <Select value={String(deadlineWeekday(r))}
                  onValueChange={(v) => onChange(patchDeadlineReminder(items, r.id, withDeadlineWeekday(r, Number(v))))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DAYS.map((d, n) => <SelectItem key={d} value={String(n)}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-sm">by</Label>
                <Input type="time" value={r.deadline} onChange={(e) => patch(r.id, { deadline: e.target.value })} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Label className="text-sm whitespace-nowrap">Every</Label>
                <Input type="number" min={15} max={720} step={15} className="w-20" value={r.intervalMinutes}
                  onChange={(e) => patch(r.id, { intervalMinutes: parseInt(e.target.value) || 60 })} />
                <span>min</span>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm whitespace-nowrap">Not before</Label>
                <Input type="time" className="w-32" value={r.notBefore || ''}
                  onChange={(e) => patch(r.id, { notBefore: e.target.value || undefined })} />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm">Repeat every</Label>
                <Input type="number" min={1} max={8} className="w-16" value={r.everyNWeeks || 1}
                  onChange={(e) => {
                    const n = Math.max(1, parseInt(e.target.value) || 1);
                    patch(r.id, { everyNWeeks: n > 1 ? n : undefined, anchorDate: n > 1 ? r.anchorDate : undefined });
                  }} />
                <span>week(s)</span>
                {(r.everyNWeeks || 1) > 1 && (
                  <>
                    <Label className="text-sm">first on</Label>
                    <Input type="date" className="w-40" value={r.anchorDate || ''}
                      onChange={(e) => patch(r.id, { anchorDate: e.target.value || undefined })} />
                    {!r.anchorDate && <span className="text-muted-foreground">(the next {DAYS[r.days?.[0] ?? 5]} when saved)</span>}
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              {([['respectQuietHours', 'Respect quiet hours'], ['email', 'Email'], ['chat', 'Chat message']] as const).map(([k, label]) => (
                <div key={k} className="flex items-center gap-1">
                  <Checkbox id={`${r.id}-${k}`} checked={r[k] !== false}
                    onCheckedChange={(v) => patch(r.id, { [k]: v === true } as Partial<DeadlineReminder>)} />
                  <Label htmlFor={`${r.id}-${k}`} className="text-sm">{label}</Label>
                </div>
              ))}
            </div>

            {error && error.index === i && (
              <p role="alert" className="text-sm text-destructive">{error.field}: {error.error}</p>
            )}
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => onChange(addDeadlineReminder(items))}>
          <Plus className="h-4 w-4 mr-1" /> Add deadline reminder
        </Button>
      </CardContent>
    </Card>
  );
};

export default DeadlineRemindersSettings;
