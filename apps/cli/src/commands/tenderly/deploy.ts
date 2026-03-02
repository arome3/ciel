import { Command } from "commander"
import { CielClient } from "../../client"
import { resolveConfig } from "../../config"
import * as out from "../../output"

export const tenderlyDeployCommand = new Command("deploy")
  .description("Deploy Registry + Consumer contracts to the active Virtual TestNet")
  .action(async (_opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const data = await client.tenderlyDeployContracts()

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header("Contracts Deployed")
    out.field("Registry", data.registryAddress)
    out.field("Consumer", data.consumerAddress)
    out.field("Explorer", data.explorerUrl)
    out.hint("Next: ciel tenderly status")
  })
