import fs from 'fs';
import path from 'path';
import { RoomState } from './gameEngine';
import { ensureD1Schema, getCloudflareRuntime } from './cloudflareDb';

export interface StoredPlayerPreference {
  userId: string;
  name?: string;
  soundEnabled: boolean;
  updatedAt: number;
}

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

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

async function getReadyD1(): Promise<D1Database | null> {
  const { d1 } = await getCloudflareRuntime();
  if (!d1) return null;
  await ensureD1Schema(d1);
  return d1;
}

/**
 * Fetch a single game room by 5-char code from Cloudflare D1 (or local fallback if D1 unbound).
 */
export async function getRoom(code: string): Promise<RoomState | null> {
  const normalized = code.trim().toUpperCase();
  const d1 = await getReadyD1();
  if (d1) {
    const row = await d1
      .prepare('SELECT state_json, expires_at FROM game_rooms WHERE code = ? LIMIT 1')
      .bind(normalized)
      .first<{ state_json: string; expires_at: number }>();

    if (!row) return null;
    if (row.expires_at && row.expires_at < Date.now()) {
      await d1.prepare('DELETE FROM game_rooms WHERE code = ?').bind(normalized).run();
      return null;
    }
    try {
      return JSON.parse(row.state_json) as RoomState;
    } catch {
      return null;
    }
  }

  const map = loadFallbackRoomsMap();
  return map.get(normalized) ?? null;
}

export async function roomExists(code: string): Promise<boolean> {
  const normalized = code.trim().toUpperCase();
  const d1 = await getReadyD1();
  if (d1) {
    const row = await d1
      .prepare('SELECT 1 AS found FROM game_rooms WHERE code = ? AND expires_at >= ? LIMIT 1')
      .bind(normalized, Date.now())
      .first<{ found: number }>();
    return Boolean(row);
  }
  return loadFallbackRoomsMap().has(normalized);
}

/**
 * Persist room state to Cloudflare D1 `game_rooms` (UPSERT).
 */
export async function saveRoom(room: RoomState, options?: { pruneExpired?: boolean }): Promise<void> {
  const normalized = room.code.trim().toUpperCase();
  const updatedAt = room.updatedAt || Date.now();
  const expiresAt = updatedAt + ROOM_TTL_MS;

  const d1 = await getReadyD1();
  if (d1) {
    const payload = JSON.stringify(room);
    await d1
      .prepare(
        `INSERT INTO game_rooms (code, state_json, status, host_id, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET
           state_json = excluded.state_json,
           status = excluded.status,
           host_id = excluded.host_id,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`
      )
      .bind(normalized, payload, room.status, room.hostId, updatedAt, expiresAt)
      .run();

    if (options?.pruneExpired) {
      await d1.prepare('DELETE FROM game_rooms WHERE expires_at < ?').bind(Date.now()).run();
    }
    return;
  }

  const map = loadFallbackRoomsMap();
  map.set(normalized, room);
  saveFallbackRoomsMap(map);
}

/**
 * Remove a closed/empty game room from Cloudflare D1 (or local fallback).
 */
export async function deleteRoom(code: string): Promise<void> {
  const normalized = code.trim().toUpperCase();
  const d1 = await getReadyD1();
  if (d1) {
    await d1.prepare('DELETE FROM game_rooms WHERE code = ?').bind(normalized).run();
    return;
  }

  const map = loadFallbackRoomsMap();
  map.delete(normalized);
  saveFallbackRoomsMap(map);
}

/**
 * Read saved display name and sound preference for either a Better Auth user or guest ID from D1.
 */
export async function getPlayerPreference(userId: string): Promise<StoredPlayerPreference | null> {
  const cleanId = userId.trim();
  if (!cleanId) return null;

  const d1 = await getReadyD1();
  if (d1) {
    const pref = await d1
      .prepare(
        'SELECT user_id, display_name, sound_enabled, updated_at FROM player_preferences WHERE user_id = ? LIMIT 1'
      )
      .bind(cleanId)
      .first<{
        user_id: string;
        display_name: string | null;
        sound_enabled: number;
        updated_at: number;
      }>();

    if (pref) {
      return {
        userId: pref.user_id,
        name: pref.display_name ?? undefined,
        soundEnabled: Number(pref.sound_enabled) !== 0,
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
        updatedAt: Date.now(),
      };
    }
    return null;
  }

  return globalStore.__lowscore_prefs!.get(cleanId) ?? null;
}

/**
 * Save soundEnabled and/or displayName in D1 (`player_preferences` + `"user"` table when registered).
 */
export async function savePlayerPreference(
  userId: string,
  updates: { name?: string; soundEnabled?: boolean }
): Promise<StoredPlayerPreference> {
  const cleanId = userId.trim();
  const now = Date.now();
  const existing = await getPlayerPreference(cleanId);
  const nextName = updates.name !== undefined ? updates.name : existing?.name;
  const nextSound =
    updates.soundEnabled !== undefined ? updates.soundEnabled : (existing?.soundEnabled ?? true);

  const d1 = await getReadyD1();
  if (d1) {
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO player_preferences (user_id, display_name, sound_enabled, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             display_name = COALESCE(excluded.display_name, player_preferences.display_name),
             sound_enabled = excluded.sound_enabled,
             updated_at = excluded.updated_at`
        )
        .bind(cleanId, nextName ?? null, nextSound ? 1 : 0, now),
      d1
        .prepare(
          `UPDATE "user"
           SET name = COALESCE(?, name),
               soundEnabled = ?,
               updatedAt = ?
           WHERE id = ?`
        )
        .bind(updates.name ?? null, nextSound ? 1 : 0, new Date(now).toISOString(), cleanId),
    ]);
  }

  const saved: StoredPlayerPreference = {
    userId: cleanId,
    name: nextName,
    soundEnabled: nextSound,
    updatedAt: now,
  };
  globalStore.__lowscore_prefs!.set(cleanId, saved);
  return saved;
}
