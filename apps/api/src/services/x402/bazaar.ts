import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from "@x402/extensions/bazaar"
import type { x402ResourceServer } from "@x402/express"
import { createLogger } from "../../lib/logger"

const log = createLogger("Bazaar")

// Community Discovery Catalog — the actual working discovery index
// that agents query via the x402_discover MCP tool.
// The CDP Facilitator only does verify/settle; it doesn't host /discovery/resources.
const BAZAAR_CATALOG_URL =
  process.env.BAZAAR_CATALOG_URL ?? "https://x402-discovery-api.onrender.com"

// ── Register Bazaar extension on the resource server ──
// Called once at middleware init time so the facilitator can
// index this server's resources into the Bazaar directory.

export function registerBazaarExtension(
  resourceServer: x402ResourceServer,
): void {
  resourceServer.registerExtension(bazaarResourceServerExtension)
  log.info("Bazaar discovery extension registered")
}

// ── Static discovery extension for the execute route ──
// Declares the GET /workflows/:id/execute endpoint shape
// so the Bazaar knows how agents should call it.
// NOTE: Per-workflow input/output schemas are not yet discoverable —
// all workflows share this generic schema. Dynamic per-request extensions
// require upstream @x402/express SDK support (extensions field is static).

export function getWorkflowDiscoveryExtension(): Record<string, unknown> {
  return declareDiscoveryExtension({
    input: { workflowId: "uuid" },
    inputSchema: {
      properties: {
        workflowId: { type: "string", format: "uuid" },
      },
      required: ["workflowId"],
    },
    output: {
      example: {
        success: true,
        result: { data: "workflow output" },
        duration: 1200,
      },
      schema: {
        properties: {
          success: { type: "boolean" },
          result: { type: "object" },
          duration: { type: "number" },
        },
        required: ["success"],
      },
    },
  })
}

// ── Active Bazaar registration ──
// Push workflow metadata to the facilitator immediately after publish
// so the workflow is discoverable right away (not just via passive traffic).

// Community catalog allowed categories: agent, compute, data, research, utility
// Map our internal categories to the closest catalog category
const CATALOG_CATEGORY_MAP: Record<string, string> = {
  "core-defi": "compute",
  "institutional": "compute",
  "risk-compliance": "data",
  "ai-powered": "agent",
}

export interface BazaarRegistrationParams {
  x402Endpoint: string
  name: string
  description: string
  category: string
  priceUsdc: number
  capabilities: string[]
  chains: string[]
}

export async function registerWorkflowInBazaar(
  params: BazaarRegistrationParams,
): Promise<void> {
  // Community catalog requires HTTPS URLs — skip for local dev endpoints
  if (!params.x402Endpoint.startsWith("https://")) {
    log.info(
      `Skipping Bazaar registration (non-HTTPS endpoint): ${params.x402Endpoint}`,
    )
    return
  }

  try {
    const catalogCategory = CATALOG_CATEGORY_MAP[params.category] ?? "utility"

    const resp = await fetch(`${BAZAAR_CATALOG_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: params.name,
        url: params.x402Endpoint,
        price_usd: params.priceUsdc / 1_000_000,
        category: catalogCategory,
        description: params.description,
        network: "base-sepolia",
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (resp.ok) {
      log.info(`Registered workflow in Bazaar: ${params.x402Endpoint}`)
    } else {
      const body = await resp.text().catch(() => "")
      log.warn(
        `Bazaar registration returned ${resp.status}: ${body || resp.statusText}`,
      )
    }
  } catch (err) {
    log.warn(`Bazaar registration failed: ${(err as Error).message}`)
  }
}

