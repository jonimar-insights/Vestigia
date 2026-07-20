CREATE TABLE `clip_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliplist_id` integer NOT NULL,
	`type` text NOT NULL,
	`video_id` integer NOT NULL,
	`timestamp` real NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`tags` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`cliplist_id`) REFERENCES `cliplists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cliplists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text DEFAULT 'anonymous' NOT NULL
);
