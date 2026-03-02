import { Command } from "commander"
import { CielClient } from "../../client"
import { resolveConfig } from "../../config"
import * as out from "../../output"

export const tenderlyFundCommand = new Command("fund")
  .description("Fund an address with ETH on the active Virtual TestNet")
  .argument("<address>", "Ethereum address to fund (0x...)")
  .option("--amount <eth>", "amount in ETH", "100")
  .action(async (address, opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const data = await client.tenderlyFund(address, Number(opts.amount))

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.success(`Funded ${address} with ${data.amountEth} ETH`)
  })
