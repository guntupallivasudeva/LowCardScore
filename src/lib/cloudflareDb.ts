import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextResponse } from 'next/server';

const globalForDb = globalThis as unknown as {
  __lowscore_schema_ready?: Promise<void>;
};

export interface CloudflareRuntime {
  d1: D1Database | null;
  env: Partial<CloudflareEnv> & Record<string, unknown>;
}

/**
 * Resolve Cloudflare Workers bindings (`env.DB`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`)
 * from OpenNext context (works in Cloudflare production, Wrangler preview, and `next dev`
 * via `initOpenNextCloudflareForDev()`).
 */
export async function getCloudflareRuntime(): Promise<CloudflareRuntime> {
  try {
    const ctx = await getCloudflareContext({ async: true });
    const env = (ctx?.env ?? {}) as Partial<CloudflareEnv> & Record<string, unknown>;
    return {
      d1: env.DB ?? null,
      env,
    };
  } catch {
    return {
      d1: null,
      env: {},
    };
  }
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "emailVerified" INTEGER NOT NULL,
    "image" TEXT,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL,
    "soundEnabled" INTEGER DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATE NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATE,
    "refreshTokenExpiresAt" DATE,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATE NOT NULL,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId")`,
  `CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId")`,
  `CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier")`,
  `CREATE TABLE IF NOT EXISTS "game_rooms" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "state_json" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "updated_at" INTEGER NOT NULL,
    "expires_at" INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "game_rooms_updated_idx" ON "game_rooms" ("updated_at")`,
  `CREATE INDEX IF NOT EXISTS "game_rooms_expires_idx" ON "game_rooms" ("expires_at")`,
  `CREATE TABLE IF NOT EXISTS "player_preferences" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "display_name" TEXT,
    "sound_enabled" INTEGER NOT NULL DEFAULT 1,
    "updated_at" INTEGER NOT NULL
  )`,
];

/**
 * Ensures required D1 tables exist once per isolate (zero overhead on subsequent requests).
 */
export async function ensureD1Schema(d1: D1Database): Promise<void> {
  if (!globalForDb.__lowscore_schema_ready) {
    globalForDb.__lowscore_schema_ready = (async () => {
      try {
        const check = await d1
          .prepare(
            `SELECT count(*) AS cnt FROM sqlite_master WHERE type = 'table' AND name IN ('user', 'session', 'game_rooms', 'player_preferences')`
          )
          .first<{ cnt: number }>();

        if (check && Number(check.cnt) >= 4) {
          return;
        }
        await d1.batch(SCHEMA_STATEMENTS.map((sql) => d1.prepare(sql)));
      } catch (err) {
        // Clear cached promise so transient initialization failures can retry cleanly
        globalForDb.__lowscore_schema_ready = undefined;
        throw err;
      }
    })();
  }
  return globalForDb.__lowscore_schema_ready;
}

export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
} as const;

/**
 * Wraps `NextResponse.json` with strict anti-cache headers so Cloudflare edge and browsers
 * never serve stale room states or auth responses.
 */
export function noStoreJson<T>(data: T, init?: ResponseInit): NextResponse<T> {
  const headers = new Headers(init?.headers);
  Object.entries(NO_STORE_HEADERS).forEach(([k, v]) => headers.set(k, v));
  return NextResponse.json(data, {
    ...init,
    headers,
  });
}
