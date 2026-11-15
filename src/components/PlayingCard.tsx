'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Card, Suit } from '@/lib/gameEngine';

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

const SUIT_META: Record<Suit, { symbol: string; isRed: boolean }> = {
  spades: { symbol: '♠', isRed: false },
  hearts: { symbol: '♥', isRed: true },
  diamonds: { symbol: '♦', isRed: true },
  clubs: { symbol: '♣', isRed: false },
};

const MAX_IMAGE_RETRIES = 2;
const RETRY_DELAYS_MS = [800, 2000];

/**
 * Tracks image load status for card assets and schedules staggered retries on transient
 * tunnel/network errors while keeping cached loads instantaneous.
 */
function useResilientCardImage(baseSrc: string) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [state, setState] = useState<{
    srcKey: string;
    loaded: boolean;
    failed: boolean;
    retry: number;
  }>({
    srcKey: baseSrc,
    loaded: false,
    failed: false,
    retry: 0,
  });

  // Derive active state synchronously if baseSrc changed to avoid stale flash.
  const active =
    state.srcKey === baseSrc
      ? state
      : { srcKey: baseSrc, loaded: false, failed: false, retry: 0 };

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setState({ srcKey: baseSrc, loaded: true, failed: false, retry: 0 });
      return;
    }
    setState((prev) =>
      prev.srcKey === baseSrc ? prev : { srcKey: baseSrc, loaded: false, failed: false, retry: 0 }
    );
  }, [baseSrc]);

  useEffect(() => {
    if (active.loaded || !active.failed || active.retry >= MAX_IMAGE_RETRIES) return;
    const delay = RETRY_DELAYS_MS[active.retry] ?? 2000;
    const timer = window.setTimeout(() => {
      setState((prev) =>
        prev.srcKey === baseSrc
          ? { ...prev, failed: false, retry: prev.retry + 1 }
          : { srcKey: baseSrc, loaded: false, failed: false, retry: 1 }
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [baseSrc, active.loaded, active.failed, active.retry]);

  const activeSrc = active.retry > 0 ? `${baseSrc}?retry=${active.retry}` : baseSrc;
  const permanentlyFailed = active.failed && active.retry >= MAX_IMAGE_RETRIES;

  const handleLoad = () => {
    setState((prev) => ({
      srcKey: baseSrc,
      loaded: true,
      failed: false,
      retry: prev.srcKey === baseSrc ? prev.retry : 0,
    }));
  };

  const handleError = () => {
    setState((prev) => ({
      srcKey: baseSrc,
      loaded: false,
      failed: true,
      retry: prev.srcKey === baseSrc ? prev.retry : 0,
    }));
  };

  return { imgRef, activeSrc, loaded: active.loaded, permanentlyFailed, handleLoad, handleError };
}

/**
 * Pure CSS/SVG ornate crimson back pattern rendered immediately while `/cards/card_back.png`
 * loads or if a tunnel drops the image request.
 */
function CardBackFallback({ compact = false }: { compact?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="w-full h-full bg-[#8E181D] relative overflow-hidden flex items-center justify-center"
      style={{
        backgroundImage:
          'repeating-linear-gradient(45deg, rgba(254,226,226,0.14) 0px, rgba(254,226,226,0.14) 2px, transparent 2px, transparent 7px), repeating-linear-gradient(-45deg, rgba(254,226,226,0.14) 0px, rgba(254,226,226,0.14) 2px, transparent 2px, transparent 7px)',
      }}
    >
      <div
        className={`w-[86%] h-[88%] rounded-[3px] border border-amber-100/75 flex items-center justify-center ${
          compact ? 'border-[0.75px]' : 'border'
        }`}
      >
        {!compact && (
          <div className="w-[46%] aspect-square rotate-45 rounded-[2px] border border-amber-100/80 bg-[#6F1014]/90 flex items-center justify-center shadow-inner">
            <span className="-rotate-45 text-amber-100/90 text-[10px] sm:text-xs leading-none">
              ♦
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Crisp inline vector face fallback shown immediately until `/cards/*.svg` paints
 * (and permanently if an external image fails over a restricted mobile tunnel).
 */
function CardFaceFallback({ card, size }: { card: Card; size: 'xs' | 'sm' | 'md' | 'lg' }) {
  const { symbol, isRed } = SUIT_META[card.suit];
  const colorCls = isRed ? 'text-red-600' : 'text-stone-900';
  const isCourt = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';

  const cornerText = {
    xs: 'text-[8px] leading-[0.9]',
    sm: 'text-[10px] sm:text-[11px] leading-[0.95]',
    md: 'text-[11px] sm:text-sm leading-[0.95]',
    lg: 'text-[12px] sm:text-base leading-[0.95]',
  }[size];

  const centerSymbol = {
    xs: 'text-base',
    sm: 'text-2xl',
    md: 'text-3xl sm:text-4xl',
    lg: 'text-3xl sm:text-5xl',
  }[size];

  return (
    <div
      aria-hidden="true"
      className={`w-full h-full bg-white flex flex-col justify-between p-1 sm:p-1.5 select-none ${colorCls}`}
    >
      <div className={`flex flex-col items-center self-start font-bold ${cornerText}`}>
        <span>{card.rank}</span>
        <span>{symbol}</span>
      </div>

      <div className="flex flex-col items-center justify-center leading-none">
        {isCourt && size !== 'xs' ? (
          <div
            className={`px-1.5 py-0.5 rounded border ${
              isRed ? 'border-red-200 bg-red-50/70' : 'border-stone-200 bg-stone-50'
            } flex flex-col items-center`}
          >
            <span className="font-serif font-extrabold text-sm sm:text-lg leading-tight">
              {card.rank}
            </span>
            <span className="text-xs sm:text-base leading-none">{symbol}</span>
          </div>
        ) : (
          <span className={centerSymbol}>{symbol}</span>
        )}
      </div>

      <div className={`flex flex-col items-center self-end rotate-180 font-bold ${cornerText}`}>
        <span>{card.rank}</span>
        <span>{symbol}</span>
      </div>
    </div>
  );
}

/**
 * Miniature card-back icon for opponent status rows, with resilient fallback when
 * `/cards/card_back.png` is slow or blocked over mobile tunnels.
 */
export function MiniCardBack({ className = '' }: { className?: string }) {
  const { imgRef, activeSrc, loaded, permanentlyFailed, handleLoad, handleError } =
    useResilientCardImage('/cards/card_back.png');

  return (
    <span
      className={`relative inline-block overflow-hidden rounded-[2px] border border-stone-300 shadow-2xs shrink-0 ${className}`}
    >
      <CardBackFallback compact />
      {!permanentlyFailed && (
        <img
          key="/cards/card_back.png"
          ref={imgRef}
          src={activeSrc}
          alt="Card Back"
          draggable={false}
          onLoad={handleLoad}
          onError={handleError}
          className={`absolute inset-0 w-full h-full object-fill pointer-events-none select-none block transition-opacity duration-150 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </span>
  );
}

/**
 * Renders the 52-card vector SVG playing cards (`/cards/${rank}_${suit}.svg`)
 * and the exact ornate red mandala lattice card back (`/cards/card_back.png`)
 * with responsive mobile-friendly sizing, continuous rounded borders, automatic retry,
 * and instant vector fallbacks for unstable mobile/tunnel connections.
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
  const isBack = faceDown || !card;
  const baseSrc = isBack ? '/cards/card_back.png' : `/cards/${card.rank}_${card.suit}.svg`;
  const { imgRef, activeSrc, loaded, permanentlyFailed, handleLoad, handleError } =
    useResilientCardImage(baseSrc);

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

  if (isBack) {
    return (
      <div
        onClick={!disabled ? onClick : undefined}
        className={`relative select-none bg-white p-[2px] transition-transform duration-150 ${dimensions} ${borderAndElevation} ${
          onClick && !disabled ? 'cursor-pointer hover:-translate-y-1.5' : ''
        } ${className}`}
      >
        <div className="relative w-full h-full overflow-hidden rounded-[4px] sm:rounded-[6px]">
          <CardBackFallback compact={size === 'xs'} />
          {!permanentlyFailed && (
            <img
              key={baseSrc}
              ref={imgRef}
              src={activeSrc}
              alt="Card Back"
              draggable={false}
              onLoad={handleLoad}
              onError={handleError}
              className={`absolute inset-0 w-full h-full object-fill pointer-events-none select-none block transition-opacity duration-150 ${
                loaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )}
        </div>
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
      <div className="relative w-full h-full overflow-hidden rounded-[4px] sm:rounded-[7px]">
        <CardFaceFallback card={card} size={size} />
        {!permanentlyFailed && (
          <img
            key={baseSrc}
            ref={imgRef}
            src={activeSrc}
            alt={`${card.rank} of ${card.suit}`}
            draggable={false}
            onLoad={handleLoad}
            onError={handleError}
            className={`absolute inset-0 w-full h-full object-contain bg-white pointer-events-none select-none block transition-opacity duration-150 ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
      </div>
    </div>
  );
}
