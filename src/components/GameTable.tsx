'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Card,
  RoomState,
  canPlayerDeclare,
  getBestHint,
  getHandSum,
  getSuitSymbol,
  isValidDiscard,
} from '@/lib/gameEngine';
import { MiniCardBack, PlayingCard } from './PlayingCard';
import { soundFX } from '@/lib/soundEffects';
import {
  Crown,
  Play,
  Lightbulb,
  LogOut,
  UserX,
  Copy,
  Check,
  Table2,
  MessageSquare,
  Send,
  RotateCcw,
  ArrowRight,
  AlertCircle,
  ArrowLeft,
  Clock,
  Pencil,
  Eye,
  Volume2,
  VolumeX,
  Shuffle,
  Bot,
} from 'lucide-react';

interface GameTableProps {
  room: RoomState;
  currentUser: { id: string; name: string; email?: string };
  soundEnabled?: boolean;
  onToggleSound?: () => void;
  onMakeMove: (
    discardIds: string[],
    drawFrom: 'deck' | 'visible',
    visibleIndex: number
  ) => Promise<void>;
  onDeclare: () => Promise<void>;
  onShuffleDeck: () => Promise<void>;
  onKickPlayer: (targetPlayerId: string) => Promise<void>;
  onLeaveRoom: () => Promise<void>;
  onTempBack: () => Promise<void>;
  onTimeoutTurn: () => Promise<void>;
  onUpdateName: (newName: string) => Promise<void>;
  onNextRound: (expectedRound?: number) => Promise<void>;
  onPlayAgain: () => Promise<void>;
  onReturnToLobby: () => Promise<void>;
  onSendChat: (text: string) => Promise<void>;
}

/**
 * Per-row horizontally scrollable 4-round strip so each player row scrolls independently
 */
function PlayerRoundsStrip({
  roundScores,
  maxRounds,
}: {
  roundScores: RoomState['players'][0]['roundScores'];
  maxRounds: number;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const snapToLatest = () => {
      if (stripRef.current) {
        stripRef.current.scrollLeft = stripRef.current.scrollWidth;
      }
    };
    snapToLatest();
    window.addEventListener('resize', snapToLatest);
    return () => window.removeEventListener('resize', snapToLatest);
  }, [roundScores.length, maxRounds]);

  if (maxRounds === 0) {
    return <span className="text-stone-400 font-mono">—</span>;
  }

  return (
    <div
      ref={stripRef}
      className="flex items-center overflow-x-auto max-w-[104px] sm:max-w-[208px] py-0.5 sm:py-1 no-scrollbar"
    >
      {Array.from({ length: maxRounds }).map((_, rIdx) => {
        const rs = roundScores[rIdx];
        if (!rs) {
          return (
            <div
              key={rIdx}
              className="w-[26px] min-w-[26px] sm:w-[52px] sm:min-w-[52px] shrink-0 text-center flex flex-col items-center leading-tight"
            >
              <span className="text-[7px] sm:text-[9px] text-stone-400 font-semibold uppercase">
                R{rIdx + 1}
              </span>
              <span className="font-mono text-stone-400 text-[8px] sm:text-xs">—</span>
            </div>
          );
        }
        const isWin = rs.outcome === 'win';
        const isLose = rs.outcome === 'lose';
        const colorClass = isWin
          ? 'text-emerald-600 font-bold'
          : isLose
          ? 'text-red-600 font-bold'
          : 'text-blue-600 font-bold';

        return (
          <div
            key={rIdx}
            className="w-[26px] min-w-[26px] sm:w-[52px] sm:min-w-[52px] shrink-0 text-center flex flex-col items-center leading-tight border-r last:border-r-0 border-stone-200/60"
          >
            <span className="text-[7px] sm:text-[9px] text-stone-400 font-semibold uppercase">
              R{rIdx + 1}
            </span>
            <span className={`font-mono text-[8px] sm:text-xs ${colorClass}`}>
              {isWin ? '0★' : `+${rs.score}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface PersistedTableUiState {
  autoPlay?: boolean;
  showScoreboard?: boolean;
  showChat?: boolean;
  dismissedRoundModal?: boolean;
  dismissedRoundNumber?: number;
  selectedCardIds?: string[];
  drawSource?: 'deck' | 'visible' | null;
  selectedVisibleIdx?: number;
  turnKey?: string;
}

function getTableUiStorageKey(roomCode: string, userId: string): string {
  return `lowscore_table_ui_${roomCode}_${userId}`;
}

function getDealtRoundStorageKey(roomCode: string, userId: string): string {
  return `lowscore_dealt_round_${roomCode}_${userId}`;
}

function loadInitialTableUi(roomCode: string, userId: string): PersistedTableUiState {
  if (typeof window === 'undefined') return {};
  try {
    const raw =
      sessionStorage.getItem(getTableUiStorageKey(roomCode, userId)) ||
      localStorage.getItem(getTableUiStorageKey(roomCode, userId));
    if (raw) {
      return JSON.parse(raw) as PersistedTableUiState;
    }
  } catch {
    // ignore storage read errors
  }
  return {};
}

export function GameTable({
  room,
  currentUser,
  soundEnabled: soundEnabledProp,
  onToggleSound,
  onMakeMove,
  onDeclare,
  onShuffleDeck,
  onKickPlayer,
  onLeaveRoom,
  onTempBack,
  onTimeoutTurn,
  onUpdateName,
  onNextRound,
  onPlayAgain,
  onReturnToLobby,
  onSendChat,
}: GameTableProps) {
  const me = room.players.find((p) => p.id === currentUser.id) || room.players[0];
  const initialTurnKey = `${room.roundNumber}:${room.turnsPlayedInRound}:${room.currentTurnPlayerId}`;
  const initialUiRef = useRef<PersistedTableUiState | null>(null);
  if (initialUiRef.current === null) {
    initialUiRef.current = loadInitialTableUi(room.code, currentUser.id);
  }
  const initialUi = initialUiRef.current;
  const initialValidHandIds = new Set(me.hand.map((c) => c.id));
  const sameInitialTurn = initialUi.turnKey === initialTurnKey;

  // Player can pre-select their own hand cards even when it is not their turn!
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>(() =>
    Array.isArray(initialUi.selectedCardIds)
      ? initialUi.selectedCardIds.filter((id) => initialValidHandIds.has(id))
      : []
  );
  const [drawSource, setDrawSource] = useState<'deck' | 'visible' | null>(() =>
    sameInitialTurn ? (initialUi.drawSource ?? null) : null
  );
  const [selectedVisibleIdx, setSelectedVisibleIdx] = useState<number>(() => {
    if (!sameInitialTurn || typeof initialUi.selectedVisibleIdx !== 'number') return 0;
    return Math.max(0, Math.min(Math.max(0, room.visibleCards.length - 1), initialUi.selectedVisibleIdx));
  });
  const [autoPlay, setAutoPlay] = useState<boolean>(() => Boolean(initialUi.autoPlay));

  const [isShufflingDeck, setIsShufflingDeck] = useState<boolean>(false);
  const [isDealingRound, setIsDealingRound] = useState<boolean>(false);
  const [revealedCardCount, setRevealedCardCount] = useState<number>(99);

  const [hintText, setHintText] = useState<string | null>(null);
  const [showScoreboard, setShowScoreboard] = useState<boolean>(() =>
    typeof initialUi.showScoreboard === 'boolean' ? initialUi.showScoreboard : true
  );
  const [showChat, setShowChat] = useState<boolean>(() => Boolean(initialUi.showChat));

  // Confirmation Modals for Declare, Exit, and Kick
  const [showDeclareModal, setShowDeclareModal] = useState<boolean>(false);
  const [showLeaveModal, setShowLeaveModal] = useState<boolean>(false);
  const [confirmKickTarget, setConfirmKickTarget] = useState<{ id: string; name: string } | null>(
    null
  );

  const [dismissedRoundModal, setDismissedRoundModal] = useState<boolean>(() =>
    Boolean(
      initialUi.dismissedRoundModal && initialUi.dismissedRoundNumber === room.roundNumber
    )
  );
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [localSoundEnabled, setLocalSoundEnabled] = useState<boolean>(() =>
    soundFX.loadPreference(currentUser.id)
  );
  const soundEnabled = soundEnabledProp ?? localSoundEnabled;

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(currentUser.name);

  const [secondsLeft, setSecondsLeft] = useState<number>(room.settings.turnTimer || 45);
  const [roundEndElapsed, setRoundEndElapsed] = useState<number>(0);

  const prevTurnPlayerRef = useRef<string>(room.currentTurnPlayerId);
  const prevStatusRef = useRef<string>(room.status);
  const nextRoundTriggeredRef = useRef<number | null>(null);
  const lastSummaryEndedAtRef = useRef<number | null>(null);

  const isHost = room.hostId === currentUser.id;
  const isMyTurn = room.status === 'playing' && room.currentTurnPlayerId === currentUser.id;
  const opponents = room.players.filter((p) => p.id !== currentUser.id);
  const maxRounds = Math.max(0, ...room.players.map((p) => p.roundScores.length));

  // Persist table UI state (Auto mode, card selection, draw choice, panels) across page refreshes
  useEffect(() => {
    try {
      const payload: PersistedTableUiState = {
        autoPlay,
        showScoreboard,
        showChat,
        dismissedRoundModal,
        dismissedRoundNumber: room.roundNumber,
        selectedCardIds,
        drawSource,
        selectedVisibleIdx,
        turnKey: `${room.roundNumber}:${room.turnsPlayedInRound}:${room.currentTurnPlayerId}`,
      };
      const serialized = JSON.stringify(payload);
      sessionStorage.setItem(getTableUiStorageKey(room.code, currentUser.id), serialized);
      localStorage.setItem(getTableUiStorageKey(room.code, currentUser.id), serialized);
    } catch {
      // ignore storage quota errors
    }
  }, [
    room.code,
    room.roundNumber,
    room.turnsPlayedInRound,
    room.currentTurnPlayerId,
    currentUser.id,
    autoPlay,
    showScoreboard,
    showChat,
    dismissedRoundModal,
    selectedCardIds,
    drawSource,
    selectedVisibleIdx,
  ]);

  // Sound Effects when turn activates or when Declare happens
  useEffect(() => {
    if (
      room.status === 'playing' &&
      room.currentTurnPlayerId !== prevTurnPlayerRef.current
    ) {
      prevTurnPlayerRef.current = room.currentTurnPlayerId;
      if (room.currentTurnPlayerId === currentUser.id) {
        soundFX.playTurnActivate();
      } else {
        soundFX.playCardMove();
      }
    }
    if (
      (room.status === 'round_end' || room.status === 'game_over') &&
      prevStatusRef.current === 'playing'
    ) {
      soundFX.playDeclare();
    }
    prevStatusRef.current = room.status;
  }, [room.currentTurnPlayerId, room.status, currentUser.id]);

  const meHandIdsKey = me.hand.map((c) => c.id).join(',');
  const turnChangeKey = `${room.currentTurnPlayerId}:${room.turnsPlayedInRound}:${room.roundNumber}`;
  const prevTurnChangeKeyRef = useRef<string>(turnChangeKey);
  const prevModalPhaseKeyRef = useRef<string>(`${room.status}:${room.roundNumber}`);

  // Only clear drawSource when the turn or round actually changes AFTER initial mount!
  // Keeping this guarded preserves pre-selected drop cards & draw source across page refreshes.
  useEffect(() => {
    const validIds = meHandIdsKey.split(',');
    setSelectedCardIds((prev) => prev.filter((id) => validIds.includes(id)));

    if (prevTurnChangeKeyRef.current !== turnChangeKey) {
      prevTurnChangeKeyRef.current = turnChangeKey;
      setDrawSource(null);
      setSelectedVisibleIdx(0);
      setHintText(null);
      setActionError(null);
      setShowDeclareModal(false);
    }
  }, [turnChangeKey, meHandIdsKey]);

  useEffect(() => {
    const modalPhaseKey = `${room.status}:${room.roundNumber}`;
    if (prevModalPhaseKeyRef.current !== modalPhaseKey) {
      prevModalPhaseKeyRef.current = modalPhaseKey;
      if (room.status === 'round_end' || room.status === 'game_over') {
        setDismissedRoundModal(false);
      }
    }
  }, [room.status, room.roundNumber]);

  // 5-Card Deal & Reveal Animation whenever a new round starts (status switches into 'playing').
  // Wall-clock interval inside the effect is React StrictMode-safe and guarantees every card ends face-up.
  const dealCompletedKeyRef = useRef<string>('');
  const dealStartedAtRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const roundKey = `${room.code}:${room.roundNumber}`;

    if (room.status !== 'playing') {
      dealCompletedKeyRef.current = '';
      dealStartedAtRef.current = {};
      setIsDealingRound(false);
      setRevealedCardCount(99);
      return;
    }

    if (dealCompletedKeyRef.current === roundKey) {
      setIsDealingRound(false);
      setRevealedCardCount(99);
      return;
    }

    let alreadyDealtInSession = false;
    try {
      alreadyDealtInSession =
        sessionStorage.getItem(getDealtRoundStorageKey(room.code, currentUser.id)) === roundKey;
    } catch {
      alreadyDealtInSession = false;
    }

    // On a page reload/rejoin (even at turn 0), keep already-dealt hand immediately face-up
    if (
      (room.turnsPlayedInRound > 0 || alreadyDealtInSession) &&
      !dealStartedAtRef.current[roundKey]
    ) {
      dealCompletedKeyRef.current = roundKey;
      setIsDealingRound(false);
      setRevealedCardCount(99);
      return;
    }

    if (!dealStartedAtRef.current[roundKey]) {
      dealStartedAtRef.current[roundKey] = Date.now();
      soundFX.playShuffle();
    }

    const cardCount = Math.max(me.hand.length || 0, room.settings.cardsPerPlayer || 5);
    const startMs = dealStartedAtRef.current[roundKey];
    let lastSoundCount = 0;

    const tick = () => {
      const elapsed = Date.now() - startMs;
      const nextCount = Math.min(cardCount, Math.max(0, Math.floor((elapsed - 240) / 110) + 1));
      if (nextCount > lastSoundCount) {
        lastSoundCount = nextCount;
        soundFX.playCardMove();
      }
      setIsDealingRound(true);
      setRevealedCardCount(nextCount);

      if (elapsed >= 240 + cardCount * 110 + 320) {
        dealCompletedKeyRef.current = roundKey;
        try {
          sessionStorage.setItem(getDealtRoundStorageKey(room.code, currentUser.id), roundKey);
        } catch {
          // ignore
        }
        setIsDealingRound(false);
        setRevealedCardCount(99);
        clearInterval(interval);
      }
    };

    const interval = setInterval(tick, 45);
    tick();
    return () => clearInterval(interval);
  }, [
    room.code,
    room.status,
    room.roundNumber,
    room.turnsPlayedInRound,
    room.settings.cardsPerPlayer,
    me.hand.length,
    currentUser.id,
  ]);

  // Automatically disable Auto Mode if eliminated or match ends
  useEffect(() => {
    if (me.isEliminated || room.status === 'game_over') {
      setAutoPlay(false);
    }
  }, [me.isEliminated, room.status]);

  // Auto-Play Mode: automatically discard optimal valid card(s) and pick from Deck/Open Pile when my turn activates.
  // Clicking "Auto" again toggles autoPlay off and cancels this effect cleanly.
  const latestRoomRef = useRef(room);
  latestRoomRef.current = room;
  const onMakeMoveRef = useRef(onMakeMove);
  onMakeMoveRef.current = onMakeMove;
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;
  const autoMovedTurnKeyRef = useRef<string>('');
  const myTurnKey = `${room.roundNumber}:${room.turnsPlayedInRound}:${room.currentTurnPlayerId}`;

  useEffect(() => {
    if (!autoPlay || room.status !== 'playing' || !isMyTurn || me.isEliminated || isDealingRound) {
      return;
    }
    if (autoMovedTurnKeyRef.current === myTurnKey) {
      return;
    }

    const timer = setTimeout(async () => {
      if (submittingRef.current) return;
      const latestRoom = latestRoomRef.current;
      const latestMe = latestRoom.players.find((p) => p.id === currentUser.id);
      if (
        !latestMe ||
        latestMe.isEliminated ||
        latestMe.hand.length === 0 ||
        latestRoom.status !== 'playing' ||
        latestRoom.currentTurnPlayerId !== currentUser.id
      ) {
        return;
      }

      autoMovedTurnKeyRef.current = myTurnKey;
      const plan = getBestHint(latestMe.hand, latestRoom.visibleCards, false);
      setSelectedCardIds(plan.discardIds);
      setDrawSource(plan.drawFrom);
      setSelectedVisibleIdx(plan.visibleIndex);
      soundFX.playCardMove();

      setSubmitting(true);
      setActionError(null);
      setHintText(null);
      try {
        await onMakeMoveRef.current(plan.discardIds, plan.drawFrom, plan.visibleIndex);
        setSelectedCardIds([]);
        setDrawSource(null);
        setSelectedVisibleIdx(0);
      } catch (e: unknown) {
        autoMovedTurnKeyRef.current = '';
        setActionError(e instanceof Error ? e.message : 'Auto move failed');
      } finally {
        setSubmitting(false);
      }
    }, 650);

    return () => clearTimeout(timer);
  }, [autoPlay, room.status, isMyTurn, me.isEliminated, isDealingRound, myTurnKey, currentUser.id]);

  const handleShuffleDeckClick = async () => {
    if (!isMyTurn || isShufflingDeck || submitting) return;
    setIsShufflingDeck(true);
    soundFX.playShuffle();
    try {
      await onShuffleDeck();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Shuffle failed');
    } finally {
      setTimeout(() => {
        setIsShufflingDeck(false);
      }, 700);
    }
  };

  // Turn countdown timer (45s) & auto-timeout trigger
  useEffect(() => {
    if (room.status !== 'playing') return;

    let lastTickSec = -1;
    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - room.turnStartTime) / 1000);
      const remaining = Math.max(0, (room.settings.turnTimer || 45) - elapsed);
      setSecondsLeft(remaining);

      if (isMyTurn && remaining <= 10 && remaining > 0 && remaining !== lastTickSec) {
        lastTickSec = remaining;
        soundFX.playTimerTick();
      }

      if (remaining === 0 && isMyTurn && !submitting) {
        onTimeoutTurn().catch(() => {});
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 400);
    return () => clearInterval(interval);
  }, [
    room.status,
    room.turnStartTime,
    room.settings.turnTimer,
    isMyTurn,
    submitting,
    onTimeoutTurn,
  ]);

  const handleNextRoundClick = async (isManualSkip: boolean) => {
    if (room.status !== 'round_end' || submitting) return;
    if (nextRoundTriggeredRef.current === room.roundNumber) return;
    nextRoundTriggeredRef.current = room.roundNumber;
    if (isManualSkip) {
      soundFX.playCardMove();
      setDismissedRoundModal(true);
    }
    setSubmitting(true);
    try {
      await onNextRound(room.roundNumber);
    } catch {
      nextRoundTriggeredRef.current = null;
    } finally {
      setSubmitting(false);
    }
  };

  // Reset modal dismiss & next-round trigger guard when a new round ends or starts playing
  useEffect(() => {
    if (room.status === 'playing') {
      nextRoundTriggeredRef.current = null;
      lastSummaryEndedAtRef.current = null;
      setDismissedRoundModal(false);
      setRoundEndElapsed(0);
      return;
    }
    const endedAt = room.lastRoundSummary?.roundEndedAt || null;
    if (endedAt && lastSummaryEndedAtRef.current !== endedAt) {
      lastSummaryEndedAtRef.current = endedAt;
      setDismissedRoundModal(false);
      setRoundEndElapsed(Math.max(0, Math.floor((Date.now() - endedAt) / 1000)));
    }
  }, [room.status, room.roundNumber, room.lastRoundSummary?.roundEndedAt]);

  // Next Round 20s timer matching LeastScore: Skip button locked while remaining > 10s, auto-starts at 20s
  useEffect(() => {
    if (room.status !== 'round_end' || !room.lastRoundSummary) return;

    const baseTime = room.lastRoundSummary.roundEndedAt || Date.now();
    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - baseTime) / 1000));
      setRoundEndElapsed(elapsed);
      if (
        elapsed >= 20 &&
        nextRoundTriggeredRef.current !== room.roundNumber &&
        !submitting
      ) {
        nextRoundTriggeredRef.current = room.roundNumber;
        onNextRound(room.roundNumber).catch(() => {
          nextRoundTriggeredRef.current = null;
        });
      }
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [room.status, room.roundNumber, room.lastRoundSummary, submitting, onNextRound]);

  const selectedCards: Card[] = me.hand.filter((c) => selectedCardIds.includes(c.id));
  const discardValidation = isValidDiscard(selectedCards);
  const canDeclareNow = canPlayerDeclare(room, currentUser.id);
  const declareRoundUnlocked =
    room.turnsPlayedInRound >= room.players.filter((p) => !p.isEliminated).length;
  const myHandSum = getHandSum(me.hand);

  const canSubmitMove =
    isMyTurn && discardValidation.valid && drawSource !== null && !submitting;

  // Allow selecting/deselecting own hand cards AT ANY TIME (even when not my turn!)
  const toggleCardSelection = (cardId: string) => {
    if (me.isEliminated) return;
    soundFX.playCardMove();
    setActionError(null);
    setHintText(null);
    setSelectedCardIds((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
    );
  };

  const handleMakeMoveClick = async () => {
    if (!isMyTurn || submitting) return;
    if (!discardValidation.valid) {
      setActionError(discardValidation.reason || 'Select a valid card combination to discard');
      return;
    }
    if (!drawSource) {
      setActionError('Select a card to draw from either the Draw Deck or the Open Pile');
      return;
    }
    setSubmitting(true);
    setActionError(null);
    setHintText(null);
    soundFX.playCardMove();
    try {
      await onMakeMove(selectedCardIds, drawSource, selectedVisibleIdx);
      setSelectedCardIds([]);
      setDrawSource(null);
      setSelectedVisibleIdx(0);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Move failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDeclare = async () => {
    if (!isMyTurn || !canDeclareNow || submitting) return;
    setShowDeclareModal(false);
    setSubmitting(true);
    setActionError(null);
    setHintText(null);
    soundFX.playDeclare();
    try {
      await onDeclare();
      setSelectedCardIds([]);
      setDrawSource(null);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Declare failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleHintClick = () => {
    if (!me || me.hand.length === 0) return;
    soundFX.playCardMove();
    const hint = getBestHint(me.hand, room.visibleCards, canDeclareNow);
    setHintText(hint.explanation);
    if (!hint.recommendDeclare) {
      setSelectedCardIds(hint.discardIds);
      if (isMyTurn) {
        setDrawSource(hint.drawFrom);
        setSelectedVisibleIdx(hint.visibleIndex);
      }
    }
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(room.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleSendChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const text = chatInput;
    setChatInput('');
    await onSendChat(text);
  };

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    await onUpdateName(nameInput.trim());
    setEditingName(false);
  };

  const toggleSound = () => {
    if (onToggleSound) {
      onToggleSound();
      return;
    }
    const next = !localSoundEnabled;
    setLocalSoundEnabled(next);
    soundFX.savePreference(next, currentUser.id);
  };

  const nextRoundAutoStartRemaining = Math.max(0, 20 - roundEndElapsed);
  const nextRoundUnlockRemaining = Math.max(0, nextRoundAutoStartRemaining - 10);

  const activeTurnPlayer = room.players.find((p) => p.id === room.currentTurnPlayerId);
  const isBotOrAutoTurn =
    Boolean(activeTurnPlayer?.isBot) ||
    Boolean(activeTurnPlayer?.disconnectedAt) ||
    (activeTurnPlayer?.missedTurns || 0) > 0 ||
    (isMyTurn && autoPlay);

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#FAF9F5] text-stone-900 flex flex-col">
      {/* Single-Line Top Header Bar: Icon-only Back button, NO LeastScore title, all items fit on one line */}
      <header className="w-full max-w-full bg-white border-b border-stone-200 px-2 sm:px-3 py-1.5 sm:py-2 flex items-center justify-between gap-1 sm:gap-2 whitespace-nowrap overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            onClick={onTempBack}
            title="Go Back (Rejoin within 5 mins; Bot plays meanwhile)"
            aria-label="Back"
            className="p-1 sm:p-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 flex items-center justify-center transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <div className="flex items-center gap-1 bg-stone-100 border border-stone-200 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-md text-[10px] sm:text-xs font-mono">
            <span className="hidden sm:inline text-stone-500">CODE:</span>
            <span className="font-bold text-stone-900">{room.code}</span>
            <button
              onClick={copyRoomCode}
              title="Copy Lobby Code"
              className="ml-0.5 text-stone-500 hover:text-stone-900 transition-colors"
            >
              {copiedCode ? (
                <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              )}
            </button>
          </div>

          <span className="text-[10px] sm:text-xs text-stone-500">
            R<strong className="text-stone-800">{room.roundNumber}</strong>
            <span className="hidden sm:inline">
              {' '}· Max: <strong className="text-stone-800">{room.settings.eliminationPoints}</strong> · Cards:{' '}
              <strong className="text-stone-800">{room.settings.cardsPerPlayer || 5}</strong>
            </span>
          </span>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            onClick={toggleSound}
            title={soundEnabled ? 'Mute Sound Effects' : 'Unmute Sound Effects'}
            aria-label={soundEnabled ? 'Mute Sound Effects' : 'Unmute Sound Effects'}
            className="p-1 sm:p-1.5 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700"
          >
            {soundEnabled ? (
              <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-stone-400" />
            )}
          </button>

          <button
            onClick={() => {
              setNameInput(me.name);
              setEditingName(true);
            }}
            title="Change your display name"
            className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg text-[10px] sm:text-xs font-medium border border-stone-200 bg-stone-50 hover:bg-stone-100 flex items-center gap-1 sm:gap-1.5"
          >
            <span className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-stone-900 text-white flex items-center justify-center text-[8px] sm:text-[10px] font-bold">
              {me.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="hidden sm:inline font-semibold text-stone-800 max-w-[90px] truncate">
              {me.name}
            </span>
            <Pencil className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-stone-400" />
          </button>

          <button
            onClick={() => setShowScoreboard((v) => !v)}
            title="Toggle Scoreboard"
            className={`px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-medium border flex items-center gap-1 transition-colors ${
              showScoreboard
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'
            }`}
          >
            <Table2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span className="hidden sm:inline">Scores</span>
          </button>

          <button
            onClick={() => setShowChat((v) => !v)}
            title="Toggle Chat"
            className={`px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-medium border flex items-center gap-1 transition-colors ${
              showChat
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'
            }`}
          >
            <MessageSquare className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span className="hidden sm:inline">Chat </span>({room.chat.length})
          </button>

          <button
            onClick={() => setShowLeaveModal(true)}
            title="Exit Room"
            className="px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-medium border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 flex items-center gap-1 transition-colors"
          >
            <LogOut className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 max-w-6xl w-full mx-auto p-1.5 sm:p-4 flex flex-col gap-2.5 sm:gap-4 min-w-0">
        {/* Opponents Row — same multi-column layout on every screen; compact on phones */}
        <div className="grid grid-cols-3 lg:grid-cols-4 gap-1.5 sm:gap-3">
          {opponents.map((opp) => {
            const isOppTurn = room.status === 'playing' && room.currentTurnPlayerId === opp.id;
            const isOppBotOrAuto =
              opp.isBot || Boolean(opp.disconnectedAt) || (opp.missedTurns || 0) > 0;

            return (
              <div
                key={opp.id}
                className={`bg-white rounded-lg sm:rounded-xl border p-1.5 sm:p-3 flex flex-col justify-between min-w-0 transition-all ${
                  isOppTurn
                    ? isOppBotOrAuto
                      ? 'border-amber-500 ring-2 ring-amber-400/30 bg-amber-50/20 shadow-sm'
                      : 'border-emerald-600 ring-2 ring-emerald-500/20 bg-emerald-50/20 shadow-sm'
                    : 'border-stone-200'
                } ${opp.isEliminated ? 'opacity-60 bg-stone-100' : ''}`}
              >
                <div className="flex items-center justify-between gap-1 sm:gap-2 mb-1 sm:mb-2">
                  <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                    <div
                      className={`w-5 h-5 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-[8px] sm:text-xs font-bold shrink-0 ${
                        isOppTurn
                          ? isOppBotOrAuto
                            ? 'bg-amber-600 text-white'
                            : 'bg-emerald-600 text-white'
                          : 'bg-stone-100 text-stone-700 border border-stone-300'
                      }`}
                    >
                      {opp.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div
                        className={`text-[10px] sm:text-sm font-semibold flex items-center gap-0.5 sm:gap-1 min-w-0 ${
                          opp.isEliminated ? 'text-stone-500' : 'text-stone-900'
                        }`}
                      >
                        <span className="truncate">{opp.name}</span>
                        {opp.isBot && (
                          <span
                            title="Bot Player"
                            className={`shrink-0 ${opp.isEliminated ? 'grayscale opacity-60' : ''}`}
                          >
                            🤖
                          </span>
                        )}
                        {opp.isKicked ? (
                          <span
                            title="Kicked"
                            aria-label="Kicked"
                            className="inline-flex items-center justify-center px-1 py-0 text-[8px] sm:text-[10px] font-extrabold rounded bg-stone-200 text-stone-600 border border-stone-300 leading-tight shrink-0"
                          >
                            K
                          </span>
                        ) : (
                          opp.isEliminated && (
                            <span
                              title="Eliminated"
                              aria-label="Eliminated"
                              className="inline-flex items-center justify-center px-1 py-0 text-[8px] sm:text-[10px] font-extrabold rounded bg-stone-200 text-stone-600 border border-stone-300 leading-tight shrink-0"
                            >
                              E
                            </span>
                          )
                        )}
                        {opp.isHost && (
                          <span className="hidden sm:inline text-[10px] bg-stone-100 border border-stone-300 px-1.5 rounded text-stone-600 shrink-0">
                            Host
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] sm:text-xs text-stone-500 whitespace-nowrap">
                        <span className="hidden sm:inline">Score: </span>
                        <strong className={opp.isEliminated ? 'text-stone-500' : 'text-stone-800'}>
                          {opp.score}
                        </strong>
                        /{room.settings.eliminationPoints}
                      </div>
                    </div>
                  </div>

                  {isHost && !opp.isKicked && (
                    <button
                      onClick={() => setConfirmKickTarget({ id: opp.id, name: opp.name })}
                      title={`Kick ${opp.name}`}
                      aria-label={`Kick ${opp.name}`}
                      className="text-red-600 hover:text-red-800 hover:bg-red-50 p-0.5 sm:p-1.5 rounded-md sm:rounded-lg border border-red-200/70 flex items-center transition-colors shrink-0"
                    >
                      <UserX className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-1 pt-1 sm:pt-2 border-t border-stone-100 min-w-0">
                  {opp.isKicked ? (
                    <span className="text-[8.5px] sm:text-xs font-semibold text-stone-500 uppercase truncate">
                      Kicked
                    </span>
                  ) : opp.isEliminated ? (
                    <span className="text-[8.5px] sm:text-xs font-semibold text-red-600 uppercase truncate">
                      Eliminated
                    </span>
                  ) : isOppTurn ? (
                    <span
                      className={`text-[8.5px] sm:text-[11px] font-semibold px-1.5 sm:px-2 py-0.5 rounded-full flex items-center gap-0.5 sm:gap-1 animate-pulse border whitespace-nowrap ${
                        isOppBotOrAuto
                          ? 'text-amber-900 bg-amber-100 border-amber-300'
                          : 'text-emerald-900 bg-emerald-100 border-emerald-300'
                      }`}
                    >
                      {isOppBotOrAuto ? '🤖 ' : ''}Thinking {secondsLeft}s
                    </span>
                  ) : (
                    <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                      <MiniCardBack className="w-3 h-[18px] sm:w-4 sm:h-6" />
                      <span className="text-[8.5px] sm:text-xs text-emerald-700 font-medium truncate">
                        {opp.disconnectedAt ? '🤖 Away' : 'Remaining'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Center Play Table Area */}
        <div className="bg-[#F2EFE9] border border-stone-300 rounded-2xl p-2 sm:p-6 flex flex-col items-center justify-between gap-3 sm:gap-6 shadow-inner sm:min-h-[360px]">
          {/* Turn Status, Countdown Timer & Auto-drops Banner */}
          <div className="w-full flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 border-b border-stone-300/70 pb-2 sm:pb-3">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <span
                className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0 ${
                  isBotOrAutoTurn ? 'bg-amber-500 animate-ping' : 'bg-emerald-600 animate-ping'
                }`}
              />
              <span className="text-[11px] sm:text-sm font-semibold text-stone-900 truncate">
                {me.isEliminated
                  ? `Spectator · ${activeTurnPlayer?.name || 'Player'}`
                  : isMyTurn && autoPlay
                  ? '🤖 Auto Mode'
                  : isMyTurn
                  ? 'Active Turn'
                  : autoPlay
                  ? `🤖 Auto (${activeTurnPlayer?.name || 'Player'})`
                  : `${isBotOrAutoTurn ? '🤖 ' : ''}${activeTurnPlayer?.name || 'Player'}'s Turn`}
              </span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs shrink-0">
              {room.status === 'playing' && (
                <div
                  className={`flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full font-mono font-bold border whitespace-nowrap ${
                    secondsLeft <= 10
                      ? 'bg-red-50 text-red-700 border-red-300 animate-pulse'
                      : isBotOrAutoTurn
                      ? 'bg-amber-50 text-amber-900 border-amber-300'
                      : 'bg-emerald-50 text-emerald-900 border-emerald-300'
                  }`}
                >
                  <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                  <span>{secondsLeft}s</span>
                </div>
              )}

              {!me.isEliminated && (
                <span
                  className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full font-semibold border whitespace-nowrap ${
                    me.missedTurns > 0
                      ? 'text-amber-800 bg-amber-100 border-amber-300'
                      : 'text-stone-700 bg-white/80 border-stone-300'
                  }`}
                >
                  Auto-drops: {me.missedTurns}/3
                </span>
              )}
            </div>
          </div>

          {/* Center Table: Open Pile on the LEFT, Draw Deck on the RIGHT — fixed wide max separation whether 1 or 5 open cards */}
          <div className="w-full max-w-4xl mx-auto px-1 sm:px-6 flex flex-nowrap items-start justify-between gap-10 sm:gap-24 my-1 sm:my-2">
            <div className="flex flex-col items-center min-w-0 shrink-0">
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-stone-500 mb-5 sm:mb-6 whitespace-nowrap">
                Open Pile
              </span>
              <div
                className={`flex flex-nowrap items-center ${
                  room.visibleCards.length >= 5
                    ? '-space-x-7 sm:space-x-0 sm:gap-2.5'
                    : room.visibleCards.length === 4
                    ? '-space-x-5 sm:space-x-0 sm:gap-2.5'
                    : room.visibleCards.length === 3
                    ? '-space-x-2.5 sm:space-x-0 sm:gap-2.5'
                    : 'gap-1 sm:gap-2.5'
                }`}
              >
                {room.visibleCards.map((vc, idx) => {
                  const isThisOpenSelected =
                    isMyTurn && drawSource === 'visible' && selectedVisibleIdx === idx;
                  return (
                    <PlayingCard
                      key={vc.id}
                      card={vc}
                      size="md"
                      selected={isThisOpenSelected}
                      onClick={() => {
                        if (isMyTurn) {
                          soundFX.playCardMove();
                          if (drawSource === 'visible' && selectedVisibleIdx === idx) {
                            setDrawSource(null);
                          } else {
                            setDrawSource('visible');
                            setSelectedVisibleIdx(idx);
                          }
                          setActionError(null);
                        }
                      }}
                    />
                  );
                })}
              </div>
              <span className="text-[10px] sm:text-xs font-medium text-stone-600 mt-2.5 sm:mt-3 whitespace-nowrap">
                {drawSource === 'visible' && room.visibleCards[selectedVisibleIdx]
                  ? `▲ Selected ${room.visibleCards[selectedVisibleIdx].rank}${getSuitSymbol(
                      room.visibleCards[selectedVisibleIdx].suit
                    )}`
                  : 'Tap card to pick'}
              </span>
            </div>

            <div className="flex flex-col items-center shrink-0">
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-stone-500 mb-5 sm:mb-6 whitespace-nowrap">
                Deck ({room.deck.length})
              </span>
              <div className="relative flex items-center justify-center">
                {isShufflingDeck && (
                  <>
                    <div className="absolute inset-0 pointer-events-none z-20 animate-shuffle-left">
                      <PlayingCard faceDown size="md" />
                    </div>
                    <div className="absolute inset-0 pointer-events-none z-20 animate-shuffle-right">
                      <PlayingCard faceDown size="md" />
                    </div>
                  </>
                )}
                <PlayingCard
                  faceDown
                  size="md"
                  badgeCount={room.deck.length}
                  selected={isMyTurn && drawSource === 'deck'}
                  onClick={() => {
                    if (isMyTurn) {
                      soundFX.playCardMove();
                      setDrawSource((prev) => (prev === 'deck' ? null : 'deck'));
                      setActionError(null);
                    }
                  }}
                />
              </div>
              <span className="text-[10px] sm:text-xs font-medium text-stone-600 mt-2.5 sm:mt-3 whitespace-nowrap">
                {isShufflingDeck
                  ? 'Shuffling...'
                  : drawSource === 'deck'
                  ? '▲ Selected'
                  : 'Tap deck to pick'}
              </span>
              {isMyTurn && (
                <button
                  type="button"
                  disabled={isShufflingDeck || submitting}
                  onClick={handleShuffleDeckClick}
                  title="Shuffle Deck"
                  className={`mt-1 sm:mt-2 px-2 sm:px-3 py-0.5 sm:py-1 rounded-md sm:rounded-lg text-[9.5px] sm:text-[11px] font-semibold border flex items-center gap-1 transition-all whitespace-nowrap ${
                    isShufflingDeck
                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                      : 'bg-white hover:bg-stone-100 text-stone-800 border-stone-300 shadow-2xs cursor-pointer'
                  }`}
                >
                  <Shuffle
                    className={`w-2.5 h-2.5 sm:w-3 sm:h-3 ${isShufflingDeck ? 'animate-spin text-amber-700' : ''}`}
                  />
                  <span>{isShufflingDeck ? 'Shuffling...' : 'Shuffle'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Center Action Controls: Single horizontal row — primary Declare & Make Move + compact Hint & Auto */}
          <div className="flex flex-nowrap sm:flex-wrap items-center justify-center gap-1 sm:gap-2.5 w-full pt-1.5 sm:pt-2 border-t border-stone-300/70">
            <button
              type="button"
              disabled={!isMyTurn || !canDeclareNow || submitting}
              onClick={() => setShowDeclareModal(true)}
              title={
                declareRoundUnlocked
                  ? 'Declare now with your current hand'
                  : `Declare unlocks after 1 full round (${room.turnsPlayedInRound}/${room.players.filter((p) => !p.isEliminated).length})`
              }
              className={`justify-center min-h-[30px] sm:min-h-[40px] px-2 sm:px-5 py-1 sm:py-2.5 rounded-lg sm:rounded-xl font-semibold text-[10.5px] sm:text-sm flex items-center gap-1 sm:gap-2 border transition-all whitespace-nowrap shrink-0 ${
                isMyTurn && canDeclareNow
                  ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-sm cursor-pointer'
                  : 'bg-stone-200 text-stone-400 border-stone-300 cursor-not-allowed'
              }`}
            >
              <Crown className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
              <span>Declare ({myHandSum} pts)</span>
            </button>

            <button
              type="button"
              disabled={!canSubmitMove}
              onClick={handleMakeMoveClick}
              className={`justify-center min-h-[30px] sm:min-h-[40px] px-2.5 sm:px-6 py-1 sm:py-2.5 rounded-lg sm:rounded-xl font-semibold text-[10.5px] sm:text-sm flex items-center gap-1 sm:gap-2 border transition-all whitespace-nowrap shrink-0 ${
                canSubmitMove
                  ? 'bg-stone-900 hover:bg-stone-800 text-white border-stone-900 shadow-sm cursor-pointer'
                  : 'bg-stone-200 text-stone-400 border-stone-300 cursor-not-allowed'
              }`}
            >
              <Play className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
              <span>Make Move</span>
            </button>

            <button
              type="button"
              disabled={me.isEliminated}
              onClick={handleHintClick}
              title="Hint — suggest optimal move"
              className="justify-center min-h-[30px] sm:min-h-[36px] px-1.5 sm:px-3 py-1 sm:py-2 rounded-lg font-medium text-[9.5px] sm:text-xs flex items-center gap-0.5 sm:gap-1 border bg-white hover:bg-stone-100 text-stone-700 border-stone-300 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              <Lightbulb className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-500 shrink-0" />
              <span>Hint</span>
            </button>

            <button
              type="button"
              disabled={me.isEliminated || room.status !== 'playing'}
              onClick={() => {
                soundFX.playCardMove();
                setAutoPlay((prev) => !prev);
              }}
              title={
                autoPlay
                  ? 'Auto Mode is ON — Click again to stop automatic discard & pick'
                  : 'Enable Auto Mode — automatically discards & picks optimal card on your turns'
              }
              className={`justify-center min-h-[30px] sm:min-h-[36px] px-1.5 sm:px-3 py-1 sm:py-2 rounded-lg font-semibold text-[9.5px] sm:text-xs flex items-center gap-0.5 sm:gap-1 border transition-all whitespace-nowrap shrink-0 ${
                autoPlay
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700 shadow-sm cursor-pointer'
                  : 'bg-white hover:bg-stone-100 text-stone-700 border-stone-300 cursor-pointer'
              } ${
                me.isEliminated || room.status !== 'playing'
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
              }`}
            >
              <Bot
                className={`w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 ${
                  autoPlay ? 'animate-pulse text-white' : 'text-stone-700'
                }`}
              />
              {autoPlay ? (
                <>
                  <span className="sm:hidden">On</span>
                  <span className="hidden sm:inline">Auto: ON</span>
                </>
              ) : (
                <span>Auto</span>
              )}
            </button>
          </div>

          {(room.status === 'round_end' || room.status === 'game_over') &&
            dismissedRoundModal && (
              <button
                type="button"
                onClick={() => setDismissedRoundModal(false)}
                className="justify-center min-h-[30px] sm:min-h-[36px] px-3 py-1 sm:py-1.5 rounded-lg font-semibold text-[10.5px] sm:text-xs bg-stone-900 text-white flex items-center gap-1.5"
              >
                <Eye className="w-3.5 h-3.5 shrink-0" />
                <span>Show Round Results</span>
              </button>
            )}

          {/* Error & Explicit Hint Feedback Banner */}
          {(actionError || hintText || (selectedCards.length > 0 && !discardValidation.valid)) && (
            <div className="w-full max-w-xl text-center">
              {actionError || (selectedCards.length > 0 && !discardValidation.valid) ? (
                <div className="bg-red-50 border border-red-200 text-red-700 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg text-[10px] sm:text-xs font-medium flex items-center justify-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span>{actionError || discardValidation.reason}</span>
                </div>
              ) : (
                hintText && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-900 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg text-[10px] sm:text-xs font-medium">
                    💡 {hintText}
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {/* Player's Own Hand Area */}
        <div
          className={`bg-white border rounded-xl sm:rounded-2xl p-2 sm:p-5 flex flex-col items-center gap-1.5 sm:gap-4 shadow-xs transition-all ${
            isMyTurn ? 'border-emerald-600 ring-2 ring-emerald-500/15' : 'border-stone-200'
          }`}
        >
          <div className="w-full flex flex-nowrap items-center justify-between gap-1 sm:gap-2">
            <div className="flex flex-nowrap items-center gap-1 sm:gap-2 min-w-0 flex-1">
              <div
                className={`w-4 h-4 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-[8px] sm:text-xs font-bold shrink-0 ${
                  me.isEliminated ? 'bg-stone-300 text-stone-600' : 'bg-stone-900 text-white'
                }`}
              >
                {me.name.slice(0, 2).toUpperCase()}
              </div>
              <span
                className={`text-[10px] sm:text-sm font-bold truncate min-w-0 ${
                  me.isEliminated ? 'text-stone-500' : 'text-stone-900'
                }`}
              >
                {me.name} (You)
              </span>
              {isMyTurn && (
                <span
                  title="Active Turn"
                  aria-label="Active Turn"
                  className="inline-block w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200 animate-pulse shrink-0"
                />
              )}
              {isHost && (
                <span className="text-[8px] sm:text-xs bg-stone-100 border border-stone-300 px-1 sm:px-2 py-0 sm:py-0.5 rounded text-stone-700 font-medium shrink-0 leading-tight">
                  Host
                </span>
              )}
              {me.isEliminated && (
                <span
                  title="Eliminated"
                  className="text-[8px] sm:text-xs bg-stone-200 border border-stone-300 text-stone-700 px-1 sm:px-1.5 py-0 sm:py-0.5 rounded font-extrabold shrink-0 leading-tight"
                >
                  E
                </span>
              )}
              {autoPlay && (
                <span className="text-[8px] sm:text-xs bg-amber-50 border border-amber-300 text-amber-900 px-1 sm:px-2 py-0 sm:py-0.5 rounded-full font-semibold flex items-center gap-0.5 shrink-0 whitespace-nowrap leading-snug">
                  🤖 <span className="sm:hidden">Auto</span>
                  <span className="hidden sm:inline">Auto ON</span>
                </span>
              )}
            </div>

            <div className="flex flex-nowrap items-center gap-1 sm:gap-2.5 text-[8.5px] sm:text-xs shrink-0">
              {!me.isEliminated && (
                <span className="bg-stone-100 border border-stone-200 px-1.5 py-0.5 sm:px-3 sm:py-1 rounded-full font-medium text-stone-700 whitespace-nowrap leading-tight">
                  Hand Sum:{' '}
                  <strong className="text-stone-950 text-[9px] sm:text-sm">{myHandSum}</strong> pts
                </span>
              )}
              <span className="bg-stone-100 border border-stone-200 px-1.5 py-0.5 sm:px-3 sm:py-1 rounded-full font-medium text-stone-700 whitespace-nowrap leading-tight">
                Total Score:{' '}
                <strong className="text-stone-950 text-[9px] sm:text-sm">{me.score}</strong>/
                {room.settings.eliminationPoints}
              </span>
            </div>
          </div>

          {me.isEliminated ? (
            <div className="py-6 px-4 text-center bg-stone-50 border border-stone-200 rounded-xl w-full space-y-1">
              <div className="text-red-600 font-bold text-sm">
                You reached {me.score} pts and are Eliminated — Spectator Mode Active
              </div>
              <p className="text-xs text-stone-500">
                You can continue watching the live table, open cards, and scoreboard as the remaining players finish the match.
              </p>
            </div>
          ) : (
            <div
              className={`w-full flex flex-nowrap items-center justify-center pt-4 sm:pt-6 pb-1 ${
                me.hand.length > 5
                  ? '-space-x-2.5 sm:space-x-0 sm:gap-3'
                  : 'gap-[3px] sm:gap-3'
              }`}
            >
              {me.hand.map((card, idx) => {
                const isSelected = selectedCardIds.includes(card.id);
                const isCardFaceDown = isDealingRound && idx >= revealedCardCount;
                return (
                  <div
                    key={card.id}
                    className={isDealingRound ? 'animate-deal-reveal' : ''}
                    style={
                      isDealingRound
                        ? { animationDelay: `${idx * 100}ms` }
                        : undefined
                    }
                  >
                    <PlayingCard
                      card={card}
                      faceDown={isCardFaceDown}
                      size="lg"
                      selected={isSelected}
                      onClick={() => toggleCardSelection(card.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Single Unified Players & Scoreboard Table
            - Single `<table>` so every row top & bottom line matches 100% seamlessly
            - Active Turn indicator is at the TOP of the active player's row (above their name) instead of beside the name:
              - Green (`text-emerald-700`) for normal human Active Turn
              - Orange/Amber (`text-amber-700`) with 🤖 Bot emoji if Bot or Auto-drop mode is active
            - Rounds column contains a per-row scrollable 4-round strip (`PlayerRoundsStrip`) so scrolling one player's rounds only scrolls that player's row! */}
        {showScoreboard && (
          <div className="bg-white border border-stone-200 rounded-xl sm:rounded-2xl p-2 sm:p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 mb-2 sm:mb-3">
              <h3 className="text-xs sm:text-sm font-bold text-stone-900">Players &amp; Scoreboard</h3>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[9px] sm:text-[11px] text-stone-600">
                <span>
                  <strong className="text-emerald-600">0★</strong> Winner
                </span>
                <span>
                  <strong className="text-blue-600">+Pts</strong> Declare
                </span>
                <span>
                  <strong className="text-red-600">+Pts</strong> Undercut
                </span>
              </div>
            </div>

            <div className="w-full overflow-x-auto no-scrollbar">
              <table className="w-full text-left border-collapse text-[9px] sm:text-xs">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-stone-500 uppercase text-[8px] sm:text-[11px]">
                    <th className="pt-1.5 pb-2.5 sm:py-2.5 px-1 sm:px-3 font-semibold">Player</th>
                    <th className="pt-1.5 pb-2.5 sm:py-2.5 px-1 sm:px-3 font-semibold">Draw</th>
                    <th className="pt-1.5 pb-2.5 sm:py-2.5 px-1 sm:px-3 font-semibold">Discard</th>
                    <th className="pt-1.5 pb-2.5 sm:py-2.5 px-1 sm:px-3 font-semibold">Total</th>
                    <th className="pt-1.5 pb-2.5 sm:py-2.5 px-1 sm:px-3 font-semibold">Rounds</th>
                    <th className="pt-1.5 pb-2.5 sm:py-2.5 px-1 sm:px-3 font-semibold text-right">
                      Act
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {room.players.map((p) => {
                    const isMe = p.id === currentUser.id;
                    const isTurn =
                      room.status === 'playing' && room.currentTurnPlayerId === p.id;
                    const isRowBotOrAuto =
                      p.isBot ||
                      Boolean(p.disconnectedAt) ||
                      (p.missedTurns || 0) > 0 ||
                      (isMe && autoPlay);

                    return (
                      <tr
                        key={p.id}
                        className={`transition-colors ${
                          isTurn
                            ? isRowBotOrAuto
                              ? 'bg-amber-50/70 border-t-2 border-t-amber-500'
                              : 'bg-emerald-50/60 border-t-2 border-t-emerald-600'
                            : p.isEliminated
                            ? 'bg-stone-100/90 text-stone-400 opacity-75'
                            : 'hover:bg-stone-50/60'
                        }`}
                      >
                        <td
                          className={`relative py-2.5 sm:py-3.5 px-1 sm:px-3 font-semibold ${
                            p.isEliminated ? 'text-stone-400' : 'text-stone-900'
                          }`}
                        >
                          {/* Active Turn / Thinking badge sitting directly ON the row top border line */}
                          {isTurn && (
                            <span
                              className={`absolute -top-2 sm:-top-2.5 left-1 sm:left-3 z-10 inline-flex items-center gap-1 text-[7px] sm:text-[9px] font-bold uppercase tracking-wider px-1.5 sm:px-2 py-0.5 rounded-full shadow-2xs whitespace-nowrap ${
                                isRowBotOrAuto
                                  ? 'bg-amber-500 text-white'
                                  : 'bg-emerald-600 text-white'
                              }`}
                            >
                              {isMe && autoPlay
                                ? '🤖 Auto Mode'
                                : p.isBot || p.disconnectedAt
                                ? '🤖 Thinking...'
                                : isRowBotOrAuto
                                ? '⚡ Auto Turn'
                                : isMe
                                ? '● Active Turn'
                                : '● Thinking...'}
                            </span>
                          )}

                          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                            <span
                              className={`w-4 h-4 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[7px] sm:text-[10px] font-bold shrink-0 ${
                                p.isEliminated
                                  ? 'bg-stone-300 text-stone-500'
                                  : isTurn
                                  ? isRowBotOrAuto
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-emerald-600 text-white'
                                  : 'bg-stone-900 text-white'
                              }`}
                            >
                              {p.name.slice(0, 2).toUpperCase()}
                            </span>
                            <span
                              className={`truncate max-w-[42px] sm:max-w-none ${
                                p.isEliminated ? 'text-stone-500' : ''
                              }`}
                            >
                              {p.name}
                            </span>
                            {p.isBot && (
                              <span
                                title="Bot"
                                className={`shrink-0 ${p.isEliminated ? 'grayscale opacity-60' : ''}`}
                              >
                                🤖
                              </span>
                            )}
                            {p.isKicked ? (
                              <span
                                title="Kicked"
                                aria-label="Kicked"
                                className="inline-flex items-center justify-center px-1 sm:px-1.5 py-0.5 text-[7.5px] sm:text-[10px] font-extrabold rounded bg-stone-200 text-stone-600 border border-stone-300 leading-none shrink-0"
                              >
                                K
                              </span>
                            ) : (
                              p.isEliminated && (
                                <span
                                  title="Eliminated"
                                  aria-label="Eliminated"
                                  className="inline-flex items-center justify-center px-1 sm:px-1.5 py-0.5 text-[7.5px] sm:text-[10px] font-extrabold rounded bg-stone-200 text-stone-600 border border-stone-300 leading-none shrink-0"
                                >
                                  E
                                </span>
                              )
                            )}
                            {isMe && (
                              <span
                                className={`hidden sm:inline text-[10px] ${
                                  p.isEliminated ? 'text-stone-400' : 'text-stone-500'
                                }`}
                              >
                                (You)
                              </span>
                            )}
                            {p.isHost && (
                              <span
                                className={`hidden sm:inline text-[10px] bg-stone-100 border border-stone-300 px-1.5 rounded ${
                                  p.isEliminated ? 'text-stone-400' : 'text-stone-700'
                                }`}
                              >
                                Host
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Last Draw — plain card text (no box) when taken from the open pile */}
                        <td
                          className={`py-1.5 sm:py-2.5 px-1 sm:px-3 whitespace-nowrap ${
                            p.isEliminated ? 'opacity-60' : ''
                          }`}
                        >
                          {p.lastDraw ? (
                            p.lastDraw.from === 'visible' && p.lastDraw.card ? (
                              <span
                                className={`font-bold ${
                                  p.isEliminated
                                    ? 'text-stone-400'
                                    : p.lastDraw.card.suit === 'hearts' ||
                                      p.lastDraw.card.suit === 'diamonds'
                                    ? 'text-red-600'
                                    : 'text-stone-900'
                                }`}
                              >
                                {p.lastDraw.card.rank}
                                {getSuitSymbol(p.lastDraw.card.suit)}
                              </span>
                            ) : (
                              <span className={p.isEliminated ? 'text-stone-400' : 'text-stone-600'}>
                                Deck
                              </span>
                            )
                          ) : (
                            '—'
                          )}
                        </td>

                        {/* Last Discard — plain card text (no box), wraps cleanly on mobile for 4-5 card drops */}
                        <td
                          className={`py-1.5 sm:py-2.5 px-1 sm:px-3 sm:whitespace-nowrap ${
                            p.isEliminated ? 'opacity-60' : ''
                          }`}
                        >
                          {p.lastDiscard && p.lastDiscard.length > 0 ? (
                            <span className="inline-flex flex-wrap sm:flex-nowrap items-center gap-x-1 gap-y-0.5 sm:gap-1.5 max-w-[54px] sm:max-w-none">
                              {p.lastDiscard.map((c) => (
                                <span
                                  key={c.id}
                                  className={`font-bold ${
                                    p.isEliminated
                                      ? 'text-stone-400'
                                      : c.suit === 'hearts' || c.suit === 'diamonds'
                                      ? 'text-red-600'
                                      : 'text-stone-900'
                                  }`}
                                >
                                  {c.rank}
                                  {getSuitSymbol(c.suit)}
                                </span>
                              ))}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>

                        <td className="py-1.5 sm:py-2.5 px-1 sm:px-3 whitespace-nowrap">
                          <span
                            className={`inline-block font-bold px-1 sm:px-2.5 py-0.5 rounded ${
                              p.isEliminated
                                ? 'bg-stone-200 text-stone-500 border border-stone-300'
                                : 'bg-stone-100 text-stone-900'
                            }`}
                          >
                            {p.score}
                            <span className="hidden sm:inline"> pts</span>
                          </span>
                        </td>

                        {/* Per-Row Independently Scrollable 4-Round Strip */}
                        <td
                          className={`py-1 sm:py-2 px-0.5 sm:px-3 ${
                            p.isEliminated ? 'opacity-60' : ''
                          }`}
                        >
                          <PlayerRoundsStrip
                            roundScores={p.roundScores}
                            maxRounds={maxRounds}
                          />
                        </td>

                        <td className="py-1.5 sm:py-2.5 px-1 sm:px-3 text-right whitespace-nowrap">
                          {isMe ? (
                            <button
                              onClick={() => setShowLeaveModal(true)}
                              title="Exit game"
                              aria-label="Exit game"
                              className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 font-medium p-1 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg border border-red-200 bg-red-50 hover:bg-red-100"
                            >
                              <LogOut className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                              <span className="hidden sm:inline text-xs">Exit</span>
                            </button>
                          ) : isHost && !p.isKicked ? (
                            <button
                              onClick={() => setConfirmKickTarget({ id: p.id, name: p.name })}
                              title={`Kick ${p.name}`}
                              aria-label={`Kick ${p.name}`}
                              className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 font-medium p-1 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg border border-red-200 bg-red-50 hover:bg-red-100"
                            >
                              <UserX className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                              <span className="hidden sm:inline text-xs">Kick</span>
                            </button>
                          ) : (
                            <span className="text-stone-400 px-1">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Declare */}
      {showDeclareModal && (
        <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-stone-300 rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <Crown className="w-5 h-5" />
              <h3 className="text-base font-bold text-stone-900">
                Confirm Declare ({myHandSum} pts)?
              </h3>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              Are you sure you want to declare your hand with <strong>{myHandSum} points</strong>?
              <br />• If no opponent has a strictly lower sum, you win with{' '}
              <strong className="text-emerald-600">0★ points</strong> (tying opponents get{' '}
              <strong className="text-blue-600">+0</strong>).
              <br />• Only if an opponent has a strictly lower sum do you suffer a{' '}
              <strong className="text-red-600">+20 + difference</strong> undercut penalty!
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowDeclareModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-stone-300 text-stone-700 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeclare}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1.5"
              >
                <Crown className="w-3.5 h-3.5" />
                Confirm Declare
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Host Kick */}
      {confirmKickTarget && (
        <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-stone-300 rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-stone-900">
              Kick {confirmKickTarget.name}?
            </h3>
            <p className="text-xs text-stone-600">
              Are you sure you want to kick <strong>{confirmKickTarget.name}</strong> from the game?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmKickTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-stone-300 text-stone-700 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = confirmKickTarget.id;
                  setConfirmKickTarget(null);
                  await onKickPlayer(id);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-700 flex items-center gap-1"
              >
                <UserX className="w-3.5 h-3.5" />
                Confirm Kick
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Name Modal */}
      {editingName && (
        <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleSaveName}
            className="bg-white border border-stone-300 rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4"
          >
            <h3 className="text-base font-bold text-stone-900">Change Your Display Name</h3>
            <p className="text-xs text-stone-500">
              The first two letters of your name are used as your profile avatar.
            </p>
            <input
              type="text"
              required
              maxLength={24}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-xl focus:outline-none focus:border-stone-900"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingName(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-stone-300 text-stone-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-stone-900 text-white"
              >
                Save Name
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Slide-out Chat Drawer */}
      {showChat && (
        <div className="fixed bottom-3 left-3 right-3 sm:left-auto sm:bottom-4 sm:right-4 sm:w-80 bg-white border border-stone-300 rounded-2xl shadow-xl flex flex-col z-40 overflow-hidden">
          <div className="bg-stone-100 border-b border-stone-200 px-4 py-2.5 flex items-center justify-between">
            <span className="text-xs font-bold text-stone-900">Room Chat ({room.code})</span>
            <button
              onClick={() => setShowChat(false)}
              className="text-xs text-stone-500 hover:text-stone-900 font-medium"
            >
              Close
            </button>
          </div>
          <div className="h-56 overflow-y-auto p-3 space-y-2 text-xs bg-[#FAF9F5]">
            {room.chat.length === 0 ? (
              <p className="text-stone-400 text-center py-8">No messages yet. Say hello!</p>
            ) : (
              room.chat.map((m) => (
                <div key={m.id} className="bg-white border border-stone-200 rounded-lg p-2">
                  <span className="font-bold text-stone-900">{m.senderName}: </span>
                  <span className="text-stone-700">{m.text}</span>
                </div>
              ))
            )}
          </div>
          <form
            onSubmit={handleSendChatSubmit}
            className="p-2 border-t border-stone-200 flex gap-1.5 bg-white"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 text-xs border border-stone-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-stone-900"
            />
            <button
              type="submit"
              className="bg-stone-900 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-stone-800"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}

      {/* Round End / Game Over Modal */}
      {(room.status === 'round_end' || room.status === 'game_over') &&
        room.lastRoundSummary &&
        !dismissedRoundModal && (
          <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-xs flex items-center justify-center p-2.5 sm:p-4 z-50">
            <div className="bg-white border border-stone-300 rounded-2xl max-w-2xl w-full p-3.5 sm:p-6 shadow-xl space-y-3 sm:space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="border-b border-stone-200 pb-3 sm:pb-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-stone-500">
                    {room.status === 'game_over'
                      ? 'Match Finished'
                      : `Round ${room.lastRoundSummary.roundNumber} Results`}
                  </span>

                  {room.status === 'round_end' && (
                    <div className="bg-stone-100 border border-stone-300 px-2.5 py-1 rounded-lg flex items-center gap-1.5 shrink-0">
                      <span className="text-[9px] sm:text-[10px] font-bold uppercase text-stone-500">
                        Next round in
                      </span>
                      <span className="text-xs sm:text-sm font-mono font-bold text-stone-900">
                        ⏱ {nextRoundAutoStartRemaining}s
                      </span>
                    </div>
                  )}

                  {room.status === 'game_over' && room.winnerId && (
                    <div className="bg-amber-50 border border-amber-300 px-2.5 py-1 rounded-lg shrink-0">
                      <span className="text-[10px] sm:text-xs font-bold text-stone-900 whitespace-nowrap">
                        🏆 {room.players.find((p) => p.id === room.winnerId)?.name} ★
                      </span>
                    </div>
                  )}
                </div>

                <h2 className="text-base sm:text-xl font-bold text-stone-900 leading-snug">
                  {room.lastRoundSummary.undercut
                    ? `⚠️ Undercut! ${room.lastRoundSummary.declarerName} penalized!`
                    : `♛ ${room.lastRoundSummary.declarerName} Won the Declare! ★`}
                </h2>
              </div>

              <p className="text-[11px] sm:text-xs leading-relaxed text-stone-600 bg-stone-50 border border-stone-200 p-2.5 sm:p-3 rounded-xl">
                <strong>{room.lastRoundSummary.declarerName}</strong> declared with{' '}
                <strong>{room.lastRoundSummary.declarerSum} pts</strong>. Lowest opponent hand was{' '}
                <strong>{room.lastRoundSummary.minOpponentSum} pts</strong>.{' '}
                {room.lastRoundSummary.undercut
                  ? `Because an opponent had a strictly lower sum, ${
                      room.lastRoundSummary.declarerName
                    } received an undercut loss of 20 + (${room.lastRoundSummary.declarerSum} - ${
                      room.lastRoundSummary.minOpponentSum
                    }) = +${
                      20 + (room.lastRoundSummary.declarerSum - room.lastRoundSummary.minOpponentSum)
                    } pts!`
                  : `Every opponent receives the difference between their hand sum and ${room.lastRoundSummary.declarerSum} pts (+0 on a tie).`}
              </p>

              <div className="space-y-2.5">
                {room.lastRoundSummary.playerResults.map((res) => {
                  const isWin = res.outcome === 'win';
                  const isLose = res.outcome === 'lose';
                  const scoreColor = isWin
                    ? 'text-emerald-600'
                    : isLose
                    ? 'text-red-600'
                    : 'text-blue-600';

                  return (
                    <div
                      key={res.playerId}
                      className={`border rounded-xl p-2.5 sm:p-3 grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_108px] items-center gap-x-2 gap-y-2 sm:gap-4 ${
                        res.eliminatedNow
                          ? 'bg-stone-100/90 border-stone-300'
                          : 'bg-[#FAF9F5] border-stone-200'
                      }`}
                    >
                      <div className="col-start-1 row-start-1 min-w-0">
                        <div className="text-xs sm:text-sm font-bold text-stone-900 flex flex-wrap items-center gap-1 sm:gap-1.5">
                          <span className="truncate max-w-[130px] sm:max-w-none">{res.name}</span>
                          {res.playerId === room.lastRoundSummary?.declarerId && (
                            <span className="text-[9px] sm:text-[10px] bg-amber-100 border border-amber-300 text-amber-900 px-1.5 py-0.5 rounded font-semibold shrink-0">
                              Declarer
                            </span>
                          )}
                          {isWin && (
                            <span className="text-[9px] sm:text-[10px] bg-emerald-100 border border-emerald-300 text-emerald-800 px-1.5 py-0.5 rounded font-semibold shrink-0">
                              ★ Winner
                            </span>
                          )}
                          {res.eliminatedNow && (
                            <span
                              title="Eliminated"
                              className="text-[9px] sm:text-[10px] bg-stone-200 border border-stone-300 text-stone-700 px-1.5 py-0.5 rounded font-bold shrink-0"
                            >
                              Eliminated
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] sm:text-xs text-stone-500 mt-0.5">
                          Hand Sum: <strong className="text-stone-800">{res.handSum} pts</strong>
                        </div>
                      </div>

                      <div className="col-start-2 row-start-1 sm:col-start-3 text-right shrink-0">
                        <div className={`text-xs sm:text-sm font-bold whitespace-nowrap ${scoreColor}`}>
                          {isWin ? '0★ pts' : `+${res.pointsAdded} pts`}
                        </div>
                        <div className="text-[11px] sm:text-xs text-stone-600 whitespace-nowrap">
                          Total: <strong>{res.newTotal}</strong> pts
                        </div>
                      </div>

                      <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 flex items-center justify-start sm:justify-center gap-1.5 pt-2 sm:pt-0 border-t sm:border-t-0 border-stone-200/80 overflow-x-auto no-scrollbar">
                        {res.hand.map((c) => (
                          <PlayingCard key={c.id} card={c} size="sm" className="shrink-0" />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-3 border-t border-stone-200">
                <button
                  onClick={() => setDismissedRoundModal(true)}
                  className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl text-xs font-medium border border-stone-300 text-stone-700 hover:bg-stone-50"
                >
                  View Table & Scoreboard
                </button>

                <div className="flex flex-wrap sm:flex-nowrap items-center justify-end gap-2">
                  {room.status === 'round_end' ? (
                    <button
                      disabled={nextRoundAutoStartRemaining > 10 || submitting}
                      onClick={() => handleNextRoundClick(true)}
                      className={`w-full sm:w-auto justify-center px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all ${
                        nextRoundAutoStartRemaining > 10 || submitting
                          ? 'bg-stone-200 text-stone-500 cursor-not-allowed'
                          : 'bg-stone-900 hover:bg-stone-800 text-white cursor-pointer'
                      }`}
                    >
                      {nextRoundAutoStartRemaining > 10 ? (
                        <span>Skip &amp; Play Next Round ({nextRoundUnlockRemaining}s)</span>
                      ) : (
                        <>
                          <span>Skip &amp; Play Next Round</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={onReturnToLobby}
                        className="flex-1 sm:flex-initial bg-white hover:bg-stone-100 text-stone-800 border border-stone-300 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium text-center"
                      >
                        Back to Room Lobby
                      </button>
                      <button
                        onClick={onPlayAgain}
                        className="flex-1 sm:flex-initial bg-stone-900 hover:bg-stone-800 text-white px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Play Again
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      {/* Confirm Permanent Exit vs Temporary Back Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-stone-300 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-stone-900">Confirm Exit or Step Away?</h3>
            <p className="text-xs text-stone-600 leading-relaxed">
              • <strong>Step Away (Rejoin within 5 mins):</strong> Keeps your seat in the match. While you are away, the Smart Bot will play your turns automatically until you click Rejoin.
              <br />• <strong>Confirm Exit:</strong> Permanently removes you from this table immediately.
            </p>
            <div className="grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center sm:justify-end gap-2 pt-2">
              <button
                onClick={() => setShowLeaveModal(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-medium border border-stone-300 text-stone-700 hover:bg-stone-50 flex items-center justify-center"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowLeaveModal(false);
                  await onTempBack();
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-stone-900 bg-stone-100 text-stone-900 hover:bg-stone-200 flex items-center justify-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Step Away (5m Rejoin)
              </button>
              <button
                onClick={async () => {
                  setShowLeaveModal(false);
                  await onLeaveRoom();
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-700 flex items-center justify-center gap-1"
              >
                <LogOut className="w-3.5 h-3.5" />
                Confirm Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
