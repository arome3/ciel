import { Command } from "commander"
import { CielClient } from "../client"
import { resolveConfig } from "../config"
import { tryAuth, workflowAuthHeaders } from "../auth"
import * as out from "../output"

export const executeCommand = new Command("execute")
  .description("Execute a workflow (owner skips payment)")
  .argument("<id>", "workflow ID")
  .action(async (id, _opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    let headers: Record<string, string> | undefined
    const auth = tryAuth(config)
    if (auth) {
      headers = await workflowAuthHeaders(auth, id)
    }

    const data = await client.executeWorkflow(id, headers)

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header("Execution Result")
    out.field("Result", JSON.stringify(data.result, null, 2))
    if (data.payment) {
      out.field("Payment", JSON.stringify(data.payment))
    }
    console.log()
  })
