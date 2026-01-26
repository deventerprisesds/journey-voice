import React from 'react';
import { cn } from '@/lib/utils';

interface AssistantAvatarProps {
  name: string;
  avatarUrl?: string | null;
  avatarInitial?: string | null;
  orbColor?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-10 h-10 text-base',
  lg: 'w-16 h-16 text-xl',
};

const AssistantAvatar: React.FC<AssistantAvatarProps> = ({
  name,
  avatarUrl,
  avatarInitial,
  orbColor = '#3B82F6',
  size = 'md',
  className,
}) => {
  const initial = avatarInitial || name.charAt(0).toUpperCase();

  if (avatarUrl) {
    return (
      <div
        className={cn(
          'rounded-full overflow-hidden flex-shrink-0 ring-2 ring-offset-2 ring-offset-background',
          sizeClasses[size],
          className
        )}
        style={{ 
          boxShadow: `0 0 0 2px ${orbColor}`,
        }}
      >
        <img
          src={avatarUrl}
          alt={name}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0',
        sizeClasses[size],
        className
      )}
      style={{ backgroundColor: orbColor }}
    >
      {initial}
    </div>
  );
};

export default AssistantAvatar;
