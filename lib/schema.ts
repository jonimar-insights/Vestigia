import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  role: text("role").notNull().default("member"), // admin | member
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const videos = sqliteTable("videos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  youtubeUrl: text("youtube_url").notNull(),
  youtubeId: text("youtube_id").notNull().unique(),
  title: text("title"),
  thumbnailUrl: text("thumbnail_url"),
  durationSeconds: integer("duration_seconds"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  createdBy: text("created_by").notNull().default("anonymous"),
});

export const transcripts = sqliteTable("transcripts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  videoId: integer("video_id")
    .notNull()
    .references(() => videos.id, { onDelete: "cascade" }),
  segments: text("segments").notNull(), // JSON array of {start, duration, text}
  language: text("language").notNull().default("en"),
  source: text("source").notNull().default("auto-caption"), // auto-caption | whisper
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const annotations = sqliteTable("annotations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  videoId: integer("video_id")
    .notNull()
    .references(() => videos.id, { onDelete: "cascade" }),
  timestampStart: real("timestamp_start").notNull(),
  timestampEnd: real("timestamp_end").notNull(),
  label: text("label").notNull(),
  tags: text("tags"), // JSON array of strings
  note: text("note"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  createdBy: text("created_by").notNull().default("anonymous"),
});

export const scenes = sqliteTable("scenes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  videoId: integer("video_id")
    .notNull()
    .references(() => videos.id, { onDelete: "cascade" }),
  timestamp: real("timestamp").notNull(),
  thumbnailPath: text("thumbnail_path"),
  aiDescription: text("ai_description"),
  aiTags: text("ai_tags"), // JSON array of strings
  aiConfidence: real("ai_confidence"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const cliplists = sqliteTable("cliplists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  createdBy: text("created_by").notNull().default("anonymous"),
});

export const clipItems = sqliteTable("clip_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cliplistId: integer("cliplist_id")
    .notNull()
    .references(() => cliplists.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // annotation | scene | key_moment
  videoId: integer("video_id").notNull(),
  timestamp: real("timestamp").notNull(),
  endTimestamp: real("end_timestamp"),
  title: text("title").notNull(),
  detail: text("detail"),
  tags: text("tags"), // JSON array of strings
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const keyMoments = sqliteTable("key_moments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  videoId: integer("video_id")
    .notNull()
    .references(() => videos.id, { onDelete: "cascade" }),
  timestamp: real("timestamp").notNull(),
  endTimestamp: real("end_timestamp"),
  title: text("title").notNull(),
  description: text("description"),
  source: text("source").notNull(), // chapter | storyboard | transcript
  thumbnailUrl: text("thumbnail_url"),
  confidence: real("confidence").notNull().default(0.5),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
