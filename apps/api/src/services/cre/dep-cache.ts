import { mkdtemp, writeFile, rm, symlink, access } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createLogger } from "../../lib/logger"

const log = createLogger("CRE DepCache")

let cacheDir: string | null = null
let cachePromise: Promise<void> | null = null

const PACKAGE_JSON = JSON.stringify(
  {
    name: "ciel-dep-cache",
    private: true,
    dependencies: {
      "@chainlink/cre-sdk": "^1.0.7",
      zod: "^3.22.0",
    },
  },
  null,
  2,
)

export async function warmDependencyCache(): Promise<void> {
  // Idempotent — second call returns the same promise
  if (cachePromise) return cachePromise

  cachePromise = (async () => {
    const dir = await mkdtemp(join(tmpdir(), "ciel-dep-cache-"))
    await writeFile(join(dir, "package.json"), PACKAGE_JSON, "utf-8")

    log.info(`Warming dependency cache in ${dir}`)

    const proc = Bun.spawn(["bun", "install"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      log.warn(`Dependency cache warm failed (exit ${exitCode}): ${stderr.slice(0, 200)}`)
      // Don't set cacheDir — linkCachedDeps will return false
      // Reset promise so next call retries
      cachePromise = null
      return
    }

    cacheDir = dir
    log.info("Dependency cache ready")
  })()

  return cachePromise
}

export async function linkCachedDeps(targetDir: string): Promise<boolean> {
  if (!cacheDir) return false

  try {
    const source = join(cacheDir, "node_modules")
    // Verify source exists before symlinking
    await access(source)
    await symlink(source, join(targetDir, "node_modules"), "dir")
    log.debug(`Linked cached deps into ${targetDir}`)
    return true
  } catch {
    log.debug("Cache link failed, falling back to fresh install")
    return false
  }
}

export async function cleanupDependencyCache(): Promise<void> {
  if (cacheDir) {
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {})
    cacheDir = null
    cachePromise = null
    log.info("Dependency cache cleaned up")
  }
}
