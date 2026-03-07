import { describe, expect, test } from "bun:test"
import { resolve } from "path"

// Import URL parser and config check directly — no external deps
const clientPath = resolve(import.meta.dir, "../services/github/client.ts")

describe("parseGitHubUrl", () => {
  let parseGitHubUrl: typeof import("../services/github/client").parseGitHubUrl

  test("setup", async () => {
    const mod = await import(clientPath)
    parseGitHubUrl = mod.parseGitHubUrl
  })

  test("parses repo-only URL", () => {
    const result = parseGitHubUrl("https://github.com/octocat/my-repo")
    expect(result).toEqual({
      owner: "octocat",
      repo: "my-repo",
      type: "repo",
    })
  })

  test("parses tree URL (branch root)", () => {
    const result = parseGitHubUrl("https://github.com/octocat/my-repo/tree/main")
    expect(result).toEqual({
      owner: "octocat",
      repo: "my-repo",
      branch: "main",
      path: undefined,
      type: "tree",
    })
  })

  test("parses tree URL with directory path", () => {
    const result = parseGitHubUrl("https://github.com/octocat/my-repo/tree/main/workflows/price")
    expect(result).toEqual({
      owner: "octocat",
      repo: "my-repo",
      branch: "main",
      path: "workflows/price",
      type: "tree",
    })
  })

  test("parses blob URL (single file)", () => {
    const result = parseGitHubUrl("https://github.com/octocat/my-repo/blob/main/wf/main.ts")
    expect(result).toEqual({
      owner: "octocat",
      repo: "my-repo",
      branch: "main",
      path: "wf/main.ts",
      type: "blob",
    })
  })

  test("parses blob URL at repo root", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/blob/develop/main.ts")
    expect(result).toEqual({
      owner: "owner",
      repo: "repo",
      branch: "develop",
      path: "main.ts",
      type: "blob",
    })
  })

  test("rejects non-github.com domain", () => {
    expect(() => parseGitHubUrl("https://gitlab.com/foo/bar")).toThrow("Only github.com")
  })

  test("rejects invalid URL", () => {
    expect(() => parseGitHubUrl("not-a-url")).toThrow("Invalid URL")
  })

  test("rejects URL without owner/repo", () => {
    expect(() => parseGitHubUrl("https://github.com/just-owner")).toThrow("owner and repo")
  })

  test("handles URL with trailing slash", () => {
    const result = parseGitHubUrl("https://github.com/octocat/my-repo/")
    expect(result.owner).toBe("octocat")
    expect(result.repo).toBe("my-repo")
    expect(result.type).toBe("repo")
  })

  test("handles URL with unknown ref type as repo", () => {
    const result = parseGitHubUrl("https://github.com/octocat/my-repo/wiki")
    expect(result.type).toBe("repo")
    expect(result.owner).toBe("octocat")
  })

  test("parses deeply nested blob path", () => {
    const result = parseGitHubUrl("https://github.com/org/repo/blob/feat/v2/src/deep/path/file.ts")
    expect(result.owner).toBe("org")
    expect(result.repo).toBe("repo")
    expect(result.branch).toBe("feat")
    expect(result.path).toBe("v2/src/deep/path/file.ts")
    expect(result.type).toBe("blob")
  })
})

describe("isGitHubConfigured", () => {
  test("returns boolean based on env configuration", async () => {
    const mod = await import(clientPath)
    // Result depends on whether config has GitHub env vars set
    // (may be true if mock leaks from other test files in bun's shared module registry)
    expect(typeof mod.isGitHubConfigured()).toBe("boolean")
  })
})
