import fs from 'fs';
import path from 'path';
import { DeckDifficulty, RoomState, normalizeDeckDifficulty } from './gameEngine';
import {
  cleanupNonEssentialDatabaseData,
  ensureD1Schema,
  getCloudflareRuntime,
  maybeAutoCleanupDatabase,
} from './cloudflareDb';
import { NON_ESSENTIAL_RETENTION_MS } from './dbCleanup';

export interface StoredPlayerPreference {
  userId: string;
  name?: string;
  soundEnabled: boolean;
  defaultDeckDifficulty: DeckDifficulty;
  updatedAt: number;
}

const ROOM_TTL_MS = NON_ESSENTIAL_RETENTION_MS;

const globalStore = globalThis as unknown as {
  __lowscore_rooms?: Map<string, RoomState>;
  __lowscore_prefs?: Map<string, StoredPlayerPreference>;
};

if (!globalStore.__lowscore_rooms) {
  globalStore.__lowscore_rooms = new Map<string, RoomState>();
}
if (!globalStore.__lowscore_prefs) {
  globalStore.__lowscore_prefs = new Map<string, StoredPlayerPreference>();
}

const TMP_ROOMS_FILE = path.join('/tmp', 'lowscore_rooms_fallback.json');

function pruneFallbackRoomsMap(map: Map<string, RoomState>, nowMs = Date.now()): boolean {
  const cutoff = nowMs - ROOM_TTL_MS;
  let removed = false;
  for (const [code, r] of map.entries()) {
    const createdAt = r.createdAt || r.updatedAt || nowMs;
    if (createdAt <= cutoff) {
      map.delete(code);
      removed = true;
    }
  }
  return removed;
}

function loadFallbackRoomsMap(): Map<string, RoomState> {
  try {
    if (fs.existsSync(TMP_ROOMS_FILE)) {
      const raw = fs.readFileSync(TMP_ROOMS_FILE, 'utf-8');
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, RoomState>;
        for (const [k, v] of Object.entries(parsed)) {
          const existing = globalStore.__lowscore_rooms!.get(k);
          if (!existing || v.updatedAt >= existing.updatedAt) {
            globalStore.__lowscore_rooms!.set(k, v);
          }
        }
      }
    }
  } catch {
    // Fallback storage unreachable on read-only worker FS; use global Map
  }
  if (pruneFallbackRoomsMap(globalStore.__lowscore_rooms!)) {
    saveFallbackRoomsMap(globalStore.__lowscore_rooms!);
  }
  return globalStore.__lowscore_rooms!;
}

function saveFallbackRoomsMap(map: Map<string, RoomState>): void {
  globalStore.__lowscore_rooms = map;
  try {
    const obj: Record<string, RoomState> = {};
    map.forEach((v, k) => {
      obj[k] = v;
    });
    fs.writeFileSync(TMP_ROOMS_FILE, JSON.stringify(obj), 'utf-8');
  } catch {
    // Ignore on Cloudflare Workers read-only FS
  }
}

async function getReadyD1(): Promise<{
  d1: D1Database | null;
  waitUntil?: (promise: Promise<unknown>) => void;
}> {
  const { d1, waitUntil } = await getCloudflareRuntime();
  if (!d1) return { d1: null, waitUntil };
  await ensureD1Schema(d1);
  maybeAutoCleanupDatabase(d1, waitUntil);
  return { d1, waitUntil };
}

/**
 * Fetch a single game room by 5-char code from Cloudflare D1 (or local fallback if D1 unbound).
 * Enforces 24-hour auto-expiration from initial room creation.
 */
export async function getRoom(code: string): Promise<RoomState | null> {
  const normalized = code.trim().toUpperCase();
  const { d1 } = await getReadyD1();
  if (d1) {
    const row = await d1
      .prepare('SELECT state_json, created_at, updated_at, expires_at FROM game_rooms WHERE code = ? LIMIT 1')
      .bind(normalized)
      .first<{ state_json: string; created_at: number; updated_at: number; expires_at: number }>();

    if (!row) return null;
    const now = Date.now();
    const createdAt = row.created_at > 0 ? row.created_at : row.updated_at;
    if ((createdAt && createdAt + ROOM_TTL_MS <= now) || (row.expires_at && row.expires_at <= now)) {
      await d1.prepare('DELETE FROM game_rooms WHERE code = ?').bind(normalized).run();
      return null;
    }
    try {
      const parsed = JSON.parse(row.state_json) as RoomState;
      if (!parsed.createdAt && createdAt) {
        parsed.createdAt = createdAt;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  const map = loadFallbackRoomsMap();
  return map.get(normalized) ?? null;
}

export async function roomExists(code: string): Promise<boolean> {
  const normalized = code.trim().toUpperCase();
  const { d1 } = await getReadyD1();
  if (d1) {
    const now = Date.now();
    const cutoff = now - ROOM_TTL_MS;
    const row = await d1
      .prepare(
        `SELECT 1 AS found FROM game_rooms
         WHERE code = ?
           AND expires_at > ?
           AND ((created_at > 0 AND created_at > ?) OR (created_at = 0 AND updated_at > ?))
         LIMIT 1`
      )
      .bind(normalized, now, cutoff, cutoff)
      .first<{ found: number }>();
    return Boolean(row);
  }
  return loadFallbackRoomsMap().has(normalized);
}

/**
 * Persist room state to Cloudflare D1 `game_rooms` (UPSERT), preserving original `created_at`
 * so every room automatically expires 24 hours after it was created.
 */
export async function saveRoom(room: RoomState, options?: { pruneExpired?: boolean }): Promise<void> {
  const normalized = room.code.trim().toUpperCase();
  const now = Date.now();
  const updatedAt = room.updatedAt || now;
  const createdAt = room.createdAt || updatedAt;
  const expiresAt = createdAt + ROOM_TTL_MS;
  const roomToStore: RoomState = room.createdAt ? room : { ...room, createdAt };

  const { d1 } = await getReadyD1();
  if (d1) {
    const payload = JSON.stringify(roomToStore);
    await d1
      .prepare(
        `INSERT INTO game_rooms (code, state_json, status, host_id, created_at, updated_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(code) DO UPDATE SET
           state_json = excluded.state_json,
           status = excluded.status,
           host_id = excluded.host_id,
           created_at = CASE WHEN game_rooms.created_at > 0 THEN game_rooms.created_at ELSE excluded.created_at END,
           updated_at = excluded.updated_at,
           expires_at = CASE
             WHEN game_rooms.created_at > 0 THEN game_rooms.created_at + ?8
             ELSE excluded.expires_at
           END`
      )
      .bind(normalized, payload, room.status, room.hostId, createdAt, updatedAt, expiresAt, ROOM_TTL_MS)
      .run();

    if (options?.pruneExpired) {
      await cleanupNonEssentialDatabaseData(d1, now);
    }
    return;
  }

  const map = loadFallbackRoomsMap();
  map.set(normalized, roomToStore);
  if (options?.pruneExpired) {
    pruneFallbackRoomsMap(map, now);
  }
  saveFallbackRoomsMap(map);
}

/**
 * Remove a closed/empty game room from Cloudflare D1 (or local fallback).
 */
export async function deleteRoom(code: string): Promise<void> {
  const normalized = code.trim().toUpperCase();
  const { d1 } = await getReadyD1();
  if (d1) {
    await d1.prepare('DELETE FROM game_rooms WHERE code = ?').bind(normalized).run();
    return;
  }

  const map = loadFallbackRoomsMap();
  map.delete(normalized);
  saveFallbackRoomsMap(map);
}

/**
 * Read saved display name, sound preference, and default card deal level for either a Better Auth
 * user or guest ID from D1.
 */
export async function getPlayerPreference(userId: string): Promise<StoredPlayerPreference | null> {
  const cleanId = userId.trim();
  if (!cleanId) return null;

  const { d1 } = await getReadyD1();
  if (d1) {
    const pref = await d1
      .prepare(
        'SELECT user_id, display_name, sound_enabled, default_deck_difficulty, updated_at FROM player_preferences WHERE user_id = ? LIMIT 1'
      )
      .bind(cleanId)
      .first<{
        user_id: string;
        display_name: string | null;
        sound_enabled: number;
        default_deck_difficulty: string | null;
        updated_at: number;
      }>();

    if (pref) {
      return {
        userId: pref.user_id,
        name: pref.display_name ?? undefined,
        soundEnabled: Number(pref.sound_enabled) !== 0,
        defaultDeckDifficulty: normalizeDeckDifficulty(pref.default_deck_difficulty),
        updatedAt: pref.updated_at,
      };
    }

    const userRow = await d1
      .prepare('SELECT id, name, soundEnabled FROM "user" WHERE id = ? LIMIT 1')
      .bind(cleanId)
      .first<{ id: string; name: string; soundEnabled: number | null }>();

    if (userRow) {
      return {
        userId: userRow.id,
        name: userRow.name,
        soundEnabled: userRow.soundEnabled === null ? true : Number(userRow.soundEnabled) !== 0,
        defaultDeckDifficulty: 'medium',
        updatedAt: Date.now(),
      };
    }
    return null;
  }

  return globalStore.__lowscore_prefs!.get(cleanId) ?? null;
}

/**
 * Save soundEnabled, displayName, and/or defaultDeckDifficulty in D1
 * (`player_preferences` + `"user"` table when registered).
 */
export async function savePlayerPreference(
  userId: string,
  updates: { name?: string; soundEnabled?: boolean; defaultDeckDifficulty?: DeckDifficulty }
): Promise<StoredPlayerPreference> {
  const cleanId = userId.trim();
  const now = Date.now();
  const existing = await getPlayerPreference(cleanId);
  const nextName = updates.name !== undefined ? updates.name : existing?.name;
  const nextSound =
    updates.soundEnabled !== undefined ? updates.soundEnabled : (existing?.soundEnabled ?? true);
  const nextDifficulty =
    updates.defaultDeckDifficulty !== undefined
      ? normalizeDeckDifficulty(updates.defaultDeckDifficulty)
      : normalizeDeckDifficulty(existing?.defaultDeckDifficulty);

  const { d1 } = await getReadyD1();
  if (d1) {
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO player_preferences (user_id, display_name, sound_enabled, default_deck_difficulty, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(user_id) DO UPDATE SET
             display_name = COALESCE(excluded.display_name, player_preferences.display_name),
             sound_enabled = excluded.sound_enabled,
             default_deck_difficulty = excluded.default_deck_difficulty,
             updated_at = excluded.updated_at`
        )
        .bind(cleanId, nextName ?? null, nextSound ? 1 : 0, nextDifficulty, now),
      d1
        .prepare(
          `UPDATE "user"
           SET name = COALESCE(?1, name),
               soundEnabled = ?2,
               updatedAt = ?3
           WHERE id = ?4`
        )
        .bind(updates.name ?? null, nextSound ? 1 : 0, new Date(now).toISOString(), cleanId),
    ]);
  }

  const saved: StoredPlayerPreference = {
    userId: cleanId,
    name: nextName,
    soundEnabled: nextSound,
    defaultDeckDifficulty: nextDifficulty,
    updatedAt: now,
  };
  globalStore.__lowscore_prefs!.set(cleanId, saved);
  return saved;
}

/**
 * Check whether a user ID belongs to a registered Better Auth user in D1.
 */
export async function isRegisteredUserInStore(userId: string): Promise<boolean> {
  const cleanId = userId.trim();
  if (!cleanId) return false;
  const { d1 } = await getReadyD1();
  if (d1) {
    const row = await d1
      .prepare('SELECT 1 AS found FROM "user" WHERE id = ? LIMIT 1')
      .bind(cleanId)
      .first<{ found: number }>();
    return Boolean(row);
  }
  return false;
}

/**
 * Permanently delete a registered Better Auth user across `user`, `account`, `session`,
 * `verification`, and `player_preferences` in Cloudflare D1.
 */
export async function deleteRegisteredUserAccountFromStore(
  userId: string,
  email?: string
): Promise<{ deletedFromD1: boolean }> {
  const cleanId = userId.trim();
  globalStore.__lowscore_prefs!.delete(cleanId);

  const { d1 } = await getReadyD1();
  if (!d1 || !cleanId) {
    return { deletedFromD1: false };
  }

  const statements: D1PreparedStatement[] = [
    d1.prepare('DELETE FROM "player_preferences" WHERE "user_id" = ?').bind(cleanId),
    d1.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(cleanId),
    d1.prepare('DELETE FROM "account" WHERE "userId" = ?').bind(cleanId),
  ];
  if (email && email.trim()) {
    statements.push(
      d1.prepare('DELETE FROM "verification" WHERE lower("identifier") = lower(?)').bind(email.trim())
    );
  }
  statements.push(d1.prepare('DELETE FROM "user" WHERE "id" = ?').bind(cleanId));

  await d1.batch(statements);
  return { deletedFromD1: true };
}

/**
 * Remove temporary guest preference rows (`guest_%`) from D1/memory fallback without ever
 * touching registered users.
 */
export async function deleteGuestPreferencesFromStore(guestId: string): Promise<void> {
  const cleanId = guestId.trim();
  if (!cleanId.startsWith('guest_')) return;
  globalStore.__lowscore_prefs!.delete(cleanId);

  const { d1 } = await getReadyD1();
  if (d1) {
    await d1
      .prepare(
        `DELETE FROM "player_preferences"
         WHERE "user_id" = ?
           AND "user_id" NOT IN (SELECT "id" FROM "user")`
      )
      .bind(cleanId)
      .run();
  }
}
