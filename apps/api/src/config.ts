import { z } from "zod"
import dotenv from "dotenv"

dotenv.config({ path: "../../.env" })

const envSchema = z.object({
  // AI
  OPENAI_API_KEY: z.string().startsWith("sk-"),
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-"),
  GEMINI_API_KEY: z.string(),

  // Blockchain
  PRIVATE_KEY: z.string().startsWith("0x"),
  BASE_SEPOLIA_RPC_URL: z.string().url(),
  ETHERSCAN_API_KEY: z.string().optional(),
  REGISTRY_CONTRACT_ADDRESS: z.string().startsWith("0x"),
  CONSUMER_CONTRACT_ADDRESS: z.string().startsWith("0x"),

  // x402
  WALLET_ADDRESS: z.string().startsWith("0x"),
  X402_FACILITATOR_URL: z.string().url(),

  // App
  API_PORT: z.coerce.number().default(3001),
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:3001"),
  DATABASE_PATH: z.string().default("./data/ciel.db"),
  CRE_CLI_PATH: z.string().default("cre"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Tenderly
  TENDERLY_PROJECT_SLUG: z.string().optional(),
  TENDERLY_VIRTUAL_TESTNET_RPC: z.string().url().optional(),
})

export const config = envSchema.parse(process.env)
export type Config = z.infer<typeof envSchema>
