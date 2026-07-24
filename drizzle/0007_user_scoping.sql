ALTER TABLE "videos" ADD COLUMN "user_id" text;
ALTER TABLE "annotations" ADD COLUMN "user_id" text;
ALTER TABLE "cliplists" ADD COLUMN "user_id" text;
ALTER TABLE "folders" ADD COLUMN "user_id" text;