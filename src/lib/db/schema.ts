import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // usr_<id>
  name: text("name").notNull().default("Demo User"),
  email: text("email"),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const videos = sqliteTable("videos", {
  id: text("id").primaryKey(), // vid_<id>
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  durationMs: integer("duration_ms"),
  status: text("status", { enum: ["uploading", "processing", "ready", "failed"] }).notNull().default("uploading"),
  b2Key: text("b2_key").notNull(), // uploads/<id>/source.mp4
  hlsUrl: text("hls_url"),
  posterUrl: text("poster_url"),
  thumbnailUrl: text("thumbnail_url"),
  userId: text("user_id").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const segments = sqliteTable("segments", {
  id: text("id").primaryKey(), // seg_<id>
  videoId: text("video_id").notNull().references(() => videos.id),
  index: integer("index").notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  transcript: text("transcript").notNull().default(""),
  topic: text("topic"),
  keyframeUrl: text("keyframe_url"),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const brands = sqliteTable("brands", {
  id: text("id").primaryKey(), // brd_<id>
  name: text("name").notNull(),
  category: text("category").notNull(),
  logoUrl: text("logo_url"),
  packshotUrl: text("packshot_url"),
  colorHex: text("color_hex").notNull().default("#f15a22"),
  allowedSurfaces: text("allowed_surfaces").notNull().default("[]"),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const adSlots = sqliteTable("ad_slots", {
  id: text("id").primaryKey(), // slot_<id>
  videoId: text("video_id").notNull().references(() => videos.id),
  segmentId: text("segment_id").references(() => segments.id),
  layer: integer("layer").notNull().default(3),
  timestampMs: integer("timestamp_ms").notNull(),
  status: text("status", {
    enum: ["pending", "filled", "approved", "rejected", "failed"],
  }).notNull().default("pending"),
  surfaceLabel: text("surface_label"),
  bbox: text("bbox"), // JSON: [x1,y1,x2,y2] in 0..1000
  brandId: text("brand_id").references(() => brands.id),
  beforeFrameUrl: text("before_frame_url"),
  afterFrameUrl: text("after_frame_url"),
  rejectReason: text("reject_reason"),
  manifestEntry: text("manifest_entry"),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const segmentEmbeddings = sqliteTable("segment_embeddings", {
  segmentId: text("segment_id").primaryKey().references(() => segments.id),
  model: text("model").notNull(), // e.g. "mistral-embed"
  dim: integer("dim").notNull(),
  vector: text("vector").notNull(), // JSON number[] (L2-normalized)
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const naturalBreaks = sqliteTable("natural_breaks", {
  id: text("id").primaryKey(), // brk_<id>
  videoId: text("video_id").notNull().references(() => videos.id),
  timestampMs: integer("timestamp_ms").notNull(),
  score: integer("score").notNull().default(0),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});
