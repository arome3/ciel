import { Command } from "commander"
import { CielClient } from "../../client"
import { resolveConfig } from "../../config"
import * as out from "../../output"

const NETWORK_NAMES: Record<number, string> = {
  1: "Ethereum Mainnet",
  84532: "Base Sepolia",
  8453: "Base",
  42161: "Arbitrum One",
}

export const tenderlyCreateCommand = new Command("create")
  .description("Create a Tenderly Virtual TestNet")
  .option("--name <name>", "testnet name", "ciel-testnet")
  .option("--network <id>", "fork network ID (1=mainnet, 84532=base-sepolia, 8453=base)", "84532")
  .option("--chain-id <id>", "custom chain ID")
  .option("--sync", "enable real-time state sync from the forked network")
  .action(async (opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const networkId = Number(opts.network)
    const data = await client.tenderlyCreate({
      name: opts.name,
      networkId,
      chainId: opts.chainId ? Number(opts.chainId) : undefined,
      syncState: opts.sync ?? false,
    })

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header("Virtual TestNet Created")
    out.field("ID", data.id)
    out.field("Name", data.name)
    out.field("Network", NETWORK_NAMES[data.networkId] ?? `Chain ${data.networkId}`)
    out.field("Chain ID", data.chainId)
    out.field("RPC URL", data.rpcUrl)
    out.field("Explorer", data.explorerUrl)
    out.hint("Next: ciel tenderly deploy")
  })
