import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from "@x402/extensions/bazaar"
import type { x402ResourceServer } from "@x402/express"
import { createLogger } from "../../lib/logger"

const log = createLogger("Bazaar")

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

