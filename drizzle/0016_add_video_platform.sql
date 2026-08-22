-- Add platform column for social media video posts.
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT 'youtube';
