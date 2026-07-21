import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { loadUserSchedulingConfig, saveUserSchedulingConfig } from '@/services/schedulingService';
import {
  DEFAULT_CEREMONY_SCHEDULE,
  type CeremonySchedule,
  type CeremonyType,
  type CeremonyRunMode,
} from '@/services/schedulingService';
import { CalendarClock, Users } from 'lucide-react';

const CEREMONY_LABEL: Record<CeremonyType, string> = {
  planning: 'Sprint planning',
  standup: 'Daily stand-up',
  review_retro: 'Review + retro',
};
const CEREMONY_HINT: Record<CeremonyType, string> = {
  planning: 'Commit the sprint per lane.',
  standup: 'Done / next / blockers per lane.',
  review_retro: 'What shipped, then what went well / to improve.',
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CeremonySettings: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schedule, setSchedule] = useState<CeremonySchedule[]>(DEFAULT_CEREMONY_SCHEDULE);

  useEffect(() => {
    if (user?.id) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const cfg = await loadUserSchedulingConfig(user.id);
      setSchedule(cfg.ceremony_schedule?.length ? cfg.ceremony_schedule : DEFAULT_CEREMONY_SCHEDULE);
    } catch (e) {
      console.error('Failed to load ceremony schedule:', e);
      toast({ title: 'Error', description: 'Failed to load ceremony schedule', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const patch = (id: string, changes: Partial<CeremonySchedule>) =>
    setSchedule((s) => s.map((c) => (c.id === id ? { ...c, ...changes } : c)));

  const toggleDay = (c: CeremonySchedule, index: number) => {
    const days = c.daysOfWeek.includes(index)
      ? c.daysOfWeek.filter((d) => d !== index)
      : [...c.daysOfWeek, index].sort((a, b) => a - b);
    patch(c.id, { daysOfWeek: days });
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const ok = await saveUserSchedulingConfig(user.id, { ceremony_schedule: schedule });
      toast(
        ok
          ? { title: 'Saved', description: 'Ceremony schedule updated.' }
          : { title: 'Error', description: 'Failed to save', variant: 'destructive' },
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            <CardTitle>Scrum ceremonies</CardTitle>
          </div>
          <CardDescription>
            Recurring virtual meetings run by your team of agents, grounded in your real tasks. Choose
            the days and time. Leave "auto-run" off to be reminded and run it yourself, or turn it on
            to have the team run it without you and report back — you can review the thread later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {schedule.map((c) => (
            <div key={c.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={c.enabled}
                    onCheckedChange={(v) => patch(c.id, { enabled: !!v })}
                    id={`en-${c.id}`}
                  />
                  <Label htmlFor={`en-${c.id}`} className="font-medium">
                    {CEREMONY_LABEL[c.ceremonyType]}
                  </Label>
                </div>
                <span className="text-xs text-muted-foreground">{CEREMONY_HINT[c.ceremonyType]}</span>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Time</Label>
                  <Input
                    type="time"
                    className="w-32"
                    value={c.time}
                    onChange={(e) => patch(c.id, { time: e.target.value })}
                    disabled={!c.enabled}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Format</Label>
                  <Select
                    value={c.mode}
                    onValueChange={(v) => patch(c.id, { mode: v as CeremonyRunMode })}
                    disabled={!c.enabled}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="round-robin">Round-robin (each agent)</SelectItem>
                      <SelectItem value="narrate">Scrum master narrates</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Checkbox
                    checked={c.autoRun}
                    onCheckedChange={(v) => patch(c.id, { autoRun: !!v })}
                    id={`auto-${c.id}`}
                    disabled={!c.enabled}
                  />
                  <Label htmlFor={`auto-${c.id}`} className="text-xs flex items-center gap-1">
                    <Users className="h-3 w-3" /> Auto-run without me
                  </Label>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Days</Label>
                <div className="flex gap-1.5">
                  {DAYS.map((day, index) => (
                    <Button
                      key={day}
                      type="button"
                      size="sm"
                      variant={c.daysOfWeek.includes(index) ? 'default' : 'outline'}
                      onClick={() => toggleDay(c, index)}
                      disabled={!c.enabled}
                    >
                      {day}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ))}

          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save ceremony schedule'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default CeremonySettings;
