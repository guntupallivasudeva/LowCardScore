'use client';

import React, { useId } from 'react';

interface FireSuitLoaderProps {
  label?: string;
  sublabel?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SUITS = [
  { key: 'spade', tilt: '-11deg', delay: '0s', color: '#1C1917', glow: 'rgba(251,146,60,0.45)' },
  { key: 'heart', tilt: '-4deg', delay: '0.16s', color: '#DC2626', glow: 'rgba(239,68,68,0.55)' },
  { key: 'diamond', tilt: '4deg', delay: '0.32s', color: '#EA580C', glow: 'rgba(249,115,22,0.55)' },
  { key: 'club', tilt: '11deg', delay: '0.48s', color: '#1C1917', glow: 'rgba(245,158,11,0.45)' },
] as const;

function SuitVector({ kind, color }: { kind: (typeof SUITS)[number]['key']; color: string }) {
  if (kind === 'spade') {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4 sm:w-5 sm:h-5" fill={color} aria-hidden="true">
        <path d="M12 2.5C9 6.5 4 9.5 4 14a4 4 0 0 0 6.7 2.95c-.2 1.75-.9 3.05-2.2 4.05h7c-1.3-1-2-2.3-2.2-4.05A4 4 0 0 0 20 14c0-4.5-5-7.5-8-11.5z" />
      </svg>
    );
  }
  if (kind === 'heart') {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4 sm:w-5 sm:h-5" fill={color} aria-hidden="true">
        <path d="M12 20.6c-.45 0-.88-.18-1.2-.5C6.5 16 3.2 12.9 3.2 8.9A4.7 4.7 0 0 1 12 6.65 4.7 4.7 0 0 1 20.8 8.9c0 4-3.3 7.1-7.6 11.2-.32.32-.75.5-1.2.5z" />
      </svg>
    );
  }
  if (kind === 'diamond') {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4 sm:w-5 sm:h-5" fill={color} aria-hidden="true">
        <path d="M12 2.5 19.8 12 12 21.5 4.2 12 12 2.5z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 sm:w-5 sm:h-5" fill={color} aria-hidden="true">
      <path d="M12 3a3.9 3.9 0 0 0-3.3 5.98A3.95 3.95 0 0 0 4 12.85a4 4 0 0 0 6.55 3.08c-.18 1.95-.95 3.4-2.05 4.57h7c-1.1-1.17-1.87-2.62-2.05-4.57A4 4 0 0 0 20 12.85a3.95 3.95 0 0 0-4.7-3.87A3.9 3.9 0 0 0 12 3z" />
    </svg>
  );
}

/**
 * Custom animated fire + all 4 playing-card suits loader for LowScore transitions.
 */
export function FireSuitLoader({
  label = 'Loading LowScore...',
  sublabel,
  size = 'md',
  className = '',
}: FireSuitLoaderProps) {
  const uid = useId().replace(/:/g, '');
  const outerFlameId = `flame_outer_${uid}`;
  const midFlameId = `flame_mid_${uid}`;
  const coreFlameId = `flame_core_${uid}`;

  const scaleClass =
    size === 'sm' ? 'scale-75' : size === 'lg' ? 'scale-110' : 'scale-100';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center select-none ${className}`}
    >
      <div className={`relative w-44 h-32 flex items-end justify-center ${scaleClass}`}>
        {/* Warm Radial Hearth Glow */}
        <div
          className="absolute inset-x-4 bottom-2 h-24 rounded-full blur-2xl opacity-70 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 72%, rgba(249,115,22,0.52) 0%, rgba(220,38,38,0.28) 48%, rgba(250,249,245,0) 78%)',
          }}
        />

        {/* Animated SVG Fire Plume Behind Suits */}
        <svg
          viewBox="0 0 180 120"
          className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={outerFlameId} x1="90" y1="8" x2="90" y2="112" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FBBF24" />
              <stop offset="42%" stopColor="#F97316" />
              <stop offset="85%" stopColor="#DC2626" />
              <stop offset="100%" stopColor="#7F1D1D" stopOpacity="0.15" />
            </linearGradient>
            <linearGradient id={midFlameId} x1="90" y1="26" x2="90" y2="112" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FEF08A" />
              <stop offset="45%" stopColor="#FB923C" />
              <stop offset="100%" stopColor="#EA580C" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id={coreFlameId} x1="90" y1="48" x2="90" y2="110" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFFBEB" />
              <stop offset="65%" stopColor="#FDE047" />
              <stop offset="100%" stopColor="#F97316" stopOpacity="0.25" />
            </linearGradient>
          </defs>

          {/* Outer Dancing Flames */}
          <path
            className="animate-flame-outer"
            fill={`url(#${outerFlameId})`}
            d="M34 104 C28 84, 41 67, 50 56 C47 71, 56 76, 61 63 C66 42, 81 26, 90 10 C102 27, 114 43, 118 62 C124 73, 132 67, 131 53 C143 66, 152 84, 146 104 C135 113, 45 113, 34 104 Z"
          />

          {/* Secondary Tongue Waves */}
          <path
            className="animate-flame-outer"
            style={{ animationDelay: '0.28s' }}
            fill={`url(#${midFlameId})`}
            d="M48 105 C45 87, 57 73, 66 64 C66 75, 74 79, 79 65 C84 48, 92 34, 96 24 C104 39, 111 55, 110 70 C115 76, 122 72, 123 64 C130 74, 136 89, 131 105 C116 112, 63 112, 48 105 Z"
          />

          {/* Bright Hot Ember Core */}
          <path
            className="animate-flame-core"
            fill={`url(#${coreFlameId})`}
            d="M66 106 C65 92, 74 80, 82 70 C85 59, 89 50, 91 44 C97 56, 102 68, 101 79 C105 83, 111 79, 112 73 C116 83, 118 96, 113 106 C100 110, 79 110, 66 106 Z"
          />

          {/* Rising Floating Sparks */}
          <circle cx="54" cy="56" r="2.2" fill="#FDE047" className="animate-ember-rise" style={{ animationDelay: '0s' }} />
          <circle cx="88" cy="32" r="2.6" fill="#FDBA74" className="animate-ember-rise" style={{ animationDelay: '0.45s' }} />
          <circle cx="122" cy="48" r="2" fill="#FDE047" className="animate-ember-rise" style={{ animationDelay: '0.9s' }} />
          <circle cx="104" cy="40" r="1.8" fill="#FB923C" className="animate-ember-rise" style={{ animationDelay: '1.2s' }} />
        </svg>

        {/* All 4 Playing Card Suit Tiles Dancing Over Fire */}
        <div className="relative z-10 flex items-center justify-center gap-1.5 sm:gap-2 pb-3">
          {SUITS.map((suit) => (
            <div
              key={suit.key}
              className="animate-suit-dance w-8 h-10 sm:w-9 sm:h-11 rounded-lg bg-[#FAF9F5]/95 border border-amber-200/80 flex items-center justify-center shadow-md"
              style={
                {
                  '--suit-tilt': suit.tilt,
                  animationDelay: suit.delay,
                  boxShadow: `0 6px 14px -3px ${suit.glow}, inset 0 1px 0 rgba(255,255,255,0.9)`,
                } as React.CSSProperties
              }
            >
              <SuitVector kind={suit.key} color={suit.color} />
            </div>
          ))}
        </div>
      </div>

      {label && (
        <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-stone-800 tracking-tight">
          <span className="w-2 h-2 rounded-full bg-orange-500 animate-ping" />
          <span>{label}</span>
        </div>
      )}
      {sublabel && (
        <p className="mt-0.5 text-[11px] font-medium text-stone-500 text-center max-w-xs">
          {sublabel}
        </p>
      )}
    </div>
  );
}
