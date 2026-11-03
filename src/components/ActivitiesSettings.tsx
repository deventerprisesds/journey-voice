// WHAT:       Settings card for ACTIVITIES — lunch, gym, church, haircut, standup, 1:1s: reserved time
//             that is never a task. Edits config.activities; the page's Save writes it.
// WHY:        Owner, 2026-10-29: activities like church, gym, haircut and lunch must get "the same
//             treatment instead of [being] treated like a regular task". Agents add them by voice
//             (add_activity); this is where they are seen and changed.
// SUPERSEDES: nothing.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   supabase/functions/_shared/activities.ts (contract), src/utils/activities.test.ts.

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dumbbell, Lock, Plus, X } from 'lucide-react';
import {
  resolveActivities,
  normalizeActivity,
  type Activity,
} from '../../supabase/functions/_shared/activities.ts';
import type { SchedulingConfig } from '@/config/schedulingRules';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WINDOWS = ['morning', 'business_hours', 'after_work', 'evening', 'weekends'];

interface Props {
  config: SchedulingConfig;
  onChange: (activities: Activity[]) => void;
}

export const ActivitiesSettings: React.FC<Props> = ({ config, onChange }) => {
  // Never-saved shows the seed (lunch + gym); the first edit saves it as the owner's own list.
  const activities = resolveActivities(config);
  const seeded = !Array.isArray(config.activities);

  const patch = (id: string, change: Partial<Activity>) =>
    onChange(activities.map((a) => (a.id === id ? { ...a, ...change } : a)));

  const add = () => {
    const { activity } = normalizeActivity({
      name: 'New activity', kind: 'recurring', mode: 'locked', start: '09:00', duration_min: 30, days: [1, 2, 3, 4, 5],
    });
    if (activity) onChange([...activities, activity]);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Dumbbell className="h-5 w-5" />
          <CardTitle>Activities</CardTitle>
        </div>
        <CardDescription>
          Things you do rather than tasks you finish — lunch, gym, church, a haircut, standup, 1:1s. Their time is
          reserved and tasks are scheduled around them; they never appear on your task board. You can also tell
          Iris or any agent ("church Sundays at 10", "I'm headed to the gym").
          {seeded && ' Showing the starting set — your first change saves it as your own.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {activities.length === 0 && (
          <p className="text-sm text-muted-foreground">No activities — every free minute is available for tasks.</p>
        )}
        {activities.map((a) => (
          <div key={a.id} className="space-y-3 p-4 border rounded-lg">
            <div className="flex items-center gap-2">
              <Input
                aria-label="Activity name"
                value={a.name}
                onChange={(e) => patch(a.id, { name: e.target.value })}
                className="font-medium"
              />
              <div className="flex items-center gap-1 text-sm whitespace-nowrap">
                <Checkbox
                  id={`${a.id}-enabled`}
                  checked={a.enabled !== false}
                  onCheckedChange={(v) => patch(a.id, { enabled: v === true })}
                />
                <Label htmlFor={`${a.id}-enabled`} className="text-sm">On</Label>
              </div>
              <Button
                type="button" size="icon" variant="ghost" aria-label={`Remove ${a.name}`}
                onClick={() => onChange(activities.filter((x) => x.id !== a.id))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-sm">Repeats</Label>
                <Select
                  value={a.kind}
                  onValueChange={(v) => patch(a.id, {
                    kind: v as Activity['kind'],
                    start: v === 'on_demand' ? undefined : a.start || '09:00',
                    days: v === 'recurring' ? (a.days?.length ? a.days : [1, 2, 3, 4, 5]) : a.days,
                    date: v === 'one_off' ? a.date || new Date().toISOString().slice(0, 10) : a.date,
                    pushesSchedule: v === 'on_demand' ? a.pushesSchedule : undefined,
                  })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recurring">Every week</SelectItem>
                    <SelectItem value="one_off">Once</SelectItem>
                    <SelectItem value="on_demand">When I start it</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {a.kind !== 'on_demand' && (
                <div className="space-y-1">
                  <Label className="text-sm flex items-center gap-1">
                    {a.mode === 'locked' && <Lock className="h-3 w-3" />} Time
                  </Label>
                  <Select value={a.mode} onValueChange={(v) => patch(a.id, {
                    mode: v as Activity['mode'],
                    earliest: v === 'floating' ? a.earliest || a.start : undefined,
                    latest: v === 'floating' ? a.latest : undefined,
                  })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="locked">Locked time</SelectItem>
                      <SelectItem value="floating">Flexible within a range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-sm">Minutes</Label>
                <Input
                  type="number" min={5} max={720} value={a.durationMin}
                  onChange={(e) => patch(a.id, { durationMin: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>

            {a.kind !== 'on_demand' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-sm">{a.mode === 'floating' ? 'Preferred start' : 'Start'}</Label>
                  <Input type="time" value={a.start || ''} onChange={(e) => patch(a.id, { start: e.target.value })} />
                </div>
                {a.mode === 'floating' && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-sm">Earliest start</Label>
                      <Input type="time" value={a.earliest || ''} onChange={(e) => patch(a.id, { earliest: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-sm">Done by</Label>
                      <Input type="time" value={a.latest || ''} onChange={(e) => patch(a.id, { latest: e.target.value })} />
                    </div>
                  </>
                )}
              </div>
            )}

            {a.kind === 'recurring' && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day, i) => (
                    <Button
                      key={day} type="button" size="sm"
                      variant={a.days?.includes(i) ? 'default' : 'outline'}
                      onClick={() => {
                        const days = a.days?.includes(i) ? a.days.filter((d) => d !== i) : [...(a.days || []), i].sort();
                        patch(a.id, { days });
                      }}
                    >
                      {day}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Label className="text-sm">Every</Label>
                  <Input
                    type="number" min={1} max={8} className="w-20" value={a.everyNWeeks || 1}
                    onChange={(e) => {
                      const n = Math.max(1, parseInt(e.target.value) || 1);
                      patch(a.id, {
                        everyNWeeks: n > 1 ? n : undefined,
                        anchorDate: n > 1 ? a.anchorDate || new Date().toISOString().slice(0, 10) : undefined,
                      });
                    }}
                  />
                  <span>week(s)</span>
                  {(a.everyNWeeks || 1) > 1 && (
                    <>
                      <Label className="text-sm">starting</Label>
                      <Input type="date" className="w-40" value={a.anchorDate || ''}
                        onChange={(e) => patch(a.id, { anchorDate: e.target.value })} />
                    </>
                  )}
                </div>
              </div>
            )}

            {a.kind === 'one_off' && (
              <div className="space-y-1">
                <Label className="text-sm">Date</Label>
                <Input type="date" className="w-44" value={a.date || ''} onChange={(e) => patch(a.id, { date: e.target.value })} />
              </div>
            )}

            {a.kind === 'on_demand' && (
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id={`${a.id}-push`}
                  checked={!!a.pushesSchedule}
                  onCheckedChange={(v) => patch(a.id, { pushesSchedule: v === true })}
                />
                <Label htmlFor={`${a.id}-push`} className="text-sm">
                  When I start it, push the rest of my day later (meetings and locked activities stay put)
                </Label>
              </div>
            )}

            <div className="flex items-center gap-2 text-sm">
              <Label className="text-sm whitespace-nowrap">Inside window</Label>
              <Select value={a.parentWindow || 'none'} onValueChange={(v) => patch(a.id, { parentWindow: v === 'none' ? undefined : v })}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any</SelectItem>
                  {WINDOWS.map((w) => <SelectItem key={w} value={w}>{w.replace('_', ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={add}>
          <Plus className="h-4 w-4 mr-1" /> Add activity
        </Button>
      </CardContent>
    </Card>
  );
};

export default ActivitiesSettings;
