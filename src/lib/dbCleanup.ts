export const NON_ESSENTIAL_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
export const AUTO_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes per isolate

const globalForDbCleanup = globalThis as unknown as {
  __lowscore_schema_v2_ready?: Promise<void>;
  __lowscore_last_cleanup_at?: number;
  __lowscore_cleanup_inflight?: Promise<DatabaseCleanupResult> | null;
};

export interface DatabaseCleanupResult {
  ok: true;
  cleanedAt: number;
  cutoffMs: number;
  retentionHours: number;
  deleted: {
    gameRooms: number;
    verifications: number;
    expiredSessions: number;
    guestPreferences: number;
  };
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
    "created_at" INTEGER NOT NULL DEFAULT 0,
    "updated_at" INTEGER NOT NULL,
    "expires_at" INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "game_rooms_created_idx" ON "game_rooms" ("created_at")`,
  `CREATE INDEX IF NOT EXISTS "game_rooms_updated_idx" ON "game_rooms" ("updated_at")`,
  `CREATE INDEX IF NOT EXISTS "game_rooms_expires_idx" ON "game_rooms" ("expires_at")`,
  `CREATE TABLE IF NOT EXISTS "player_preferences" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "display_name" TEXT,
    "sound_enabled" INTEGER NOT NULL DEFAULT 1,
    "default_deck_difficulty" TEXT NOT NULL DEFAULT 'medium',
    "updated_at" INTEGER NOT NULL
  )`,
];

async function tableHasColumn(
  d1: D1Database,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const info = await d1.prepare(`PRAGMA table_info("${tableName}")`).all<{ name: string }>();
  return Boolean(info.results?.some((col) => col.name === columnName));
}

/**
 * Ensures required D1 tables and columns exist once per isolate (zero overhead on subsequent requests).
 */
export async function ensureD1Schema(d1: D1Database): Promise<void> {
  if (!globalForDbCleanup.__lowscore_schema_v2_ready) {
    globalForDbCleanup.__lowscore_schema_v2_ready = (async () => {
      try {
        const check = await d1
          .prepare(
            `SELECT count(*) AS cnt FROM sqlite_master WHERE type = 'table' AND name IN ('user', 'session', 'game_rooms', 'player_preferences')`
          )
          .first<{ cnt: number }>();

        if (!check || Number(check.cnt) < 4) {
          await d1.batch(SCHEMA_STATEMENTS.map((sql) => d1.prepare(sql)));
        }

        // Idempotent upgrades for D1 databases provisioned before migration 0002
        const [hasRoomCreatedAt, hasPrefDifficulty] = await Promise.all([
          tableHasColumn(d1, 'game_rooms', 'created_at'),
          tableHasColumn(d1, 'player_preferences', 'default_deck_difficulty'),
        ]);

        const upgradeStatements: D1PreparedStatement[] = [];
        if (!hasRoomCreatedAt) {
          upgradeStatements.push(
            d1.prepare(`ALTER TABLE "game_rooms" ADD COLUMN "created_at" INTEGER NOT NULL DEFAULT 0`),
            d1.prepare(`UPDATE "game_rooms" SET "created_at" = "updated_at" WHERE "created_at" = 0`),
            d1.prepare(`CREATE INDEX IF NOT EXISTS "game_rooms_created_idx" ON "game_rooms" ("created_at")`)
          );
        }
        if (!hasPrefDifficulty) {
          upgradeStatements.push(
            d1.prepare(
              `ALTER TABLE "player_preferences" ADD COLUMN "default_deck_difficulty" TEXT NOT NULL DEFAULT 'medium'`
            )
          );
        }
        if (upgradeStatements.length > 0) {
          await d1.batch(upgradeStatements);
        }
      } catch (err) {
        globalForDbCleanup.__lowscore_schema_v2_ready = undefined;
        throw err;
      }
    })();
  }
  return globalForDbCleanup.__lowscore_schema_v2_ready;
}

/**
 * Cleans up non-essential temporary database records older than 24 hours (`game_rooms`,
 * `verification` tokens, expired/orphaned `session` rows, and stale guest-only preferences),
 * while strictly preserving essential user records (`"user"`, `"account"`, valid sessions,
 * and registered users' `"player_preferences"`).
 */
export async function cleanupNonEssentialDatabaseData(
  d1: D1Database,
  nowMs = Date.now()
): Promise<DatabaseCleanupResult> {
  await ensureD1Schema(d1);
  const cutoffMs = nowMs - NON_ESSENTIAL_RETENTION_MS;

  const results = await d1.batch([
    d1
      .prepare(
        `DELETE FROM "game_rooms"
         WHERE ("created_at" > 0 AND "created_at" <= ?1)
            OR ("created_at" = 0 AND "updated_at" <= ?1)
            OR "expires_at" <= ?2`
      )
      .bind(cutoffMs, nowMs),
    d1
      .prepare(
        `DELETE FROM "verification"
         WHERE (
           CASE
             WHEN typeof("createdAt") IN ('integer', 'real') THEN CAST("createdAt" AS REAL)
             ELSE CAST(strftime('%s', "createdAt") AS REAL) * 1000.0
           END
         ) <= ?1
         OR (
           CASE
             WHEN typeof("expiresAt") IN ('integer', 'real') THEN CAST("expiresAt" AS REAL)
             ELSE CAST(strftime('%s', "expiresAt") AS REAL) * 1000.0
           END
         ) <= ?2`
      )
      .bind(cutoffMs, nowMs),
    d1
      .prepare(
        `DELETE FROM "session"
         WHERE (
           CASE
             WHEN typeof("expiresAt") IN ('integer', 'real') THEN CAST("expiresAt" AS REAL)
             ELSE CAST(strftime('%s', "expiresAt") AS REAL) * 1000.0
           END
         ) <= ?1
         OR "userId" NOT IN (SELECT "id" FROM "user")`
      )
      .bind(nowMs),
    d1
      .prepare(
        `DELETE FROM "player_preferences"
         WHERE "updated_at" <= ?1
           AND "user_id" NOT IN (SELECT "id" FROM "user")`
      )
      .bind(cutoffMs),
  ]);

  globalForDbCleanup.__lowscore_last_cleanup_at = nowMs;

  return {
    ok: true,
    cleanedAt: nowMs,
    cutoffMs,
    retentionHours: 24,
    deleted: {
      gameRooms: Number(results[0]?.meta?.changes ?? 0),
      verifications: Number(results[1]?.meta?.changes ?? 0),
      expiredSessions: Number(results[2]?.meta?.changes ?? 0),
      guestPreferences: Number(results[3]?.meta?.changes ?? 0),
    },
  };
}

/**
 * Throttled opportunistic cleanup triggered automatically on live traffic at most once every 15 minutes
 * per isolate. Uses `waitUntil` inside Cloudflare Workers so response latency is unaffected.
 */
export function maybeAutoCleanupDatabase(
  d1: D1Database,
  waitUntil?: (promise: Promise<unknown>) => void
): void {
  const now = Date.now();
  const lastRun = globalForDbCleanup.__lowscore_last_cleanup_at ?? 0;
  if (now - lastRun < AUTO_CLEANUP_INTERVAL_MS || globalForDbCleanup.__lowscore_cleanup_inflight) {
    return;
  }

  globalForDbCleanup.__lowscore_last_cleanup_at = now;
  const task = cleanupNonEssentialDatabaseData(d1, now)
    .catch(() => {
      globalForDbCleanup.__lowscore_last_cleanup_at = lastRun;
      return {
        ok: true as const,
        cleanedAt: now,
        cutoffMs: now - NON_ESSENTIAL_RETENTION_MS,
        retentionHours: 24,
        deleted: { gameRooms: 0, verifications: 0, expiredSessions: 0, guestPreferences: 0 },
      };
    })
    .finally(() => {
      globalForDbCleanup.__lowscore_cleanup_inflight = null;
    });

  globalForDbCleanup.__lowscore_cleanup_inflight = task;
  if (waitUntil) {
    try {
      waitUntil(task);
      return;
    } catch {
      // Fall through if waitUntil is unavailable outside a Worker request context
    }
  }
  void task;
}

export function getLastDatabaseCleanupTimestamp(): number | null {
  return globalForDbCleanup.__lowscore_last_cleanup_at ?? null;
}
