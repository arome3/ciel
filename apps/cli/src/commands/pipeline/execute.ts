import { Command } from "commander"
import { CielClient } from "../../client"
import { resolveConfig } from "../../config"
import { requireAuth, pipelineAuthHeaders } from "../../auth"
import { invalidInput } from "../../errors"
import * as out from "../../output"

export const pipelineExecuteCommand = new Command("execute")
  .description("Execute a pipeline")
  .argument("<id>", "pipeline ID")
  .option("--input <json>", "input data as JSON string", "{}")
  .action(async (id, opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const auth = requireAuth(config)
    const client = new CielClient(config)

    let input: unknown
    try {
      input = JSON.parse(opts.input)
    } catch {
      throw invalidInput("--input must be valid JSON")
    }

    const headers = await pipelineAuthHeaders(auth, id)
    const data = await client.executePipeline(id, input, headers)

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header("Pipeline Execution")
    out.field("Execution ID", data.id)
    out.field("Pipeline ID", data.pipelineId)
    out.field("Status", data.status)
    out.field("Started", data.startedAt)
    if (data.completedAt) {
      out.field("Completed", data.completedAt)
    }

    if (data.results) {
      console.log()
      out.info("Results:")
      console.log(`  ${JSON.stringify(data.results, null, 2)}`)
    }

    console.log()
  })
