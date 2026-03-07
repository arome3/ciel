import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

// ─────────────────────────────────────────────
// Workflows Table
// ─────────────────────────────────────────────
export const workflows = sqliteTable("workflows", {
  // Identity
  id: text("id").primaryKey(),                              // UUID v4
  name: text("name").notNull(),
  description: text("description").notNull(),
  prompt: text("prompt").notNull(),                         // Original user prompt

  // Template reference
  templateId: integer("template_id").notNull(),             // 1-10
  templateName: text("template_name").notNull(),

  // Generated artifacts
  code: text("code").notNull(),                             // workflow.ts content
  config: text("config").notNull(),                         // config.json as stringified JSON
  consumerSol: text("consumer_sol"),                        // Optional generated Solidity

  // Simulation results
  simulationSuccess: integer("simulation_success", { mode: "boolean" }).default(false),
  simulationTrace: text("simulation_trace"),                // JSON string of SimulationStep[]
  simulationDuration: integer("simulation_duration"),       // Milliseconds

  // Publishing
  published: integer("published", { mode: "boolean" }).default(false),
  onchainWorkflowId: text("onchain_workflow_id"),           // bytes32 from registry
  publishTxHash: text("publish_tx_hash"),
  donWorkflowId: text("don_workflow_id"),                   // CRE DON workflow ID (set async after deploy)
  deployStatus: text("deploy_status").default("none"),      // "none" | "pending" | "deployed" | "failed"
  ownerAddress: text("owner_address").notNull(),   // Wallet address of workflow creator
  inputSchema: text("input_schema", { mode: "json" }),   // JSON Schema for workflow inputs
  outputSchema: text("output_schema", { mode: "json" }),  // JSON Schema for workflow outputs
  x402Endpoint: text("x402_endpoint"),

  // Marketplace metadata
  priceUsdc: integer("price_usdc").default(10000),          // 6 decimals — 10000 = $0.01
  category: text("category").notNull(),                     // "core-defi" | "institutional" | "risk-compliance" | "ai-powered"
  capabilities: text("capabilities").notNull(),             // JSON array, e.g. '["price-feed","evmWrite"]'
  chains: text("chains").notNull(),                         // JSON array, e.g. '["base-sepolia"]'

  // Stats
  totalExecutions: integer("total_executions").default(0),
  successfulExecutions: integer("successful_executions").default(0),

  // Revision tracking
  currentRevision: integer("current_revision").default(1),

  // Timestamps (ISO 8601 strings)
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
})

// ─────────────────────────────────────────────
// Workflow Revisions Table
// ─────────────────────────────────────────────
export const workflowRevisions = sqliteTable("workflow_revisions", {
  id: text("id").primaryKey(),                              // UUID v4
  workflowId: text("workflow_id").notNull().references(() => workflows.id),
  revisionNumber: integer("revision_number").notNull(),     // 1-based
  prompt: text("prompt").notNull(),                         // Refinement prompt (or original for rev 1)
  code: text("code").notNull(),                             // Code snapshot at this revision
  config: text("config").notNull(),                         // Config snapshot (stringified JSON)
  explanation: text("explanation").notNull(),
  consumerSol: text("consumer_sol"),
  parentRevisionId: text("parent_revision_id"),             // FK to self, null for rev 1
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
})

// ─────────────────────────────────────────────
// Executions Table
// ─────────────────────────────────────────────
export const executions = sqliteTable("executions", {
  id: text("id").primaryKey(),                              // UUID v4
  workflowId: text("workflow_id").notNull().references(() => workflows.id),

  // Payment info
  agentAddress: text("agent_address"),                      // 0x address of paying agent
  paymentTxHash: text("payment_tx_hash"),
  amountUsdc: integer("amount_usdc"),                       // 6 decimals

  // Result
  success: integer("success", { mode: "boolean" }).notNull(),
  result: text("result"),                                   // JSON string
  error: text("error"),
  duration: integer("duration"),                            // Milliseconds

  // Timestamp
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
})

// ─────────────────────────────────────────────
// Events Table (SSE activity feed)
// ─────────────────────────────────────────────
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),                             // "execution" | "publish" | "discovery"
  data: text("data").notNull(),                             // JSON payload
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
})

// ─────────────────────────────────────────────
// Pipelines Table
// ─────────────────────────────────────────────
export const pipelines = sqliteTable("pipelines", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description").notNull(),
  ownerAddress: text("owner_address").notNull(),
  steps: text("steps").notNull(),                                    // JSON: PipelineStep[]
  totalPrice: text("total_price").notNull().default("0"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  executionCount: integer("execution_count").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
})

// ─────────────────────────────────────────────
// Pipeline Executions Table
// ─────────────────────────────────────────────
export const pipelineExecutions = sqliteTable("pipeline_executions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  pipelineId: text("pipeline_id").notNull().references(() => pipelines.id),
  agentAddress: text("agent_address"),
  totalPaid: text("total_paid"),
  status: text("status").notNull().default("pending"),               // "pending" | "running" | "completed" | "failed" | "partial"
  stepResults: text("step_results"),                                 // JSON
  triggerInput: text("trigger_input"),                               // JSON
  finalOutput: text("final_output"),                                 // JSON
  duration: integer("duration"),                                     // ms
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
})

// ─────────────────────────────────────────────
// Intent Logs Table (training data for future fine-tuning)
// ─────────────────────────────────────────────
export const intentLogs = sqliteTable("intentLogs", {
  id: text("id").primaryKey(),
  prompt: text("prompt").notNull(),
  matchedTemplateId: integer("matched_template_id"),
  matchedConfidence: real("matched_confidence"),
  keywordScore: real("keyword_score"),
  embeddingScore: real("embedding_score"),
  userAccepted: integer("user_accepted"),               // 1 = accepted, 0 = overridden
  overrideTemplateId: integer("override_template_id"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
})

// ─────────────────────────────────────────────
// Template Requests Table
// ─────────────────────────────────────────────
export const templateRequests = sqliteTable("template_requests", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  description: text("description").notNull(),
  category: text("category"),
  triggerType: text("trigger_type"),
  ownerAddress: text("owner_address").notNull(),
  status: text("status").notNull().default("open"),  // "open" | "planned" | "completed"
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
})

// ─────────────────────────────────────────────
// Template Request Votes Table
// ─────────────────────────────────────────────
export const templateRequestVotes = sqliteTable("template_request_votes", {
  requestId: text("request_id").notNull().references(() => templateRequests.id),
  voterAddress: text("voter_address").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
})

// ─────────────────────────────────────────────
// User Settings Table
// ─────────────────────────────────────────────
export const userSettings = sqliteTable("user_settings", {
  ownerAddress: text("owner_address").primaryKey(),
  displayName: text("display_name"),
  defaultChain: text("default_chain").default("base-sepolia"),
  webhookUrl: text("webhook_url"),
  notifyDeployFail: integer("notify_deploy_fail", { mode: "boolean" }).default(true),
  notifyExecFail: integer("notify_exec_fail", { mode: "boolean" }).default(true),
  notifyExecSuccess: integer("notify_exec_success", { mode: "boolean" }).default(false),
  githubInstallationId: integer("github_installation_id"),
  githubUsername: text("github_username"),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
})

// ─────────────────────────────────────────────
// Generation Traces Table (observability for AI pipeline)
// ─────────────────────────────────────────────
export const generationTraces = sqliteTable("generation_traces", {
  id: text("id").primaryKey(),                              // requestId
  workflowId: text("workflow_id"),                          // FK to workflows (nullable — set after generation)
  prompt: text("prompt").notNull(),                         // truncated 200 chars
  promptHash: text("prompt_hash"),                          // system prompt hash (cache analysis)
  templateId: integer("template_id").notNull(),
  templateName: text("template_name").notNull(),
  templateConfidence: real("template_confidence"),
  ownerAddress: text("owner_address").notNull(),
  model: text("model"),                                     // "gpt-5.3-codex"
  totalDurationMs: integer("total_duration_ms").notNull(),
  totalAttempts: integer("total_attempts").notNull(),
  successfulAttempt: integer("successful_attempt"),
  usedFallback: integer("used_fallback", { mode: "boolean" }).notNull(),
  finalOutcome: text("final_outcome").notNull(),
  totalInputTokens: integer("total_input_tokens").default(0),
  totalOutputTokens: integer("total_output_tokens").default(0),
  totalReasoningTokens: integer("total_reasoning_tokens").default(0),
  totalCachedTokens: integer("total_cached_tokens").default(0),
  estimatedCostUsd: real("estimated_cost_usd").default(0),
  traceJson: text("trace_json").notNull(),                  // full GenerationTrace
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
})

// ─────────────────────────────────────────────
// Tenderly VNet State (singleton row, survives restarts)
// ─────────────────────────────────────────────
export const tenderlyState = sqliteTable("tenderly_state", {
  id: integer("id").primaryKey().default(1),                 // Always 1 — singleton
  stateJson: text("state_json").notNull(),                   // Serialized ManagerState
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
})

// ─────────────────────────────────────────────
// Type exports for use across the app
// ─────────────────────────────────────────────
export type Workflow = typeof workflows.$inferSelect
export type NewWorkflow = typeof workflows.$inferInsert
export type WorkflowRevision = typeof workflowRevisions.$inferSelect
export type NewWorkflowRevision = typeof workflowRevisions.$inferInsert
export type Execution = typeof executions.$inferSelect
export type NewExecution = typeof executions.$inferInsert
export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type Pipeline = typeof pipelines.$inferSelect
export type NewPipeline = typeof pipelines.$inferInsert
export type PipelineExecution = typeof pipelineExecutions.$inferSelect
export type NewPipelineExecution = typeof pipelineExecutions.$inferInsert
export type IntentLog = typeof intentLogs.$inferSelect
export type NewIntentLog = typeof intentLogs.$inferInsert
export type TemplateRequest = typeof templateRequests.$inferSelect
export type NewTemplateRequest = typeof templateRequests.$inferInsert
export type UserSetting = typeof userSettings.$inferSelect
export type NewUserSetting = typeof userSettings.$inferInsert
export type GenerationTraceRow = typeof generationTraces.$inferSelect
export type NewGenerationTraceRow = typeof generationTraces.$inferInsert
