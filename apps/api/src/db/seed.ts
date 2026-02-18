import { db } from "./index"
import { workflows, events } from "./schema"
import { randomUUID } from "crypto"

const FLAGSHIP_WORKFLOW_ID = randomUUID()

async function seed() {
  console.log("Seeding database...")

  // ── Flagship workflow: Multi-AI Consensus Oracle (Template 9) ──
  await db.insert(workflows).values({
    id: FLAGSHIP_WORKFLOW_ID,
    name: "AI Consensus Oracle",
    description:
      "Queries GPT-4o, Claude, and Gemini for ETH/USD price, applies BFT consensus with outlier rejection, and writes the verified median price onchain.",
    prompt:
      "Create an oracle that asks 3 AI models for the ETH price, compares their answers, rejects outliers, and publishes the consensus price onchain every 5 minutes",
    ownerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    templateId: 9,
    templateName: "Multi-AI Consensus Oracle",
    code: `// Placeholder — replaced by actual generated code in demo
import { Workflow } from "@chainlink/cre-sdk"
// See 05-ai-engine-code-generation.md and 15-multi-ai-consensus-oracle.md
`,
    config: JSON.stringify({
      schedule: "*/5 * * * *",
      aiModels: ["gpt-4o", "claude-sonnet-4-20250514", "gemini-2.0-flash"],
      maxDeviation: 2,
      chains: ["base-sepolia"],
    }),
    simulationSuccess: true,
    simulationTrace: JSON.stringify([
      { step: "trigger", status: "ok", duration: 0, output: "cron: */5 * * * *" },
      { step: "compute_gpt4o", status: "ok", duration: 820, output: "ETH=$3,412.50" },
      { step: "compute_claude", status: "ok", duration: 650, output: "ETH=$3,415.00" },
      { step: "compute_gemini", status: "ok", duration: 410, output: "ETH=$3,411.80" },
      { step: "consensus", status: "ok", duration: 5, output: "median=$3,412.50, deviation=0.09%" },
      { step: "evmWrite", status: "ok", duration: 1200, output: "tx: 0xabc...def" },
    ]),
    simulationDuration: 3085,
    published: true,
    onchainWorkflowId: "0x" + "a1b2c3d4".repeat(8),
    publishTxHash: "0x" + "dead".repeat(16),
    x402Endpoint: "http://localhost:3001/api/workflows/" + FLAGSHIP_WORKFLOW_ID + "/execute",
    priceUsdc: 10000,
    category: "ai-powered",
    capabilities: JSON.stringify(["price-feed", "multi-ai", "consensus", "evmWrite"]),
    chains: JSON.stringify(["base-sepolia"]),
    totalExecutions: 42,
    successfulExecutions: 40,
  })

  // ── Seed a couple more workflows for marketplace variety ──
  const priceMonitorId = randomUUID()
  await db.insert(workflows).values({
    id: priceMonitorId,
    name: "ETH Price Alert",
    description: "Monitors ETH/USD price every minute and triggers an alert when it drops below $3,000.",
    prompt: "Alert me when ETH drops below $3000",
    ownerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    templateId: 1,
    templateName: "Price Monitoring + Alert",
    code: "// Placeholder — see template 1 scaffold",
    config: JSON.stringify({ schedule: "* * * * *", threshold: 3000, asset: "ETH/USD" }),
    simulationSuccess: true,
    simulationDuration: 450,
    published: true,
    onchainWorkflowId: "0x" + "b2c3d4e5".repeat(8),
    publishTxHash: "0x" + "beef".repeat(16),
    x402Endpoint: "http://localhost:3001/api/workflows/" + priceMonitorId + "/execute",
    priceUsdc: 5000,
    category: "core-defi",
    capabilities: JSON.stringify(["price-feed", "alert"]),
    chains: JSON.stringify(["base-sepolia"]),
    totalExecutions: 128,
    successfulExecutions: 125,
  })

  // ── Seed initial event for the activity feed ──
  await db.insert(events).values({
    type: "publish",
    data: JSON.stringify({
      workflowId: FLAGSHIP_WORKFLOW_ID,
      workflowName: "AI Consensus Oracle",
      category: "ai-powered",
      timestamp: new Date().toISOString(),
    }),
  })

  console.log(`Seeded ${2} workflows and ${1} event.`)
  console.log(`Flagship workflow ID: ${FLAGSHIP_WORKFLOW_ID}`)
  process.exit(0)
}

seed().catch((err) => {
  console.error("Seed failed:", err)
  process.exit(1)
})
