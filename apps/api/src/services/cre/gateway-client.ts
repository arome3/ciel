// apps/api/src/services/cre/gateway-client.ts
// CRE Gateway client — triggers deployed workflows on the Chainlink DON.
// Ported from smartcontractkit/cre_x402_smartcon_demo (Python reference).

import { createHash, randomUUID } from "crypto"
import { privateKeyToAccount } from "viem/accounts"
import { config } from "../../config"
import { AppError, ErrorCodes } from "../../types/errors"
import { createLogger } from "../../lib/logger"

const log = createLogger("Gateway")

const GATEWAY_TIMEOUT_MS = 30_000

// ── Types ──

export interface GatewayExecutionResult {
  jsonrpc: string
  id: string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// ── Trigger Account ──

function getTriggerAccount() {
  const key = config.CRE_HTTP_TRIGGER_KEY ?? config.PRIVATE_KEY
  return privateKeyToAccount(key as `0x${string}`)
}

// ── Helpers ──

/** Recursive sorted-keys JSON — matches Python json.dumps(sort_keys=True, separators=(',',':')) */
export function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj)
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`
  const sorted = Object.keys(obj as Record<string, unknown>).sort()
  const pairs = sorted.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`,
  )
  return `{${pairs.join(",")}}`
}

/** SHA-256 hex digest */
export function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex")
}

/** Base64url encode (no padding) */
function base64url(buf: Buffer): string {
  return buf.toString("base64url")
}

// ── JWT ──

/**
 * Create a JWT with {"alg":"ETH","typ":"JWT"} header.
 * Payload digest is SHA-256 of the stable-stringified request body.
 * Signature is EIP-191 over `<header>.<payload>` with v adjusted to 0/1.
 */
export async function createGatewayJWT(
  request: Record<string, unknown>,
): Promise<string> {
  const account = getTriggerAccount()

  const header = { alg: "ETH", typ: "JWT" }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    digest: `0x${sha256Hex(stableStringify(request))}`,
    exp: now + 300,
    iat: now,
    iss: account.address,
    jti: randomUUID(),
  }

  const headerB64 = base64url(Buffer.from(JSON.stringify(header)))
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)))
  const rawMessage = `${headerB64}.${payloadB64}`

  // EIP-191 sign the raw message string
  const sig = await account.signMessage({ message: rawMessage })

  // sig is a 0x-prefixed 65-byte hex string (r[32] + s[32] + v[1])
  const sigBytes = Buffer.from(sig.slice(2), "hex")

  // Adjust v from 27/28 to 0/1 (matching Python reference)
  if (sigBytes[64] >= 27) {
    sigBytes[64] -= 27
  }

  const sigB64 = base64url(sigBytes)
  return `${rawMessage}.${sigB64}`
}

// ── Gateway Trigger ──

/**
 * Trigger a deployed workflow on the DON via CRE Gateway.
 * Returns the JSON-RPC response synchronously (DON waits for BFT consensus).
 */
export async function triggerWorkflow(
  donWorkflowId: string,
  input?: Record<string, unknown>,
): Promise<GatewayExecutionResult> {
  if (!config.CRE_GATEWAY_URL) {
    throw new AppError(
      ErrorCodes.GATEWAY_ERROR,
      503,
      "CRE Gateway URL not configured",
    )
  }

  const request: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "workflows.execute",
    params: {
      input: input ?? {},
      workflow: { workflowID: donWorkflowId },
    },
  }

  const jwt = await createGatewayJWT(request)
  const body = stableStringify(request)

  log.info(`Triggering DON workflow ${donWorkflowId}`)

  let res: Response
  try {
    res = await fetch(config.CRE_GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${jwt}`,
      },
      body,
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new AppError(
        ErrorCodes.GATEWAY_TIMEOUT,
        504,
        `CRE Gateway request timed out after ${GATEWAY_TIMEOUT_MS}ms`,
      )
    }
    throw new AppError(
      ErrorCodes.GATEWAY_ERROR,
      502,
      `CRE Gateway request failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!res.ok) {
    let detail = ""
    try {
      const errBody = await res.json()
      detail = errBody.error?.message ?? JSON.stringify(errBody).slice(0, 300)
    } catch {
      detail = `HTTP ${res.status}`
    }
    throw new AppError(
      ErrorCodes.GATEWAY_ERROR,
      res.status >= 500 ? 502 : res.status,
      `CRE Gateway error: ${detail}`,
    )
  }

  let result: GatewayExecutionResult
  try {
    result = await res.json() as GatewayExecutionResult
  } catch {
    throw new AppError(
      ErrorCodes.GATEWAY_ERROR,
      502,
      "CRE Gateway returned invalid JSON",
    )
  }

  if (result.error) {
    throw new AppError(
      ErrorCodes.GATEWAY_ERROR,
      502,
      `CRE Gateway RPC error: ${result.error.message}`,
      result.error,
    )
  }

  log.info(`DON workflow ${donWorkflowId} executed successfully`)
  return result
}
