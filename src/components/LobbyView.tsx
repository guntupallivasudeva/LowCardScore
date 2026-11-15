'use client';

import React, { useState } from 'react';
import {
  DECK_DIFFICULTY_PROFILES,
  DeckDifficulty,
  GameSettings,
  RoomState,
  normalizeDeckDifficulty,
} from '@/lib/gameEngine';
import {
  Copy,
  Check,
  Share2,
  UserX,
  LogOut,
  Play,
  Settings,
  Bot,
  Users,
  Plus,
  Minus,
  MessageSquare,
  Send,
  ArrowLeft,
  Pencil,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface LobbyViewProps {
  room: RoomState;
  currentUser: { id: string; name: string; email?: string };
  soundEnabled?: boolean;
  onToggleSound?: () => void;
  onUpdateSettings: (
    settings: GameSettings,
    botsConfig: { includeAI: boolean; easy: number; hard: number }
  ) => Promise<void>;
  onKickPlayer: (targetPlayerId: string) => Promise<void>;
  onLeaveRoom: () => Promise<void>;
  onTempBack: () => Promise<void>;
  onUpdateName: (newName: string) => Promise<void>;
  onStartGame: () => Promise<void>;
  onSendChat: (text: string) => Promise<void>;
}

export function LobbyView({
  room,
  currentUser,
  soundEnabled = true,
  onToggleSound,
  onUpdateSettings,
  onKickPlayer,
  onLeaveRoom,
  onTempBack,
  onUpdateName,
  onStartGame,
  onSendChat,
}: LobbyViewProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [chatText, setChatText] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(currentUser.name);

  // Confirmation Modals for Kick & Exit
  const [confirmKickPlayer, setConfirmKickPlayer] = useState<{ id: string; name: string } | null>(
    null
  );
  const [confirmExitModal, setConfirmExitModal] = useState(false);

  const isHost = room.hostId === currentUser.id;
  const canStart = room.players.length >= 2;
  const me = room.players.find((p) => p.id === currentUser.id) || currentUser;

  const currentSettings: GameSettings = {
    eliminationPoints: room.settings.eliminationPoints ?? 100,
    turnTimer: room.settings.turnTimer ?? 45,
    maxPlayers: room.settings.maxPlayers ?? 8,
    cardsPerPlayer: room.settings.cardsPerPlayer ?? 5,
    deckDifficulty: normalizeDeckDifficulty(room.settings.deckDifficulty),
  };

  const activeDifficulty = normalizeDeckDifficulty(currentSettings.deckDifficulty);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(room.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyInviteLink = () => {
    const url = `${window.location.origin}/?join=${room.code}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleWhatsAppShare = () => {
    const url = `${window.location.origin}/?join=${room.code}`;
    const text = `Join my LowScore card table! Room Code: ${room.code} — ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  const adjustSetting = async (
    key: 'eliminationPoints' | 'turnTimer' | 'maxPlayers' | 'cardsPerPlayer',
    delta: number,
    min: number,
    max: number
  ) => {
    if (!isHost) return;
    const nextVal = Math.max(min, Math.min(max, currentSettings[key] + delta));
    await onUpdateSettings({ ...currentSettings, [key]: nextVal }, room.botsConfig);
  };

  const changeDeckDifficulty = async (level: DeckDifficulty) => {
    if (!isHost || activeDifficulty === level) return;
    await onUpdateSettings({ ...currentSettings, deckDifficulty: level }, room.botsConfig);
  };

  const toggleIncludeAI = async () => {
    if (!isHost) return;
    const nextInclude = !room.botsConfig.includeAI;
    const nextEasy =
      nextInclude && room.botsConfig.easy === 0 && room.botsConfig.hard === 0
        ? 1
        : room.botsConfig.easy;
    await onUpdateSettings(currentSettings, {
      includeAI: nextInclude,
      easy: nextEasy,
      hard: room.botsConfig.hard,
    });
  };

  const adjustBots = async (type: 'easy' | 'hard', delta: number) => {
    if (!isHost) return;
    const currentVal = room.botsConfig[type];
    const nextVal = Math.max(0, Math.min(7, currentVal + delta));
    await onUpdateSettings(currentSettings, {
      ...room.botsConfig,
      includeAI: true,
      [type]: nextVal,
    });
  };

  const handleStart = async () => {
    if (!isHost || !canStart || starting) return;
    setStarting(true);
    setError(null);
    try {
      await onStartGame();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start match');
    } finally {
      setStarting(false);
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    const msg = chatText;
    setChatText('');
    await onSendChat(msg);
  };

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    await onUpdateName(nameInput.trim());
    setEditingName(false);
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#FAF9F5] text-stone-900 flex flex-col">
      {/* Single-Line Top Navbar: Icon-only Back button, no LeastScore title, all items on one line */}
      <header className="bg-white border-b border-stone-200 px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 whitespace-nowrap overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onTempBack}
            title="Go Back to Dashboard (Keep seat for 5 mins)"
            aria-label="Back"
            className="p-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 flex items-center justify-center transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-xs bg-stone-100 border border-stone-200 px-2.5 py-1 rounded-full text-stone-700 font-semibold">
            <span className="hidden sm:inline">Private Lobby · </span>
            {room.code}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {onToggleSound && (
            <button
              onClick={onToggleSound}
              title={soundEnabled ? 'Mute Sound Effects' : 'Unmute Sound Effects'}
              className="p-1.5 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700"
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4 text-stone-400" />
              )}
            </button>
          )}
          <button
            onClick={() => {
              setNameInput(me.name);
              setEditingName(true);
            }}
            className="px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-200 bg-stone-50 hover:bg-stone-100 flex items-center gap-1.5"
          >
            <span className="w-5 h-5 rounded-full bg-stone-900 text-white flex items-center justify-center text-[10px] font-bold">
              {me.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="font-semibold text-stone-800 max-w-[70px] sm:max-w-none truncate">
              {me.name}
            </span>
            <Pencil className="w-3 h-3 text-stone-400" />
          </button>

          <button
            onClick={() => setConfirmExitModal(true)}
            className="px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 flex items-center gap-1.5 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Exit Lobby</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-3 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Left & Center Column: Code Share + Players Table */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6 min-w-0">
          {/* Room Code & Share Card */}
          <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                Lobby Share Code
              </span>
              <div className="text-2xl sm:text-3xl font-mono font-bold tracking-widest text-stone-900 mt-1">
                {room.code}
              </div>
              <p className="text-xs text-stone-500 mt-1">
                Share this 5-character code with friends so they can join your table.
              </p>
            </div>

            <div className="w-full sm:w-auto grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={handleCopyCode}
                className="justify-center px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 flex items-center gap-1.5 transition-colors"
              >
                {copiedCode ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Copied Code</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 shrink-0" />
                    <span>Copy Code</span>
                  </>
                )}
              </button>

              <button
                onClick={handleCopyInviteLink}
                className="justify-center px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 flex items-center gap-1.5 transition-colors"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Link Copied</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Invite Link</span>
                  </>
                )}
              </button>

              <button
                onClick={handleWhatsAppShare}
                className="col-span-2 sm:col-auto justify-center px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold bg-[#25D366] hover:bg-[#1ebe5d] text-white flex items-center gap-1.5 transition-colors shadow-2xs"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 256 258"
                  width="18"
                  height="18"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <defs>
                    <linearGradient id="waLogoGreen" x1="50%" x2="50%" y1="100%" y2="0%">
                      <stop offset="0%" stopColor="#1faf38" />
                      <stop offset="100%" stopColor="#60d669" />
                    </linearGradient>
                    <linearGradient id="waLogoWhite" x1="50%" x2="50%" y1="100%" y2="0%">
                      <stop offset="0%" stopColor="#f9f9f9" />
                      <stop offset="100%" stopColor="#fff" />
                    </linearGradient>
                  </defs>
                  <path
                    fill="url(#waLogoGreen)"
                    d="M5.463 127.456c-.006 21.677 5.658 42.843 16.428 61.499L4.433 252.697l65.232-17.104a123 123 0 0 0 58.8 14.97h.054c67.815 0 123.018-55.183 123.047-123.01c.013-32.867-12.775-63.773-36.009-87.025c-23.23-23.25-54.125-36.061-87.043-36.076c-67.823 0-123.022 55.18-123.05 123.004"
                  />
                  <path
                    fill="url(#waLogoWhite)"
                    d="M1.07 127.416c-.007 22.457 5.86 44.38 17.014 63.704L0 257.147l67.571-17.717c18.618 10.151 39.58 15.503 60.91 15.511h.055c70.248 0 127.434-57.168 127.464-127.423c.012-34.048-13.236-66.065-37.3-90.15C194.633 13.286 162.633.014 128.536 0C58.276 0 1.099 57.16 1.071 127.416m40.24 60.376l-2.523-4.005c-10.606-16.864-16.204-36.352-16.196-56.363C22.614 69.029 70.138 21.52 128.576 21.52c28.3.012 54.896 11.044 74.9 31.06c20.003 20.018 31.01 46.628 31.003 74.93c-.026 58.395-47.551 105.91-105.943 105.91h-.042c-19.013-.01-37.66-5.116-53.922-14.765l-3.87-2.295l-40.098 10.513z"
                  />
                  <path
                    fill="#fff"
                    d="M96.678 74.148c-2.386-5.303-4.897-5.41-7.166-5.503c-1.858-.08-3.982-.074-6.104-.074c-2.124 0-5.575.799-8.492 3.984c-2.92 3.188-11.148 10.892-11.148 26.561s11.413 30.813 13.004 32.94c1.593 2.123 22.033 35.307 54.405 48.073c26.904 10.609 32.379 8.499 38.218 7.967c5.84-.53 18.844-7.702 21.497-15.139c2.655-7.436 2.655-13.81 1.859-15.142c-.796-1.327-2.92-2.124-6.105-3.716s-18.844-9.298-21.763-10.361c-2.92-1.062-5.043-1.592-7.167 1.597c-2.124 3.184-8.223 10.356-10.082 12.48c-1.857 2.129-3.716 2.394-6.9.801c-3.187-1.598-13.444-4.957-25.613-15.806c-9.468-8.442-15.86-18.867-17.718-22.056c-1.858-3.184-.199-4.91 1.398-6.497c1.431-1.427 3.186-3.719 4.78-5.578c1.588-1.86 2.118-3.187 3.18-5.311c1.063-2.126.531-3.986-.264-5.579c-.798-1.593-6.987-17.343-9.819-23.64"
                  />
                </svg>
                <span>Share on WhatsApp</span>
              </button>
            </div>
          </div>

          {/* Players Table (Joined Order: First on top, next below; Host has Kick icon, Players have Exit icon) */}
          <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-1.5 mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-stone-600" />
                <h2 className="text-sm font-bold text-stone-900">
                  Players Table — Joined Order ({room.players.length} / {currentSettings.maxPlayers})
                </h2>
              </div>
              <span className="text-xs text-stone-500">
                Minimum 2 players required to start
              </span>
            </div>

            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 uppercase text-[10px] sm:text-xs">
                    <th className="py-2 px-1.5 sm:px-3 font-semibold w-6">#</th>
                    <th className="py-2 px-1.5 sm:px-3 font-semibold">Player</th>
                    <th className="py-2 px-1.5 sm:px-3 font-semibold">Role</th>
                    <th className="py-2 px-1.5 sm:px-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {room.players.map((p, index) => {
                    const isMe = p.id === currentUser.id;
                    return (
                      <tr key={p.id} className="hover:bg-stone-50/70">
                        <td className="py-2.5 sm:py-3 px-1.5 sm:px-3 font-mono text-stone-500">{index + 1}</td>
                        <td className="py-2.5 sm:py-3 px-1.5 sm:px-3 font-semibold text-stone-900">
                          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-stone-900 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                              {p.name.slice(0, 2).toUpperCase()}
                            </div>
                            <span className="truncate max-w-[78px] sm:max-w-none">{p.name}</span>
                            {isMe && (
                              <span className="text-[9px] sm:text-[10px] bg-stone-100 border border-stone-200 px-1 sm:px-1.5 py-0.2 rounded text-stone-600 shrink-0">
                                You
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 sm:py-3 px-1.5 sm:px-3 whitespace-nowrap">
                          {p.isHost ? (
                            <span className="bg-amber-50 border border-amber-200 text-amber-800 px-1.5 sm:px-2 py-0.5 rounded font-semibold text-[10px] sm:text-xs">
                              Host
                            </span>
                          ) : p.isBot ? (
                            <span className="bg-stone-100 border border-stone-200 text-stone-700 px-1.5 sm:px-2 py-0.5 rounded font-medium uppercase text-[10px] sm:text-xs">
                              {p.botDifficulty}
                              <span className="hidden sm:inline"> Bot</span>
                            </span>
                          ) : (
                            <span className="text-stone-600 text-[11px] sm:text-xs">Player</span>
                          )}
                        </td>
                        <td className="py-2.5 sm:py-3 px-1.5 sm:px-3 text-right whitespace-nowrap">
                          {isMe ? (
                            <button
                              onClick={() => setConfirmExitModal(true)}
                              className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 font-medium text-[11px] sm:text-xs transition-colors"
                            >
                              <LogOut className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                              Exit
                            </button>
                          ) : isHost ? (
                            <button
                              onClick={() => setConfirmKickPlayer({ id: p.id, name: p.name })}
                              className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 font-medium text-[11px] sm:text-xs transition-colors"
                            >
                              <UserX className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                              Kick
                            </button>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {error && (
              <div className="mt-4 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            {/* Start Game Bar */}
            <div className="mt-6 pt-4 border-t border-stone-200 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-stone-500">
                {isHost
                  ? canStart
                    ? 'Ready to launch! Click Start Match when everyone is in.'
                    : 'Waiting for at least 1 more player (or enable AI Bots on the right).'
                  : 'Waiting for the Host to start the match...'}
              </div>

              {isHost && (
                <button
                  onClick={handleStart}
                  disabled={!canStart || starting}
                  className={`w-full sm:w-auto justify-center px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg sm:rounded-xl font-semibold text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 transition-all ${
                    canStart
                      ? 'bg-stone-900 hover:bg-stone-800 text-white shadow-sm cursor-pointer'
                      : 'bg-stone-200 text-stone-400 cursor-not-allowed'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  {starting ? 'Starting...' : 'Start Match'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Full Host Settings + AI Bots + Room Chat */}
        <div className="space-y-6">
          <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-2 border-b border-stone-100 pb-3">
              <Settings className="w-4 h-4 text-stone-600" />
              <h3 className="text-sm font-bold text-stone-900">Game Settings (Host)</h3>
            </div>

            {/* Elimination Max Points */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-stone-800">Max Points (Elimination)</div>
                <div className="text-[11px] text-stone-500">Eliminated at this score</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={!isHost}
                  onClick={() => adjustSetting('eliminationPoints', -10, 50, 300)}
                  className="w-7 h-7 rounded-lg border border-stone-300 flex items-center justify-center hover:bg-stone-100 disabled:opacity-40"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono font-bold text-sm w-12 text-center">
                  {currentSettings.eliminationPoints}
                </span>
                <button
                  disabled={!isHost}
                  onClick={() => adjustSetting('eliminationPoints', 10, 50, 300)}
                  className="w-7 h-7 rounded-lg border border-stone-300 flex items-center justify-center hover:bg-stone-100 disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Number of Cards per Player */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-stone-800">No. of Cards Dealt</div>
                <div className="text-[11px] text-stone-500">Starting cards per hand</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={!isHost}
                  onClick={() => adjustSetting('cardsPerPlayer', -1, 3, 7)}
                  className="w-7 h-7 rounded-lg border border-stone-300 flex items-center justify-center hover:bg-stone-100 disabled:opacity-40"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono font-bold text-sm w-12 text-center">
                  {currentSettings.cardsPerPlayer}
                </span>
                <button
                  disabled={!isHost}
                  onClick={() => adjustSetting('cardsPerPlayer', 1, 3, 7)}
                  className="w-7 h-7 rounded-lg border border-stone-300 flex items-center justify-center hover:bg-stone-100 disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Max Players */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-stone-800">Max Players</div>
                <div className="text-[11px] text-stone-500">Room player capacity (2–8)</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={!isHost}
                  onClick={() => adjustSetting('maxPlayers', -1, 2, 8)}
                  className="w-7 h-7 rounded-lg border border-stone-300 flex items-center justify-center hover:bg-stone-100 disabled:opacity-40"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono font-bold text-sm w-12 text-center">
                  {currentSettings.maxPlayers}
                </span>
                <button
                  disabled={!isHost}
                  onClick={() => adjustSetting('maxPlayers', 1, 2, 8)}
                  className="w-7 h-7 rounded-lg border border-stone-300 flex items-center justify-center hover:bg-stone-100 disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Turn Timer (Default 45s) */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-stone-800">Turn Timer</div>
                <div className="text-[11px] text-stone-500">Default 45s per turn</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={!isHost}
                  onClick={() => adjustSetting('turnTimer', -5, 15, 90)}
                  className="w-7 h-7 rounded-lg border border-stone-300 flex items-center justify-center hover:bg-stone-100 disabled:opacity-40"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono font-bold text-sm w-12 text-center">
                  {currentSettings.turnTimer}s
                </span>
                <button
                  disabled={!isHost}
                  onClick={() => adjustSetting('turnTimer', 5, 15, 90)}
                  className="w-7 h-7 rounded-lg border border-stone-300 flex items-center justify-center hover:bg-stone-100 disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Card Deck Difficulty (Default: Medium) */}
            <div className="pt-3 border-t border-stone-100 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-stone-800">Card Deal &amp; Deck Level</div>
                  <div className="text-[11px] text-stone-500">
                    {DECK_DIFFICULTY_PROFILES[activeDifficulty].description}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5 bg-stone-100 p-1 rounded-xl border border-stone-200">
                {(['easy', 'medium', 'hard'] as DeckDifficulty[]).map((lvl) => {
                  const selected = activeDifficulty === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      disabled={!isHost}
                      onClick={() => changeDeckDifficulty(lvl)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-60 ${
                        selected
                          ? 'bg-stone-900 text-white shadow-2xs'
                          : 'text-stone-700 hover:bg-white/70'
                      }`}
                    >
                      {DECK_DIFFICULTY_PROFILES[lvl].label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Include AI Bots */}
            <div className="pt-3 border-t border-stone-100 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Bot className="w-4 h-4 text-stone-600" />
                  <span className="text-xs font-semibold text-stone-800">Include AI Bots</span>
                </div>
                <button
                  type="button"
                  disabled={!isHost}
                  onClick={toggleIncludeAI}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    room.botsConfig.includeAI
                      ? 'bg-stone-900 text-white border-stone-900'
                      : 'bg-stone-100 text-stone-600 border-stone-300'
                  }`}
                >
                  {room.botsConfig.includeAI ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              {room.botsConfig.includeAI && (
                <div className="space-y-2.5 bg-stone-50 p-3 rounded-xl border border-stone-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-stone-700 font-medium">Easy Bots</span>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={!isHost}
                        onClick={() => adjustBots('easy', -1)}
                        className="w-6 h-6 rounded border border-stone-300 bg-white flex items-center justify-center"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="font-mono font-bold text-xs w-5 text-center">
                        {room.botsConfig.easy}
                      </span>
                      <button
                        disabled={!isHost}
                        onClick={() => adjustBots('easy', 1)}
                        className="w-6 h-6 rounded border border-stone-300 bg-white flex items-center justify-center"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-stone-700 font-medium">Hard Bots</span>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={!isHost}
                        onClick={() => adjustBots('hard', -1)}
                        className="w-6 h-6 rounded border border-stone-300 bg-white flex items-center justify-center"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="font-mono font-bold text-xs w-5 text-center">
                        {room.botsConfig.hard}
                      </span>
                      <button
                        disabled={!isHost}
                        onClick={() => adjustBots('hard', 1)}
                        className="w-6 h-6 rounded border border-stone-300 bg-white flex items-center justify-center"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Room Chat Box */}
          <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs flex flex-col h-72">
            <div className="flex items-center gap-2 border-b border-stone-100 pb-2.5 mb-2">
              <MessageSquare className="w-4 h-4 text-stone-600" />
              <h3 className="text-sm font-bold text-stone-900">Lobby Chat</h3>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
              {room.chat.length === 0 ? (
                <p className="text-stone-400 text-center py-10">No messages yet.</p>
              ) : (
                room.chat.map((c) => (
                  <div
                    key={c.id}
                    className="bg-stone-50 border border-stone-200/80 rounded-lg px-2.5 py-1.5"
                  >
                    <span className="font-bold text-stone-900">{c.senderName}: </span>
                    <span className="text-stone-700">{c.text}</span>
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={handleChatSubmit}
              className="mt-2 pt-2 border-t border-stone-100 flex gap-1.5"
            >
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Write a message..."
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
        </div>
      </main>

      {/* Confirm Kick Player Modal */}
      {confirmKickPlayer && (
        <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-stone-300 rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-stone-900">
              Kick {confirmKickPlayer.name}?
            </h3>
            <p className="text-xs text-stone-600">
              Are you sure you want to remove <strong>{confirmKickPlayer.name}</strong> from this lobby?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmKickPlayer(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-stone-300 text-stone-700 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const targetId = confirmKickPlayer.id;
                  setConfirmKickPlayer(null);
                  await onKickPlayer(targetId);
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

      {/* Confirm Exit Lobby Modal */}
      {confirmExitModal && (
        <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-stone-300 rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-stone-900">Exit Lobby?</h3>
            <p className="text-xs text-stone-600">
              Are you sure you want to leave this lobby?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmExitModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-stone-300 text-stone-700 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setConfirmExitModal(false);
                  await onLeaveRoom();
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-700 flex items-center gap-1"
              >
                <LogOut className="w-3.5 h-3.5" />
                Confirm Exit
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
    </div>
  );
}
