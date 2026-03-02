import { Command } from "commander"
import { pipelineCreateCommand } from "./create"
import { pipelineListCommand } from "./list"
import { pipelineShowCommand } from "./show"
import { pipelineExecuteCommand } from "./execute"
import { pipelineHistoryCommand } from "./history"

export const pipelineCommand = new Command("pipeline")
  .description("Manage workflow pipelines")
  .addCommand(pipelineCreateCommand)
  .addCommand(pipelineListCommand)
  .addCommand(pipelineShowCommand)
  .addCommand(pipelineExecuteCommand)
  .addCommand(pipelineHistoryCommand)
