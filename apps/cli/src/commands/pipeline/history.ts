import { Command } from "commander"
import { CielClient } from "../../client"
import { resolveConfig } from "../../config"
import * as out from "../../output"

export const pipelineHistoryCommand = new Command("history")
  .description("Show pipeline execution history")
  .argument("<id>", "pipeline ID")
  .option("--page <n>", "page number", "1")
  .option("--limit <n>", "results per page", "10")
  .action(async (id, opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const data = await client.pipelineHistory(id, {
      page: Number(opts.page),
      limit: Number(opts.limit),
    })

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header(`Pipeline Execution History (${data.total} total)`)

    if (data.executions.length === 0) {
      out.info("  No executions found.")
      return
    }

    out.table(
      ["ID", "Status", "Started", "Completed"],
      data.executions.map(e => [
        e.id.slice(0, 8),
        e.status,
        new Date(e.startedAt).toLocaleString(),
        e.completedAt ? new Date(e.completedAt).toLocaleString() : "–",
      ]),
    )
    console.log()
  })
