CREATE TABLE `annotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` integer NOT NULL,
	`timestamp_start` real NOT NULL,
	`timestamp_end` real NOT NULL,
	`label` text NOT NULL,
	`tags` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text DEFAULT 'anonymous' NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transcripts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` integer NOT NULL,
	`segments` text NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`source` text DEFAULT 'auto-caption' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`youtube_url` text NOT NULL,
	`youtube_id` text NOT NULL,
	`title` text,
	`thumbnail_url` text,
	`duration_seconds` integer,
	`created_at` text NOT NULL,
	`created_by` text DEFAULT 'anonymous' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `videos_youtube_id_unique` ON `videos` (`youtube_id`);