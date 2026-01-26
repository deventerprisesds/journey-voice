import React from 'react';
import { cn } from '@/lib/utils';
import type { VoiceState } from './types';

interface VoiceOrbProps {
  state: VoiceState;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: () => void;
  isConnected?: boolean;
}

const sizeClasses = {
  sm: 'w-12 h-12',
  md: 'w-20 h-20',
  lg: 'w-28 h-28',
};

const VoiceOrb: React.FC<VoiceOrbProps> = ({
  state,
  color = '#3B82F6',
  size = 'lg',
  className,
  onClick,
  isConnected = false,
}) => {
  return (
    <div 
      className={cn(
        'relative flex items-center justify-center',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {/* Outer glow rings - animated based on state */}
      {state === 'listening' && (
        <>
          <div
            className="absolute rounded-full animate-ping opacity-20"
            style={{
              backgroundColor: color,
              width: '150%',
              height: '150%',
              animationDuration: '1.5s',
            }}
          />
          <div
            className="absolute rounded-full animate-ping opacity-10"
            style={{
              backgroundColor: color,
              width: '180%',
              height: '180%',
              animationDuration: '2s',
              animationDelay: '0.5s',
            }}
          />
        </>
      )}

      {state === 'speaking' && (
        <>
          <div
            className="absolute rounded-full animate-pulse opacity-30"
            style={{
              backgroundColor: color,
              width: '130%',
              height: '130%',
            }}
          />
          <div
            className="absolute rounded-full opacity-20"
            style={{
              backgroundColor: color,
              width: '160%',
              height: '160%',
              animation: 'pulse 1s ease-in-out infinite alternate',
            }}
          />
        </>
      )}

      {state === 'processing' && (
        <div
          className="absolute rounded-full opacity-30 animate-spin"
          style={{
            background: `conic-gradient(from 0deg, transparent, ${color})`,
            width: '140%',
            height: '140%',
            animationDuration: '1s',
          }}
        />
      )}

      {/* Main orb */}
      <div
        className={cn(
          'relative rounded-full shadow-lg transition-all duration-300',
          sizeClasses[size],
          state === 'idle' && 'animate-pulse',
          state === 'listening' && 'scale-105',
          state === 'speaking' && 'scale-110',
          state === 'processing' && 'scale-95'
        )}
        style={{
          background: `radial-gradient(circle at 30% 30%, ${color}dd, ${color}99, ${color}66)`,
          boxShadow: `0 0 40px ${color}40, 0 0 80px ${color}20`,
        }}
      >
        {/* Inner highlight */}
        <div
          className="absolute inset-2 rounded-full opacity-40"
          style={{
            background: `radial-gradient(circle at 30% 30%, white, transparent 60%)`,
          }}
        />

        {/* Processing spinner overlay */}
        {state === 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-1/2 h-1/2 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: `white transparent transparent transparent` }}
            />
          </div>
        )}

        {/* Speaking waveform indicator */}
        {state === 'speaking' && (
          <div className="absolute inset-0 flex items-center justify-center gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1 bg-white/60 rounded-full"
                style={{
                  height: '40%',
                  animation: `wave 0.5s ease-in-out infinite`,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
};

export default VoiceOrb;
