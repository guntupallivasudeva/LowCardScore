'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  DECK_DIFFICULTY_PROFILES,
  DeckDifficulty,
  RoomState,
  normalizeDeckDifficulty,
} from '@/lib/gameEngine';
import { LobbyView } from '@/components/LobbyView';
import { GameTable } from '@/components/GameTable';
import { PlayingCard } from '@/components/PlayingCard';
import { LowScoreLogo } from '@/components/LowScoreLogo';
import { FireSuitLoader } from '@/components/FireSuitLoader';
import { authClient } from '@/lib/auth-client';
import { soundFX } from '@/lib/soundEffects';
import {
  Users,
  Bot,
  BookOpen,
  LogOut,
  ArrowRight,
  Plus,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Settings,
  Trash2,
  ShieldAlert,
  User as UserIcon,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface UserSession {
  id: string;
  email: string;
  name: string;
  soundEnabled?: boolean;
  isGuest?: boolean;
}

const STORAGE_USER_KEY = 'lowscore_user_session_v1';
const STORAGE_ACTIVE_ROOM_KEY = 'lowscore_active_room_v1';
const STORAGE_REJOIN_ROOM_KEY = 'lowscore_rejoin_room_v1';
const STORAGE_DIFFICULTY_KEY = 'lowscore_deck_difficulty_v1';
const LEGACY_USER_KEY = 'leastscore_user_session_v1';
const LEGACY_ACTIVE_ROOM_KEY = 'leastscore_active_room_v1';
const LEGACY_REJOIN_ROOM_KEY = 'leastscore_rejoin_room_v1';

function readStorageWithLegacy(primary: string, legacy: string): string | null {
  try {
    const val = localStorage.getItem(primary);
    if (val !== null) return val;
    const oldVal = localStorage.getItem(legacy);
    if (oldVal !== null) {
      localStorage.setItem(primary, oldVal);
      localStorage.removeItem(legacy);
      return oldVal;
    }
  } catch {
    // ignore storage access issues
  }
  return null;
}

function writeActiveRoomCode(code: string | null) {
  try {
    if (code) {
      localStorage.setItem(STORAGE_ACTIVE_ROOM_KEY, code);
      localStorage.removeItem(LEGACY_ACTIVE_ROOM_KEY);
    } else {
      localStorage.removeItem(STORAGE_ACTIVE_ROOM_KEY);
      localStorage.removeItem(LEGACY_ACTIVE_ROOM_KEY);
    }
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    if (code) {
      url.searchParams.set('room', code);
      url.searchParams.delete('join');
    } else {
      url.searchParams.delete('room');
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }
}

interface RejoinInfo {
  code: string;
  leftAt: number;
}

export default function LeastScoreApp() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [reconnectingCode, setReconnectingCode] = useState<string | null>(null);

  // Auth form states
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Room & Navigation state
  const [room, setRoom] = useState<RoomState | null>(null);
  const [rejoinInfo, setRejoinInfo] = useState<RejoinInfo | null>(null);
  const [rejoinSecondsLeft, setRejoinSecondsLeft] = useState<number>(0);

  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);

  // User Profile & Account Management Modals on Dashboard
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [profileSavedMessage, setProfileSavedMessage] = useState<string | null>(null);
  const [confirmDeleteAccountModal, setConfirmDeleteAccountModal] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [aiDeckDifficulty, setAiDeckDifficulty] = useState<DeckDifficulty>('medium');

  const botTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptedRef = useRef<boolean>(false);

  // 1. Hydrate Better Auth cookie session (or saved Guest session), D1 preferences & rejoin state on mount
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const urlJoin = params.get('join');
        const urlRoom = params.get('room');
        if (urlJoin) {
          setJoinCodeInput(urlJoin.toUpperCase().slice(0, 5));
        }

        const savedRoomCode = (
          urlRoom ||
          readStorageWithLegacy(STORAGE_ACTIVE_ROOM_KEY, LEGACY_ACTIVE_ROOM_KEY) ||
          ''
        )
          .trim()
          .toUpperCase();

        const savedRejoin = readStorageWithLegacy(STORAGE_REJOIN_ROOM_KEY, LEGACY_REJOIN_ROOM_KEY);
        if (savedRejoin) {
          const parsedRejoin = JSON.parse(savedRejoin) as RejoinInfo;
          if (Date.now() - parsedRejoin.leftAt < 5 * 60 * 1000) {
            setRejoinInfo(parsedRejoin);
          } else {
            localStorage.removeItem(STORAGE_REJOIN_ROOM_KEY);
            localStorage.removeItem(LEGACY_REJOIN_ROOM_KEY);
          }
        }

        const savedRaw = readStorageWithLegacy(STORAGE_USER_KEY, LEGACY_USER_KEY);
        let parsedSaved: UserSession | null = null;
        if (savedRaw) {
          try {
            const p = JSON.parse(savedRaw) as UserSession;
            if (p?.id && p?.name) parsedSaved = p;
          } catch {
            // ignore corrupted json
          }
        }

        let resolvedUser: UserSession | null = null;
        try {
          const sessionRes = await authClient.getSession();
          const sessionUser = sessionRes?.data?.user as
            | { id: string; email: string; name: string; soundEnabled?: boolean }
            | undefined;
          const sessionError = sessionRes?.error as
            | { status?: number; message?: string }
            | null
            | undefined;

          if (sessionUser?.id && sessionUser?.email) {
            let remoteSound =
              typeof sessionUser.soundEnabled === 'boolean' ? sessionUser.soundEnabled : undefined;
            let remoteDifficulty: DeckDifficulty | undefined;
            try {
              const prefRes = await fetch(
                `/api/preferences?userId=${encodeURIComponent(sessionUser.id)}`,
                { cache: 'no-store' }
              );
              if (prefRes.ok) {
                const prefJson = (await prefRes.json()) as {
                  preferences?: { soundEnabled?: boolean; defaultDeckDifficulty?: DeckDifficulty };
                };
                if (typeof prefJson?.preferences?.soundEnabled === 'boolean') {
                  remoteSound = prefJson.preferences.soundEnabled;
                }
                if (prefJson?.preferences?.defaultDeckDifficulty) {
                  remoteDifficulty = normalizeDeckDifficulty(
                    prefJson.preferences.defaultDeckDifficulty
                  );
                }
              }
            } catch {
              // ignore transient pref fetch error
            }
            const hasLocalPref =
              localStorage.getItem(`lowscore_sound_pref_${sessionUser.id}`) !== null ||
              localStorage.getItem(`leastscore_sound_pref_${sessionUser.id}`) !== null;
            const finalSound = hasLocalPref
              ? soundFX.loadPreference(sessionUser.id)
              : remoteSound ?? soundFX.loadPreference();

            if (remoteDifficulty) {
              setAiDeckDifficulty(remoteDifficulty);
              try {
                localStorage.setItem(STORAGE_DIFFICULTY_KEY, remoteDifficulty);
              } catch {
                // ignore
              }
            } else {
              try {
                const storedDiff = localStorage.getItem(STORAGE_DIFFICULTY_KEY);
                if (storedDiff) setAiDeckDifficulty(normalizeDeckDifficulty(storedDiff));
              } catch {
                // ignore
              }
            }

            resolvedUser = {
              id: sessionUser.id,
              email: sessionUser.email,
              name: sessionUser.name || sessionUser.email.split('@')[0],
              soundEnabled: finalSound,
              isGuest: false,
            };
          } else if (parsedSaved?.isGuest) {
            resolvedUser = parsedSaved;
            try {
              const storedDiff = localStorage.getItem(STORAGE_DIFFICULTY_KEY);
              if (storedDiff) setAiDeckDifficulty(normalizeDeckDifficulty(storedDiff));
            } catch {
              // ignore
            }
          } else if (
            sessionError &&
            sessionError.status !== 401 &&
            sessionError.status !== 403 &&
            parsedSaved
          ) {
            resolvedUser = parsedSaved;
          } else {
            localStorage.removeItem(STORAGE_USER_KEY);
            localStorage.removeItem(LEGACY_USER_KEY);
          }
        } catch {
          if (parsedSaved) {
            resolvedUser = parsedSaved;
          }
        }

        if (cancelled) return;

        if (resolvedUser) {
          if (typeof resolvedUser.soundEnabled === 'boolean') {
            soundFX.savePreference(resolvedUser.soundEnabled, resolvedUser.id);
          }
          const finalPref = soundFX.loadPreference(resolvedUser.id);
          resolvedUser = { ...resolvedUser, soundEnabled: finalPref };
          localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(resolvedUser));
          setUser(resolvedUser);
          setSoundEnabled(finalPref);

          if (savedRoomCode && savedRoomCode.length >= 4) {
            setReconnectingCode(savedRoomCode);
          }
        } else {
          setSoundEnabled(soundFX.loadPreference());
        }
      } catch {
        // ignore startup hydration errors
      } finally {
        if (!cancelled) {
          setAuthLoaded(true);
        }
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Rejoin countdown timer on Dashboard (5 minutes = 300s)
  useEffect(() => {
    if (!rejoinInfo) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - rejoinInfo.leftAt) / 1000);
      const rem = Math.max(0, 300 - elapsed);
      setRejoinSecondsLeft(rem);
      if (rem === 0) {
        setRejoinInfo(null);
        localStorage.removeItem(STORAGE_REJOIN_ROOM_KEY);
        localStorage.removeItem(LEGACY_REJOIN_ROOM_KEY);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [rejoinInfo]);

  // Reconnect to active room on page refresh (keeps player seamlessly inside the game)
  useEffect(() => {
    if (!user || room || reconnectAttemptedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const savedCode = (
      params.get('room') ||
      readStorageWithLegacy(STORAGE_ACTIVE_ROOM_KEY, LEGACY_ACTIVE_ROOM_KEY) ||
      ''
    )
      .trim()
      .toUpperCase();

    if (!savedCode || savedCode.length < 4) {
      setReconnectingCode(null);
      return;
    }

    reconnectAttemptedRef.current = true;
    setReconnectingCode(savedCode);

    fetch(
      `/api/room?code=${encodeURIComponent(savedCode)}&playerId=${encodeURIComponent(user.id)}`,
      { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } }
    )
      .then((r) => (r.ok ? (r.json() as Promise<{ room?: RoomState }>) : null))
      .then((data) => {
        if (data?.room) {
          const mySeat = data.room.players.find(
            (p: { id: string; isKicked?: boolean }) => p.id === user.id
          );
          if (mySeat && !mySeat.isKicked) {
            setRoom(data.room);
            writeActiveRoomCode(data.room.code);
            return;
          }
        }
        writeActiveRoomCode(null);
      })
      .catch(() => {
        writeActiveRoomCode(null);
      })
      .finally(() => {
        setReconnectingCode(null);
      });
  }, [user, room]);

  // 2. Poll active room state for realtime multiplayer synchronization
  const fetchRoomUpdate = useCallback(async (code: string, currentUserId: string) => {
    try {
      const res = await fetch(
        `/api/room?code=${encodeURIComponent(code)}&playerId=${encodeURIComponent(currentUserId)}`,
        { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } }
      );
      if (!res.ok) {
        if (res.status === 404) {
          setRoom(null);
          writeActiveRoomCode(null);
        }
        return;
      }
      const data = (await res.json()) as { room?: RoomState };
      if (data?.room) {
        const myEntry = data.room.players.find((p: { id: string }) => p.id === currentUserId);
        if (!myEntry || myEntry.isKicked) {
          setRoom(null);
          writeActiveRoomCode(null);
          setDashboardError(
            myEntry?.isKicked ? 'You were kicked from the room.' : 'You were removed from the room.'
          );
          return;
        }
        setRoom(data.room);
      }
    } catch {
      // ignore transient network error
    }
  }, []);

  useEffect(() => {
    if (!room || !user) return;
    const interval = setInterval(() => {
      fetchRoomUpdate(room.code, user.id);
    }, 1000);
    return () => clearInterval(interval);
  }, [room, user, fetchRoomUpdate]);

  // Also keep background polling if user stepped away (in rejoinInfo) so bots continue playing while user is on Dashboard
  useEffect(() => {
    if (room || !rejoinInfo) return;
    const interval = setInterval(() => {
      fetch(`/api/room?code=${encodeURIComponent(rejoinInfo.code)}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      }).catch(() => {});
    }, 1800);
    return () => clearInterval(interval);
  }, [room, rejoinInfo]);

  // 3. Trigger AI Bot turns automatically when currentTurnPlayerId is a bot or disconnected human
  useEffect(() => {
    if (!room || room.status !== 'playing' || !user) return;
    const activePlayer = room.players.find((p) => p.id === room.currentTurnPlayerId);
    if (activePlayer && (activePlayer.isBot || activePlayer.disconnectedAt)) {
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
      botTimeoutRef.current = setTimeout(async () => {
        try {
          const res = await fetch('/api/room', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
            body: JSON.stringify({
              action: 'bot_turn',
              code: room.code,
              player: user,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as { room?: RoomState };
            if (data.room) setRoom(data.room);
          }
        } catch {
          // ignore
        }
      }, 1100);
    }
    return () => {
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    };
  }, [room, user]);

  // Better Auth Handlers (Cloudflare D1 backed)
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const chosenName = displayName.trim() || cleanEmail.split('@')[0] || 'Player';
      const localDefaultSound = soundFX.loadPreference();

      const authRes =
        authMode === 'signup'
          ? await authClient.signUp.email({
              email: cleanEmail,
              password,
              name: chosenName,
              soundEnabled: localDefaultSound,
            } as Parameters<typeof authClient.signUp.email>[0])
          : await authClient.signIn.email({
              email: cleanEmail,
              password,
            });

      if (authRes.error) {
        setAuthError(authRes.error.message || 'Authentication failed');
        return;
      }

      const signedUser = authRes.data?.user as
        | { id: string; email: string; name: string; soundEnabled?: boolean }
        | undefined;

      if (signedUser?.id) {
        let remoteSound =
          typeof signedUser.soundEnabled === 'boolean' ? signedUser.soundEnabled : undefined;
        let remoteDifficulty: DeckDifficulty | undefined;
        try {
          if (authMode === 'signup') {
            await fetch('/api/preferences', {
              method: 'POST',
              cache: 'no-store',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: signedUser.id,
                name: signedUser.name || chosenName,
                soundEnabled: localDefaultSound,
                defaultDeckDifficulty: aiDeckDifficulty,
              }),
            });
            remoteSound = localDefaultSound;
            remoteDifficulty = aiDeckDifficulty;
          } else {
            const prefRes = await fetch(
              `/api/preferences?userId=${encodeURIComponent(signedUser.id)}`,
              { cache: 'no-store' }
            );
            if (prefRes.ok) {
              const prefJson = (await prefRes.json()) as {
                preferences?: { soundEnabled?: boolean; defaultDeckDifficulty?: DeckDifficulty };
              };
              if (typeof prefJson?.preferences?.soundEnabled === 'boolean') {
                remoteSound = prefJson.preferences.soundEnabled;
              }
              if (prefJson?.preferences?.defaultDeckDifficulty) {
                remoteDifficulty = normalizeDeckDifficulty(
                  prefJson.preferences.defaultDeckDifficulty
                );
              }
            }
          }
        } catch {
          // ignore transient D1 pref sync error
        }

        if (remoteDifficulty) {
          setAiDeckDifficulty(remoteDifficulty);
          try {
            localStorage.setItem(STORAGE_DIFFICULTY_KEY, remoteDifficulty);
          } catch {
            // ignore
          }
        }

        const hasLocalUserPref =
          localStorage.getItem(`lowscore_sound_pref_${signedUser.id}`) !== null ||
          localStorage.getItem(`leastscore_sound_pref_${signedUser.id}`) !== null;
        const resolvedSound = hasLocalUserPref
          ? soundFX.loadPreference(signedUser.id)
          : remoteSound ?? localDefaultSound;

        const sessionUser: UserSession = {
          id: signedUser.id,
          email: signedUser.email,
          name: signedUser.name || chosenName,
          soundEnabled: resolvedSound,
          isGuest: false,
        };
        soundFX.savePreference(resolvedSound, sessionUser.id);
        setSoundEnabled(resolvedSound);
        localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(sessionUser));
        reconnectAttemptedRef.current = false;
        setShowPassword(false);
        setPassword('');
        setUser(sessionUser);
      }
    } catch {
      setAuthError('Network error while connecting to Better Auth service.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleQuickGuest = () => {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const currentPref = soundFX.loadPreference();
    const guestUser: UserSession = {
      id: `guest_${Math.random().toString(36).substring(2, 10)}`,
      email: `guest${randomNum}@lowscore.local`,
      name: displayName.trim() || `Player${randomNum}`,
      soundEnabled: currentPref,
      isGuest: true,
    };
    soundFX.savePreference(currentPref, guestUser.id);
    localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(guestUser));
    reconnectAttemptedRef.current = false;
    setUser(guestUser);
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundFX.savePreference(next, user?.id);
    if (user) {
      const updatedUser: UserSession = { ...user, soundEnabled: next };
      setUser(updatedUser);
      try {
        localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(updatedUser));
      } catch {
        // ignore localStorage errors
      }
      fetch('/api/preferences', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          soundEnabled: next,
        }),
      }).catch(() => {});
    }
  };

  const handleLogout = async () => {
    try {
      await authClient.signOut({
        fetchOptions: {
          headers: { 'Content-Type': 'application/json' },
          body: {},
        },
      });
    } catch {
      // ignore signOut network error
    }
    localStorage.removeItem(STORAGE_USER_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
    localStorage.removeItem(STORAGE_REJOIN_ROOM_KEY);
    localStorage.removeItem(LEGACY_REJOIN_ROOM_KEY);
    writeActiveRoomCode(null);
    reconnectAttemptedRef.current = false;
    setShowProfileModal(false);
    setConfirmDeleteAccountModal(false);
    setDeleteAccountError(null);
    setProfileSavedMessage(null);
    setShowPassword(false);
    setReconnectingCode(null);
    setRoom(null);
    setRejoinInfo(null);
    setUser(null);
  };

  const handleUpdateUserName = async (newName: string) => {
    if (!user) return;
    const cleaned = newName.trim().slice(0, 24);
    if (!cleaned) return;
    const updatedUser: UserSession = { ...user, name: cleaned };
    setUser(updatedUser);
    localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(updatedUser));

    fetch('/api/preferences', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, name: cleaned }),
    }).catch(() => {});

    if (room) {
      await callRoomApi('update_name', { name: cleaned });
    }
  };

  const handleUpdateDefaultDifficulty = (difficulty: DeckDifficulty) => {
    setAiDeckDifficulty(difficulty);
    try {
      localStorage.setItem(STORAGE_DIFFICULTY_KEY, difficulty);
    } catch {
      // ignore
    }
    if (user) {
      fetch('/api/preferences', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          defaultDeckDifficulty: difficulty,
        }),
      }).catch(() => {});
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || deletingAccount) return;
    setDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({
          guestId: user.isGuest ? user.id : undefined,
          activeRoomCode: room?.code || rejoinInfo?.code,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDeleteAccountError(data.error || 'Could not delete your account. Please try again.');
        return;
      }

      try {
        localStorage.removeItem(STORAGE_USER_KEY);
        localStorage.removeItem(LEGACY_USER_KEY);
        localStorage.removeItem(STORAGE_REJOIN_ROOM_KEY);
        localStorage.removeItem(LEGACY_REJOIN_ROOM_KEY);
        localStorage.removeItem(STORAGE_DIFFICULTY_KEY);
        localStorage.removeItem(`lowscore_sound_pref_${user.id}`);
        localStorage.removeItem(`leastscore_sound_pref_${user.id}`);
      } catch {
        // ignore storage cleanup errors
      }
      writeActiveRoomCode(null);
      reconnectAttemptedRef.current = false;
      setConfirmDeleteAccountModal(false);
      setShowProfileModal(false);
      setProfileSavedMessage(null);
      setReconnectingCode(null);
      setRoom(null);
      setRejoinInfo(null);
      setShowPassword(false);
      setPassword('');
      setAuthError(null);
      setAuthMode('login');
      setUser(null);
    } catch {
      setDeleteAccountError('Network error while deleting account. Please try again.');
    } finally {
      setDeletingAccount(false);
    }
  };

  // Room API Helpers
  const callRoomApi = async (
    action: string,
    payload?: Record<string, unknown>,
    customCode?: string
  ) => {
    if (!user) return;
    const targetCode = customCode || room?.code;
    const res = await fetch('/api/room', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({
        action,
        code: targetCode,
        player: user,
        payload,
      }),
    });
    const data = (await res.json()) as { room?: RoomState | null; error?: string };
    if (!res.ok) {
      if (res.status === 401 && !user.isGuest) {
        try {
          localStorage.removeItem(STORAGE_USER_KEY);
          localStorage.removeItem(LEGACY_USER_KEY);
        } catch {
          // ignore
        }
        writeActiveRoomCode(null);
        setRoom(null);
        setRejoinInfo(null);
        setAuthError(data.error || 'Your login session expired. Please log in again.');
        setUser(null);
      }
      throw new Error(data.error || 'Operation failed');
    }

    if (action === 'temp_leave') {
      if (targetCode) {
        const info: RejoinInfo = { code: targetCode, leftAt: Date.now() };
        setRejoinInfo(info);
        localStorage.setItem(STORAGE_REJOIN_ROOM_KEY, JSON.stringify(info));
      }
      writeActiveRoomCode(null);
      setRoom(null);
      return;
    }

    if (data.room) {
      setRoom(data.room);
      writeActiveRoomCode(data.room.code);
      setRejoinInfo(null);
      localStorage.removeItem(STORAGE_REJOIN_ROOM_KEY);
      localStorage.removeItem(LEGACY_REJOIN_ROOM_KEY);
    } else {
      setRoom(null);
      writeActiveRoomCode(null);
    }
  };

  const handleCreatePrivateLobby = async () => {
    if (!user || loadingAction) return;
    setLoadingAction(true);
    setDashboardError(null);
    try {
      await callRoomApi('create', {
        botsConfig: { includeAI: false, easy: 0, hard: 0 },
        settings: {
          eliminationPoints: 100,
          turnTimer: 45,
          maxPlayers: 8,
          cardsPerPlayer: 5,
          deckDifficulty: aiDeckDifficulty,
        },
      });
    } catch (e: unknown) {
      setDashboardError(e instanceof Error ? e.message : 'Could not create lobby');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleCreateAIGame = async (easyCount: number, hardCount: number) => {
    if (!user || loadingAction) return;
    setLoadingAction(true);
    setDashboardError(null);
    try {
      await callRoomApi('create', {
        botsConfig: { includeAI: true, easy: easyCount, hard: hardCount },
        settings: {
          eliminationPoints: 100,
          turnTimer: 45,
          maxPlayers: 8,
          cardsPerPlayer: 5,
          deckDifficulty: aiDeckDifficulty,
        },
        autoStart: true,
      });
    } catch (e: unknown) {
      setDashboardError(e instanceof Error ? e.message : 'Could not start AI match');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleJoinLobbyByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCodeInput.trim().toUpperCase();
    if (cleaned.length < 4) {
      setDashboardError('Please enter a valid 5-character lobby code.');
      return;
    }
    setLoadingAction(true);
    setDashboardError(null);
    try {
      await callRoomApi('join', {}, cleaned);
    } catch (e: unknown) {
      setDashboardError(e instanceof Error ? e.message : 'Could not join lobby');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleRejoinActiveMatch = async () => {
    if (!rejoinInfo || loadingAction) return;
    setLoadingAction(true);
    setDashboardError(null);
    try {
      await callRoomApi('join', {}, rejoinInfo.code);
    } catch (e: unknown) {
      setDashboardError(e instanceof Error ? e.message : 'Could not rejoin match');
      setRejoinInfo(null);
      localStorage.removeItem(STORAGE_REJOIN_ROOM_KEY);
    } finally {
      setLoadingAction(false);
    }
  };

  if (!authLoaded || (user && !room && reconnectingCode)) {
    return (
      <div className="min-h-screen bg-[#FAF9F5] flex flex-col items-center justify-center p-6">
        <FireSuitLoader
          label={
            reconnectingCode
              ? `Reconnecting to Table ${reconnectingCode}...`
              : 'Loading LowScore...'
          }
          sublabel={
            reconnectingCode
              ? 'Keeping your active hand, turn timer & table intact'
              : 'Warming the deck & Cloudflare D1 session'
          }
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // VIEW 1: LOGIN / SIGN UP SCREEN
  // ---------------------------------------------------------------------------
  if (!user) {
    return (
      <div className="min-h-screen bg-[#FAF9F5] text-stone-900 flex flex-col justify-center items-center p-3 sm:p-4">
        <div className="max-w-md w-full bg-white border border-stone-200 rounded-2xl p-5 sm:p-8 shadow-xs space-y-5 sm:space-y-6">
          <div className="text-center space-y-2">
            <div className="flex justify-center items-center gap-2 mb-3">
              <PlayingCard
                card={{ id: 'demo-1', suit: 'spades', rank: 'A' }}
                size="sm"
                className="-rotate-6"
              />
              <PlayingCard
                card={{ id: 'demo-2', suit: 'hearts', rank: 'K' }}
                size="sm"
                className="rotate-6"
              />
            </div>
            <div className="inline-flex items-center justify-center gap-2">
              <LowScoreLogo className="w-7 h-7" />
              <h1 className="text-2xl font-bold tracking-tight text-stone-900">LowScore</h1>
            </div>
            <p className="text-xs text-stone-500">
              Strategic Low-Sum Card Game · Play with Friends or AI
            </p>
          </div>

          <div className="grid grid-cols-2 gap-1 bg-stone-100 p-1 rounded-xl border border-stone-200 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setAuthError(null);
              }}
              className={`py-2 rounded-lg transition-all ${
                authMode === 'login'
                  ? 'bg-white text-stone-900 shadow-2xs'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('signup');
                setAuthError(null);
              }}
              className={`py-2 rounded-lg transition-all ${
                authMode === 'signup'
                  ? 'bg-white text-stone-900 shadow-2xs'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'signup' && (
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Player Display Name
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Vasu"
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-stone-300 rounded-xl focus:outline-none focus:border-stone-900"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-stone-300 rounded-xl focus:outline-none focus:border-stone-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={4}
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2.5 text-sm bg-white border border-stone-300 rounded-xl focus:outline-none focus:border-stone-900"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-stone-400 hover:text-stone-700 focus:outline-none touch-manipulation"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {authError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2.5 rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full bg-stone-900 hover:bg-stone-800 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors shadow-xs"
            >
              {authSubmitting
                ? 'Please wait...'
                : authMode === 'login'
                ? 'Log In & Save Session'
                : 'Sign Up & Save Session'}
            </button>
          </form>

          <div className="relative flex py-1 items-center">
            <div className="grow border-t border-stone-200" />
            <span className="shrink mx-3 text-[11px] text-stone-400 uppercase font-medium">
              or quick play
            </span>
            <div className="grow border-t border-stone-200" />
          </div>

          <button
            type="button"
            onClick={handleQuickGuest}
            className="w-full bg-stone-100 hover:bg-stone-200/80 text-stone-800 border border-stone-300 font-semibold py-2.5 rounded-xl text-xs transition-colors"
          >
            Continue as Guest (Saved in Browser)
          </button>

          <p className="text-[11px] text-stone-400 text-center flex items-center justify-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Secured by Better Auth &amp; Cloudflare D1 · Guest mode supported
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // VIEW 2: PRIVATE ROOM LOBBY
  // ---------------------------------------------------------------------------
  if (room && room.status === 'lobby') {
    return (
      <LobbyView
        room={room}
        currentUser={user}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onUpdateSettings={async (settings, botsConfig) => {
          await callRoomApi('update_settings', { settings, botsConfig });
        }}
        onKickPlayer={async (targetPlayerId) => {
          await callRoomApi('kick', { targetPlayerId });
        }}
        onLeaveRoom={async () => {
          await callRoomApi('leave');
        }}
        onTempBack={async () => {
          await callRoomApi('temp_leave');
        }}
        onUpdateName={handleUpdateUserName}
        onStartGame={async () => {
          await callRoomApi('start_game');
        }}
        onSendChat={async (text) => {
          await callRoomApi('chat', { text });
        }}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // VIEW 3: ACTIVE IN-GAME TABLE (PLAYING / ROUND END / GAME OVER)
  // ---------------------------------------------------------------------------
  if (
    room &&
    (room.status === 'playing' || room.status === 'round_end' || room.status === 'game_over')
  ) {
    return (
      <GameTable
        room={room}
        currentUser={user}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onMakeMove={async (discardIds, drawFrom, visibleIndex) => {
          await callRoomApi('make_move', { discardIds, drawFrom, visibleIndex });
        }}
        onDeclare={async () => {
          await callRoomApi('declare');
        }}
        onShuffleDeck={async () => {
          await callRoomApi('shuffle_deck');
        }}
        onKickPlayer={async (targetPlayerId) => {
          await callRoomApi('kick', { targetPlayerId });
        }}
        onLeaveRoom={async () => {
          await callRoomApi('leave');
        }}
        onTempBack={async () => {
          await callRoomApi('temp_leave');
        }}
        onTimeoutTurn={async () => {
          await callRoomApi('timeout_turn');
        }}
        onUpdateName={handleUpdateUserName}
        onNextRound={async (expectedRound) => {
          await callRoomApi('next_round', expectedRound ? { expectedRound } : undefined);
        }}
        onPlayAgain={async () => {
          await callRoomApi('play_again');
        }}
        onReturnToLobby={async () => {
          await callRoomApi('return_to_lobby');
        }}
        onSendChat={async (text) => {
          await callRoomApi('chat', { text });
        }}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // VIEW 4: CLEAN PLAIN WEB DASHBOARD
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#FAF9F5] text-stone-900 flex flex-col">
      {/* Top Bar */}
      <header className="bg-white border-b border-stone-200 px-3 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between gap-2 whitespace-nowrap overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <LowScoreLogo className="w-6 h-6 sm:w-7 sm:h-7 shrink-0" />
          <span className="font-bold text-base sm:text-lg tracking-tight text-stone-900">LowScore</span>
          <span className="text-xs text-stone-500 hidden sm:inline">Low-Sum Card Game</span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <button
            onClick={handleToggleSound}
            title={soundEnabled ? 'Mute Sound Effects' : 'Unmute Sound Effects'}
            aria-label={soundEnabled ? 'Mute Sound Effects' : 'Unmute Sound Effects'}
            className="p-1.5 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 shrink-0"
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4" />
            ) : (
              <VolumeX className="w-4 h-4 text-stone-400" />
            )}
          </button>

          <button
            onClick={() => setShowRulesModal(true)}
            className="px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 flex items-center gap-1 sm:gap-1.5 shrink-0"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">How to Play</span>
            <span className="sm:hidden">Rules</span>
          </button>

          {/* User Profile & Settings Button */}
          <button
            onClick={() => {
              setNameInput(user.name);
              setProfileSavedMessage(null);
              setDeleteAccountError(null);
              setConfirmDeleteAccountModal(false);
              setShowProfileModal(true);
            }}
            title={`Profile & Settings (${user.name})`}
            aria-label="Profile & Settings"
            className="flex items-center gap-1 sm:gap-2 bg-stone-100 hover:bg-stone-200/70 border border-stone-200 px-2 sm:px-3 py-1.5 rounded-lg text-xs transition-colors shrink-0"
          >
            <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-stone-900 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
              {user.name.slice(0, 2).toUpperCase()}
            </div>
            <span className="hidden sm:inline font-semibold text-stone-900 max-w-[140px] truncate">
              {user.name}
            </span>
            <Settings className="w-3.5 h-3.5 text-stone-500 shrink-0" />
          </button>

          <button
            onClick={handleLogout}
            title="Log Out"
            aria-label="Log Out"
            className="px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 flex items-center gap-1 shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Log Out</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
        {dashboardError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs font-medium flex items-center justify-between">
            <span>{dashboardError}</span>
            <button onClick={() => setDashboardError(null)} className="font-bold underline ml-4">
              Dismiss
            </button>
          </div>
        )}

        {/* 5-Minute Rejoin Active Match Banner (Bot is playing while away) */}
        {rejoinInfo && rejoinSecondsLeft > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 shadow-xs">
            <div className="space-y-1">
              <div className="text-sm font-bold text-stone-900 flex flex-wrap items-center gap-2">
                <span>Active Match in Progress — Room {rejoinInfo.code}</span>
                <span className="text-xs font-mono bg-white border border-amber-300 px-2 py-0.5 rounded text-amber-800">
                  Rejoin window: {Math.floor(rejoinSecondsLeft / 60)}m {rejoinSecondsLeft % 60}s
                </span>
              </div>
              <p className="text-xs text-stone-600">
                Smart Bot is temporarily playing your turns using optimal card logic. Rejoin now to take back control of your hand!
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <button
                onClick={handleRejoinActiveMatch}
                disabled={loadingAction}
                className="w-full sm:w-auto justify-center bg-stone-900 hover:bg-stone-800 text-white px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Rejoin Game Now
              </button>
            </div>
          </div>
        )}

        {/* Primary Grid: Play with Friends (Create or Join by Code) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col justify-between space-y-5">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-900">
                <Users className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-stone-900">Create Private Table</h2>
              <p className="text-xs text-stone-500 leading-relaxed">
                Start a room for 2 to 8 players. Get a 5-character share code, configure elimination score, invite friends, or mix in AI bots. As host, you can kick any player.
              </p>
            </div>

            <button
              onClick={handleCreatePrivateLobby}
              disabled={loadingAction}
              className="w-full bg-stone-900 hover:bg-stone-800 text-white font-semibold py-2 sm:py-3 px-4 rounded-lg sm:rounded-xl text-xs sm:text-sm flex items-center justify-center gap-1.5 sm:gap-2 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              Create Room & Get Code
            </button>
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col justify-between space-y-5">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-900 font-mono font-bold text-sm">
                #
              </div>
              <h2 className="text-lg font-bold text-stone-900">Join Room with Code</h2>
              <p className="text-xs text-stone-500 leading-relaxed">
                Have a 5-character room code from a friend (or rejoining an active room)? Enter it below to join immediately.
              </p>
            </div>

            <form onSubmit={handleJoinLobbyByCode} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                maxLength={5}
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                placeholder="E.G. 77T68"
                className="flex-1 min-w-0 font-mono font-bold tracking-widest uppercase text-center text-sm sm:text-base border border-stone-300 rounded-lg sm:rounded-xl px-3 py-2 sm:py-2.5 focus:outline-none focus:border-stone-900 bg-[#FAF9F5]"
              />
              <button
                type="submit"
                disabled={loadingAction}
                className="bg-stone-900 hover:bg-stone-800 text-white font-semibold px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors shrink-0"
              >
                Join
                <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </form>
          </div>
        </div>

        {/* Play with Smart AI Bots Section */}
        <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-stone-700" />
              <h3 className="text-base font-bold text-stone-900">Instant Practice vs AI Bots</h3>
            </div>
            <p className="text-xs text-stone-500">
              Jump straight into a 5-card match against computer opponents to practice combinations and declarations.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] font-semibold text-stone-700">Card Deal Level:</span>
              <div className="inline-flex items-center rounded-lg bg-stone-100 border border-stone-200 p-0.5 gap-0.5">
                {(['easy', 'medium', 'hard'] as const).map((level) => {
                  const active = aiDeckDifficulty === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => handleUpdateDefaultDifficulty(level)}
                      title={DECK_DIFFICULTY_PROFILES[level].description}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                        active
                          ? 'bg-stone-900 text-white shadow-2xs'
                          : 'text-stone-600 hover:bg-white hover:text-stone-900'
                      }`}
                    >
                      {DECK_DIFFICULTY_PROFILES[level].label}
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] text-stone-500">
                {aiDeckDifficulty === 'medium'
                  ? 'Medium (Default)'
                  : DECK_DIFFICULTY_PROFILES[aiDeckDifficulty].label}
              </span>
            </div>
          </div>

          <div className="w-full sm:w-auto grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleCreateAIGame(1, 0)}
              disabled={loadingAction}
              className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 transition-colors flex items-center justify-center"
            >
              1v1 Easy AI
            </button>
            <button
              onClick={() => handleCreateAIGame(1, 2)}
              disabled={loadingAction}
              className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold bg-stone-900 hover:bg-stone-800 text-white transition-colors flex items-center justify-center"
            >
              4-Player AI Table
            </button>
          </div>
        </div>

        {/* Full 52-Card Preview Row & Rules Summary */}
        <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-stone-900">
            Standard Deck Preview & Valid Card Combinations
          </h3>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-2">
            {(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const).map(
              (r, i) => (
                <PlayingCard
                  key={r}
                  card={{
                    id: `prev-${r}`,
                    rank: r,
                    suit: (['clubs', 'spades', 'diamonds', 'hearts'] as const)[i % 4],
                  }}
                  size="md"
                  className="shrink-0"
                />
              )
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-stone-600">
            <div className="bg-[#FAF9F5] border border-stone-200 rounded-xl p-3.5 space-y-1">
              <div className="font-bold text-stone-900">1. Card Values</div>
              <p>
                <strong>Ace</strong> = 1 pt · <strong>2–10</strong> = Face value ·{' '}
                <strong>J, Q, K</strong> = 10 pts each. Each player starts with 5 cards.
              </p>
            </div>
            <div className="bg-[#FAF9F5] border border-stone-200 rounded-xl p-3.5 space-y-1">
              <div className="font-bold text-stone-900">2. Valid Drops (1 to 5 Cards)</div>
              <p>
                Drop <strong>1 Card</strong>, a <strong>Pair</strong> (2 same rank; if you have 3 same, select 2), a{' '}
                <strong>3-Card Sequence</strong>, <strong>4 of a Kind</strong> (4 same rank), or <strong>5 Cards</strong> (5-Card Sequence or 5-Card Same-Suit Flush).
              </p>
            </div>
            <div className="bg-[#FAF9F5] border border-stone-200 rounded-xl p-3.5 space-y-1">
              <div className="font-bold text-stone-900">3. Declare, Timer & Rejoin</div>
              <p>
                Declare with the lowest or tied-lowest sum for <strong>0★ pts</strong> (same-sum players get <strong>+0</strong>; undercut only if strictly beaten = <strong>20 + diff</strong>). Deck defaults to <strong>Medium</strong> (Host can choose Easy / Medium / Hard). Missing 3 turn timers auto-kicks; stepping away gives <strong>5 mins</strong> to rejoin while Bot plays.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* User Profile & Settings Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-white border border-stone-300 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-xl space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-stone-200 pb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-full bg-stone-900 text-white flex items-center justify-center text-sm font-bold shrink-0">
                  {user.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-base font-bold text-stone-900 truncate">{user.name}</h3>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        user.isGuest
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {user.isGuest ? 'Guest Mode' : 'Registered'}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 truncate mt-0.5">{user.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="text-xs text-stone-500 hover:text-stone-900 font-semibold shrink-0"
              >
                Close
              </button>
            </div>

            {/* Display Name Form */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await handleUpdateUserName(nameInput);
                setProfileSavedMessage('Display name updated');
              }}
              className="space-y-2"
            >
              <label className="block text-xs font-semibold text-stone-800">
                Display Name
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  required
                  maxLength={24}
                  value={nameInput}
                  onChange={(e) => {
                    setNameInput(e.target.value);
                    setProfileSavedMessage(null);
                  }}
                  placeholder="Your table display name"
                  className="flex-1 min-w-0 px-3 py-2 text-sm border border-stone-300 rounded-xl focus:outline-none focus:border-stone-900"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-stone-900 hover:bg-stone-800 text-white shrink-0"
                >
                  Save
                </button>
              </div>
              {profileSavedMessage ? (
                <p className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {profileSavedMessage}
                </p>
              ) : (
                <p className="text-[11px] text-stone-500">
                  First two letters appear as your table avatar badge.
                </p>
              )}
            </form>

            {/* User Preferences & Settings */}
            <div className="space-y-3 bg-[#FAF9F5] border border-stone-200 rounded-xl p-3.5">
              <div className="text-xs font-bold text-stone-900">Preferences &amp; Game Defaults</div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-stone-800">Sound Effects</div>
                  <div className="text-[11px] text-stone-500">
                    Card deals, turns &amp; declare alerts
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleSound}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 shrink-0 ${
                    soundEnabled
                      ? 'bg-stone-900 text-white border-stone-900'
                      : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-100'
                  }`}
                >
                  {soundEnabled ? (
                    <>
                      <Volume2 className="w-3.5 h-3.5" />
                      On
                    </>
                  ) : (
                    <>
                      <VolumeX className="w-3.5 h-3.5" />
                      Off
                    </>
                  )}
                </button>
              </div>

              <div className="pt-2 border-t border-stone-200/80 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-stone-800">
                      Default Card Deal Level
                    </div>
                    <div className="text-[11px] text-stone-500">
                      Used for new lobbies &amp; AI practice
                    </div>
                  </div>
                  <div className="inline-flex items-center rounded-lg bg-white border border-stone-200 p-0.5 gap-0.5">
                    {(['easy', 'medium', 'hard'] as const).map((level) => {
                      const active = aiDeckDifficulty === level;
                      return (
                        <button
                          key={level}
                          type="button"
                          onClick={() => handleUpdateDefaultDifficulty(level)}
                          className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                            active
                              ? 'bg-stone-900 text-white'
                              : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                          }`}
                        >
                          {DECK_DIFFICULTY_PROFILES[level].label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-stone-500 pt-1 border-t border-stone-200/80">
                Your account and settings are kept permanently, while temporary game rooms and expired tokens auto-clean after 24 hours.
              </p>
            </div>

            {/* Danger Zone: Account Deletion */}
            <div className="bg-red-50/70 border border-red-200 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-red-700">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Danger Zone</span>
              </div>
              <p className="text-[11px] text-red-700/90 leading-relaxed">
                {user.isGuest
                  ? 'Clear your guest session, local profile, and temporary guest preferences from this browser and server.'
                  : 'Permanently delete your account, login credentials, sessions, and saved preferences from the Cloudflare D1 database. This cannot be undone.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setDeleteAccountError(null);
                  setConfirmDeleteAccountModal(true);
                }}
                className="w-full sm:w-auto px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-red-300 text-red-700 hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {user.isGuest ? 'Delete Guest Profile' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {confirmDeleteAccountModal && (
        <div className="fixed inset-0 bg-stone-900/60 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white border border-red-200 rounded-2xl max-w-sm w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-red-600">
              <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <h3 className="text-base font-bold text-stone-900">
                {user.isGuest ? 'Delete Guest Profile?' : 'Permanently Delete Account?'}
              </h3>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed">
              {user.isGuest ? (
                <>
                  This will remove your guest profile (<strong>{user.name}</strong>) and return you to the sign-in screen.
                </>
              ) : (
                <>
                  Are you sure you want to permanently delete <strong>{user.name}</strong> (
                  <span className="font-mono">{user.email}</span>)? This immediately removes your
                  records from the <strong>users</strong>, <strong>accounts</strong>,{' '}
                  <strong>sessions</strong>, and <strong>preferences</strong> tables in the database and cannot be reversed.
                </>
              )}
            </p>

            {deleteAccountError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{deleteAccountError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={deletingAccount}
                onClick={() => {
                  setConfirmDeleteAccountModal(false);
                  setDeleteAccountError(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingAccount}
                onClick={handleDeleteAccount}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deletingAccount
                  ? 'Deleting...'
                  : user.isGuest
                  ? 'Yes, Delete Guest'
                  : 'Yes, Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rules Modal */}
      {showRulesModal && (
        <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-stone-300 rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div className="flex items-center gap-2">
                <LowScoreLogo className="w-5 h-5 shrink-0" />
                <h3 className="text-base font-bold text-stone-900">How to Play LowScore</h3>
              </div>
              <button
                onClick={() => setShowRulesModal(false)}
                className="text-xs text-stone-500 hover:text-stone-900 font-semibold"
              >
                Close
              </button>
            </div>
            <div className="space-y-3 text-xs text-stone-600 leading-relaxed">
              <p>
                <strong>Goal:</strong> Keep your total score below the Elimination Threshold (default{' '}
                <strong>100 points</strong>). Eliminated players stay in Spectator Mode to watch the rest of the match!
              </p>
              <p>
                <strong>On Your Turn:</strong> Click cards in your hand to drop (they lift up) AND click either the <strong>Draw Deck</strong> or an <strong>Open Card</strong> (it lifts up) to pick, then click <strong>Make Move</strong>. Or click <strong>Declare</strong> at the start of your turn.
              </p>
              <p>
                <strong>Valid Drops (1 to 5 Cards):</strong>
                <br />• <strong>1 Card:</strong> Any single card.
                <br />• <strong>2 Cards (Pair):</strong> 2 cards of the same rank (if you hold 3 of the same rank, select 2 to drop).
                <br />• <strong>3 Cards (Sequence only):</strong> 3 consecutive ranks (e.g., A-2-3, 5-6-7, or Q-K-A).
                <br />• <strong>4 Cards (Four of a Kind):</strong> All 4 cards of the same rank.
                <br />• <strong>5 Cards:</strong> A 5-card sequence OR a 5-card Flush (all 5 same suit).
              </p>
              <p>
                <strong>Declare &amp; Ties:</strong> Declaring with the lowest or tied-lowest sum scores <strong>0★ pts</strong> for the declarer, while any tying opponent receives <strong>+0 pts</strong>. You suffer an undercut (<strong>20 + diff</strong>) only if an opponent holds a strictly lower sum.
              </p>
              <p>
                <strong>Card Deal Levels (Host):</strong> Matches default to <strong>Medium</strong> so deck draws aren&apos;t overly favorable. Hosts can switch between <strong>Easy</strong>, <strong>Medium</strong>, and <strong>Hard</strong> in the Lobby.
              </p>
              <p>
                <strong>Turn Timer &amp; Rejoin:</strong> If your turn timer runs out, the bot logic auto-drops for you. After 3 consecutive auto-drops, you are auto-kicked. If you click <strong>Back</strong> to step away, you have <strong>5 minutes</strong> to rejoin while the bot plays your turns.
              </p>
            </div>
            <div className="pt-2 text-right">
              <button
                onClick={() => setShowRulesModal(false)}
                className="bg-stone-900 text-white px-4 py-2 rounded-xl text-xs font-semibold"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table Launch / Join Loading Overlay */}
      {loadingAction && (
        <div className="fixed inset-0 bg-stone-900/45 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF9F5] border border-stone-200 rounded-2xl px-8 py-6 shadow-2xl">
            <FireSuitLoader
              label="Setting Up Table..."
              sublabel="Syncing cards & players in Cloudflare D1"
            />
          </div>
        </div>
      )}
    </div>
  );
}
