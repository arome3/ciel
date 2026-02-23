// agent/src/executor.ts — Execute workflows with x402 automatic payment

import { createPublicClient, http } from "viem"
import { baseSepolia } from "viem/chains"
import { wrapFetchWithPayment, x402Client, type Network } from "@x402/fetch"
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm"
import type { DiscoveredWorkflow, ExecutionResult } from "./types"
import * as log from "./logger"

export type PaymentFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface EvmAccount {
  readonly address: `0x${string}`
  signTypedData(message: {
    domain: Record<string, unknown>
    types: Record<string, unknown>
    primaryType: string
    message: Record<string, unknown>
  }): Promise<`0x${string}`>
}

const MAX_RETRIES = 1
const TIMEOUT_MS = 30_000

// ─────────────────────────────────────────────
// Create payment-enabled fetch
// ─────────────────────────────────────────────

export function createPaymentFetch(
  account: EvmAccount,
  network: Network,
  rpcUrl?: string,
): PaymentFetch {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  })
  const signer = toClientEvmSigner(account, publicClient)
  const client = new x402Client()
  client.register(network, new ExactEvmScheme(signer))
  return wrapFetchWithPayment(fetch, client)
}

// ─────────────────────────────────────────────
// Execute a workflow via its x402 endpoint
// ─────────────────────────────────────────────

export async function executeWorkflow(
  workflow: DiscoveredWorkflow,
  _prompt: string,
  paymentFetch: PaymentFetch,
): Promise<ExecutionResult> {
  await log.step(`Executing "${workflow.name}" via x402...`)
  await log.detail(`Endpoint: ${workflow.x402Endpoint}`)
  await log.detail(`Price: $${(workflow.priceUsdc / 1_000_000).toFixed(4)} USDC`)

  let lastError: Error | undefined

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await log.detail(`Retry attempt ${attempt}/${MAX_RETRIES}...`)
    }

    try {
      // Execute route is GET — workflow code is stored server-side.
      // x402 wrapper auto-handles 402 → sign → retry with payment header.
      const res = await paymentFetch(workflow.x402Endpoint, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
      }

      let data: Record<string, unknown>
      try {
        data = await res.json()
      } catch {
        throw new Error("Failed to parse response JSON")
      }

      log.done("Execution complete — payment settled automatically")

      // Parse response — execute route returns { success, result: { output, ... }, payment, ... }
      const resultObj = data.result as Record<string, unknown> | undefined
      const paymentObj = data.payment as Record<string, unknown> | undefined

      return {
        success: data.success === true,
        answer: typeof resultObj?.output === "string" ? resultObj.output : undefined,
        confidence: typeof resultObj?.confidence === "number" ? resultObj.confidence : undefined,
        modelsAgreed: typeof resultObj?.modelsAgreed === "number" ? resultObj.modelsAgreed : undefined,
        consensusReached: typeof resultObj?.consensusReached === "boolean" ? resultObj.consensusReached : undefined,
        txHash: typeof paymentObj?.txHash === "string" ? paymentObj.txHash : undefined,
        blockNumber: typeof data.blockNumber === "number" ? data.blockNumber : undefined,
        explorerUrl: typeof data.explorerUrl === "string" ? data.explorerUrl : undefined,
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      // Don't retry payment-related errors (402 is handled by the wrapper)
      if (lastError.message.includes("402")) break
    }
  }

  log.error(`Execution failed: ${lastError?.message ?? "Unknown error"}`)
  return { success: false }
}
