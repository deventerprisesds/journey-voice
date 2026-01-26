import React from 'react';
import { Mic, Phone, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CommunicationMode } from './types';

interface ModeToggleProps {
  currentMode: CommunicationMode;
  onModeChange: (mode: CommunicationMode) => void;
  disabled?: boolean;
  className?: string;
}

const modes: { mode: CommunicationMode; icon: React.ElementType; label: string }[] = [
  { mode: 'voice', icon: Mic, label: 'Voice' },
  { mode: 'phone', icon: Phone, label: 'Phone' },
  { mode: 'chat', icon: MessageSquare, label: 'Chat' },
];

const ModeToggle: React.FC<ModeToggleProps> = ({
  currentMode,
  onModeChange,
  disabled = false,
  className,
}) => {
  return (
    <div className={cn('flex items-center justify-center gap-2 p-2', className)}>
      {modes.map(({ mode, icon: Icon, label }) => (
        <Button
          key={mode}
          variant={currentMode === mode ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onModeChange(mode)}
          disabled={disabled}
          className={cn(
            'flex items-center gap-2 px-4 py-2 transition-all',
            currentMode === mode && 'shadow-md'
          )}
        >
          <Icon className="w-4 h-4" />
          <span className="hidden sm:inline">{label}</span>
        </Button>
      ))}
    </div>
  );
};

export default ModeToggle;
