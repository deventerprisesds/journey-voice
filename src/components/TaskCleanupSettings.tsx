import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Search, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface DuplicateGroup {
  title: string;
  count: number;
  category: string | null;
  tasks: DuplicateTask[];
}

interface DuplicateTask {
  id: string;
  title: string;
  status: string;
  category: string | null;
  created_at: string;
  start_time: string | null;
  is_scheduled: boolean | null;
}

const TaskCleanupSettings: React.FC = () => {
  const { user } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [keepIds, setKeepIds] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmGroup, setConfirmGroup] = useState<DuplicateGroup | null>(null);
  const [scanned, setScanned] = useState(false);

  const scanForDuplicates = async () => {
    if (!user?.id) return;
    setScanning(true);
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, status, category, created_at, start_time, is_scheduled')
        .eq('user_id', user.id)
        .neq('status', 'DONE');

      if (error) throw error;

      // Group by normalized title
      const titleMap = new Map<string, DuplicateTask[]>();
      for (const task of data || []) {
        const key = task.title.toLowerCase().trim();
        if (!titleMap.has(key)) titleMap.set(key, []);
        titleMap.get(key)!.push(task as DuplicateTask);
      }

      // Filter to groups with duplicates
      const dupGroups: DuplicateGroup[] = [];
      for (const [, tasks] of titleMap) {
        if (tasks.length > 1) {
          // Sort: scheduled first, then by created_at desc
          tasks.sort((a, b) => {
            if (a.is_scheduled && !b.is_scheduled) return -1;
            if (!a.is_scheduled && b.is_scheduled) return 1;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          });
          dupGroups.push({
            title: tasks[0].title,
            count: tasks.length,
            category: tasks[0].category,
            tasks,
          });
        }
      }

      // Sort by count desc
      dupGroups.sort((a, b) => b.count - a.count);
      setGroups(dupGroups);
      setScanned(true);

      // Auto-select first task in each group to keep
      const defaults: Record<string, string> = {};
      for (const g of dupGroups) {
        defaults[g.title] = g.tasks[0].id;
      }
      setKeepIds(defaults);

      if (dupGroups.length === 0) {
        toast.success('No duplicates found!');
      } else {
        toast.info(`Found ${dupGroups.length} duplicate groups (${dupGroups.reduce((s, g) => s + g.count - 1, 0)} extras)`);
      }
    } catch (e: any) {
      console.error('Scan failed:', e);
      toast.error('Failed to scan for duplicates');
    } finally {
      setScanning(false);
    }
  };

  const deleteExtras = async (group: DuplicateGroup) => {
    if (!user?.id) return;
    const keepId = keepIds[group.title];
    if (!keepId) {
      toast.error('Select a task to keep first');
      return;
    }

    const idsToDelete = group.tasks.filter(t => t.id !== keepId).map(t => t.id);
    setDeleting(group.title);
    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .in('id', idsToDelete)
        .eq('user_id', user.id);

      if (error) throw error;

      toast.success(`Deleted ${idsToDelete.length} duplicate(s) of "${group.title}"`);
      // Remove from state
      setGroups(prev => prev.filter(g => g.title !== group.title));
    } catch (e: any) {
      console.error('Delete failed:', e);
      toast.error('Failed to delete duplicates');
    } finally {
      setDeleting(null);
      setConfirmGroup(null);
    }
  };

  const deleteAllExtras = async () => {
    if (!user?.id || groups.length === 0) return;
    setDeleting('__all__');
    let totalDeleted = 0;

    try {
      for (const group of groups) {
        const keepId = keepIds[group.title];
        if (!keepId) continue;
        const idsToDelete = group.tasks.filter(t => t.id !== keepId).map(t => t.id);
        const { error } = await supabase
          .from('tasks')
          .delete()
          .in('id', idsToDelete)
          .eq('user_id', user.id);
        if (error) throw error;
        totalDeleted += idsToDelete.length;
      }
      toast.success(`Deleted ${totalDeleted} duplicate tasks total`);
      setGroups([]);
    } catch (e: any) {
      console.error('Bulk delete failed:', e);
      toast.error('Failed to delete some duplicates');
    } finally {
      setDeleting(null);
    }
  };

  const toggleExpand = (title: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Task Cleanup</span>
            <Button onClick={scanForDuplicates} disabled={scanning} size="sm">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Scan for Duplicates
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!scanned && (
            <p className="text-sm text-muted-foreground">
              Scan your tasks to find and remove duplicate entries that may be causing scheduling issues.
            </p>
          )}

          {scanned && groups.length === 0 && (
            <p className="text-sm text-muted-foreground">✓ No duplicate tasks found.</p>
          )}

          {groups.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {groups.length} group(s) with duplicates. The first entry (scheduled or newest) is auto-selected to keep.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={deleteAllExtras}
                  disabled={deleting !== null}
                >
                  {deleting === '__all__' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                  Delete All Extras ({groups.reduce((s, g) => s + g.count - 1, 0)})
                </Button>
              </div>

              {groups.map((group) => (
                <div key={group.title} className="border border-border rounded-lg">
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => toggleExpand(group.title)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {expanded.has(group.title) ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                      <span className="text-sm font-medium truncate">{group.title}</span>
                      <Badge variant="secondary" className="shrink-0">×{group.count}</Badge>
                      {group.category && <Badge variant="outline" className="shrink-0 text-xs">{group.category}</Badge>}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive shrink-0"
                      onClick={(e) => { e.stopPropagation(); setConfirmGroup(group); }}
                      disabled={deleting === group.title}
                    >
                      {deleting === group.title ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>

                  {expanded.has(group.title) && (
                    <div className="border-t border-border px-3 pb-3 space-y-1">
                      {group.tasks.map((task) => (
                        <label
                          key={task.id}
                          className={`flex items-center gap-3 p-2 rounded cursor-pointer text-sm ${
                            keepIds[group.title] === task.id ? 'bg-primary/10' : 'hover:bg-muted/50'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`keep-${group.title}`}
                            checked={keepIds[group.title] === task.id}
                            onChange={() => setKeepIds(prev => ({ ...prev, [group.title]: task.id }))}
                            className="shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant={task.is_scheduled ? 'default' : 'outline'} className="text-xs">
                                {task.status}
                              </Badge>
                              {task.is_scheduled && <Badge className="text-xs bg-accent text-accent-foreground">Scheduled</Badge>}
                              <span className="text-xs text-muted-foreground">
                                Created {format(new Date(task.created_at), 'MMM d, h:mm a')}
                              </span>
                            </div>
                            {task.start_time && (
                              <span className="text-xs text-muted-foreground">
                                Start: {format(new Date(task.start_time), 'MMM d, h:mm a')}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">{task.id.slice(0, 8)}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmGroup} onOpenChange={() => setConfirmGroup(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Duplicates</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {confirmGroup ? confirmGroup.count - 1 : 0} duplicate(s) of "{confirmGroup?.title}",
              keeping the selected version. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmGroup && deleteExtras(confirmGroup)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Extras
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TaskCleanupSettings;
