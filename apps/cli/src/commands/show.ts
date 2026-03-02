import { Command } from "commander"
import { CielClient } from "../client"
import { resolveConfig } from "../config"
import * as out from "../output"

export const showCommand = new Command("show")
  .description("Show workflow details")
  .argument("<id>", "workflow ID")
  .option("--show-code", "display generated code")
  .option("--show-config", "display workflow configuration")
  .action(async (id, opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const w = await client.getWorkflow(id)

    if (config.jsonMode) {
      out.json(w)
      return
    }

    out.header(w.name ?? "Unnamed Workflow")
    out.field("ID", w.id)
    out.field("Prompt", w.prompt)
    out.field("Category", w.category)
    out.field("Published", w.published ? "yes" : "no")
    out.field("Deploy Status", w.deployStatus)
    out.field("Owner", w.ownerAddress)
    out.field("Price", w.priceUsdc ? `$${(w.priceUsdc / 1_000_000).toFixed(2)}` : "–")
    out.field("Executions", w.executionCount)
    out.field("Created", w.createdAt)

    if (w.onchainWorkflowId) {
      out.field("Onchain ID", w.onchainWorkflowId)
    }
    if (w.donWorkflowId) {
      out.field("DON Workflow ID", w.donWorkflowId)
    }

    if (opts.showCode) {
      out.code(w.code, "typescript")
    }

    if (opts.showConfig) {
      try {
        const parsed = JSON.parse(w.configJson)
        out.code(JSON.stringify(parsed, null, 2), "json")
      } catch {
        out.code(w.configJson, "json")
      }
    }

    console.log()
  })
