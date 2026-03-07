#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { registerTools } from "./tools"

const apiUrl = process.env.CIEL_API_URL ?? "http://localhost:3001"

const server = new McpServer({
  name: "Ciel",
  version: "0.1.0",
})

registerTools(server, apiUrl)

const transport = new StdioServerTransport()
await server.connect(transport)

// Log to stderr — stdout is reserved for JSON-RPC
console.error(`[ciel-mcp] Connected — API: ${apiUrl}`)
