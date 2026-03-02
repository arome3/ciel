import { privateKeyToAccount } from "viem/accounts"
import type { CliConfig } from "./config"
import { authRequired } from "./errors"

export interface AuthContext {
  address: string
  sign: (message: string) => Promise<string>
}

export function requireAuth(config: CliConfig): AuthContext {
  if (!config.privateKey) {
    throw authRequired()
  }

  const key = config.privateKey as `0x${string}`
  const account = privateKeyToAccount(key)

  return {
    address: account.address,
    sign: async (message: string) => {
      return account.signMessage({ message })
    },
  }
}

export function tryAuth(config: CliConfig): AuthContext | null {
  if (!config.privateKey) return null
  try {
    return requireAuth(config)
  } catch {
    return null
  }
}

export async function workflowAuthHeaders(
  auth: AuthContext,
  workflowId: string,
): Promise<Record<string, string>> {
  const signature = await auth.sign(workflowId)
  return {
    "X-Owner-Address": auth.address,
    "X-Owner-Signature": signature,
  }
}

export async function pipelineAuthHeaders(
  auth: AuthContext,
  pipelineId: string,
): Promise<Record<string, string>> {
  const timestamp = String(Date.now())
  const message = `${pipelineId}:${timestamp}`
  const signature = await auth.sign(message)
  return {
    "X-Owner-Address": auth.address,
    "X-Owner-Signature": signature,
    "X-Owner-Timestamp": timestamp,
  }
}
