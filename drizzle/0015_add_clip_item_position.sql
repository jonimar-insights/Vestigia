-- Add position column for manual ordering of cliplist items.
ALTER TABLE "clip_items" ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill: preserve the previously displayed order (createdAt DESC),
-- so the newest item keeps position 0 and playback order is unchanged.
UPDATE "clip_items" ci
SET "position" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY cliplist_id ORDER BY created_at DESC) - 1 AS rn
  FROM "clip_items"
) sub
WHERE sub.id = ci.id;
