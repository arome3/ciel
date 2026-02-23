// agent/src/index.ts — Ciel Demo Agent: full platform integration
// Discover → Simulate → Evaluate → Execute (single) or Compose → Pipeline (multi)

import dotenv from "dotenv"
import { privateKeyToAccount } from "viem/accounts"
import type { Network } from "@x402/fetch"
import type { AgentConfig } from "./types"
import * as log from "./logger"
import { discoverWorkflows } from "./discovery"
import { rankWorkflows } from "./evaluator"
import { simulateWorkflow } from "./simulator"
import { createPaymentFetch, executeWorkflow } from "./executor"
import { goalNeedsPipeline, composePipeline, createPipeline, executePipeline } from "./pipelines"
import { SSEListener, createEventLogger } from "./events"

dotenv.config({ path: "../.env" })

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

function loadConfig(): AgentConfig {
  const privateKey = process.env.AGENT_PRIVATE_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey?.startsWith("0x")) {
    throw new Error("AGENT_PRIVATE_KEY or PRIVATE_KEY must be set (hex with 0x prefix)")
  }

  return {
    privateKey: privateKey as `0x${string}`,
    rpcUrl: process.env.RPC_URL ?? "https://sepolia.base.org",
    cielApiUrl: process.env.CIEL_API_URL ?? "http://localhost:3001",
    facilitatorUrl: process.env.FACILITATOR_URL ?? "https://x402.org/facilitator",
    bazaarUrl: process.env.BAZAAR_URL ?? "http://localhost:3001",
    category: process.env.AGENT_CATEGORY ?? process.argv[2] ?? "oracle",
    goal: process.env.AGENT_GOAL ?? process.argv[3] ?? "Get the current price of ETH in USD",
  }
}

// ─────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────

async function displayExecutionResult(result: Awaited<ReturnType<typeof executeWorkflow>>): Promise<void> {
  if (!result.success) {
    log.error("Workflow execution failed")
    await log.detail("The agent could not complete the task")
    return
  }

  await log.step("Result")
  if (result.answer) await log.detail(`Answer: ${result.answer}`)
  if (result.confidence != null) await log.detail(`Confidence: ${(result.confidence * 100).toFixed(1)}%`)
  if (result.modelsAgreed != null) await log.detail(`Models agreed: ${result.modelsAgreed}`)
  if (result.consensusReached != null) await log.detail(`Consensus: ${result.consensusReached ? "yes" : "no"}`)

  if (result.txHash) {
    log.separator()
    await log.step("Onchain proof")
    await log.detail(`Tx: ${result.txHash}`)
    if (result.blockNumber) await log.detail(`Block: ${result.blockNumber}`)
    if (result.explorerUrl) await log.detail(`Explorer: ${result.explorerUrl}`)
  }
}

async function displayPipelineResult(result: NonNullable<Awaited<ReturnType<typeof executePipeline>>>): Promise<void> {
  await log.step("Pipeline result")
  await log.detail(`Status: ${result.status}`)
  await log.detail(`Duration: ${result.duration}ms`)
  await log.detail(`Steps: ${result.stepResults.length}`)

  for (const step of result.stepResults) {
    const icon = step.success ? "✓" : "✗"
    const dur = step.duration ? ` (${step.duration}ms)` : ""
    await log.detail(`  ${icon} ${step.workflowId.slice(0, 8)}...${dur}${step.error ? ` — ${step.error}` : ""}`, 200)
  }

  if (result.finalOutput) {
    log.separator()
    await log.step("Final output")
    for (const [key, val] of Object.entries(result.finalOutput)) {
      const display = typeof val === "string" ? val : JSON.stringify(val)
      await log.detail(`${key}: ${display.slice(0, 120)}`, 200)
    }
  }
}

// ─────────────────────────────────────────────
// Single workflow path
// ─────────────────────────────────────────────

async function runSingleWorkflow(config: AgentConfig, account: ReturnType<typeof privateKeyToAccount>): Promise<void> {
  // 1. Discover
  const workflows = await discoverWorkflows(config, config.category)

  if (workflows.length === 0) {
    log.separator()
    log.error("No workflows found — is the Ciel API running?")
    await log.detail("Start with: cd apps/api && bun dev")
    process.exit(1)
  }

  log.separator()

  // 2. Evaluate & rank
  const ranked = await rankWorkflows(workflows)
  const best = ranked[0]

  if (!best || best.fitness.recommendation === "skip") {
    log.separator()
    log.error("No suitable workflows found (all scored below threshold)")
    process.exit(1)
  }

  log.separator()

  // 3. Display selection
  await log.step("Selected workflow")
  await log.detail(`Name: ${best.workflow.name}`)
  await log.detail(`Category: ${best.workflow.category}`)
  await log.detail(`Score: ${best.fitness.total}/100 (${best.fitness.recommendation})`)
  await log.detail(
    `Breakdown: schema=${best.fitness.breakdown.schemaMatch} output=${best.fitness.breakdown.outputUsefulness} price=${best.fitness.breakdown.priceScore} reliability=${best.fitness.breakdown.reliabilityScore}`,
  )
  await log.detail(`Price: $${(best.workflow.priceUsdc / 1_000_000).toFixed(4)} USDC`)
  await log.detail(`Endpoint: ${best.workflow.x402Endpoint}`)

  log.separator()

  // 4. Pre-execution simulation
  const simResult = await simulateWorkflow(config.cielApiUrl, best.workflow.workflowId)

  if (simResult && !simResult.success) {
    log.warn("Simulation failed — proceeding with caution")
  }

  log.separator()

  // 5. Execute with x402 payment
  const network: Network = "eip155:84532"
  const paymentFetch = createPaymentFetch(account, network, config.rpcUrl)

  const result = await executeWorkflow(best.workflow, config.goal, paymentFetch)

  log.separator()
  await displayExecutionResult(result)
}

// ─────────────────────────────────────────────
// Pipeline path
// ─────────────────────────────────────────────

async function runPipeline(config: AgentConfig, account: ReturnType<typeof privateKeyToAccount>): Promise<void> {
  // 1. Broad discovery — fetch multiple categories
  await log.step("Pipeline mode — discovering workflows across categories...")
  const workflows = await discoverWorkflows(config, config.category)

  if (workflows.length === 0) {
    log.separator()
    log.error("No workflows found — is the Ciel API running?")
    await log.detail("Start with: cd apps/api && bun dev")
    process.exit(1)
  }

  log.separator()

  // 2. Auto-compose pipeline from goal
  const proposal = await composePipeline(config.goal, workflows)

  if (!proposal) {
    log.warn("Pipeline composition failed — falling back to single workflow")
    log.separator()
    await runSingleWorkflow(config, account)
    return
  }

  log.separator()

  // 3. Simulate each step's workflow before committing
  let allSimsPass = true
  for (const step of proposal.steps) {
    const sim = await simulateWorkflow(config.cielApiUrl, step.workflowId)
    if (sim && !sim.success) allSimsPass = false
  }

  if (!allSimsPass) {
    log.warn("Some simulations failed — proceeding with pipeline anyway")
  }

  log.separator()

  // 4. Create pipeline on API
  const pipelineId = await createPipeline(config, proposal, account.address)

  if (!pipelineId) {
    log.error("Could not create pipeline — falling back to single workflow")
    log.separator()
    await runSingleWorkflow(config, account)
    return
  }

  log.separator()

  // 5. Execute pipeline with EIP-191 auth
  const result = await executePipeline(config, pipelineId, config.privateKey)

  if (!result) {
    log.error("Pipeline execution returned no result")
    return
  }

  log.separator()
  await displayPipelineResult(result)
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

async function main() {
  log.banner("Ciel Autonomous Agent", "Discover → Evaluate → Pay → Execute")
  log.separator()

  // 1. Load config & create wallet
  let config: AgentConfig
  try {
    config = loadConfig()
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err))
    log.error("Set AGENT_PRIVATE_KEY in .env to run the agent")
    process.exit(1)
  }

  const account = privateKeyToAccount(config.privateKey)

  await log.step("Wallet loaded")
  await log.detail(`Address: ${account.address}`)
  await log.detail(`Chain: Base Sepolia (eip155:84532)`)
  await log.detail(`API: ${config.cielApiUrl}`)
  await log.detail(`Category: ${config.category}`)
  await log.detail(`Goal: "${config.goal}"`)
  log.separator()

  // 2. Connect SSE for real-time events (background, non-blocking)
  const sse = new SSEListener(config.cielApiUrl, createEventLogger())
  sse.connect().catch(() => {})

  // 3. Route: single workflow or pipeline
  try {
    if (goalNeedsPipeline(config.goal)) {
      await log.step("Goal requires multiple capabilities — using pipeline mode")
      log.separator()
      await runPipeline(config, account)
    } else {
      await log.step("Single capability detected — using direct execution")
      log.separator()
      await runSingleWorkflow(config, account)
    }
  } finally {
    // 4. Disconnect SSE
    sse.disconnect()
  }

  log.separator()
  log.done("Agent run complete")
  console.log()
}

main().catch((err) => {
  log.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
