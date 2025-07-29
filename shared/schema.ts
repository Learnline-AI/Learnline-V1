import { pgTable, text, serial, integer, boolean, timestamp, json, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  type: text("type").notNull(), // 'student' | 'ai'
  content: text("content").notNull(),
  audioUrl: text("audio_url"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  anthropicApiKey: text("anthropic_api_key"),
  googleServiceAccount: text("google_service_account"),
  preferredLanguage: text("preferred_language").default("hindi"),
  speechRate: text("speech_rate").default("0.85"),
  voiceType: text("voice_type").default("hi-IN-Wavenet-A"),
  offlineMode: boolean("offline_mode").default(false),
});

export const learningStats = pgTable("learning_stats", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  questionsAsked: integer("questions_asked").default(0),
  topicsCovered: integer("topics_covered").default(0),
  studyTimeMinutes: integer("study_time_minutes").default(0),
  currentStreak: integer("current_streak").default(0),
});

// RAG-specific tables
export const ragChunks = pgTable("rag_chunks", {
  id: serial("id").primaryKey(),
  chunkId: text("chunk_id").notNull().unique(),
  chapter: text("chapter").notNull(), // e.g., "8" for Chapter 8
  chapterTitle: text("chapter_title").notNull(), // e.g., "Force and Laws of Motion"
  section: text("section").notNull(), // e.g., "8.1", "8.2", "Summary"
  contentType: text("content_type").notNull(), // activity, example, content, special_box
  content: text("content").notNull(),
  preparedText: text("prepared_text").notNull(),
  aiMetadata: json("ai_metadata").notNull(),
  qualityScore: real("quality_score").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ragEmbeddings = pgTable("rag_embeddings", {
  id: serial("id").primaryKey(),
  chunkId: text("chunk_id").notNull(),
  embedding: json("embedding").notNull(), // Array of floats
  dimension: integer("dimension").notNull().default(1536),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ragQueryHistory = pgTable("rag_query_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  query: text("query").notNull(),
  language: text("language").notNull(), // hindi, english, hinglish
  ragEnabled: boolean("rag_enabled").default(false),
  retrievedChunks: json("retrieved_chunks"), // Array of chunk IDs and scores
  responseTime: integer("response_time"), // milliseconds
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertMessageSchema = createInsertSchema(messages).pick({
  userId: true,
  type: true,
  content: true,
  audioUrl: true,
});

export const insertUserSettingsSchema = createInsertSchema(userSettings).pick({
  userId: true,
  anthropicApiKey: true,
  googleServiceAccount: true,
  preferredLanguage: true,
  speechRate: true,
  voiceType: true,
  offlineMode: true,
});

export const insertLearningStatsSchema = createInsertSchema(learningStats).pick({
  userId: true,
  questionsAsked: true,
  topicsCovered: true,
  studyTimeMinutes: true,
  currentStreak: true,
});

export const insertRagChunkSchema = createInsertSchema(ragChunks).pick({
  chunkId: true,
  chapter: true,
  chapterTitle: true,
  section: true,
  contentType: true,
  content: true,
  preparedText: true,
  aiMetadata: true,
  qualityScore: true,
});

export const insertRagEmbeddingSchema = createInsertSchema(ragEmbeddings).pick({
  chunkId: true,
  embedding: true,
  dimension: true,
});

export const insertRagQueryHistorySchema = createInsertSchema(ragQueryHistory).pick({
  userId: true,
  query: true,
  language: true,
  ragEnabled: true,
  retrievedChunks: true,
  responseTime: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type LearningStats = typeof learningStats.$inferSelect;
export type InsertLearningStats = z.infer<typeof insertLearningStatsSchema>;
export type RagChunk = typeof ragChunks.$inferSelect;
export type InsertRagChunk = z.infer<typeof insertRagChunkSchema>;
export type RagEmbedding = typeof ragEmbeddings.$inferSelect;
export type InsertRagEmbedding = z.infer<typeof insertRagEmbeddingSchema>;
export type RagQueryHistory = typeof ragQueryHistory.$inferSelect;
export type InsertRagQueryHistory = z.infer<typeof insertRagQueryHistorySchema>;
