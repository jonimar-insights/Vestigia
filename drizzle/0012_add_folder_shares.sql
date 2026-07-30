CREATE TABLE IF NOT EXISTS "folder_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"folder_id" integer NOT NULL,
	"email" text NOT NULL,
	"permission" text NOT NULL DEFAULT 'view',
	"created_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;