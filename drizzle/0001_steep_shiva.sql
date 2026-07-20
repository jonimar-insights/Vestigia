CREATE TABLE `scenes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` integer NOT NULL,
	`timestamp` real NOT NULL,
	`thumbnail_path` text,
	`ai_description` text,
	`ai_tags` text,
	`ai_confidence` real,
	`created_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
