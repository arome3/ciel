import type { Request, Response, NextFunction } from "express"
import { paymentMiddleware, x402ResourceServer } from "@x402/express"
import { HTTPFacilitatorClient } from "@x402/core/server"
import { registerExactEvmScheme } from "@x402/evm/exact/server"
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm"
import { registerBazaarExtension, getWorkflowDiscoveryExtension } from "./bazaar"
import { config } from "../../config"
import { createLogger } from "../../lib/logger"
import { db } from "../../db"
import { workflows, executions } from "../../db/schema"

const log = createLogger("x402")

// ── Facilitator client (Coinbase USDC settlement) ──
const facilitatorClient = new HTTPFacilitatorClient({
  url: config.X402_FACILITATOR_URL,
})

// ── Resource server with EVM exact-amount scheme ──
const resourceServer = new x402ResourceServer(facilitatorClient)
registerExactEvmScheme(resourceServer)
registerBazaarExtension(resourceServer)

// ── Dynamic price lookup ──
// Called during 402 challenge to determine per-workflow price.
// Extracts workflow ID from request path: /workflows/:id/execute
async function lookupWorkflowPrice(context: { path: string }): Promise<string> {
  try {
    const parts = context.path.split("/")
    // path = /workflows/{id}/execute → ["", "workflows", "{id}", "execute"]
    const workflowId = parts[2]
    if (!workflowId) return "0.01"

    const workflow = await db
      .select({ priceUsdc: workflows.priceUsdc })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .get()

    if (!workflow?.priceUsdc) return "0.01"

    // Convert from 6-decimal integer to dollar string
    // 10000 → "0.01", 1000000 → "1"
    return (workflow.priceUsdc / 1_000_000).toString()
  } catch (err) {
    log.error("Price lookup failed, using default", err)
    return "0.01"
  }
}

// ── Route payment configuration ──
// Path has NO /api prefix — Express strips the mount prefix before the router sees it
const routes = {
  "GET /workflows/:id/execute": {
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532" as const,
        price: lookupWorkflowPrice,
        payTo: config.WALLET_ADDRESS,
      },
    ],
    description: "Execute Ciel CRE workflow",
    extensions: getWorkflowDiscoveryExtension(),
  },
}

// ── Settlement tracking hook ──
// After x402 settles payment, update the execution record with tx hash.
// Correlation: find the most recent paid execution with null paymentTxHash.
// Reliable at demo throughput — SQLite serializes writes, settle fires
// within milliseconds of the handler's awaited insert.
resourceServer.onAfterSettle(async (context) => {
  if (!context.result.success) return
  try {
    const txHash = context.result.transaction
    const payer = context.result.payer ?? null

    const pending = await db
      .select({ id: executions.id })
      .from(executions)
      .where(
        and(
          isNull(executions.paymentTxHash),
          isNotNull(executions.amountUsdc),
        ),
      )
      .orderBy(desc(executions.createdAt))
      .limit(1)
      .get()

    if (pending) {
      const updates: Record<string, unknown> = { paymentTxHash: txHash }
      if (payer) updates.agentAddress = payer

      await db
        .update(executions)
        .set(updates)
        .where(eq(executions.id, pending.id))

      log.info(`Settlement recorded — tx: ${txHash}, execution: ${pending.id}`)
    } else {
      log.warn(`Settlement received but no pending execution — tx: ${txHash}`)
    }
  } catch (err) {
    log.error("Failed to record settlement", err)
  }
})

// ── Build the x402 handler ──
const x402Handler = paymentMiddleware(routes, resourceServer)

/**
 * Conditional payment middleware.
 * Skips x402 challenge if upstream owner-verify set req.skipPayment.
 */
export function conditionalPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.skipPayment) {
    log.debug("Owner bypass — skipping x402 payment")
    next()
    return
  }

  log.debug("Delegating to x402 payment middleware")
  x402Handler(req, res, next)
}

// ── Test introspection exports ──
export const _routes = routes
export const _resourceServer = resourceServer
export const _lookupWorkflowPrice = lookupWorkflowPrice
