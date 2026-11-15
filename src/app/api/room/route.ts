import { NextRequest, NextResponse } from 'next/server';
import { loadRoomsMap, saveRoomsMap } from '@/lib/serverStore';
import {
  createInitialRoom,
  executeDeclare,
  executeMakeMove,
  kickOrRemovePlayer,
  startRound,
  syncBotsInLobby,
  checkRoomTimersAndAutoPlay,
} from '@/lib/roomController';
import { computeBotAction, shuffle } from '@/lib/gameEngine';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')?.toUpperCase().trim();
  const playerId = req.nextUrl.searchParams.get('playerId')?.trim();
  if (!code) {
    return NextResponse.json({ error: 'Room code is required' }, { status: 400 });
  }
  const rooms = loadRoomsMap();
  const rawRoom = rooms.get(code);
  if (!rawRoom) {
    return NextResponse.json({ error: 'Lobby not found' }, { status: 404 });
  }

  // Clear disconnectedAt if polling player is back online
  let modified = false;
  if (playerId) {
    const p = rawRoom.players.find((pl) => pl.id === playerId);
    if (p && p.disconnectedAt) {
      p.disconnectedAt = undefined;
      modified = true;
    }
  }

  const timerCheck = checkRoomTimersAndAutoPlay(rawRoom);
  if (timerCheck.changed || modified) {
    if (timerCheck.room) {
      rooms.set(code, timerCheck.room);
    } else {
      rooms.delete(code);
    }
    saveRoomsMap(rooms);
  }

  if (!timerCheck.room) {
    return NextResponse.json({ error: 'Room closed' }, { status: 404 });
  }

  return NextResponse.json({ room: timerCheck.room });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, code: rawCode, player, payload } = body;
    const rooms = loadRoomsMap();

    if (action === 'create') {
      if (!player?.id || !player?.name) {
        return NextResponse.json({ error: 'Player info required' }, { status: 400 });
      }
      let newRoom = createInitialRoom(player, rawCode);
      if (payload?.botsConfig) {
        newRoom.botsConfig = payload.botsConfig;
        newRoom = syncBotsInLobby(newRoom);
      }
      if (payload?.settings) {
        newRoom.settings = payload.settings;
      }
      if (payload?.autoStart) {
        newRoom = startRound(newRoom, true);
      }
      rooms.set(newRoom.code, newRoom);
      saveRoomsMap(rooms);
      return NextResponse.json({ room: newRoom });
    }

    const code = (rawCode || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      return NextResponse.json({ error: `Lobby "${code}" not found.` }, { status: 404 });
    }

    // Join or Rejoin (within 5-min window even if match is playing!)
    if (action === 'join') {
      if (!player?.id || !player?.name) {
        return NextResponse.json({ error: 'Player info required' }, { status: 400 });
      }
      const alreadyIn = room.players.find((p) => p.id === player.id);
      if (alreadyIn) {
        if (alreadyIn.isKicked) {
          return NextResponse.json({ error: 'You were kicked from this room.' }, { status: 403 });
        }
        alreadyIn.name = player.name;
        alreadyIn.disconnectedAt = undefined;
        room.updatedAt = Date.now();
        rooms.set(code, room);
        saveRoomsMap(rooms);
        return NextResponse.json({ room });
      }

      if (room.status !== 'lobby') {
        return NextResponse.json({ error: 'Match has already started in this lobby.' }, { status: 400 });
      }
      if (room.players.length >= (room.settings.maxPlayers || 8)) {
        return NextResponse.json(
          { error: `Lobby is full (maximum ${room.settings.maxPlayers || 8} players).` },
          { status: 400 }
        );
      }

      room.players.push({
        id: player.id,
        name: player.name,
        email: player.email,
        isHost: false,
        isBot: false,
        hand: [],
        score: 0,
        roundScores: [],
        isEliminated: false,
        joinedAt: Date.now(),
        missedTurns: 0,
      });
      const synced = syncBotsInLobby(room);
      rooms.set(code, synced);
      saveRoomsMap(rooms);
      return NextResponse.json({ room: synced });
    }

    // Update player display name anytime
    if (action === 'update_name') {
      const newName = (payload?.name || '').trim();
      if (!newName) {
        return NextResponse.json({ error: 'Display name cannot be empty' }, { status: 400 });
      }
      const target = room.players.find((p) => p.id === player?.id);
      if (target) {
        target.name = newName.slice(0, 24);
        room.updatedAt = Date.now();
        rooms.set(code, room);
        saveRoomsMap(rooms);
      }
      return NextResponse.json({ room });
    }

    // Temporary leave ("Back") — keeps player seat for 5 minutes while Bot plays their turns
    if (action === 'temp_leave') {
      const target = room.players.find((p) => p.id === player?.id);
      if (target) {
        target.disconnectedAt = Date.now();
        room.updatedAt = Date.now();
        rooms.set(code, room);
        saveRoomsMap(rooms);
      }
      return NextResponse.json({ room });
    }

    if (action === 'update_settings') {
      if (room.hostId !== player?.id) {
        return NextResponse.json({ error: 'Only the host can change lobby settings.' }, { status: 403 });
      }
      if (payload?.settings) {
        room.settings = {
          eliminationPoints: Math.max(50, Math.min(300, Number(payload.settings.eliminationPoints) || 100)),
          turnTimer: Math.max(15, Math.min(120, Number(payload.settings.turnTimer) || 45)),
          maxPlayers: Math.max(2, Math.min(8, Number(payload.settings.maxPlayers) || 8)),
          cardsPerPlayer: Math.max(3, Math.min(7, Number(payload.settings.cardsPerPlayer) || 5)),
        };
      }
      if (payload?.botsConfig) {
        room.botsConfig = {
          includeAI: Boolean(payload.botsConfig.includeAI),
          easy: Math.max(0, Math.min(7, Number(payload.botsConfig.easy) || 0)),
          hard: Math.max(0, Math.min(7, Number(payload.botsConfig.hard) || 0)),
        };
      }
      const synced = syncBotsInLobby(room);
      rooms.set(code, synced);
      saveRoomsMap(rooms);
      return NextResponse.json({ room: synced });
    }

    if (action === 'kick') {
      if (room.hostId !== player?.id) {
        return NextResponse.json({ error: 'Only the host can kick players.' }, { status: 403 });
      }
      const targetId = payload?.targetPlayerId;
      if (!targetId || targetId === room.hostId) {
        return NextResponse.json({ error: 'Invalid player to kick.' }, { status: 400 });
      }
      const updated = kickOrRemovePlayer(room, targetId);
      if (!updated) {
        rooms.delete(code);
        saveRoomsMap(rooms);
        return NextResponse.json({ room: null });
      }
      rooms.set(code, updated);
      saveRoomsMap(rooms);
      return NextResponse.json({ room: updated });
    }

    if (action === 'leave') {
      const updated = kickOrRemovePlayer(room, player?.id, true);
      if (!updated) {
        rooms.delete(code);
        saveRoomsMap(rooms);
        return NextResponse.json({ room: null });
      }
      rooms.set(code, updated);
      saveRoomsMap(rooms);
      return NextResponse.json({ room: updated });
    }

    if (action === 'start_game') {
      if (room.hostId !== player?.id) {
        return NextResponse.json({ error: 'Only the host can start the match.' }, { status: 403 });
      }
      if (room.players.length < 2) {
        return NextResponse.json(
          { error: 'At least 2 players are required to start (invite a friend or enable AI bots).' },
          { status: 400 }
        );
      }
      room.roundNumber = 1;
      const started = startRound(room, true);
      rooms.set(code, started);
      saveRoomsMap(rooms);
      return NextResponse.json({ room: started });
    }

    if (action === 'make_move') {
      const { discardIds, drawFrom, visibleIndex } = payload || {};
      if (!drawFrom) {
        return NextResponse.json({ error: 'Please select a card to draw from the Deck or Open Pile.' }, { status: 400 });
      }
      const result = executeMakeMove(
        room,
        player?.id,
        discardIds || [],
        drawFrom,
        visibleIndex || 0,
        false
      );
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      rooms.set(code, result.room);
      saveRoomsMap(rooms);
      return NextResponse.json({ room: result.room });
    }

    if (action === 'declare') {
      const result = executeDeclare(room, player?.id);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      rooms.set(code, result.room);
      saveRoomsMap(rooms);
      return NextResponse.json({ room: result.room });
    }

    if (action === 'shuffle_deck') {
      if (room.status !== 'playing') {
        return NextResponse.json({ error: 'Game is not currently active.' }, { status: 400 });
      }
      if (room.currentTurnPlayerId !== player?.id) {
        return NextResponse.json(
          { error: 'Only the active turn player can shuffle the draw deck.' },
          { status: 403 }
        );
      }
      room.deck = shuffle(room.deck);
      room.updatedAt = Date.now();
      rooms.set(code, room);
      saveRoomsMap(rooms);
      return NextResponse.json({ room });
    }

    if (action === 'bot_turn' || action === 'timeout_turn') {
      if (room.status !== 'playing') {
        return NextResponse.json({ room });
      }
      const currentPlayer = room.players.find((p) => p.id === room.currentTurnPlayerId);
      if (!currentPlayer) {
        return NextResponse.json({ room });
      }

      const isTimeoutHuman = action === 'timeout_turn' && !currentPlayer.isBot;
      const isBotOrOffline = currentPlayer.isBot || Boolean(currentPlayer.disconnectedAt);

      if (!isBotOrOffline && !isTimeoutHuman) {
        return NextResponse.json({ room });
      }

      const decision = computeBotAction(room, currentPlayer);
      if (decision.action === 'declare' && isBotOrOffline) {
        const declRes = executeDeclare(room, currentPlayer.id);
        rooms.set(code, declRes.room);
        saveRoomsMap(rooms);
        return NextResponse.json({ room: declRes.room });
      } else {
        const moveRes = executeMakeMove(
          room,
          currentPlayer.id,
          decision.discardIds || [currentPlayer.hand[0].id],
          decision.drawFrom || 'deck',
          decision.visibleIndex || 0,
          isTimeoutHuman
        );
        rooms.set(code, moveRes.room);
        saveRoomsMap(rooms);
        return NextResponse.json({ room: moveRes.room });
      }
    }

    if (action === 'next_round') {
      if (room.status !== 'round_end') {
        return NextResponse.json({ room });
      }
      if (
        typeof payload?.expectedRound === 'number' &&
        payload.expectedRound !== room.roundNumber
      ) {
        return NextResponse.json({ room });
      }
      room.roundNumber += 1;
      const nextR = startRound(room, false);
      rooms.set(code, nextR);
      saveRoomsMap(rooms);
      return NextResponse.json({ room: nextR });
    }

    if (action === 'play_again') {
      room.roundNumber = 1;
      const restarted = startRound(room, true);
      rooms.set(code, restarted);
      saveRoomsMap(rooms);
      return NextResponse.json({ room: restarted });
    }

    if (action === 'return_to_lobby') {
      const resetPlayers = room.players
        .filter((p) => !p.isKicked)
        .map((p) => ({
          ...p,
          hand: [],
          score: 0,
          roundScores: [],
          isEliminated: false,
          isKicked: false,
          lastDraw: undefined,
          lastDiscard: undefined,
          missedTurns: 0,
        }));
      const lobbyRoom = {
        ...room,
        status: 'lobby' as const,
        players: resetPlayers,
        deck: [],
        visibleCards: [],
        exposedPile: [],
        lastRoundSummary: undefined,
        winnerId: undefined,
        updatedAt: Date.now(),
      };
      rooms.set(code, lobbyRoom);
      saveRoomsMap(rooms);
      return NextResponse.json({ room: lobbyRoom });
    }

    if (action === 'chat') {
      const text = (payload?.text || '').trim();
      if (text) {
        room.chat.push({
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          senderId: player?.id || 'anon',
          senderName: player?.name || 'Player',
          text: text.slice(0, 200),
          timestamp: Date.now(),
        });
        if (room.chat.length > 50) {
          room.chat = room.chat.slice(-50);
        }
        room.updatedAt = Date.now();
        rooms.set(code, room);
        saveRoomsMap(rooms);
      }
      return NextResponse.json({ room });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Room operation failed' },
      { status: 500 }
    );
  }
}
