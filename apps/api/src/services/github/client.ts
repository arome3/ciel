import { Octokit } from "@octokit/rest"
import { createAppAuth } from "@octokit/auth-app"
import { config } from "../../config"
import { AppError, ErrorCodes } from "../../types/errors"
import { createLogger } from "../../lib/logger"

const log = createLogger("GitHubClient")

// ─────────────────────────────────────────────
// Configuration check
// ─────────────────────────────────────────────

export function isGitHubConfigured(): boolean {
  return !!(
    config.GITHUB_APP_ID &&
    config.GITHUB_APP_PRIVATE_KEY &&
    config.GITHUB_APP_CLIENT_ID &&
    config.GITHUB_APP_CLIENT_SECRET
  )
}

function requireGitHubConfig() {
  if (!isGitHubConfigured()) {
    throw new AppError(
      ErrorCodes.GITHUB_NOT_CONFIGURED,
      501,
      "GitHub App is not configured — set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET",
    )
  }
}

function getPrivateKey(): string {
  // PEM key is base64-encoded in env
  return Buffer.from(config.GITHUB_APP_PRIVATE_KEY!, "base64").toString("utf-8")
}

// ─────────────────────────────────────────────
// App-level Octokit (JWT auth — for installation management)
// ─────────────────────────────────────────────

function getAppOctokit(): Octokit {
  requireGitHubConfig()
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.GITHUB_APP_ID!,
      privateKey: getPrivateKey(),
    },
  })
}

// ─────────────────────────────────────────────
// Installation-level Octokit (scoped to user's repos)
// ─────────────────────────────────────────────

export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  requireGitHubConfig()
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.GITHUB_APP_ID!,
      privateKey: getPrivateKey(),
      installationId,
    },
  })

  // Verify the installation is still valid
  try {
    await octokit.apps.getInstallation({ installation_id: installationId })
  } catch (err: unknown) {
    const status = (err as { status?: number }).status
    if (status === 404 || status === 401) {
      throw new AppError(
        ErrorCodes.GITHUB_AUTH_FAILED,
        401,
        "GitHub App installation is no longer valid — please reconnect",
      )
    }
    throw err
  }

  return octokit
}

// ─────────────────────────────────────────────
// Get installation details (for callback)
// ─────────────────────────────────────────────

export async function getInstallationAccount(installationId: number): Promise<string> {
  requireGitHubConfig()
  const appOctokit = getAppOctokit()
  try {
    const { data } = await appOctokit.apps.getInstallation({
      installation_id: installationId,
    })
    return (data.account as { login: string })?.login ?? "unknown"
  } catch (err: unknown) {
    log.error("Failed to get installation account", { err })
    throw new AppError(
      ErrorCodes.GITHUB_AUTH_FAILED,
      401,
      "Invalid GitHub App installation",
    )
  }
}

// ─────────────────────────────────────────────
// List repos accessible to installation
// ─────────────────────────────────────────────

export interface GitHubRepo {
  owner: string
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
}

export async function listRepos(installationId: number): Promise<GitHubRepo[]> {
  const octokit = await getInstallationOctokit(installationId)
  try {
    const { data } = await octokit.apps.listReposAccessibleToInstallation({
      per_page: 100,
    })
    return data.repositories.map((r) => ({
      owner: r.owner?.login ?? "",
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch ?? "main",
    }))
  } catch (err: unknown) {
    log.error("Failed to list repos", { err })
    throw new AppError(ErrorCodes.GITHUB_API_ERROR, 502, "Failed to list GitHub repos")
  }
}

// ─────────────────────────────────────────────
// Create repo
// ─────────────────────────────────────────────

export async function createRepo(
  installationId: number,
  name: string,
  isPrivate: boolean,
): Promise<{ owner: string; name: string; defaultBranch: string }> {
  const octokit = await getInstallationOctokit(installationId)
  try {
    const { data } = await octokit.repos.createForAuthenticatedUser({
      name,
      private: isPrivate,
      auto_init: true,
      description: "CRE workflows managed by Ciel",
    })
    return {
      owner: data.owner.login,
      name: data.name,
      defaultBranch: data.default_branch ?? "main",
    }
  } catch (err: unknown) {
    const status = (err as { status?: number }).status
    if (status === 422) {
      throw new AppError(ErrorCodes.GITHUB_API_ERROR, 409, `Repository "${name}" already exists`)
    }
    log.error("Failed to create repo", { err })
    throw new AppError(ErrorCodes.GITHUB_API_ERROR, 502, "Failed to create GitHub repo")
  }
}

// ─────────────────────────────────────────────
// Atomic commit (Git Trees API)
// ─────────────────────────────────────────────

export interface FileEntry {
  path: string
  content: string
}

export interface AtomicCommitResult {
  commitSha: string
  commitUrl: string
  filesCreated: string[]
}

export async function atomicCommit(
  installationId: number,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  files: FileEntry[],
): Promise<AtomicCommitResult> {
  const octokit = await getInstallationOctokit(installationId)

  try {
    // 1. Get current branch HEAD
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    })
    const headSha = refData.object.sha

    // 2. Get the tree SHA of the HEAD commit
    const { data: commitData } = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: headSha,
    })
    const baseTreeSha = commitData.tree.sha

    // 3. Create blobs for each file
    const treeEntries = await Promise.all(
      files.map(async (f) => {
        const { data: blob } = await octokit.git.createBlob({
          owner,
          repo,
          content: Buffer.from(f.content).toString("base64"),
          encoding: "base64",
        })
        return {
          path: f.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        }
      }),
    )

    // 4. Create tree with all blobs
    const { data: tree } = await octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: treeEntries,
    })

    // 5. Create commit
    const { data: commit } = await octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: tree.sha,
      parents: [headSha],
    })

    // 6. Update branch ref
    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
    })

    return {
      commitSha: commit.sha,
      commitUrl: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
      filesCreated: files.map((f) => f.path),
    }
  } catch (err: unknown) {
    const status = (err as { status?: number }).status
    if (status === 404) {
      throw new AppError(
        ErrorCodes.GITHUB_REPO_NOT_FOUND,
        404,
        `Repository ${owner}/${repo} not found or branch "${branch}" doesn't exist`,
      )
    }
    log.error("Atomic commit failed", { err, owner, repo, branch })
    throw new AppError(ErrorCodes.GITHUB_API_ERROR, 502, "Failed to push to GitHub")
  }
}

// ─────────────────────────────────────────────
// Create branch
// ─────────────────────────────────────────────

export async function createBranch(
  installationId: number,
  owner: string,
  repo: string,
  branchName: string,
  fromBranch: string,
): Promise<void> {
  const octokit = await getInstallationOctokit(installationId)
  try {
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${fromBranch}`,
    })
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: refData.object.sha,
    })
  } catch (err: unknown) {
    const status = (err as { status?: number }).status
    if (status === 422) {
      throw new AppError(ErrorCodes.GITHUB_API_ERROR, 409, `Branch "${branchName}" already exists`)
    }
    log.error("Failed to create branch", { err })
    throw new AppError(ErrorCodes.GITHUB_API_ERROR, 502, "Failed to create branch")
  }
}

// ─────────────────────────────────────────────
// Get file content (for import)
// ─────────────────────────────────────────────

const MAX_FILE_SIZE = 500 * 1024 // 500KB

export async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<string> {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ...(ref && { ref }),
    })

    if (Array.isArray(data) || data.type !== "file") {
      throw new AppError(
        ErrorCodes.GITHUB_IMPORT_FAILED,
        400,
        `Path "${path}" is not a file`,
      )
    }

    if (data.size > MAX_FILE_SIZE) {
      throw new AppError(
        ErrorCodes.GITHUB_IMPORT_FAILED,
        400,
        `File exceeds 500KB size limit (${Math.round(data.size / 1024)}KB)`,
      )
    }

    return Buffer.from(data.content, "base64").toString("utf-8")
  } catch (err: unknown) {
    if (err instanceof AppError) throw err
    const status = (err as { status?: number }).status
    if (status === 404) {
      throw new AppError(
        ErrorCodes.GITHUB_REPO_NOT_FOUND,
        404,
        `File "${path}" not found in ${owner}/${repo}`,
      )
    }
    log.error("Failed to get file content", { err })
    throw new AppError(ErrorCodes.GITHUB_API_ERROR, 502, "Failed to fetch file from GitHub")
  }
}

// ─────────────────────────────────────────────
// URL parsing
// ─────────────────────────────────────────────

export interface ParsedGitHubUrl {
  owner: string
  repo: string
  branch?: string
  path?: string
  type: "repo" | "tree" | "blob"
}

export function parseGitHubUrl(url: string): ParsedGitHubUrl {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new AppError(
      ErrorCodes.GITHUB_IMPORT_FAILED,
      400,
      "Invalid URL format",
    )
  }

  if (parsed.hostname !== "github.com") {
    throw new AppError(
      ErrorCodes.GITHUB_IMPORT_FAILED,
      400,
      "Only github.com URLs are supported",
    )
  }

  // Remove leading slash and split
  const parts = parsed.pathname.slice(1).split("/").filter(Boolean)

  if (parts.length < 2) {
    throw new AppError(
      ErrorCodes.GITHUB_IMPORT_FAILED,
      400,
      "URL must include owner and repo (https://github.com/owner/repo)",
    )
  }

  const owner = parts[0]
  const repo = parts[1]

  // https://github.com/owner/repo
  if (parts.length === 2) {
    return { owner, repo, type: "repo" }
  }

  const refType = parts[2] // "tree" or "blob"
  if (refType !== "tree" && refType !== "blob") {
    return { owner, repo, type: "repo" }
  }

  if (parts.length < 4) {
    throw new AppError(
      ErrorCodes.GITHUB_IMPORT_FAILED,
      400,
      "URL missing branch name",
    )
  }

  const branch = parts[3]
  const filePath = parts.slice(4).join("/") || undefined

  return {
    owner,
    repo,
    branch,
    path: filePath,
    type: refType as "tree" | "blob",
  }
}

// ─────────────────────────────────────────────
// Unauthenticated Octokit (for public repos)
// ─────────────────────────────────────────────

export function getPublicOctokit(): Octokit {
  return new Octokit()
}
