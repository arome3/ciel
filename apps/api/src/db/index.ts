import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import * as schema from "./schema"
import { config } from "../config"
import { mkdirSync, existsSync } from "fs"
import { dirname } from "path"

// Ensure the data directory exists
const dbDir = dirname(config.DATABASE_PATH)
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true })
}

// Open SQLite database with bun:sqlite (NOT better-sqlite3)
const sqlite = new Database(config.DATABASE_PATH)

// Enable WAL mode for concurrent read performance during SSE streaming
sqlite.exec("PRAGMA journal_mode = WAL")

// Enable foreign key enforcement
sqlite.exec("PRAGMA foreign_keys = ON")

// Ensure intentLogs table exists (no formal migration — table was added mid-sprint)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS intentLogs (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    matched_template_id INTEGER,
    matched_confidence REAL,
    keyword_score REAL,
    embedding_score REAL,
    user_accepted INTEGER,
    override_template_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

// Create indexes
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_workflow_category ON workflows(category);
  CREATE INDEX IF NOT EXISTS idx_workflow_published ON workflows(published);
  CREATE INDEX IF NOT EXISTS idx_execution_workflow ON executions(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_execution_created ON executions(created_at);
  CREATE INDEX IF NOT EXISTS idx_pipeline_owner ON pipelines(owner_address);
  CREATE INDEX IF NOT EXISTS idx_pipeline_active ON pipelines(is_active);
  CREATE INDEX IF NOT EXISTS idx_pipeline_exec_pipeline ON pipeline_executions(pipeline_id);
  CREATE INDEX IF NOT EXISTS idx_pipeline_exec_created ON pipeline_executions(created_at);
  CREATE INDEX IF NOT EXISTS idx_intent_log_template ON intentLogs(matched_template_id);
`)

// Export the Drizzle ORM instance with full schema for relational queries
export const db = drizzle(sqlite, { schema })

// Export raw sqlite for edge cases (e.g., custom pragmas, raw queries)
export { sqlite }
