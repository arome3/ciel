import { describe, test, expect, mock, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — OpenAI at the boundary
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

const mockCreate = mock(() =>
  Promise.resolve({
    choices: [
      {
        message: {
          content:
            "Monitors ETH price using Chainlink feeds and sends alerts when thresholds are breached. " +
            "Runs on a cron schedule with configurable parameters.",
        },
      },
    ],
  }),
)

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    }
  },
}))

// Mock config (side-effectful)
mock.module(resolve(SRC, "config"), () => ({
  config: {
    OPENAI_API_KEY: "sk-test-key",
    API_PORT: 3001,
    NODE_ENV: "test",
  },
}))

// Mock db (side-effectful)
mock.module(resolve(SRC, "db"), () => ({
  db: {
    insert: () => ({ values: () => ({ catch: () => {} }) }),
  },
}))

// Mock logger
mock.module(resolve(SRC, "lib/logger"), () => ({
  createLogger: () => ({
    info: () => {},
    debug: () => {},
    error: () => {},
  }),
}))

// ─────────────────────────────────────────────
// Import route + helpers after mocks register
// ─────────────────────────────────────────────

const { _resetDescClient, DescriptionRequestSchema } = await import(
  resolve(SRC, "routes/generate")
)

// Minimal Express-like request/response helpers
function makeReq(body: unknown) {
  return { body } as any
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    _body: null as unknown,
    json(data: unknown) {
      res._body = data
      return res
    },
    status(code: number) {
      res.statusCode = code
      return res
    },
  }
  return res
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("DescriptionRequestSchema", () => {
  test("accepts valid input", () => {
    const result = DescriptionRequestSchema.parse({
      explanation: "Monitors ETH price via Chainlink feeds",
      templateName: "Price Feed Monitor",
      category: "core-defi",
      capabilities: ["price-feed", "alert"],
    })
    expect(result.explanation).toBe("Monitors ETH price via Chainlink feeds")
    expect(result.capabilities).toHaveLength(2)
  })

  test("rejects empty explanation", () => {
    expect(() =>
      DescriptionRequestSchema.parse({
        explanation: "",
        templateName: "Test",
        category: "core-defi",
        capabilities: [],
      }),
    ).toThrow()
  })

  test("rejects missing required fields", () => {
    expect(() =>
      DescriptionRequestSchema.parse({
        explanation: "Something",
      }),
    ).toThrow()
  })

  test("rejects explanation over 2000 chars", () => {
    expect(() =>
      DescriptionRequestSchema.parse({
        explanation: "x".repeat(2001),
        templateName: "Test",
        category: "core-defi",
        capabilities: [],
      }),
    ).toThrow()
  })

  test("rejects capabilities array over 20 items", () => {
    expect(() =>
      DescriptionRequestSchema.parse({
        explanation: "Something",
        templateName: "Test",
        category: "core-defi",
        capabilities: Array.from({ length: 21 }, (_, i) => `cap-${i}`),
      }),
    ).toThrow()
  })
})

describe("generate-description route", () => {
  beforeEach(() => {
    _resetDescClient()
    mockCreate.mockClear()
  })

  test("returns a description from valid input", async () => {
    // Import the router fresh — it's already set up with the mock
    const routeModule = await import(resolve(SRC, "routes/generate"))
    const router = routeModule.default

    // Find the POST /generate-description handler
    const layer = router.stack.find(
      (l: any) => l.route?.path === "/generate-description" && l.route?.methods?.post,
    )
    expect(layer).toBeTruthy()

    // Extract the actual handler (last in the chain, after rate limiter middleware)
    const handlers = layer.route.stack.map((s: any) => s.handle)
    const handler = handlers[handlers.length - 1]

    const req = makeReq({
      explanation: "Monitors ETH price via Chainlink feeds",
      templateName: "Price Feed Monitor",
      category: "core-defi",
      capabilities: ["price-feed", "alert"],
    })

    const res = makeRes()
    const next = mock(() => {})

    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._body).toBeTruthy()
    expect(res._body.description).toBeString()
    expect(res._body.description.length).toBeGreaterThan(0)
    expect(res._body.description.length).toBeLessThan(500)

    // Verify OpenAI was called with correct model
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const callArgs = (mockCreate.mock.calls as any[])[0][0]
    expect(callArgs.model).toBe("gpt-4o-mini")
    expect(callArgs.max_tokens).toBe(150)
    expect(callArgs.temperature).toBe(0.7)
  })

  test("calls next with AppError on OpenAI failure", async () => {
    mockCreate.mockImplementationOnce(() =>
      Promise.reject(new Error("OpenAI API error")),
    )

    const routeModule = await import(resolve(SRC, "routes/generate"))
    const router = routeModule.default

    const layer = router.stack.find(
      (l: any) => l.route?.path === "/generate-description" && l.route?.methods?.post,
    )
    const handlers = layer.route.stack.map((s: any) => s.handle)
    const handler = handlers[handlers.length - 1]

    const req = makeReq({
      explanation: "Monitors ETH price",
      templateName: "Test",
      category: "core-defi",
      capabilities: [],
    })

    const res = makeRes()
    const next = mock(() => {})

    await handler(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    const err = (next.mock.calls as any[])[0][0]
    expect(err.code).toBe("AI_SERVICE_ERROR")
    expect(err.statusCode).toBe(502)
  })

  test("calls next with INVALID_INPUT on bad request body", async () => {
    const routeModule = await import(resolve(SRC, "routes/generate"))
    const router = routeModule.default

    const layer = router.stack.find(
      (l: any) => l.route?.path === "/generate-description" && l.route?.methods?.post,
    )
    const handlers = layer.route.stack.map((s: any) => s.handle)
    const handler = handlers[handlers.length - 1]

    const req = makeReq({ explanation: "" }) // missing fields + empty explanation
    const res = makeRes()
    const next = mock(() => {})

    await handler(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    const err = (next.mock.calls as any[])[0][0]
    expect(err.code).toBe("INVALID_INPUT")
    expect(err.statusCode).toBe(400)
  })
})
