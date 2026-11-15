import {
  Card,
  Player,
  RoomState,
  createDeck,
  getHandSum,
  isValidDiscard,
  shuffle,
  canPlayerDeclare,
  computeBotAction,
} from './gameEngine';

export function generateLobbyCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function createInitialRoom(
  host: { id: string; name: string; email?: string },
  customCode?: string
): RoomState {
  const code = (customCode || generateLobbyCode()).toUpperCase();
  const now = Date.now();
  return {
    code,
    status: 'lobby',
    hostId: host.id,
    settings: {
      eliminationPoints: 100,
      turnTimer: 45,
      maxPlayers: 8,
      cardsPerPlayer: 5,
    },
    botsConfig: {
      includeAI: false,
      easy: 0,
      hard: 0,
    },
    players: [
      {
        id: host.id,
        name: host.name,
        email: host.email,
        isHost: true,
        isBot: false,
        hand: [],
        score: 0,
        roundScores: [],
        isEliminated: false,
        joinedAt: now,
        missedTurns: 0,
      },
    ],
    deck: [],
    visibleCards: [],
    exposedPile: [],
    currentTurnPlayerId: host.id,
    roundStarterPlayerId: host.id,
    turnsPlayedInRound: 0,
    roundNumber: 1,
    turnStartTime: now,
    chat: [],
    updatedAt: now,
  };
}

const BOT_NAMES_EASY = ['Bot Rookie', 'Bot Sunny', 'Bot Clover', 'Bot Pip', 'Bot Daisy', 'Bot Lucky'];
const BOT_NAMES_HARD = ['Bot Magnus', 'Bot Athena', 'Bot Cipher', 'Bot Viper', 'Bot Kronos', 'Bot Apex'];

export function syncBotsInLobby(room: RoomState): RoomState {
  const humanPlayers = [...room.players.filter((p) => !p.isBot)].sort(
    (a, b) => a.joinedAt - b.joinedAt
  );

  if (!room.botsConfig.includeAI) {
    return {
      ...room,
      players: humanPlayers,
      updatedAt: Date.now(),
    };
  }

  const maxAllowed = Math.max(2, Math.min(8, room.settings.maxPlayers || 8));
  const maxBotsAllowed = Math.max(0, maxAllowed - humanPlayers.length);
  const easyCount = Math.min(room.botsConfig.easy, maxBotsAllowed);
  const hardCount = Math.min(room.botsConfig.hard, Math.max(0, maxBotsAllowed - easyCount));

  const baseBotTime = Date.now();
  const bots: Player[] = [];
  for (let i = 0; i < easyCount; i++) {
    const botId = `bot-easy-${i + 1}`;
    const existing = room.players.find((p) => p.id === botId);
    bots.push({
      id: botId,
      name: BOT_NAMES_EASY[i % BOT_NAMES_EASY.length],
      isHost: false,
      isBot: true,
      botDifficulty: 'easy',
      hand: existing?.hand || [],
      score: existing?.score || 0,
      roundScores: existing?.roundScores || [],
      isEliminated: existing?.isEliminated || false,
      joinedAt: existing?.joinedAt || baseBotTime + i + 1,
      missedTurns: 0,
    });
  }
  for (let i = 0; i < hardCount; i++) {
    const botId = `bot-hard-${i + 1}`;
    const existing = room.players.find((p) => p.id === botId);
    bots.push({
      id: botId,
      name: BOT_NAMES_HARD[i % BOT_NAMES_HARD.length],
      isHost: false,
      isBot: true,
      botDifficulty: 'hard',
      hand: existing?.hand || [],
      score: existing?.score || 0,
      roundScores: existing?.roundScores || [],
      isEliminated: existing?.isEliminated || false,
      joinedAt: existing?.joinedAt || baseBotTime + 100 + i + 1,
      missedTurns: 0,
    });
  }

  return {
    ...room,
    players: [...humanPlayers, ...bots],
    updatedAt: Date.now(),
  };
}

export function startRound(room: RoomState, isFirstRound = false): RoomState {
  const sourcePlayers = isFirstRound ? room.players.filter((p) => !p.isKicked) : room.players;
  const orderedPlayers = [
    ...[...sourcePlayers.filter((p) => !p.isBot)].sort((a, b) => a.joinedAt - b.joinedAt),
    ...sourcePlayers.filter((p) => p.isBot),
  ];

  const activePlayers = orderedPlayers.filter((p) =>
    isFirstRound ? true : !p.isEliminated && !p.isKicked
  );
  const cardsPerHand = Math.max(3, Math.min(7, room.settings.cardsPerPlayer || 5));
  const numDecks = activePlayers.length * cardsPerHand >= 30 ? 2 : 1;
  const fullDeck = createDeck(numDecks);

  // Deal one card at a time to each active player in turn (round-robin), like a real dealer
  const dealOrder = activePlayers;
  const dealtHands = new Map<string, Card[]>(dealOrder.map((p) => [p.id, []]));
  let deckCursor = 0;
  for (let round = 0; round < cardsPerHand; round++) {
    for (const p of dealOrder) {
      dealtHands.get(p.id)!.push({ ...fullDeck[deckCursor], isNew: false });
      deckCursor += 1;
    }
  }

  const updatedPlayers = orderedPlayers.map((p) => {
    if (isFirstRound) {
      p = { ...p, score: 0, roundScores: [], isEliminated: false, isKicked: false, missedTurns: 0 };
    }
    if (p.isEliminated || p.isKicked) {
      return { ...p, hand: [], lastDraw: undefined, lastDiscard: undefined };
    }
    const hand = dealtHands.get(p.id) || [];
    return {
      ...p,
      hand,
      lastDraw: undefined,
      lastDiscard: undefined,
    };
  });

  const firstVisible = fullDeck[deckCursor];
  deckCursor += 1;
  const remainingDeck = fullDeck.slice(deckCursor);

  const nonEliminated = updatedPlayers.filter((p) => !p.isEliminated);
  let startingPlayer = nonEliminated[0];

  if (!isFirstRound && nonEliminated.length > 0) {
    const prevStarterId = room.roundStarterPlayerId || room.currentTurnPlayerId;
    const prevIdx = updatedPlayers.findIndex((p) => p.id === prevStarterId);
    if (prevIdx !== -1) {
      for (let offset = 1; offset <= updatedPlayers.length; offset++) {
        const candidate = updatedPlayers[(prevIdx + offset) % updatedPlayers.length];
        if (!candidate.isEliminated) {
          startingPlayer = candidate;
          break;
        }
      }
    } else {
      startingPlayer =
        nonEliminated[(room.roundNumber - 1) % nonEliminated.length] || nonEliminated[0];
    }
  }

  return {
    ...room,
    status: 'playing',
    players: updatedPlayers,
    deck: remainingDeck,
    visibleCards: [firstVisible],
    exposedPile: [],
    currentTurnPlayerId: startingPlayer.id,
    roundStarterPlayerId: startingPlayer.id,
    turnsPlayedInRound: 0,
    turnStartTime: Date.now(),
    lastRoundSummary: undefined,
    winnerId: undefined,
    updatedAt: Date.now(),
  };
}

export function executeMakeMove(
  room: RoomState,
  playerId: string,
  discardIds: string[],
  drawFrom: 'deck' | 'visible',
  visibleIndex = 0,
  isAutoTimeoutMove = false
): { room: RoomState; error?: string } {
  if (room.status !== 'playing') {
    return { room, error: 'Game is not currently active' };
  }
  if (room.currentTurnPlayerId !== playerId) {
    return { room, error: 'It is not your turn' };
  }

  const playerIndex = room.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) return { room, error: 'Player not found' };
  const player = room.players[playerIndex];

  const discardCards: Card[] = [];
  for (const id of discardIds) {
    const found = player.hand.find((c) => c.id === id);
    if (!found) return { room, error: 'Selected card not in hand' };
    discardCards.push({ ...found, isNew: false });
  }

  const validation = isValidDiscard(discardCards);
  if (!validation.valid) {
    return { room, error: validation.reason || 'Invalid discard combination' };
  }

  let currentDeck = [...room.deck];
  let currentExposed = [...room.exposedPile];
  const currentVisible = [...room.visibleCards];

  let drawnCard: Card | undefined;

  if (drawFrom === 'visible') {
    const idx = visibleIndex >= 0 && visibleIndex < currentVisible.length ? visibleIndex : 0;
    drawnCard = currentVisible[idx];
    if (!drawnCard) return { room, error: 'No visible card available to draw' };
    const otherVisible = currentVisible.filter((_, i) => i !== idx);
    currentExposed.push(...otherVisible);
  } else {
    if (currentDeck.length === 0 && currentExposed.length > 0) {
      currentDeck = shuffle(currentExposed);
      currentExposed = [];
    }
    drawnCard = currentDeck.shift();
    currentExposed.push(...currentVisible);
  }

  if (!drawnCard) {
    return { room, error: 'No cards left to draw' };
  }

  const remainingHand = player.hand
    .filter((c) => !discardIds.includes(c.id))
    .map((c) => ({ ...c, isNew: false }));

  const updatedHand = [...remainingHand, { ...drawnCard, isNew: true }];

  if (currentDeck.length === 0 && currentExposed.length > 0) {
    currentDeck = shuffle(currentExposed);
    currentExposed = [];
  }

  const newMissedTurns = isAutoTimeoutMove ? (player.missedTurns || 0) + 1 : 0;

  const updatedPlayers = [...room.players];
  updatedPlayers[playerIndex] = {
    ...player,
    hand: updatedHand,
    lastDraw: { from: drawFrom, card: drawnCard },
    lastDiscard: discardCards,
    missedTurns: newMissedTurns,
  };

  const nextPlayerId = getNextActivePlayerId(updatedPlayers, playerId);

  let updatedRoom: RoomState = {
    ...room,
    players: updatedPlayers,
    deck: currentDeck,
    visibleCards: discardCards,
    exposedPile: currentExposed,
    currentTurnPlayerId: nextPlayerId,
    turnsPlayedInRound: room.turnsPlayedInRound + 1,
    turnStartTime: Date.now(),
    updatedAt: Date.now(),
  };

  if (!player.isBot && newMissedTurns >= 3 && !player.disconnectedAt) {
    const afterKick = kickOrRemovePlayer(updatedRoom, playerId);
    if (afterKick) {
      afterKick.chat.push({
        id: `sys_${Date.now()}`,
        senderId: 'system',
        senderName: 'System',
        text: `${player.name} was auto-kicked after missing 3 consecutive turns.`,
        timestamp: Date.now(),
      });
      updatedRoom = afterKick;
    } else {
      updatedRoom = {
        ...updatedRoom,
        players: updatedRoom.players.filter((p) => p.id !== playerId),
      };
    }
  }

  return { room: updatedRoom };
}

export function executeDeclare(
  room: RoomState,
  playerId: string
): { room: RoomState; error?: string } {
  if (!canPlayerDeclare(room, playerId)) {
    return {
      room,
      error: 'Cannot declare yet — every player must complete at least 1 turn in this round.',
    };
  }

  const activePlayers = room.players.filter((p) => !p.isEliminated);
  const declarer = activePlayers.find((p) => p.id === playerId);
  if (!declarer) return { room, error: 'Declarer not found' };

  const declarerSum = getHandSum(declarer.hand);
  const opponents = activePlayers.filter((p) => p.id !== playerId);
  const minOpponentSum =
    opponents.length > 0 ? Math.min(...opponents.map((o) => getHandSum(o.hand))) : 999;

  const isUndercut = declarerSum >= minOpponentSum;

  const playerResults: NonNullable<RoomState['lastRoundSummary']>['playerResults'] = [];

  const updatedPlayers = room.players.map((p) => {
    if (p.isEliminated) {
      return p;
    }

    const handSum = getHandSum(p.hand);
    let pointsAdded = 0;
    let outcome: 'win' | 'lose' | 'other_declare' = 'other_declare';

    if (p.id === playerId) {
      if (isUndercut) {
        // Declarer lost (undercut) -> RED score
        pointsAdded = 20 + (declarerSum - minOpponentSum);
        outcome = 'lose';
      } else {
        // Declarer won -> 0 in GREEN + STAR ★
        pointsAdded = 0;
        outcome = 'win';
      }
    } else {
      if (isUndercut) {
        // Opponents win when declarer is undercut -> 0 in GREEN + STAR ★ for those who beat/tied declarer
        pointsAdded = 0;
        outcome = 'win';
      } else {
        // Score added because of another player's declare -> BLUE score
        pointsAdded = Math.max(0, handSum - declarerSum);
        outcome = pointsAdded === 0 ? 'win' : 'other_declare';
      }
    }

    const newTotal = p.score + pointsAdded;
    const eliminatedNow = newTotal >= room.settings.eliminationPoints;

    playerResults.push({
      playerId: p.id,
      name: p.name,
      hand: p.hand,
      handSum,
      pointsAdded,
      newTotal,
      outcome,
      eliminatedNow,
    });

    return {
      ...p,
      score: newTotal,
      roundScores: [...p.roundScores, { score: pointsAdded, outcome }],
      isEliminated: eliminatedNow,
      missedTurns: p.id === playerId ? 0 : p.missedTurns,
    };
  });

  const remainingPlayers = updatedPlayers.filter((p) => !p.isEliminated);
  let status: RoomState['status'] = 'round_end';
  let winnerId: string | undefined;

  if (remainingPlayers.length === 1) {
    status = 'game_over';
    winnerId = remainingPlayers[0].id;
  } else if (remainingPlayers.length === 0) {
    status = 'game_over';
    const sorted = [...updatedPlayers].sort((a, b) => a.score - b.score);
    winnerId = sorted[0].id;
  }

  return {
    room: {
      ...room,
      status,
      players: updatedPlayers,
      winnerId,
      lastRoundSummary: {
        roundNumber: room.roundNumber,
        declarerId: declarer.id,
        declarerName: declarer.name,
        declarerSum,
        minOpponentSum,
        undercut: isUndercut,
        roundEndedAt: Date.now(),
        playerResults,
      },
      updatedAt: Date.now(),
    },
  };
}

export function getNextActivePlayerId(players: Player[], currentPlayerId: string): string {
  const n = players.length;
  const currentIndex = players.findIndex((p) => p.id === currentPlayerId);
  if (currentIndex === -1) {
    return players.find((p) => !p.isEliminated)?.id || players[0].id;
  }
  for (let offset = 1; offset <= n; offset++) {
    const candidate = players[(currentIndex + offset) % n];
    if (!candidate.isEliminated) {
      return candidate.id;
    }
  }
  return currentPlayerId;
}

export function kickOrRemovePlayer(
  room: RoomState,
  targetPlayerId: string,
  forceRemove = false
): RoomState | null {
  const shouldHardRemove = forceRemove || room.status === 'lobby';

  if (shouldHardRemove) {
    const remaining = room.players.filter((p) => p.id !== targetPlayerId);
    const remainingHumans = remaining.filter((p) => !p.isBot && !p.isKicked);
    if (remainingHumans.length === 0) {
      return null;
    }

    let newHostId = room.hostId;
    if (room.hostId === targetPlayerId) {
      newHostId = remainingHumans[0].id;
    }

    const updatedPlayers = remaining.map((p) => ({
      ...p,
      isHost: p.id === newHostId,
    }));

    let nextTurnId = room.currentTurnPlayerId;
    if (room.status === 'playing' && room.currentTurnPlayerId === targetPlayerId) {
      nextTurnId = getNextActivePlayerId(updatedPlayers, targetPlayerId);
    }

    const activeRemaining = updatedPlayers.filter((p) => !p.isEliminated && !p.isKicked);
    let status = room.status;
    let winnerId = room.winnerId;
    if (room.status === 'playing' && activeRemaining.length <= 1) {
      status = 'game_over';
      winnerId = activeRemaining[0]?.id;
    }

    return {
      ...room,
      hostId: newHostId,
      players: updatedPlayers,
      currentTurnPlayerId: nextTurnId,
      turnStartTime: room.currentTurnPlayerId === targetPlayerId ? Date.now() : room.turnStartTime,
      status,
      winnerId,
      updatedAt: Date.now(),
    };
  }

  // During an active/completed match, preserve kicked players in the table/scoreboard with `isKicked: true`
  const target = room.players.find((p) => p.id === targetPlayerId);
  const reclaimedHand = target?.hand || [];

  const markedPlayers = room.players.map((p) =>
    p.id === targetPlayerId
      ? {
          ...p,
          isKicked: true,
          isEliminated: true,
          isHost: false,
          hand: [],
          lastDraw: undefined,
          lastDiscard: undefined,
        }
      : p
  );

  const remainingHumans = markedPlayers.filter((p) => !p.isBot && !p.isKicked);
  if (remainingHumans.length === 0) {
    return null;
  }

  let newHostId = room.hostId;
  if (room.hostId === targetPlayerId) {
    newHostId = remainingHumans[0].id;
  }

  const updatedPlayers = markedPlayers.map((p) => ({
    ...p,
    isHost: p.id === newHostId,
  }));

  let nextTurnId = room.currentTurnPlayerId;
  if (room.status === 'playing' && room.currentTurnPlayerId === targetPlayerId) {
    nextTurnId = getNextActivePlayerId(updatedPlayers, targetPlayerId);
  }

  const activeRemaining = updatedPlayers.filter((p) => !p.isEliminated && !p.isKicked);
  let status = room.status;
  let winnerId = room.winnerId;
  if (room.status === 'playing' && activeRemaining.length <= 1) {
    status = 'game_over';
    winnerId = activeRemaining[0]?.id;
  }

  return {
    ...room,
    hostId: newHostId,
    players: updatedPlayers,
    exposedPile:
      reclaimedHand.length > 0 ? [...room.exposedPile, ...reclaimedHand] : room.exposedPile,
    currentTurnPlayerId: nextTurnId,
    turnStartTime: room.currentTurnPlayerId === targetPlayerId ? Date.now() : room.turnStartTime,
    status,
    winnerId,
    updatedAt: Date.now(),
  };
}

export function checkRoomTimersAndAutoPlay(room: RoomState): {
  room: RoomState | null;
  changed: boolean;
} {
  const now = Date.now();
  let currentRoom: RoomState | null = room;
  let changed = false;

  // 1. Remove any temporarily disconnected player who has been away > 5 minutes
  for (const p of currentRoom.players) {
    if (!p.isBot && p.disconnectedAt && now - p.disconnectedAt > 5 * 60 * 1000) {
      currentRoom = kickOrRemovePlayer(currentRoom, p.id);
      changed = true;
      if (!currentRoom) return { room: null, changed: true };
    }
  }

  // 2. Auto-start Next Round after 20 seconds when in 'round_end' state
  if (currentRoom.status === 'round_end' && currentRoom.lastRoundSummary?.roundEndedAt) {
    const roundEndElapsed = (now - currentRoom.lastRoundSummary.roundEndedAt) / 1000;
    if (roundEndElapsed >= 20) {
      currentRoom.roundNumber += 1;
      currentRoom = startRound(currentRoom, false);
      return { room: currentRoom, changed: true };
    }
    return { room: currentRoom, changed };
  }

  if (currentRoom.status !== 'playing') {
    return { room: currentRoom, changed };
  }

  const activePlayer = currentRoom.players.find((p) => p.id === currentRoom!.currentTurnPlayerId);
  if (!activePlayer) return { room: currentRoom, changed };

  const elapsedSeconds = (now - currentRoom.turnStartTime) / 1000;

  const isTempDisconnectedHuman = !activePlayer.isBot && Boolean(activePlayer.disconnectedAt);
  const botWaitSeconds = currentRoom.turnsPlayedInRound === 0 ? 2.4 : 1.5;
  const shouldBotPlayImmediately =
    (activePlayer.isBot || isTempDisconnectedHuman) && elapsedSeconds >= botWaitSeconds;

  const isHumanTurnExpired =
    !activePlayer.isBot &&
    !activePlayer.disconnectedAt &&
    elapsedSeconds >= currentRoom.settings.turnTimer;

  if (shouldBotPlayImmediately || isHumanTurnExpired) {
    const decision = computeBotAction(currentRoom, activePlayer);
    if (decision.action === 'declare' && shouldBotPlayImmediately) {
      const declRes = executeDeclare(currentRoom, activePlayer.id);
      if (!declRes.error) {
        currentRoom = declRes.room;
        changed = true;
      }
    } else {
      const moveRes = executeMakeMove(
        currentRoom,
        activePlayer.id,
        decision.discardIds || [activePlayer.hand[0].id],
        decision.drawFrom || 'deck',
        decision.visibleIndex || 0,
        isHumanTurnExpired
      );
      if (!moveRes.error) {
        currentRoom = moveRes.room;
        changed = true;
        if (currentRoom.players.every((p) => p.isBot || p.isKicked)) {
          return { room: null, changed: true };
        }
      }
    }
  }

  return { room: currentRoom, changed };
}
