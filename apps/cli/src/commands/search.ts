import { Command } from "commander"
import { CielClient } from "../client"
import { resolveConfig } from "../config"
import * as out from "../output"

export const searchCommand = new Command("search")
  .description("Search/discover published workflows")
  .argument("<query>", "search query")
  .option("--category <cat>", "filter by category")
  .option("--chain <chain>", "filter by chain")
  .option("--capability <cap>", "filter by capability")
  .action(async (query, opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const data = await client.discover({
      category: opts.category ?? query,
      chain: opts.chain,
      capability: opts.capability,
    })

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header(`Search Results for "${query}"`)

    if (data.workflows.length === 0) {
      out.info("  No workflows found matching your query.")
      return
    }

    out.table(
      ["ID", "Name", "Category", "Chain", "Price", "Runs"],
      data.workflows.map(w => [
        w.id.slice(0, 8),
        w.name.slice(0, 25),
        w.category,
        w.chain,
        `$${(w.priceUsdc / 1_000_000).toFixed(2)}`,
        String(w.executionCount),
      ]),
    )
    console.log()
  })
