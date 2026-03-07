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

// Ensure template_requests table exists
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS template_requests (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT,
    trigger_type TEXT,
    owner_address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// Ensure template_request_votes table exists
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS template_request_votes (
    request_id TEXT NOT NULL REFERENCES template_requests(id),
    voter_address TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (request_id, voter_address)
  );
`)

// Ensure workflow_revisions table exists
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS workflow_revisions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id),
    revision_number INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    code TEXT NOT NULL,
    config TEXT NOT NULL,
    explanation TEXT NOT NULL,
    consumer_sol TEXT,
    parent_revision_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// Add current_revision column to workflows (idempotent)
try {
  sqlite.exec(`ALTER TABLE workflows ADD COLUMN current_revision INTEGER DEFAULT 1`)
} catch {
  // Column already exists — expected on subsequent starts
}

// Ensure user_settings table exists
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    owner_address TEXT PRIMARY KEY,
    display_name TEXT,
    default_chain TEXT DEFAULT 'base-sepolia',
    webhook_url TEXT,
    notify_deploy_fail INTEGER DEFAULT 1,
    notify_exec_fail INTEGER DEFAULT 1,
    notify_exec_success INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// Add GitHub integration columns to user_settings (idempotent)
try {
  sqlite.exec(`ALTER TABLE user_settings ADD COLUMN github_installation_id INTEGER`)
} catch {
  // Column already exists
}
try {
  sqlite.exec(`ALTER TABLE user_settings ADD COLUMN github_username TEXT`)
} catch {
  // Column already exists
}

// Ensure generation_traces table exists (observability for AI pipeline)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS generation_traces (
    id TEXT PRIMARY KEY,
    workflow_id TEXT,
    prompt TEXT NOT NULL,
    prompt_hash TEXT,
    template_id INTEGER NOT NULL,
    template_name TEXT NOT NULL,
    template_confidence REAL,
    owner_address TEXT NOT NULL,
    model TEXT,
    total_duration_ms INTEGER NOT NULL,
    total_attempts INTEGER NOT NULL,
    successful_attempt INTEGER,
    used_fallback INTEGER NOT NULL,
    final_outcome TEXT NOT NULL,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_reasoning_tokens INTEGER DEFAULT 0,
    total_cached_tokens INTEGER DEFAULT 0,
    estimated_cost_usd REAL DEFAULT 0,
    trace_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// Ensure tenderly_state table exists (singleton VNet state — survives restarts)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS tenderly_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// Create indexes
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_workflow_category ON workflows(category);
  CREATE INDEX IF NOT EXISTS idx_workflow_published ON workflows(published);
  CREATE INDEX IF NOT EXISTS idx_workflow_owner ON workflows(owner_address);
  CREATE INDEX IF NOT EXISTS idx_execution_workflow ON executions(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_execution_created ON executions(created_at);
  CREATE INDEX IF NOT EXISTS idx_pipeline_owner ON pipelines(owner_address);
  CREATE INDEX IF NOT EXISTS idx_pipeline_active ON pipelines(is_active);
  CREATE INDEX IF NOT EXISTS idx_pipeline_exec_pipeline ON pipeline_executions(pipeline_id);
  CREATE INDEX IF NOT EXISTS idx_pipeline_exec_created ON pipeline_executions(created_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_revision_workflow ON workflow_revisions(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_intent_log_template ON intentLogs(matched_template_id);
  CREATE INDEX IF NOT EXISTS idx_template_request_owner ON template_requests(owner_address);
  CREATE INDEX IF NOT EXISTS idx_template_request_status ON template_requests(status);
  CREATE INDEX IF NOT EXISTS idx_template_request_votes_request ON template_request_votes(request_id);
  CREATE INDEX IF NOT EXISTS idx_gen_trace_template ON generation_traces(template_id);
  CREATE INDEX IF NOT EXISTS idx_gen_trace_outcome ON generation_traces(final_outcome);
  CREATE INDEX IF NOT EXISTS idx_gen_trace_created ON generation_traces(created_at);
`)

// Export the Drizzle ORM instance with full schema for relational queries
export const db = drizzle(sqlite, { schema })

// Export raw sqlite for edge cases (e.g., custom pragmas, raw queries)
export { sqlite }
