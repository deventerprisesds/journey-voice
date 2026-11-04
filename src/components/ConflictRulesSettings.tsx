// WHAT:       Settings editor for owner-defined CONFLICT RULES: "when tasks compete for the same time, these
//             win". Each rule = what it matches (coursework / a category / a tag) + a weight. Higher wins.
// WHY:        Owner 2026-11-04: weights must be data the owner sets, used only when tasks conflict, never a
//             hard-coded education-vs-ventures rule. Backend contract: supabase/functions/_shared/conflict-rules.ts.
// SUPERSEDES: nothing (categoryWeights stays until the owner sets it to 0).  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   supabase/functions/_shared/conflict-rules.test.ts
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Scale, Plus, X } from 'lucide-react';
import type { ConflictRule } from '@/config/schedulingRules';

interface Props {
  rules: ConflictRule[];
  categories: string[];
  onChange: (rules: ConflictRule[]) => void;
}

const newId = () => `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const ConflictRulesSettings: React.FC<Props> = ({ rules, categories, onChange }) => {
  const update = (i: number, patch: Partial<ConflictRule>) =>
    onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          <CardTitle>When tasks compete for the same time</CardTitle>
        </div>
        <CardDescription>
          The nightly scheduler uses these only when two tasks want the same slot. Higher weight wins. With no
          rules, nothing changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 && <p className="text-sm text-muted-foreground">No rules yet.</p>}
        {rules.map((r, i) => (
          <div key={r.id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_6rem_auto] gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Applies to</Label>
              <Select
                value={r.match.kind}
                onValueChange={(kind) =>
                  update(i, {
                    match: kind === 'coursework'
                      ? { kind: 'coursework' }
                      : { kind: kind as 'category' | 'tag', value: kind === 'category' ? (categories[0] ?? '') : '' },
                  })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="coursework">Coursework (Nexus assignments, readings and their sessions)</SelectItem>
                  <SelectItem value="category">A category</SelectItem>
                  <SelectItem value="tag">A tag</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              {r.match.kind === 'category' && (
                <>
                  <Label className="text-xs">Category</Label>
                  <Select value={r.match.value} onValueChange={(value) => update(i, { match: { kind: 'category', value } })}>
                    <SelectTrigger><SelectValue placeholder="Pick a category" /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              )}
              {r.match.kind === 'tag' && (
                <>
                  <Label className="text-xs">Tag</Label>
                  <Input value={r.match.value} placeholder="e.g. client-deadline"
                    onChange={(e) => update(i, { match: { kind: 'tag', value: e.target.value } })} />
                </>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Weight</Label>
              <Input type="number" min={0} max={100} value={r.weight}
                onChange={(e) => update(i, { weight: Math.max(0, parseInt(e.target.value) || 0) })} />
            </div>
            <Button variant="ghost" size="icon" aria-label="Remove rule" onClick={() => onChange(rules.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm"
          onClick={() => onChange([...rules, { id: newId(), match: { kind: 'coursework' }, weight: 10 }])}>
          <Plus className="h-4 w-4 mr-1" /> Add rule
        </Button>
      </CardContent>
    </Card>
  );
};

export default ConflictRulesSettings;
