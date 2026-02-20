import { createChannel } from "better-sse"
import { sqlite } from "../../db"
import { createLogger } from "../../lib/logger"
import { createEmitterFromDeps } from "./emitter-core"

const log = createLogger("Emitter")

// Prepared statement for sync insert — returns auto-increment id
const insertStmt = sqlite.prepare(
  "INSERT INTO events (type, data) VALUES (?, ?) RETURNING id"
)

// ── Wire real dependencies into the emitter ──
const { emitEvent, getAgentChannel, getConnectedClientCount } =
  createEmitterFromDeps({
    channel: createChannel(),
    syncInsertEvent: (type: string, data: string) => {
      const row = insertStmt.get(type, data) as { id: number }
      return row.id
    },
    log,
  })

export { emitEvent, getAgentChannel, getConnectedClientCount }
