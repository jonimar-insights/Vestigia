ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gmail_access_token" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gmail_refresh_token" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gmail_token_expires_at" text;
