import { Command } from "commander"
import { CielClient } from "../../client"
import { resolveConfig } from "../../config"
import * as out from "../../output"

export const pipelineListCommand = new Command("list")
  .description("List pipelines")
  .option("--owner <address>", "filter by owner address")
  .option("--active", "only show active pipelines")
  .option("--page <n>", "page number", "1")
  .option("--limit <n>", "results per page", "10")
  .action(async (opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const data = await client.listPipelines({
      page: Number(opts.page),
      limit: Number(opts.limit),
      owner: opts.owner,
      active: opts.active ? true : undefined,
    })

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header(`Pipelines (${data.total} total)`)

    if (data.pipelines.length === 0) {
      out.info("  No pipelines found.")
      return
    }

    out.table(
      ["ID", "Name", "Steps", "Price", "Active", "Runs"],
      data.pipelines.map(p => [
        p.id.slice(0, 8),
        p.name.slice(0, 25),
        String(p.steps.length),
        `$${(p.totalPriceUsdc / 1_000_000).toFixed(2)}`,
        p.active ? "yes" : "no",
        String(p.executionCount),
      ]),
    )
    console.log()
  })
