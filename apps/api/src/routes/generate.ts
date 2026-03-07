import { Router } from "express"
import { z } from "zod"
import OpenAI from "openai"
import { GenerateRequestSchema } from "../types/api"
import { generateLimiter } from "../middleware/rate-limiter"
import { generateWorkflow } from "../services/ai-engine/orchestrator"
import { db } from "../db"
import { intentLogs } from "../db/schema"
import { config } from "../config"
import { AppError, ErrorCodes } from "../types/errors"
import { createLogger } from "../lib/logger"

const log = createLogger("GenerateDesc")

const router = Router()

router.post("/generate", generateLimiter, async (req, res, next) => {
  try {
    const parsed = GenerateRequestSchema.parse(req.body)
    const rawAddress = req.headers["x-owner-address"] as string | undefined
    const ownerAddress = rawAddress && /^0x[a-fA-F0-9]{40}$/.test(rawAddress)
      ? rawAddress
      : "0x0000000000000000000000000000000000000000"

    const result = await generateWorkflow(parsed.prompt, ownerAddress, parsed.templateHint)

    // Fire-and-forget: log intent for future fine-tuning
    db.insert(intentLogs).values({
      id: crypto.randomUUID(),
      prompt: parsed.prompt,
      matchedTemplateId: result.template.templateId,
      matchedConfidence: result.template.confidence,
    }).catch(() => { /* non-blocking — never fail the response */ })

    res.json({
      workflowId: result.workflowId,
      code: result.code,
      configJson: result.configJson,
      explanation: result.explanation,
      consumerSol: result.consumerSol,
      secretsYaml: result.secretsYaml,
      intent: result.intent,
      template: result.template,
      validation: result.validation,
      fallback: result.fallback,
    })
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// Generate Description — lightweight LLM call for marketplace listings
// ─────────────────────────────────────────────

const DescriptionRequestSchema = z.object({
  explanation: z.string().min(1).max(2000),
  templateName: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  capabilities: z.array(z.string().max(100)).max(20),
})

export { DescriptionRequestSchema }

let descClient: OpenAI | null = null
function getDescClient(): OpenAI {
  if (!descClient) {
    descClient = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      timeout: 30_000,
      maxRetries: 1,
    })
  }
  return descClient
}

/** @internal Test-only: reset lazy singleton so mock.module changes take effect */
export function _resetDescClient(): void {
  descClient = null
}

router.post("/generate-description", generateLimiter, async (req, res, next) => {
  try {
    const parsed = DescriptionRequestSchema.parse(req.body)

    const openai = getDescClient()
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "Write a concise marketplace description (2-3 sentences, max 300 chars) " +
            "for a Chainlink CRE workflow. Be specific about what it does, not generic. " +
            "Do not use markdown or bullet points. Return only the description text.",
        },
        {
          role: "user",
          content: [
            `Template: ${parsed.templateName}`,
            `Category: ${parsed.category}`,
            `Capabilities: ${parsed.capabilities.join(", ")}`,
            `What it does: ${parsed.explanation}`,
          ].join("\n"),
        },
      ],
    })

    const DESC_LIMIT = 500
    let description = completion.choices[0]?.message?.content?.trim() ?? ""
    if (!description) {
      throw new AppError(ErrorCodes.AI_SERVICE_ERROR, 502, "Empty description from AI model")
    }

    // LLMs don't reliably respect char limits — hard-truncate at sentence boundary
    if (description.length > DESC_LIMIT) {
      const truncated = description.slice(0, DESC_LIMIT)
      const lastSentence = truncated.lastIndexOf(".")
      description = lastSentence > DESC_LIMIT / 2
        ? truncated.slice(0, lastSentence + 1)
        : truncated
    }

    log.info(`Generated description (${description.length} chars)`)
    res.json({ description })
  } catch (err) {
    if (err instanceof AppError) return next(err)
    if (err instanceof z.ZodError) {
      return next(new AppError(ErrorCodes.INVALID_INPUT, 400, "Invalid input", err.errors))
    }
    log.info(`Description generation failed: ${(err as Error).message?.slice(0, 200)}`)
    next(new AppError(ErrorCodes.AI_SERVICE_ERROR, 502, "Failed to generate description"))
  }
})

export default router
