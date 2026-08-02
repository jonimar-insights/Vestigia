CREATE TABLE IF NOT EXISTS "saved_share_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_share_emails_user_email_unique" ON "saved_share_emails" ("user_id", "email");
