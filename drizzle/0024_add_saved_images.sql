--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_images_user_url_unique" ON "saved_images" ("user_id", "url");