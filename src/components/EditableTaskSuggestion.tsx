import React, { useState } from 'react';
import { Calendar, Clock, Brain, Edit2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface TaskSuggestion {
  title: string;
  description?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION' | 'PROF_EDUCATION';
  estimate_minutes: number;
  scheduledStart: string;
  aiReasoning: string;
}

interface EditableTaskSuggestionProps {
  suggestion: TaskSuggestion;
  onAccept: (editedSuggestion: TaskSuggestion) => void;
  onDismiss: () => void;
  busySlots: Array<{start: string; end: string; title: string; type: string}>;
}

const EditableTaskSuggestion: React.FC<EditableTaskSuggestionProps> = ({
  suggestion,
  onAccept,
  onDismiss,
  busySlots
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedSuggestion, setEditedSuggestion] = useState(suggestion);

  const handleSave = () => {
    onAccept(editedSuggestion);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedSuggestion(suggestion);
    setIsEditing(false);
  };

  const getAlternativeTimeSlots = () => {
    const currentTime = new Date(suggestion.scheduledStart);
    const alternatives = [];
    
    // Generate 3 alternative time slots
    for (let i = 1; i <= 3; i++) {
      const altTime = new Date(currentTime);
      altTime.setHours(altTime.getHours() + i * 2);
      
      // Check if this slot conflicts with busy times
      const hasConflict = busySlots.some(slot => {
        const slotStart = new Date(slot.start);
        const slotEnd = new Date(slot.end);
        const taskEnd = new Date(altTime.getTime() + editedSuggestion.estimate_minutes * 60000);
        
        return (altTime >= slotStart && altTime < slotEnd) ||
               (taskEnd > slotStart && taskEnd <= slotEnd) ||
               (altTime <= slotStart && taskEnd >= slotEnd);
      });
      
      alternatives.push({
        time: altTime,
        isAvailable: !hasConflict,
        conflicts: hasConflict ? busySlots.filter(slot => {
          const slotStart = new Date(slot.start);
          const slotEnd = new Date(slot.end);
          const taskEnd = new Date(altTime.getTime() + editedSuggestion.estimate_minutes * 60000);
          
          return (altTime >= slotStart && altTime < slotEnd) ||
                 (taskEnd > slotStart && taskEnd <= slotEnd) ||
                 (altTime <= slotStart && taskEnd >= slotEnd);
        }) : []
      });
    }
    
    return alternatives;
  };

  const alternatives = getAlternativeTimeSlots();

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="pt-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              <h4 className="font-semibold">AI Scheduling Suggestion</h4>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(!isEditing)}
            >
              <Edit2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Editable Task Details */}
          <div className="space-y-3">
            {isEditing ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Title</label>
                  <Input
                    value={editedSuggestion.title}
                    onChange={(e) => setEditedSuggestion({
                      ...editedSuggestion,
                      title: e.target.value
                    })}
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={editedSuggestion.description || ''}
                    onChange={(e) => setEditedSuggestion({
                      ...editedSuggestion,
                      description: e.target.value
                    })}
                    rows={2}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">Priority</label>
                    <Select
                      value={editedSuggestion.priority}
                      onValueChange={(value: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT') =>
                        setEditedSuggestion({
                          ...editedSuggestion,
                          priority: value
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOW">Low</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="URGENT">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-sm font-medium">Category</label>
                    <Select
                      value={editedSuggestion.category}
                      onValueChange={(value: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION' | 'PROF_EDUCATION') =>
                        setEditedSuggestion({
                          ...editedSuggestion,
                          category: value
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LIFE">Life</SelectItem>
                        <SelectItem value="CAREER">Career</SelectItem>
                        <SelectItem value="VENTURES">Ventures</SelectItem>
                        <SelectItem value="EDUCATION">Education</SelectItem>
                        <SelectItem value="PROF_EDUCATION">Prof. Education</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Duration (minutes)</label>
                  <Input
                    type="number"
                    value={editedSuggestion.estimate_minutes}
                    onChange={(e) => setEditedSuggestion({
                      ...editedSuggestion,
                      estimate_minutes: parseInt(e.target.value) || 60
                    })}
                  />
                </div>
              </div>
            ) : (
              <div>
                <h5 className="font-medium">{editedSuggestion.title}</h5>
                {editedSuggestion.description && (
                  <p className="text-sm text-muted-foreground">
                    {editedSuggestion.description}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Time Slot Selection */}
          <div className="space-y-3">
            <h6 className="font-medium text-sm">Suggested Time Slots</h6>
            
            <div className="space-y-2">
              {/* Primary suggestion */}
              <div 
                className={`p-3 rounded border cursor-pointer transition-colors ${
                  editedSuggestion.scheduledStart === suggestion.scheduledStart
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-accent'
                }`}
                onClick={() => setEditedSuggestion({
                  ...editedSuggestion,
                  scheduledStart: suggestion.scheduledStart
                })}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span className="font-medium">
                      {new Date(suggestion.scheduledStart).toLocaleString()}
                    </span>
                    <Badge variant="outline">Recommended</Badge>
                  </div>
                  <Badge variant="outline">
                    {editedSuggestion.estimate_minutes}m
                  </Badge>
                </div>
              </div>

              {/* Alternative time slots */}
              {alternatives.map((alt, index) => (
                <div
                  key={index}
                  className={`p-3 rounded border cursor-pointer transition-colors ${
                    !alt.isAvailable ? 'opacity-50 cursor-not-allowed' : ''
                  } ${
                    editedSuggestion.scheduledStart === alt.time.toISOString()
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-accent'
                  }`}
                  onClick={() => {
                    if (alt.isAvailable) {
                      setEditedSuggestion({
                        ...editedSuggestion,
                        scheduledStart: alt.time.toISOString()
                      });
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span className={alt.isAvailable ? '' : 'line-through'}>
                        {alt.time.toLocaleString()}
                      </span>
                      {!alt.isAvailable && (
                        <Badge variant="destructive">Conflicts</Badge>
                      )}
                    </div>
                    <Badge variant="outline">
                      {editedSuggestion.estimate_minutes}m
                    </Badge>
                  </div>
                  {!alt.isAvailable && alt.conflicts.length > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Conflicts with: {alt.conflicts.map(c => c.title).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* AI Reasoning */}
          <div className="p-3 bg-accent/30 rounded">
            <p className="text-sm">
              <strong>AI Reasoning:</strong> {editedSuggestion.aiReasoning}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button onClick={handleSave} size="sm">
                  <Check className="h-4 w-4 mr-1" />
                  Save Changes
                </Button>
                <Button onClick={handleCancel} variant="outline" size="sm">
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => onAccept(editedSuggestion)} size="sm">
                  Schedule Task
                </Button>
                <Button onClick={onDismiss} variant="outline" size="sm">
                  Dismiss
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default EditableTaskSuggestion;