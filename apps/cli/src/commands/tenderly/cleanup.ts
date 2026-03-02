import { Command } from "commander"
import { CielClient } from "../../client"
import { resolveConfig } from "../../config"
import * as out from "../../output"

export const tenderlyCleanupCommand = new Command("cleanup")
  .description("Destroy the active Virtual TestNet")
  .action(async (_opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const data = await client.tenderlyCleanup()

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.success("Virtual TestNet destroyed")
  })
