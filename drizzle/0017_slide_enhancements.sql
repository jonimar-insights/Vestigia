-- Slide enhancements: theme color, image, and explicit hold mode.
ALTER TABLE "clip_items" ADD COLUMN IF NOT EXISTS "color" VARCHAR(32);
ALTER TABLE "clip_items" ADD COLUMN IF NOT EXISTS "image_url" TEXT;
-- Legacy slides were inserted with NULL end_timestamp (the POST handler ignored
-- the requested duration) and the player rendered them as 5s. Backfill so that
-- NULL can mean explicit "hold until keypress" going forward.
UPDATE "clip_items" SET "end_timestamp" = 5 WHERE "type" = 'slide' AND "end_timestamp" IS NULL;
