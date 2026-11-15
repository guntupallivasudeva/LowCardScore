'use client';

import React, { useId } from 'react';

interface LowScoreLogoProps {
  className?: string;
}

/**
 * Custom LowScore crest: obsidian emblem framing an emerald deck backing and ivory Ace-1 card
 * with a ruby-ember diamond pip and gold victory spark.
 */
export function LowScoreLogo({ className = 'w-7 h-7' }: LowScoreLogoProps) {
  const uid = useId().replace(/:/g, '');
  const bgId = `ls_bg_${uid}`;
  const goldId = `ls_gold_${uid}`;
  const emberId = `ls_ember_${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id={bgId} x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#292524" />
          <stop offset="100%" stopColor="#0C0A09" />
        </linearGradient>
        <linearGradient id={goldId} x1="2" y1="2" x2="38" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.65" />
          <stop offset="50%" stopColor="#10B981" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#78716C" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id={emberId} x1="16" y1="12" x2="16" y2="27" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F97316" />
          <stop offset="55%" stopColor="#DC2626" />
          <stop offset="100%" stopColor="#991B1B" />
        </linearGradient>
      </defs>

      {/* Obsidian Squircle Housing */}
      <rect x="1" y="1" width="38" height="38" rx="10.5" fill={`url(#${bgId})`} />
      <rect
        x="1.5"
        y="1.5"
        width="37"
        height="37"
        rx="10"
        stroke={`url(#${goldId})`}
        strokeWidth="1.2"
      />

      {/* Ambient Emerald Felt Back Card */}
      <g transform="rotate(14 25 21)">
        <rect x="17" y="8.5" width="14.5" height="21.5" rx="3" fill="#059669" />
        <rect
          x="18.75"
          y="10.25"
          width="11"
          height="18"
          rx="1.6"
          stroke="#A7F3D0"
          strokeOpacity="0.55"
          strokeWidth="0.9"
        />
        <circle cx="24.25" cy="19.25" r="2" fill="#ECFDF5" fillOpacity="0.35" />
      </g>

      {/* Hero Ivory Ace Card (Low Score = 1 pt) */}
      <g transform="rotate(-8 17 20)">
        <rect
          x="7.5"
          y="7"
          width="18"
          height="24.5"
          rx="3.2"
          fill="#FAF9F5"
          stroke="#E7E5E4"
          strokeWidth="0.8"
        />
        {/* Sharp Geometric "A" Index */}
        <path
          d="M10.4 12.6 L11.8 9 L13.2 12.6 M10.9 11.4 H12.7"
          stroke="#1C1917"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Crisp Flame-Ruby Diamond Suit Center */}
        <path
          d="M16.5 13.6 L21.4 19.6 L16.5 25.6 L11.6 19.6 Z"
          fill={`url(#${emberId})`}
        />
        {/* Subtle Specular Inner Facet */}
        <path d="M16.5 15.1 L19.4 19.6 L16.5 19.6 Z" fill="#FDBA74" fillOpacity="0.45" />
      </g>

      {/* Low-Score Emerald Crown Dot */}
      <circle cx="30.5" cy="30" r="3.6" fill="#10B981" stroke="#141210" strokeWidth="1.5" />
      <circle cx="30.5" cy="30" r="1.3" fill="#ECFDF5" />
    </svg>
  );
}
