import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface AddTopicGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryKey: string;
  onCreated: () => void;
}

const AddTopicGroupDialog: React.FC<AddTopicGroupDialogProps> = ({
  open,
  onOpenChange,
  categoryKey,
  onCreated,
}) => {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !user) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('task_topic_index').upsert(
        {
          user_id: user.id,
          topic_name: name.trim(),
          topic_summary: `Topic group for ${categoryKey}`,
          window_affinity: [categoryKey],
          category_affinity: categoryKey,
        } as any,
        { onConflict: 'user_id,topic_name' }
      );
      if (error) throw error;
      toast.success(`"${name.trim()}" topic group ready`);
      setName('');
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      const code = err?.code;
      const msg = err?.message || 'Unknown error';
      console.error('[AddTopicGroup] Insert failed:', { code, msg, details: err?.details, hint: err?.hint, full: err });
      if (code === '42501') {
        toast.error(`Permission denied (RLS): ${msg}`);
      } else if (code === '23505') {
        toast.error(`Topic "${name.trim()}" already exists`);
      } else {
        toast.error(`Failed to create topic group: ${msg}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Topic Group</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="topic-name">Name</Label>
            <Input
              id="topic-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Professional Networking"
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddTopicGroupDialog;
