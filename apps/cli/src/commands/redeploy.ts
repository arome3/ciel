import { Command } from "commander"
import { CielClient } from "../client"
import { resolveConfig } from "../config"
import { requireAuth, workflowAuthHeaders } from "../auth"
import * as out from "../output"

export const redeployCommand = new Command("redeploy")
  .description("Re-deploy a failed workflow to DON")
  .argument("<id>", "workflow ID")
  .action(async (id, _opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const auth = requireAuth(config)
    const client = new CielClient(config)

    const headers = await workflowAuthHeaders(auth, id)
    const data = await client.redeploy(id, headers)

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header("Redeployment Initiated")
    out.field("Workflow ID", data.workflowId)
    out.field("Deploy Status", data.deployStatus)

    out.hint("Monitor deployment: ciel events")
  })
