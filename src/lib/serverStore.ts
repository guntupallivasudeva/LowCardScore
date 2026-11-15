import { RoomState } from '@/lib/gameEngine';
import fs from 'fs';
import path from 'path';

// Global in-memory store across warm invocations + /tmp fallback for local/serverless persistence
const globalStore = globalThis as unknown as {
  __leastscore_rooms?: Map<string, RoomState>;
  __leastscore_users?: Map<string, { id: string; email: string; passwordHash: string; name: string; createdAt: number }>;
};

if (!globalStore.__leastscore_rooms) {
  globalStore.__leastscore_rooms = new Map<string, RoomState>();
}
if (!globalStore.__leastscore_users) {
  globalStore.__leastscore_users = new Map();
}

const TMP_ROOMS_FILE = path.join('/tmp', 'leastscore_rooms.json');
const TMP_USERS_FILE = path.join('/tmp', 'leastscore_users.json');

export function loadRoomsMap(): Map<string, RoomState> {
  try {
    if (fs.existsSync(TMP_ROOMS_FILE)) {
      const raw = fs.readFileSync(TMP_ROOMS_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, RoomState>;
      for (const [k, v] of Object.entries(parsed)) {
        const existing = globalStore.__leastscore_rooms!.get(k);
        if (!existing || v.updatedAt >= existing.updatedAt) {
          globalStore.__leastscore_rooms!.set(k, v);
        }
      }
    }
  } catch {
    // ignore file read errors on restricted environments
  }
  return globalStore.__leastscore_rooms!;
}

export function saveRoomsMap(map: Map<string, RoomState>) {
  try {
    const obj: Record<string, RoomState> = {};
    for (const [k, v] of map.entries()) {
      // Prune rooms older than 12 hours
      if (Date.now() - v.updatedAt < 12 * 3600 * 1000) {
        obj[k] = v;
      }
    }
    fs.writeFileSync(TMP_ROOMS_FILE, JSON.stringify(obj), 'utf-8');
  } catch {
    // ignore file write errors
  }
}

export interface StoredUser {
  id: string;
  email: string;
  password: string;
  name: string;
  soundEnabled?: boolean;
  createdAt: number;
}

export function loadUsersMap(): Map<string, StoredUser> {
  try {
    if (fs.existsSync(TMP_USERS_FILE)) {
      const raw = fs.readFileSync(TMP_USERS_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, StoredUser>;
      for (const [k, v] of Object.entries(parsed)) {
        globalStore.__leastscore_users!.set(k, v as unknown as never);
      }
    }
  } catch {
    // ignore
  }
  return globalStore.__leastscore_users as unknown as Map<string, StoredUser>;
}

export function saveUsersMap(map: Map<string, StoredUser>) {
  try {
    const obj: Record<string, StoredUser> = {};
    for (const [k, v] of map.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(TMP_USERS_FILE, JSON.stringify(obj), 'utf-8');
  } catch {
    // ignore
  }
}
