import { Router } from "express"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { workflows } from "../db/schema"
import { AppError, ErrorCodes } from "../types/errors"
import { LRUCache } from "../lib/lru-cache"
import { createLogger } from "../lib/logger"
import { config } from "../config"

const log = createLogger("AgentCard")
const router = Router()

interface AgentCardSkill {
  id: string
  name: string
  description: string
  tags: string[]
  examples: string[]
}

interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  capabilities: { streaming: boolean }
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: AgentCardSkill[]
  provider: { organization: string; url: string }
  authSchemes: Array<{ type: string; network: string }>
}

// Cache agent card for 60s — skills rarely change
const cardCache = new LRUCache<AgentCard>(1, 60_000)

router.get("/.well-known/agent-card.json", async (_req, res, next) => {
  try {
    const cached = cardCache.get("card")
    if (cached) {
      log.debug("Serving cached agent card")
      res.setHeader("Content-Type", "application/json")
      return res.json(cached)
    }

    log.debug("Building agent card from published workflows")

    const rows = await db
      .select({
        id: workflows.id,
        name: workflows.name,
        description: workflows.description,
        capabilities: workflows.capabilities,
        chains: workflows.chains,
      })
      .from(workflows)
      .where(eq(workflows.published, true))

    const skills: AgentCardSkill[] = rows.map((row) => {
      let caps: string[] = []
      let chains: string[] = []
      try { caps = JSON.parse(row.capabilities) } catch { /* empty */ }
      try { chains = JSON.parse(row.chains) } catch { /* empty */ }

      return {
        id: `workflow-${row.id}`,
        name: row.name,
        description: row.description,
        tags: [...caps, ...chains],
        examples: [],
      }
    })

    const apiUrl = config.NEXT_PUBLIC_API_URL

    const card: AgentCard = {
      name: "Ciel",
      description: "AI-powered CRE workflow platform — discover and execute on-chain workflows",
      url: apiUrl,
      version: "1.0.0",
      capabilities: { streaming: false },
      defaultInputModes: ["application/json"],
      defaultOutputModes: ["application/json"],
      skills,
      provider: { organization: "Ciel", url: apiUrl },
      authSchemes: [{ type: "x402", network: "eip155:84532" }],
    }

    cardCache.set("card", card)

    res.setHeader("Content-Type", "application/json")
    res.json(card)
  } catch (err) {
    if (err instanceof AppError) return next(err)
    log.error("Agent card generation failed", err)
    next(
      new AppError(
        ErrorCodes.AGENT_CARD_FAILED,
        500,
        "Failed to generate agent card",
        { cause: err instanceof Error ? err.message : String(err) },
      ),
    )
  }
})

export default router
