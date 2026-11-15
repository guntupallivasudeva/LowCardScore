'use client';

import React from 'react';
import { Card } from '@/lib/gameEngine';

interface PlayingCardProps {
  card?: Card;
  faceDown?: boolean;
  selected?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  badgeCount?: number;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Renders the 52-card vector SVG playing cards (`/cards/${rank}_${suit}.svg`)
 * and the exact ornate red mandala lattice card back (`/cards/card_back.png`)
 * with responsive mobile-friendly sizing and continuous rounded borders.
 */
export function PlayingCard({
  card,
  faceDown = false,
  selected = false,
  size = 'md',
  badgeCount,
  onClick,
  disabled = false,
  className = '',
}: PlayingCardProps) {
  // md & lg scale generously on mobile to match LeastScore card prominence while keeping 1-row fit on small screens
  const dimensions = {
    xs: 'w-8 h-[46px] sm:w-9 sm:h-[52px] rounded-[5px]',
    sm: 'w-12 h-[70px] sm:w-14 sm:h-20 rounded-[7px]',
    md: 'w-[17vw] h-[24.6vw] max-w-[92px] max-h-[133px] sm:max-w-none sm:max-h-none sm:w-24 sm:h-[138px] rounded-[8px] sm:rounded-[10px]',
    lg: 'w-[17.5vw] h-[25.3vw] max-w-[96px] max-h-[139px] sm:max-w-none sm:max-h-none sm:w-28 sm:h-[162px] rounded-[8px] sm:rounded-[11px]',
  }[size];

  const borderAndElevation = selected
    ? '-translate-y-3 sm:-translate-y-4 border-2 border-stone-900 shadow-lg z-20'
    : 'translate-y-0 border border-stone-300 shadow-sm';

  if (faceDown || !card) {
    return (
      <div
        onClick={!disabled ? onClick : undefined}
        className={`relative select-none bg-white p-[2px] transition-transform duration-150 ${dimensions} ${borderAndElevation} ${
          onClick && !disabled ? 'cursor-pointer hover:-translate-y-1.5' : ''
        } ${className}`}
      >
        <img
          src="/cards/card_back.png"
          alt="Card Back"
          draggable={false}
          className="w-full h-full object-fill rounded-[4px] sm:rounded-[6px] pointer-events-none select-none block"
        />
        {typeof badgeCount === 'number' && (
          <div className="absolute -top-2 -right-2 sm:-top-2.5 sm:-right-2.5 bg-stone-900 text-white text-[9px] sm:text-[11px] font-bold font-mono px-1.5 sm:px-2 py-0.5 rounded-full shadow-md border-2 border-white z-30">
            {badgeCount}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={!disabled ? onClick : undefined}
      className={`relative select-none bg-white p-[1px] sm:p-[2px] overflow-hidden transition-transform duration-150 ${dimensions} ${borderAndElevation} ${
        onClick && !disabled ? 'cursor-pointer hover:-translate-y-1.5' : ''
      } ${className}`}
    >
      <img
        src={`/cards/${card.rank}_${card.suit}.svg`}
        alt={`${card.rank} of ${card.suit}`}
        draggable={false}
        className="w-full h-full object-contain pointer-events-none select-none block"
      />
    </div>
  );
}
