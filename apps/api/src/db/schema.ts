import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
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

  // Timestamps (ISO 8601 strings)
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
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
// Type exports for use across the app
// ─────────────────────────────────────────────
export type Workflow = typeof workflows.$inferSelect
export type NewWorkflow = typeof workflows.$inferInsert
export type Execution = typeof executions.$inferSelect
export type NewExecution = typeof executions.$inferInsert
export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type Pipeline = typeof pipelines.$inferSelect
export type NewPipeline = typeof pipelines.$inferInsert
export type PipelineExecution = typeof pipelineExecutions.$inferSelect
export type NewPipelineExecution = typeof pipelineExecutions.$inferInsert
