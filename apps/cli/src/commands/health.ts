import { Command } from "commander"
import { CielClient } from "../client"
import { resolveConfig } from "../config"
import * as out from "../output"

export const healthCommand = new Command("health")
  .description("Check Ciel API health status")
  .action(async (_opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const data = await client.health()

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header("Ciel API Health")
    out.field("Status", data.status === "ok" ? "healthy" : data.status)
    out.field("Uptime", formatUptime(data.uptime))
    out.field("SSE Clients", data.sseClients)
    out.field("Database", data.database)
    console.log()
  })

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
