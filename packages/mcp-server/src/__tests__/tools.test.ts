import { describe, test, expect, mock, beforeAll, afterEach } from "bun:test"

// ─────────────────────────────────────────────
// Mock global fetch
// ─────────────────────────────────────────────

const originalFetch = globalThis.fetch
const mockFetch = mock<typeof fetch>()

beforeAll(() => {
  globalThis.fetch = mockFetch as any
})

afterEach(() => {
  mockFetch.mockReset()
})

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const API_URL = "http://localhost:3001"

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

// ─────────────────────────────────────────────
// Tool registry capture
// ─────────────────────────────────────────────

interface RegisteredTool {
  name: string
  description: string
  schema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>
}

const registeredTools: RegisteredTool[] = []

// Minimal McpServer stub that captures tool registrations
const mockServer = {
  tool(
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: RegisteredTool["handler"],
  ) {
    registeredTools.push({ name, description, schema, handler })
  },
}

function getTool(name: string): RegisteredTool {
  const t = registeredTools.find((t) => t.name === name)
  if (!t) throw new Error(`Tool "${name}" not registered`)
  return t
}

// Register tools once
beforeAll(async () => {
  const { registerTools } = await import("../tools")
  registerTools(mockServer as any, API_URL)
})

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("MCP Tool Registration", () => {
  test("registers 3 tools", () => {
    expect(registeredTools).toHaveLength(3)
  })

  test("registers ciel_discover with correct name and description", () => {
    const tool = getTool("ciel_discover")
    expect(tool.description).toContain("Discover")
  })

  test("registers ciel_get_workflow with correct name", () => {
    const tool = getTool("ciel_get_workflow")
    expect(tool.description).toContain("detailed information")
  })

  test("registers ciel_execute with correct name", () => {
    const tool = getTool("ciel_execute")
    expect(tool.description).toContain("Execute")
  })
})

describe("ciel_discover", () => {
  test("sends GET /api/discover and returns workflows", async () => {
    const workflows = [
      { workflowId: "uuid-1", name: "ETH Oracle", category: "core-defi" },
    ]
    mockFetch.mockResolvedValueOnce(jsonResponse(workflows))

    const tool = getTool("ciel_discover")
    const result = await tool.handler({})

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe(`${API_URL}/api/discover`)

    expect(result.isError).toBeUndefined()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe("ETH Oracle")
  })

  test("passes filter query params", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]))

    const tool = getTool("ciel_discover")
    await tool.handler({ category: "core-defi", chain: "base-sepolia" })

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("category=core-defi")
    expect(url).toContain("chain=base-sepolia")
  })

  test("returns isError on API failure", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse("Service unavailable", 503))

    const tool = getTool("ciel_discover")
    const result = await tool.handler({})

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Service unavailable")
  })

  test("returns isError on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"))

    const tool = getTool("ciel_discover")
    const result = await tool.handler({})

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Failed to discover")
  })
})

describe("ciel_get_workflow", () => {
  test("sends GET /api/workflows/{id} and returns detail", async () => {
    const workflow = { id: "uuid-1", name: "ETH Oracle", code: "export default..." }
    mockFetch.mockResolvedValueOnce(jsonResponse(workflow))

    const tool = getTool("ciel_get_workflow")
    const result = await tool.handler({ workflowId: "uuid-1" })

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe(`${API_URL}/api/workflows/uuid-1`)

    expect(result.isError).toBeUndefined()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.name).toBe("ETH Oracle")
  })

  test("returns isError on 404", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse("Workflow not found", 404))

    const tool = getTool("ciel_get_workflow")
    const result = await tool.handler({ workflowId: "nonexistent" })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Workflow not found")
  })
})

describe("ciel_execute", () => {
  test("sends GET to execute endpoint and returns result", async () => {
    const execResult = { success: true, result: { output: "ETH: $3500" }, duration: 1200 }
    mockFetch.mockResolvedValueOnce(jsonResponse(execResult))

    const tool = getTool("ciel_execute")
    const result = await tool.handler({ workflowId: "uuid-1" })

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe(`${API_URL}/api/workflows/uuid-1/execute`)

    expect(result.isError).toBeUndefined()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(true)
  })

  test("returns isError on execution failure", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse("Execution failed", 500))

    const tool = getTool("ciel_execute")
    const result = await tool.handler({ workflowId: "uuid-1" })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Execution failed")
  })
})
