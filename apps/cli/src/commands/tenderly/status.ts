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

export const tenderlyStatusCommand = new Command("status")
  .description("Show current Virtual TestNet status and explorer URL")
  .action(async (_opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const data = await client.tenderlyStatus()

    if (config.jsonMode) {
      out.json(data)
      return
    }

    if (!data.active || !data.testnet) {
      out.info("No active Virtual TestNet")
      out.hint("Create one: ciel tenderly create --name my-testnet")
      return
    }

    const t = data.testnet
    out.header("Virtual TestNet Status")
    out.field("ID", t.id)
    out.field("Name", t.name)
    out.field("Network", NETWORK_NAMES[t.networkId] ?? `Chain ${t.networkId}`)
    out.field("Chain ID", t.chainId)
    out.field("RPC URL", t.rpcUrl)
    out.field("Explorer", t.explorerUrl)

    if (data.contracts.registry) {
      console.log()
      out.field("Registry", data.contracts.registry)
      out.field("Consumer", data.contracts.consumer)
    }

    if (data.snapshotId) {
      out.field("Snapshot", data.snapshotId)
    }
  })
