-- LowScore D1 Initial Migration (Better Auth + Game Rooms + Player Preferences)
-- Compatible with Cloudflare D1 (Free Tier SQLite)

CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "soundEnabled" INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" DATE NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
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
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" DATE NOT NULL,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE IF NOT EXISTS "game_rooms" (
  "code" TEXT NOT NULL PRIMARY KEY,
  "state_json" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "host_id" TEXT NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "expires_at" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "game_rooms_updated_idx" ON "game_rooms" ("updated_at");
CREATE INDEX IF NOT EXISTS "game_rooms_expires_idx" ON "game_rooms" ("expires_at");

CREATE TABLE IF NOT EXISTS "player_preferences" (
  "user_id" TEXT NOT NULL PRIMARY KEY,
  "display_name" TEXT,
  "sound_enabled" INTEGER NOT NULL DEFAULT 1,
  "updated_at" INTEGER NOT NULL
);
