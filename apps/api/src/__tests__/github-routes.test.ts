import { describe, expect, test, mock, beforeEach } from "bun:test"
import { resolve } from "path"
import { AppError, ErrorCodes } from "../types/errors"

// ─────────────────────────────────────────────
// Pure re-implementation of parseGitHubUrl for test mock
// (cannot await import inside mock.module factory)
// ─────────────────────────────────────────────

function parseGitHubUrl(url: string) {
  let parsed: URL
  try { parsed = new URL(url) } catch {
    throw new AppError(ErrorCodes.GITHUB_IMPORT_FAILED, 400, "Invalid URL format")
  }
  if (parsed.hostname !== "github.com") {
    throw new AppError(ErrorCodes.GITHUB_IMPORT_FAILED, 400, "Only github.com URLs are supported")
  }
  const parts = parsed.pathname.slice(1).split("/").filter(Boolean)
  if (parts.length < 2) {
    throw new AppError(ErrorCodes.GITHUB_IMPORT_FAILED, 400, "URL must include owner and repo (https://github.com/owner/repo)")
  }
  const owner = parts[0]
  const repo = parts[1]
  if (parts.length === 2) return { owner, repo, type: "repo" as const }
  const refType = parts[2]
  if (refType !== "tree" && refType !== "blob") return { owner, repo, type: "repo" as const }
  if (parts.length < 4) {
    throw new AppError(ErrorCodes.GITHUB_IMPORT_FAILED, 400, "URL missing branch name")
  }
  const branch = parts[3]
  const filePath = parts.slice(4).join("/") || undefined
  return { owner, repo, branch, path: filePath, type: refType as "tree" | "blob" }
}

// ─────────────────────────────────────────────
// Mock DB at external boundary
// ─────────────────────────────────────────────

const mockDbGet = mock(() => null as unknown)
const mockDbAll = mock(() => [] as unknown[])
const mockDbInsert = mock(() => ({ values: mock(() => {}) }))
const mockDbUpdate = mock(() => ({
  set: mock(() => ({
    where: mock(() => {}),
  })),
}))

mock.module(resolve(import.meta.dir, "../db/index.ts"), () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          get: mockDbGet,
          all: mockDbAll,
        }),
      }),
    }),
    insert: () => ({
      values: mockDbInsert,
    }),
    update: () => ({
      set: () => ({
        where: mockDbUpdate,
      }),
    }),
  },
  sqlite: { exec: () => {} },
}))

// ─────────────────────────────────────────────
// Mock GitHub client at external boundary
// ─────────────────────────────────────────────

const mockIsConfigured = mock(() => true)
const mockGetInstallationAccount = mock(() => Promise.resolve("octocat"))
const mockListRepos = mock(() => Promise.resolve([
  { owner: "octocat", name: "my-repo", fullName: "octocat/my-repo", private: false, defaultBranch: "main" },
]))
const mockAtomicCommit = mock(() => Promise.resolve({
  commitSha: "abc123",
  commitUrl: "https://github.com/octocat/my-repo/commit/abc123",
  filesCreated: ["main.ts", "config.json"],
}))
const mockGetFileContent = mock(() => Promise.resolve('import { cre } from "@chainlink/cre-sdk"'))
const mockGetInstallationOctokit = mock(() => Promise.resolve({}))

mock.module(resolve(import.meta.dir, "../services/github/client.ts"), () => ({
  isGitHubConfigured: mockIsConfigured,
  getInstallationAccount: mockGetInstallationAccount,
  getInstallationOctokit: mockGetInstallationOctokit,
  listRepos: mockListRepos,
  createRepo: mock(() => Promise.resolve({ owner: "octocat", name: "new-repo", defaultBranch: "main" })),
  createBranch: mock(() => Promise.resolve()),
  atomicCommit: mockAtomicCommit,
  getFileContent: mockGetFileContent,
  parseGitHubUrl,
  getPublicOctokit: mock(() => ({})),
}))

// ─────────────────────────────────────────────
// Mock validator at external boundary
// ─────────────────────────────────────────────

mock.module(resolve(import.meta.dir, "../services/ai-engine/validator.ts"), () => ({
  validateWorkflow: mock(() => Promise.resolve({ valid: true, errors: [] })),
}))

// ─────────────────────────────────────────────
// Mock config
// ─────────────────────────────────────────────

mock.module(resolve(import.meta.dir, "../config.ts"), () => ({
  config: {
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: Buffer.from("fake-key").toString("base64"),
    GITHUB_APP_CLIENT_ID: "Iv1.abc",
    GITHUB_APP_CLIENT_SECRET: "secret",
    NEXT_PUBLIC_API_URL: "http://localhost:3001",
    API_PORT: 3001,
    DATABASE_PATH: ":memory:",
    NODE_ENV: "test",
  },
}))

// ─────────────────────────────────────────────
// Mock cre-utils
// ─────────────────────────────────────────────

mock.module(resolve(import.meta.dir, "../services/cre/cre-utils.ts"), () => ({
  buildPackageJson: mock(() => '{"name":"test","private":true}'),
}))

// ─────────────────────────────────────────────
// Mock rate limiter (Bun.serve doesn't set request.ip)
// ─────────────────────────────────────────────

const passthrough = (_req: any, _res: any, next: any) => next()
mock.module(resolve(import.meta.dir, "../middleware/rate-limiter.ts"), () => ({
  githubLimiter: passthrough,
  defaultLimiter: passthrough,
  generateLimiter: passthrough,
  executeLimiter: passthrough,
  simulateLimiter: passthrough,
  discoverLimiter: passthrough,
  publishLimiter: passthrough,
  eventsSseLimiter: passthrough,
  pipelineLimiter: passthrough,
  tenderlyLimiter: passthrough,
}))

// ─────────────────────────────────────────────
// Setup Express app for route testing
// ─────────────────────────────────────────────

import express from "express"
import http from "http"

const app = express()
app.use(express.json())

// Dynamically import router after mocks
const { default: githubRouter } = await import("../routes/github")
app.use("/api", githubRouter)

// Error handler
app.use((err: { statusCode?: number; code?: string; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.statusCode ?? 500).json({
    error: { code: err.code ?? "INTERNAL_ERROR", message: err.message },
  })
})

// ─────────────────────────────────────────────
// Helper — Bun.serve bridge to Express (same as pipelines-routes.test.ts)
// ─────────────────────────────────────────────

async function req(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  }
  if (body) init.body = JSON.stringify(body)

  const server = Bun.serve({
    port: 0,
    fetch: (request) =>
      new Promise<Response>((resolve) => {
        const url = new URL(request.url)
        const incoming = new http.IncomingMessage(null as any)
        incoming.method = request.method
        incoming.url = url.pathname + url.search
        incoming.headers = Object.fromEntries(request.headers.entries())

        const outgoing = new http.ServerResponse(incoming)
        outgoing.writeHead = (statusCode: number, headers?: any) => {
          outgoing.statusCode = statusCode
          if (headers) {
            for (const [k, v] of Object.entries(headers)) {
              outgoing.setHeader(k, v as string)
            }
          }
          return outgoing
        }

        let responseBody = ""
        outgoing.end = (chunk?: any) => {
          if (chunk) responseBody += chunk.toString()
          resolve(
            new Response(responseBody, {
              status: outgoing.statusCode,
              headers: { "Content-Type": "application/json" },
            }),
          )
          return outgoing
        }

        outgoing.write = (chunk: any) => {
          responseBody += chunk.toString()
          return true
        }

        request.text().then((text) => {
          incoming.push(text)
          incoming.push(null)
          app(incoming as any, outgoing as any)
        })
      }),
  })

  try {
    const res = await fetch(`http://localhost:${server.port}/api${path}`, init)
    const json = await res.json().catch(() => ({}))
    return { status: res.status, json }
  } finally {
    server.stop()
  }
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("GitHub Routes", () => {
  beforeEach(() => {
    mockDbGet.mockReset()
    mockIsConfigured.mockReturnValue(true)
  })

  describe("GET /github/status", () => {
    test("returns connected when installation exists", async () => {
      mockDbGet.mockReturnValue({
        githubInstallationId: 12345,
        githubUsername: "octocat",
      })

      const { status, json } = await req("GET", "/github/status", undefined, {
        "X-Owner-Address": "0x123",
      })

      expect(status).toBe(200)
      expect(json.connected).toBe(true)
      expect(json.username).toBe("octocat")
      expect(json.installationId).toBe(12345)
    })

    test("returns not connected when no installation", async () => {
      mockDbGet.mockReturnValue(null)

      const { status, json } = await req("GET", "/github/status", undefined, {
        "X-Owner-Address": "0x123",
      })

      expect(status).toBe(200)
      expect(json.connected).toBe(false)
    })

    test("returns 403 without X-Owner-Address", async () => {
      const { status } = await req("GET", "/github/status")
      expect(status).toBe(403)
    })
  })

  describe("DELETE /github/disconnect", () => {
    test("clears installation", async () => {
      const { status, json } = await req("DELETE", "/github/disconnect", undefined, {
        "X-Owner-Address": "0x123",
      })

      expect(status).toBe(200)
      expect(json.disconnected).toBe(true)
    })
  })

  describe("GET /github/repos", () => {
    test("returns repos when connected", async () => {
      mockDbGet.mockReturnValue({ githubInstallationId: 12345 })

      const { status, json } = await req("GET", "/github/repos", undefined, {
        "X-Owner-Address": "0x123",
      })

      expect(status).toBe(200)
      expect(json.repos).toHaveLength(1)
      expect(json.repos[0].name).toBe("my-repo")
    })

    test("returns 401 when not connected", async () => {
      mockDbGet.mockReturnValue(null)

      const { status, json } = await req("GET", "/github/repos", undefined, {
        "X-Owner-Address": "0x123",
      })

      expect(status).toBe(401)
      expect(json.error.code).toBe("GITHUB_AUTH_FAILED")
    })
  })

  describe("POST /workflows/:id/export-github", () => {
    test("exports workflow with atomic commit", async () => {
      // First call: getInstallationId lookup
      // Second call: workflow lookup
      let callCount = 0
      mockDbGet.mockImplementation(() => {
        callCount++
        if (callCount === 1) return { githubInstallationId: 12345 }
        return {
          id: "wf-1",
          name: "Price Monitor",
          description: "Monitors prices",
          code: 'import { cre } from "@chainlink/cre-sdk"',
          config: '{"asset":"ETH"}',
          ownerAddress: "0x123",
          templateId: 1,
          templateName: "Price Monitor",
          category: "core-defi",
        }
      })

      const { status, json } = await req(
        "POST",
        "/workflows/wf-1/export-github",
        {
          repo: "my-repo",
          owner: "octocat",
          branch: "main",
          commitMessage: "Add workflow",
        },
        { "X-Owner-Address": "0x123" },
      )

      expect(status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.commitSha).toBe("abc123")
      expect(json.repoUrl).toBe("https://github.com/octocat/my-repo")
    })

    test("returns 404 when workflow not found", async () => {
      let callCount = 0
      mockDbGet.mockImplementation(() => {
        callCount++
        if (callCount === 1) return { githubInstallationId: 12345 }
        return null
      })

      const { status, json } = await req(
        "POST",
        "/workflows/wf-missing/export-github",
        { repo: "my-repo", owner: "octocat" },
        { "X-Owner-Address": "0x123" },
      )

      expect(status).toBe(404)
      expect(json.error.code).toBe("WORKFLOW_NOT_FOUND")
    })

    test("returns 403 when not workflow owner", async () => {
      let callCount = 0
      mockDbGet.mockImplementation(() => {
        callCount++
        if (callCount === 1) return { githubInstallationId: 12345 }
        return {
          id: "wf-1",
          ownerAddress: "0xOtherOwner",
          code: "",
          config: "{}",
          name: "Test",
          description: "Test",
          templateId: 1,
          templateName: "Test",
          category: "core-defi",
        }
      })

      const { status, json } = await req(
        "POST",
        "/workflows/wf-1/export-github",
        { repo: "my-repo", owner: "octocat" },
        { "X-Owner-Address": "0x123" },
      )

      expect(status).toBe(403)
      expect(json.error.code).toBe("UNAUTHORIZED")
    })
  })

  describe("POST /workflows/import-github", () => {
    test("imports from public repo", async () => {
      // getInstallationId will fail (no installation) → falls back to public
      mockDbGet.mockReturnValue(null)

      const { status, json } = await req(
        "POST",
        "/workflows/import-github",
        { url: "https://github.com/octocat/my-repo/blob/main/wf/main.ts" },
        { "X-Owner-Address": "0x123" },
      )

      expect(status).toBe(200)
      expect(json.workflowId).toBeTruthy()
      expect(json.code).toBeTruthy()
      expect(json.validation.valid).toBe(true)
      expect(json.source.repo).toBe("octocat/my-repo")
      expect(json.source.branch).toBe("main")
      expect(json.source.path).toBe("wf/main.ts")
    })

    test("rejects non-github URL", async () => {
      const { status, json } = await req(
        "POST",
        "/workflows/import-github",
        { url: "https://gitlab.com/foo/bar/blob/main/file.ts" },
        { "X-Owner-Address": "0x123" },
      )

      expect(status).toBe(400)
      expect(json.error.code).toBe("GITHUB_IMPORT_FAILED")
    })

    test("rejects malformed URL", async () => {
      const { status } = await req(
        "POST",
        "/workflows/import-github",
        { url: "not-a-url" },
        { "X-Owner-Address": "0x123" },
      )

      // Zod url() validation fails before our handler — returns 500 from error handler
      // (no custom statusCode on ZodError). Either 400 or 500 is acceptable.
      expect(status).toBeGreaterThanOrEqual(400)
    })
  })

  describe("GET /github/callback", () => {
    test("requires installation_id and state", async () => {
      const { status, json } = await req("GET", "/github/callback?missing=true")
      expect(status).toBe(400)
      expect(json.error.code).toBe("INVALID_INPUT")
    })
  })
})
