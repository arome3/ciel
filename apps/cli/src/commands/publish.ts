import { Command } from "commander"
import { CielClient } from "../client"
import { resolveConfig } from "../config"
import { requireAuth, workflowAuthHeaders } from "../auth"
import * as out from "../output"

export const publishCommand = new Command("publish")
  .description("Publish a workflow to the marketplace")
  .argument("<id>", "workflow ID")
  .requiredOption("--name <name>", "workflow name (3-100 chars)")
  .requiredOption("--description <desc>", "workflow description (10-500 chars)")
  .requiredOption("--price <microUsdc>", "price in micro USDC (1000-10000000)")
  .action(async (id, opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const auth = requireAuth(config)
    const client = new CielClient(config)

    const price = Number(opts.price)
    if (Number.isNaN(price) || price < 1000 || price > 10_000_000) {
      out.error("Price must be between 1000 and 10000000 micro USDC")
      process.exit(1)
    }

    const headers = await workflowAuthHeaders(auth, id)
    const data = await client.publish(id, opts.name, opts.description, price, headers)

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header("Workflow Published")
    out.field("Workflow ID", data.workflowId)
    out.field("Onchain ID", data.onchainWorkflowId)
    out.field("Tx Hash", data.publishTxHash)
    out.field("x402 Endpoint", data.x402Endpoint)
    out.field("Deploy Status", data.deployStatus)
    if (data.donWorkflowId) {
      out.field("DON Workflow ID", data.donWorkflowId)
    }

    out.hint("Monitor deployment: ciel events")
  })
