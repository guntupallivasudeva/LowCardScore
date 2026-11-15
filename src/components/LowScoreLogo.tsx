'use client';

import React from 'react';

interface LowScoreLogoProps {
  className?: string;
}

/**
 * Geometric tabletop card emblem for LowScore (ivory Ace/diamond card over emerald card inside charcoal badge).
 */
export function LowScoreLogo({ className = 'w-7 h-7' }: LowScoreLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="1" y="1" width="38" height="38" rx="10" fill="#1C1917" />
      <rect x="1.5" y="1.5" width="37" height="37" rx="9.5" stroke="#44403C" strokeOpacity="0.6" />
      {/* Back Emerald Card */}
      <g transform="rotate(11 24 21)">
        <rect x="16" y="8" width="16" height="23" rx="3" fill="#059669" />
        <rect x="18" y="10" width="12" height="19" rx="1.5" stroke="#A7F3D0" strokeOpacity="0.45" strokeWidth="1" />
      </g>
      {/* Front Ivory Card */}
      <g transform="rotate(-7 17 20)">
        <rect x="8" y="7" width="17" height="24" rx="3" fill="#FAF9F5" stroke="#E7E5E4" strokeWidth="0.75" />
        {/* Crisp Crimson Diamond Suit */}
        <path d="M16.5 13.5 L21 19 L16.5 24.5 L12 19 Z" fill="#DC2626" />
      </g>
      {/* Emerald Low-Score Star Dot */}
      <circle cx="30" cy="30" r="3.5" fill="#10B981" stroke="#1C1917" strokeWidth="1.5" />
    </svg>
  );
}
