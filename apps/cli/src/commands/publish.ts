import { Command } from "commander"
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  decodeEventLog,
} from "viem"
import { baseSepolia } from "viem/chains"
import { privateKeyToAccount } from "viem/accounts"
import { CielClient } from "../client"
import { resolveConfig } from "../config"
import { requireAuth } from "../auth"
import * as out from "../output"

const registryAbi = parseAbi([
  "function publishWorkflow(string name, string description, string category, uint64[] supportedChains, string[] capabilities, string x402Endpoint, uint256 pricePerExecution) returns (bytes32)",
  "event WorkflowPublished(bytes32 indexed workflowId, address indexed creator, string name, string category)",
])

const BASE_SEPOLIA_CHAIN_SELECTOR = 10344971235874465080n

export const publishCommand = new Command("publish")
  .description("Publish a workflow to the marketplace")
  .argument("<id>", "workflow ID")
  .requiredOption("--name <name>", "workflow name (3-100 chars)")
  .requiredOption("--description <desc>", "workflow description (10-500 chars)")
  .requiredOption("--price <microUsdc>", "price in micro USDC (1000-10000000)")
  .requiredOption("--registry <address>", "AutopilotRegistry contract address")
  .action(async (id, opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const auth = requireAuth(config)
    const client = new CielClient(config)

    const price = Number(opts.price)
    if (Number.isNaN(price) || price < 1000 || price > 10_000_000) {
      out.error("Price must be between 1000 and 10000000 micro USDC")
      process.exit(1)
    }

    const registryAddress = opts.registry as `0x${string}`
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"

    // Build on-chain tx args
    const x402Endpoint = `${config.apiUrl}/api/workflows/${id}/execute`
    const capabilities: string[] = [] // populated from workflow metadata if available

    out.info("Submitting publishWorkflow transaction...")

    const account = privateKeyToAccount(config.privateKey as `0x${string}`)
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(rpcUrl),
    })
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    })

    // 1. Submit on-chain tx
    const hash = await walletClient.writeContract({
      address: registryAddress,
      abi: registryAbi,
      functionName: "publishWorkflow",
      args: [
        opts.name,
        opts.description,
        "core-defi",
        [BASE_SEPOLIA_CHAIN_SELECTOR],
        capabilities,
        x402Endpoint,
        BigInt(price),
      ],
    })

    out.info(`Tx submitted: ${hash}`)
    out.info("Waiting for confirmation...")

    // 2. Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    // 3. Decode WorkflowPublished event
    let onchainWorkflowId: string | null = null
    for (const log of receipt.logs) {
      try {
        const event = decodeEventLog({
          abi: registryAbi,
          data: log.data,
          topics: log.topics,
        })
        if (event.eventName === "WorkflowPublished") {
          onchainWorkflowId = event.args.workflowId
          break
        }
      } catch {
        // not our event
      }
    }

    if (!onchainWorkflowId) {
      // Free RPCs may return empty logs — use tx hash as fallback identifier
      out.warn("Could not decode event from receipt logs, using tx hash as workflow ID")
      onchainWorkflowId = hash
    }

    // 4. Confirm with backend
    const data = await client.confirmPublish(
      id,
      hash,
      onchainWorkflowId,
      opts.name,
      opts.description,
      price,
      auth.address,
    )

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header("Workflow Published")
    out.field("Workflow ID", data.workflowId)
    out.field("Onchain ID", data.onchainWorkflowId)
    out.field("Tx Hash", data.publishTxHash)
    out.field("x402 Endpoint", data.x402Endpoint)
    out.field("Deploy Status", data.deployStatus)
    if (data.donWorkflowId) {
      out.field("DON Workflow ID", data.donWorkflowId)
    }

    out.hint("Monitor deployment: ciel events")
  })
