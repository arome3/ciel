import { Command } from "commander"
import { CielClient } from "../client"
import { resolveConfig } from "../config"
import * as out from "../output"

export const listCommand = new Command("list")
  .description("List published workflows")
  .option("--category <cat>", "filter by category")
  .option("--page <n>", "page number", "1")
  .option("--limit <n>", "results per page", "10")
  .option("--search <query>", "search by name or description")
  .action(async (opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const data = await client.listWorkflows({
      page: Number(opts.page),
      limit: Number(opts.limit),
      category: opts.category,
      search: opts.search,
    })

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header(`Workflows (${data.total} total, page ${data.page})`)

    if (data.workflows.length === 0) {
      out.info("  No workflows found.")
      return
    }

    out.table(
      ["ID", "Name", "Category", "Price", "Runs"],
      data.workflows.map(w => [
        w.id.slice(0, 8),
        (w.name ?? "unnamed").slice(0, 30),
        w.category,
        w.priceUsdc == null ? "–" : w.priceUsdc === 0 ? "Free" : `$${(w.priceUsdc / 1_000_000).toFixed(2)}`,
        String(w.totalExecutions),
      ]),
    )
    console.log()
  })
