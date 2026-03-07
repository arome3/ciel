import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { request, qs } from "./http"

export function registerTools(server: McpServer, apiUrl: string): void {
  // ── ciel_discover ──
  server.tool(
    "ciel_discover",
    "Discover available Ciel workflows. Filter by category (core-defi, institutional, risk-compliance, ai-powered), blockchain chain, or capability.",
    {
      category: z.string().optional().describe("Filter by category (e.g. core-defi, institutional)"),
      chain: z.string().optional().describe("Filter by blockchain chain (e.g. base-sepolia)"),
      capability: z.string().optional().describe("Filter by capability (e.g. price-feed, evmWrite, alert)"),
    },
    async ({ category, chain, capability }) => {
      try {
        const params = { category, chain, capability }
        const workflows = await request(apiUrl, `/api/discover${qs(params)}`)
        return {
          content: [{ type: "text" as const, text: JSON.stringify(workflows, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Failed to discover workflows: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    },
  )

  // ── ciel_get_workflow ──
  server.tool(
    "ciel_get_workflow",
    "Get detailed information about a specific Ciel workflow by its ID, including code, config, execution stats, and deployment status.",
    {
      workflowId: z.string().uuid().describe("The workflow UUID"),
    },
    async ({ workflowId }) => {
      try {
        const workflow = await request(apiUrl, `/api/workflows/${workflowId}`)
        return {
          content: [{ type: "text" as const, text: JSON.stringify(workflow, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Failed to get workflow: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    },
  )

  // ── ciel_execute ──
  server.tool(
    "ciel_execute",
    "Execute a Ciel workflow. Works for owner-bypass or free workflows. For paid workflows requiring x402 payment, use the @ciel/sdk directly.",
    {
      workflowId: z.string().uuid().describe("The workflow UUID to execute"),
      configOverrides: z.record(z.unknown()).optional().describe("Optional config overrides for the execution"),
    },
    async ({ workflowId }) => {
      try {
        const result = await request(apiUrl, `/api/workflows/${workflowId}/execute`)
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Failed to execute workflow: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    },
  )
}
