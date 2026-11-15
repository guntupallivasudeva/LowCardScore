export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  isNew?: boolean;
}

export interface RoundScoreEntry {
  score: number;
  outcome: 'win' | 'lose' | 'other_declare';
}

export interface Player {
  id: string;
  name: string;
  email?: string;
  isHost: boolean;
  isBot: boolean;
  botDifficulty?: 'easy' | 'hard';
  hand: Card[];
  score: number;
  roundScores: RoundScoreEntry[];
  isEliminated: boolean;
  isKicked?: boolean;
  lastDraw?: { from: 'deck' | 'visible'; card?: Card };
  lastDiscard?: Card[];
  joinedAt: number;
  missedTurns: number;
  disconnectedAt?: number;
}

export type DeckDifficulty = 'easy' | 'medium' | 'hard';

export interface GameSettings {
  eliminationPoints: number;
  turnTimer: number;
  maxPlayers: number;
  cardsPerPlayer: number;
  deckDifficulty?: DeckDifficulty;
}

export interface RoundSummary {
  roundNumber: number;
  declarerId: string;
  declarerName: string;
  declarerSum: number;
  minOpponentSum: number;
  undercut: boolean;
  roundEndedAt: number;
  playerResults: {
    playerId: string;
    name: string;
    hand: Card[];
    handSum: number;
    pointsAdded: number;
    newTotal: number;
    outcome: 'win' | 'lose' | 'other_declare';
    eliminatedNow: boolean;
  }[];
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface RoomState {
  code: string;
  status: 'lobby' | 'playing' | 'round_end' | 'game_over';
  hostId: string;
  settings: GameSettings;
  botsConfig: {
    includeAI: boolean;
    easy: number;
    hard: number;
  };
  players: Player[];
  deck: Card[];
  visibleCards: Card[];
  exposedPile: Card[];
  currentTurnPlayerId: string;
  roundStarterPlayerId?: string;
  roundStarterNextId?: string;
  turnsPlayedInRound: number;
  roundNumber: number;
  turnStartTime: number;
  lastRoundSummary?: RoundSummary;
  winnerId?: string;
  chat: ChatMessage[];
  createdAt?: number;
  updatedAt: number;
}

export const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const RANK_VALUES: Record<Rank, number> = {
  'A': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  'J': 10,
  'Q': 10,
  'K': 10,
};

export const RANK_ORDER_HIGH_ACE: Record<Rank, number> = {
  '2': 0,
  '3': 1,
  '4': 2,
  '5': 3,
  '6': 4,
  '7': 5,
  '8': 6,
  '9': 7,
  '10': 8,
  'J': 9,
  'Q': 10,
  'K': 11,
  'A': 12,
};

export function createDeck(numDecks = 1): Card[] {
  const deck: Card[] = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({
          id: `${suit}-${rank}-${d}-${Math.random().toString(36).substring(2, 7)}`,
          suit,
          rank,
        });
      }
    }
  }
  // Real-world style: several full shuffles followed by a random cut
  return cutDeck(shuffle(shuffle(shuffle(deck))));
}

/** Unbiased random integer in [0, maxExclusive) using crypto RNG (rejection sampling, no modulo bias). */
function secureRandomInt(maxExclusive: number): number {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) {
    return Math.floor(Math.random() * maxExclusive);
  }
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  let x: number;
  do {
    c.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % maxExclusive;
}

/** Cut the deck at a random point (like a dealer cut) — keeps order fully random. */
export function cutDeck<T>(array: T[]): T[] {
  if (array.length < 4) return [...array];
  const cut = 1 + secureRandomInt(array.length - 2);
  return [...array.slice(cut), ...array.slice(0, cut)];
}

/** Fisher–Yates shuffle with crypto randomness — every card order is equally likely. */
export function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface DeckDifficultyProfile {
  label: string;
  description: string;
  dealCandidates: number;
  suppressFavoredPct: number;
  boostFavoredPct: number;
  preferHeavyPct: number;
}

export const DECK_DIFFICULTY_PROFILES: Record<DeckDifficulty, DeckDifficultyProfile> = {
  easy: {
    label: 'Easy',
    description: 'More favorable draws & starting combinations',
    dealCandidates: 4,
    suppressFavoredPct: 0,
    boostFavoredPct: 35,
    preferHeavyPct: 20,
  },
  medium: {
    label: 'Medium',
    description: 'Balanced challenge — prevents easy deck streaks',
    dealCandidates: 8,
    suppressFavoredPct: 72,
    boostFavoredPct: 0,
    preferHeavyPct: 30,
  },
  hard: {
    label: 'Hard',
    description: 'Minimal lucky deck draws — open-pile strategy focused',
    dealCandidates: 12,
    suppressFavoredPct: 92,
    boostFavoredPct: 0,
    preferHeavyPct: 60,
  },
};

export function normalizeDeckDifficulty(value?: unknown): DeckDifficulty {
  if (value === 'easy' || value === 'hard' || value === 'medium') {
    return value;
  }
  return 'medium';
}

export function getCardValue(card: Card): number {
  return RANK_VALUES[card.rank] ?? 0;
}

export function getHandSum(cards: Card[]): number {
  return cards.reduce((sum, c) => sum + getCardValue(c), 0);
}

export function isSequence(cards: Card[]): boolean {
  if (cards.length < 3) return false;

  const checkIndices = (indices: number[]) => {
    const sorted = [...indices].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) return false;
    }
    return true;
  };

  const highIndices = cards.map((c) => RANK_ORDER_HIGH_ACE[c.rank]);
  if (checkIndices(highIndices)) return true;

  const lowIndices = cards.map((c) => (c.rank === 'A' ? -1 : RANK_ORDER_HIGH_ACE[c.rank]));
  return checkIndices(lowIndices);
}

export function isValidDiscard(cards: Card[]): { valid: boolean; reason?: string; label?: string } {
  const n = cards.length;
  if (n === 0) return { valid: false, reason: 'Select at least 1 card to discard' };
  if (n > 7) return { valid: false, reason: 'Cannot discard more than 7 cards' };

  if (n === 1) {
    return { valid: true, label: 'Single Card' };
  }

  const allSameRank = cards.every((c) => c.rank === cards[0].rank);

  if (n === 2) {
    if (allSameRank) return { valid: true, label: `Pair of ${cards[0].rank}s` };
    return { valid: false, reason: '2 cards must be a Pair of the same rank' };
  }

  if (n === 3) {
    if (isSequence(cards)) return { valid: true, label: '3-Card Sequence' };
    if (allSameRank) {
      return {
        valid: false,
        reason: '3 of the same rank cannot be dropped together — select 2 for a Pair (or 4 for Four of a Kind)',
      };
    }
    return { valid: false, reason: '3 cards must form a consecutive Sequence (e.g. A-2-3 or 7-8-9)' };
  }

  if (n === 4) {
    if (allSameRank) return { valid: true, label: `Four of a Kind (${cards[0].rank}s)` };
    return { valid: false, reason: '4 cards must be Four of a Kind (all 4 of the same rank)' };
  }

  if (n >= 5) {
    const isFlush = cards.every((c) => c.suit === cards[0].suit);
    if (isSequence(cards)) return { valid: true, label: `${n}-Card Sequence` };
    if (isFlush) return { valid: true, label: `${n}-Card Flush (${cards[0].suit})` };
    return { valid: false, reason: `${n} cards must be a Sequence or a Flush (all same suit)` };
  }

  return { valid: false, reason: 'Invalid card combination' };
}

export function getAllValidDiscards(hand: Card[]): { cards: Card[]; pointsRemoved: number; label: string }[] {
  const results: { cards: Card[]; pointsRemoved: number; label: string }[] = [];
  const n = hand.length;

  const totalMasks = 1 << n;
  for (let mask = 1; mask < totalMasks; mask++) {
    const subset: Card[] = [];
    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) !== 0) {
        subset.push(hand[i]);
      }
    }
    const check = isValidDiscard(subset);
    if (check.valid) {
      results.push({
        cards: subset,
        pointsRemoved: getHandSum(subset),
        label: check.label || 'Valid Move',
      });
    }
  }

  results.sort((a, b) => {
    if (b.pointsRemoved !== a.pointsRemoved) return b.pointsRemoved - a.pointsRemoved;
    return b.cards.length - a.cards.length;
  });

  return results;
}

/**
 * Checks if adding `candidate` to `hand` forms a pair, 4-of-a-kind, 3/5-card sequence, or 5-card flush.
 */
function createsComboWithHand(hand: Card[], candidate: Card): boolean {
  if (hand.some((c) => c.rank === candidate.rank)) return true;

  const n = hand.length;
  // 3-card sequence with any 2 cards already in hand
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (isValidDiscard([hand[i], hand[j], candidate]).valid) {
        return true;
      }
    }
  }

  // 5-card sequence or flush when 4+ cards remain
  if (n >= 4) {
    const sameSuitCount = hand.filter((c) => c.suit === candidate.suit).length;
    if (sameSuitCount >= 4) return true;
    for (let skip = n === 4 ? -1 : 0; skip < n; skip++) {
      const four = skip === -1 ? hand : hand.filter((_, idx) => idx !== skip);
      if (four.length === 4 && isValidDiscard([...four, candidate]).valid) {
        return true;
      }
      if (skip === -1) break;
    }
  }

  return false;
}

function isFavoredDeckCard(
  candidate: Card,
  remainingHand: Card[],
  difficulty: DeckDifficulty
): boolean {
  if (createsComboWithHand(remainingHand, candidate)) return true;
  const val = getCardValue(candidate);
  const handSum = getHandSum(remainingHand);
  if (val <= 2 && handSum <= 18) return true;
  if (difficulty === 'hard' && val <= 3 && handSum <= 26) return true;
  return false;
}

function scoreStartingDealEase(hands: Card[][], cardsPerHand: number): number {
  let ease = 0;
  for (const hand of hands) {
    const sum = getHandSum(hand);
    const combos = getAllValidDiscards(hand).filter((m) => m.cards.length >= 2);
    const multiCount = combos.length;
    const bigCombo = combos.some((m) => m.cards.length >= 3);
    if (multiCount > 0) ease += 2 + Math.min(3, multiCount);
    if (bigCombo) ease += 3;
    if (sum <= cardsPerHand * 3.4) ease += 8;
    else if (sum <= cardsPerHand * 4.4) ease += 3;
    const veryLowCards = hand.filter((c) => getCardValue(c) <= 2).length;
    if (veryLowCards >= 2) ease += 2;
  }
  return ease;
}

/**
 * Deals starting hands using genuine full shuffled decks calibrated to the room's deck difficulty.
 */
export function dealBalancedDeck(
  playerIds: string[],
  cardsPerHand: number,
  numDecks: number,
  difficulty: DeckDifficulty
): {
  dealtHands: Map<string, Card[]>;
  firstVisible: Card;
  remainingDeck: Card[];
} {
  const profile = DECK_DIFFICULTY_PROFILES[difficulty];
  const samples: {
    ease: number;
    dealtHands: Map<string, Card[]>;
    firstVisible: Card;
    remainingDeck: Card[];
  }[] = [];

  for (let s = 0; s < profile.dealCandidates; s++) {
    const fullDeck = createDeck(numDecks);
    const dealtHands = new Map<string, Card[]>(playerIds.map((id) => [id, []]));
    let cursor = 0;
    for (let r = 0; r < cardsPerHand; r++) {
      for (const pid of playerIds) {
        dealtHands.get(pid)!.push({ ...fullDeck[cursor], isNew: false });
        cursor += 1;
      }
    }
    const firstVisible = fullDeck[cursor];
    const remainingDeck = fullDeck.slice(cursor + 1);
    const handsArr = playerIds.map((id) => dealtHands.get(id)!);
    samples.push({
      ease: scoreStartingDealEase(handsArr, cardsPerHand),
      dealtHands,
      firstVisible,
      remainingDeck,
    });
  }

  if (difficulty === 'easy') {
    samples.sort((a, b) => b.ease - a.ease);
  } else if (difficulty === 'hard') {
    samples.sort((a, b) => a.ease - b.ease);
  } else {
    // Medium: target realistic balanced hands near moderate ease (avoid turn-1 low hands)
    const targetEase = Math.max(2, Math.round(playerIds.length * 1.25));
    samples.sort((a, b) => Math.abs(a.ease - targetEase) - Math.abs(b.ease - targetEase));
  }

  const pickWindow = Math.min(2, samples.length);
  const chosen = samples[secureRandomInt(pickWindow)];
  return {
    dealtHands: chosen.dealtHands,
    firstVisible: chosen.firstVisible,
    remainingDeck: chosen.remainingDeck,
  };
}

/**
 * Draws a real card from the finite remaining deck, applying Easy / Medium / Hard
 * randomization control so blind deck draws are balanced without inventing cards.
 */
export function drawFromShuffledDeck(
  deck: Card[],
  remainingHand: Card[],
  difficulty: DeckDifficulty
): { card: Card | undefined; remainingDeck: Card[] } {
  if (deck.length === 0) return { card: undefined, remainingDeck: [] };
  if (deck.length === 1) return { card: deck[0], remainingDeck: [] };

  const profile = DECK_DIFFICULTY_PROFILES[difficulty];
  const topCard = deck[0];

  if (difficulty === 'easy') {
    if (!isFavoredDeckCard(topCard, remainingHand, difficulty) && secureRandomInt(100) < profile.boostFavoredPct) {
      const lookahead = Math.min(8, deck.length);
      const favoredIndices: number[] = [];
      for (let i = 1; i < lookahead; i++) {
        if (isFavoredDeckCard(deck[i], remainingHand, difficulty) || getCardValue(deck[i]) <= 3) {
          favoredIndices.push(i);
        }
      }
      if (favoredIndices.length > 0) {
        const chosenIdx = favoredIndices[secureRandomInt(favoredIndices.length)];
        return {
          card: deck[chosenIdx],
          remainingDeck: deck.filter((_, idx) => idx !== chosenIdx),
        };
      }
    }
    return { card: topCard, remainingDeck: deck.slice(1) };
  }

  // Medium / Hard: prevent too-frequent lucky pairs, sequences, or repeated ultra-low deck hits
  if (
    isFavoredDeckCard(topCard, remainingHand, difficulty) &&
    secureRandomInt(100) < profile.suppressFavoredPct
  ) {
    const midNonFavored: number[] = [];
    const heavyNonFavored: number[] = [];
    const otherNonFavored: number[] = [];

    for (let i = 1; i < deck.length; i++) {
      const cand = deck[i];
      if (!isFavoredDeckCard(cand, remainingHand, difficulty)) {
        const v = getCardValue(cand);
        if (v >= 4 && v <= 8) midNonFavored.push(i);
        else if (v >= 9) heavyNonFavored.push(i);
        else otherNonFavored.push(i);
      }
    }

    const wantHeavy = secureRandomInt(100) < profile.preferHeavyPct;
    const primaryPool = wantHeavy ? heavyNonFavored : midNonFavored;
    const secondaryPool = wantHeavy ? midNonFavored : heavyNonFavored;
    const chosenPool =
      primaryPool.length > 0
        ? primaryPool
        : secondaryPool.length > 0
        ? secondaryPool
        : otherNonFavored;

    if (chosenPool.length > 0) {
      const chosenIdx = chosenPool[secureRandomInt(chosenPool.length)];
      const nextDeck = deck.filter((_, idx) => idx !== chosenIdx);
      // Tuck the skipped favored top card slightly deeper into the deck so the very next player
      // doesn't always inherit an unnaturally curated top card either.
      if (nextDeck.length > 3) {
        const skipped = nextDeck.shift()!;
        const insertAt = 1 + secureRandomInt(Math.min(6, nextDeck.length));
        nextDeck.splice(insertAt, 0, skipped);
      }
      return { card: deck[chosenIdx], remainingDeck: nextDeck };
    }
  }

  return { card: topCard, remainingDeck: deck.slice(1) };
}

export function canPlayerDeclare(room: RoomState, playerId: string): boolean {
  if (room.status !== 'playing') return false;
  if (room.currentTurnPlayerId !== playerId) return false;
  const activePlayers = room.players.filter((p) => !p.isEliminated);
  return room.turnsPlayedInRound >= activePlayers.length;
}

export function getBestHint(hand: Card[], visibleCards: Card[], canDeclare: boolean): {
  recommendDeclare: boolean;
  discardIds: string[];
  drawFrom: 'deck' | 'visible';
  visibleIndex: number;
  explanation: string;
} {
  const currentSum = getHandSum(hand);
  if (canDeclare && currentSum <= 6) {
    return {
      recommendDeclare: true,
      discardIds: [],
      drawFrom: 'deck',
      visibleIndex: 0,
      explanation: `Your hand sum is very low (${currentSum} pts). Declaring now has a high chance of winning the round!`,
    };
  }

  const validMoves = getAllValidDiscards(hand);
  const bestDiscard = validMoves[0] || {
    cards: [hand[0]],
    pointsRemoved: getCardValue(hand[0]),
    label: 'Single Card',
  };
  const remainingHand = hand.filter((c) => !bestDiscard.cards.some((d) => d.id === c.id));

  let bestDrawFrom: 'deck' | 'visible' = 'deck';
  let bestVisibleIdx = 0;

  for (let i = 0; i < visibleCards.length; i++) {
    const vc = visibleCards[i];
    const pairsWithRemaining = remainingHand.some((rc) => rc.rank === vc.rank);
    if (pairsWithRemaining || getCardValue(vc) <= 2) {
      bestDrawFrom = 'visible';
      bestVisibleIdx = i;
      break;
    }
  }

  const cardNames = bestDiscard.cards.map((c) => `${c.rank}${getSuitSymbol(c.suit)}`).join(' + ');
  return {
    recommendDeclare: false,
    discardIds: bestDiscard.cards.map((c) => c.id),
    drawFrom: bestDrawFrom,
    visibleIndex: bestVisibleIdx,
    explanation: `Discard ${cardNames} (${bestDiscard.label}, -${bestDiscard.pointsRemoved} pts) and draw from ${
      bestDrawFrom === 'visible'
        ? `the open card (${visibleCards[bestVisibleIdx].rank}${getSuitSymbol(visibleCards[bestVisibleIdx].suit)})`
        : 'the deck'
    }.`,
  };
}

export function getSuitSymbol(suit: Suit): string {
  switch (suit) {
    case 'spades':
      return '♠';
    case 'hearts':
      return '♥';
    case 'diamonds':
      return '♦';
    case 'clubs':
      return '♣';
  }
}

export function computeBotAction(room: RoomState, bot: Player): {
  action: 'declare' | 'move';
  discardIds?: string[];
  drawFrom?: 'deck' | 'visible';
  visibleIndex?: number;
} {
  const canDecl = canPlayerDeclare(room, bot.id);
  const handSum = getHandSum(bot.hand);

  if (canDecl) {
    if (bot.botDifficulty === 'easy') {
      if (handSum <= 7) {
        return { action: 'declare' };
      }
    } else {
      const activeOpponents = room.players.filter((p) => !p.isEliminated && p.id !== bot.id);
      const minOppCards = Math.min(...activeOpponents.map((o) => o.hand.length));
      const threshold = minOppCards <= 2 ? 5 : 7;
      if (handSum <= threshold) {
        return { action: 'declare' };
      }
    }
  }

  const hint = getBestHint(bot.hand, room.visibleCards, false);
  return {
    action: 'move',
    discardIds: hint.discardIds,
    drawFrom: hint.drawFrom,
    visibleIndex: hint.visibleIndex,
  };
}
