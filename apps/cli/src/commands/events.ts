import { Command } from "commander"
import { CielClient } from "../client"
import { resolveConfig } from "../config"
import { streamEvents, defaultEventHandler } from "../sse"
import * as out from "../output"

export const eventsCommand = new Command("events")
  .description("Stream real-time SSE events (Ctrl+C to stop)")
  .option("--filter <types>", "comma-separated event types to show")
  .action(async (opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const filterSet = opts.filter
      ? new Set(opts.filter.split(",").map((t: string) => t.trim()))
      : null

    const controller = new AbortController()

    process.on("SIGINT", () => {
      controller.abort()
    })

    if (!config.jsonMode) {
      out.header("Streaming Events")
      out.info("  Press Ctrl+C to stop\n")
    }

    const response = await client.connectSSE()

    await streamEvents(
      response,
      (type, data) => {
        if (filterSet && !filterSet.has(type)) return
        defaultEventHandler(type, data)
      },
      controller.signal,
    )

    if (!config.jsonMode) {
      console.log()
      out.info("  Stream ended.")
    }
  })
