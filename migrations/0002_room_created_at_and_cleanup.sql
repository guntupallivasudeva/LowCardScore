-- Track room creation timestamp for strict 24-hour auto-cleanup
-- and store user's preferred card deal difficulty level.

ALTER TABLE "game_rooms" ADD COLUMN "created_at" INTEGER NOT NULL DEFAULT 0;
UPDATE "game_rooms" SET "created_at" = "updated_at" WHERE "created_at" = 0;
CREATE INDEX IF NOT EXISTS "game_rooms_created_idx" ON "game_rooms" ("created_at");

ALTER TABLE "player_preferences" ADD COLUMN "default_deck_difficulty" TEXT NOT NULL DEFAULT 'medium';
