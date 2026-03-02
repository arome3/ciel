import { Command } from "commander"
import { CielClient } from "../client"
import { resolveConfig } from "../config"
import * as out from "../output"

export const simulateCommand = new Command("simulate")
  .description("Simulate a workflow and display execution trace")
  .argument("<id>", "workflow ID")
  .action(async (id, _opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const data = await client.simulate(id)

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header("Simulation Result")
    out.field("Status", data.success ? "success" : "failed")
    out.field("Duration", `${data.duration}ms`)

    if (data.trace && data.trace.length > 0) {
      console.log()
      for (const step of data.trace) {
        const detail = step.duration ? `${step.duration}ms` : step.detail
        out.traceStep(step.step, step.status, detail)
      }
    }

    if (data.logs.length > 0) {
      console.log()
      out.info("Logs:")
      for (const log of data.logs) {
        console.log(`  ${log}`)
      }
    }

    if (data.output !== undefined) {
      console.log()
      out.info("Output:")
      console.log(`  ${JSON.stringify(data.output, null, 2)}`)
    }

    console.log()
    if (data.success) {
      out.hint(`Next: ciel publish ${id} --name "My Workflow" --description "..." --price 10000`)
    } else {
      out.hint(`Simulation failed. Review the trace above and regenerate if needed.`)
    }
  })
