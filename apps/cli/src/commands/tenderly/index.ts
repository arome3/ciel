import { Command } from "commander"
import { tenderlyCreateCommand } from "./create"
import { tenderlyDeployCommand } from "./deploy"
import { tenderlyFundCommand } from "./fund"
import { tenderlyStatusCommand } from "./status"
import { tenderlyCleanupCommand } from "./cleanup"

export const tenderlyCommand = new Command("tenderly")
  .description("Manage Tenderly Virtual TestNets")
  .addCommand(tenderlyCreateCommand)
  .addCommand(tenderlyDeployCommand)
  .addCommand(tenderlyFundCommand)
  .addCommand(tenderlyStatusCommand)
  .addCommand(tenderlyCleanupCommand)
