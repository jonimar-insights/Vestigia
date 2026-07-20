CREATE TABLE `key_moments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` integer NOT NULL,
	`timestamp` real NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`source` text NOT NULL,
	`thumbnail_url` text,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
