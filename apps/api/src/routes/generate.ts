import { Router } from "express"
import { GenerateRequestSchema } from "../types/api"
import { generateLimiter } from "../middleware/rate-limiter"
import { generateWorkflow } from "../services/ai-engine/orchestrator"
import { db } from "../db"
import { intentLogs } from "../db/schema"

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

export default router
