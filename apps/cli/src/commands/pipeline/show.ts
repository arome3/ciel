import { Command } from "commander"
import { CielClient } from "../../client"
import { resolveConfig } from "../../config"
import * as out from "../../output"

export const pipelineShowCommand = new Command("show")
  .description("Show pipeline details")
  .argument("<id>", "pipeline ID")
  .action(async (id, _opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const p = await client.getPipeline(id)

    if (config.jsonMode) {
      out.json(p)
      return
    }

    out.header(p.name)
    out.field("ID", p.id)
    out.field("Description", p.description)
    out.field("Owner", p.ownerAddress)
    out.field("Active", p.active ? "yes" : "no")
    out.field("Total Price", `$${(p.totalPriceUsdc / 1_000_000).toFixed(2)}`)
    out.field("Executions", p.executionCount)
    out.field("Created", p.createdAt)

    if (Array.isArray(p.steps) && p.steps.length > 0) {
      console.log()
      out.info("Steps:")
      for (let i = 0; i < p.steps.length; i++) {
        const step = p.steps[i] as Record<string, unknown>
        out.traceStep(
          `Step ${i + 1}: ${step.workflowId ?? "unknown"}`,
          "pending",
          step.position !== undefined ? `position ${step.position}` : undefined,
        )
      }
    }

    console.log()
  })
