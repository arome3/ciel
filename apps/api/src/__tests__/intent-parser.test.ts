import { describe, test, expect } from "bun:test"
import { parseIntent } from "../services/ai-engine/intent-parser"

describe("parseIntent", () => {
  // ── Test 1: Empty defaults ──
  test("empty string returns safe defaults", () => {
    const result = parseIntent("")
    expect(result.triggerType).toBe("unknown")
    expect(result.confidence).toBe(0)
    expect(result.chains).toEqual(["base-sepolia"])
    expect(result.actions).toEqual(["evmWrite"])
    expect(result.keywords).toEqual([])
    expect(result.dataSources).toEqual([])
    expect(result.conditions).toEqual([])
    expect(result.schedule).toBeUndefined()
    expect(result.negated).toBe(false)
  })

  // ── Test 2: Cron + schedule ──
  test("detects cron trigger with schedule", () => {
    const result = parseIntent("Every 5 minutes check ETH price")
    expect(result.triggerType).toBe("cron")
    expect(result.schedule).toBe("*/5 * * * *")
    expect(result.dataSources).toContain("price-feed")
    expect(result.confidence).toBeGreaterThan(0)
  })

  // ── Test 3: Quality gate — 15min schedule ──
  test("15-minute schedule with price-feed data source", () => {
    const result = parseIntent("Every 15 minutes check ETH price and alert if below $2000")
    expect(result.triggerType).toBe("cron")
    expect(result.schedule).toBe("*/15 * * * *")
    expect(result.dataSources).toContain("price-feed")
    expect(result.confidence).toBeGreaterThan(0)
  })

  // ── Test 4: HTTP trigger ──
  test("detects HTTP trigger", () => {
    const result = parseIntent("When a deposit request arrives, mint stablecoins")
    expect(result.triggerType).toBe("http")
    expect(result.actions).toContain("mint")
    expect(result.confidence).toBeGreaterThan(0)
  })

  // ── Test 5: EVM log trigger ──
  test("detects EVM log trigger", () => {
    const result = parseIntent("Listen for Transfer events on the contract")
    expect(result.triggerType).toBe("evm_log")
    expect(result.confidence).toBeGreaterThan(0)
  })

  // ── Test 6: Chain extraction ──
  test("extracts chain from prompt", () => {
    const result = parseIntent("Deploy a price oracle on Arbitrum")
    expect(result.chains).toContain("arbitrum-sepolia")
  })

  // ── Test 7: Default chain ──
  test("defaults to base-sepolia when no chain mentioned", () => {
    const result = parseIntent("Monitor price every hour and send alert")
    expect(result.chains).toContain("base-sepolia")
  })

  // ── Test 8: Conditions ──
  test("extracts conditions", () => {
    const result = parseIntent("Alert me when ETH drops below $3000")
    expect(result.conditions.length).toBeGreaterThan(0)
    expect(result.conditions[0]).toMatch(/drops below.*3000/)
  })

  // ── Test 9: Multi-AI data source ──
  test("detects multi-AI data source", () => {
    const result = parseIntent("Query GPT and Claude for consensus oracle")
    expect(result.dataSources).toContain("multi-ai")
  })

  // ── Test 10: Long input ──
  test("handles very long input without error", () => {
    const longPrompt = "monitor ETH price ".repeat(200)
    const result = parseIntent(longPrompt)
    expect(result.triggerType).toBe("cron")
    expect(result).toBeDefined()
  })

  // ── Test 11: Price monitoring (Template 1) ──
  test("Template 1: Price monitoring", () => {
    const result = parseIntent("Monitor ETH price every minute and alert when it drops below $1800")
    expect(result.triggerType).toBe("cron")
    expect(result.dataSources).toContain("price-feed")
    expect(result.actions).toContain("alert")
    expect(result.conditions.length).toBeGreaterThan(0)
  })

  // ── Test 12: Parametric insurance (Template 7) ──
  test("Template 7: Parametric insurance", () => {
    const result = parseIntent("Create crop insurance with payout when rainfall drops below 50mm")
    expect(result.dataSources).toContain("weather-api")
    expect(result.actions).toContain("payout")
  })

  // ── Test 13: Multi-AI consensus (Template 9) ──
  test("Template 9: Multi-AI consensus", () => {
    const result = parseIntent("Ask GPT, Claude, and Gemini for ETH price and publish consensus onchain")
    expect(result.dataSources).toContain("multi-ai")
    expect(result.dataSources).toContain("price-feed")
    expect(result.actions).toContain("evmWrite")
  })

  // ── Test 14: Hourly schedule ──
  test("hourly schedule shorthand", () => {
    const result = parseIntent("Check status hourly and update records")
    expect(result.schedule).toBe("0 * * * *")
    expect(result.triggerType).toBe("cron")
  })

  // ── Test 15: Daily schedule ──
  test("daily schedule shorthand", () => {
    const result = parseIntent("Run a daily report on portfolio balances")
    expect(result.schedule).toBe("0 0 * * *")
    expect(result.triggerType).toBe("cron")
  })

  // ── Test 16: Daily at time ──
  test("daily at specific time schedule", () => {
    const result = parseIntent("Every day at 9am check market status and send report")
    expect(result.schedule).toBe("0 9 * * *")
    expect(result.triggerType).toBe("cron")
  })

  // ── Test 17: Multi-chain / cross-chain ──
  test("cross-chain keyword adds base-sepolia and ethereum-sepolia", () => {
    const result = parseIntent("Build a cross-chain bridge monitor for token transfers")
    expect(result.chains).toContain("base-sepolia")
    expect(result.chains).toContain("ethereum-sepolia")
  })
})

// ─────────────────────────────────────────────
// NLP Enhancement Tests
// ─────────────────────────────────────────────
describe("parseIntent — typo tolerance (fuzzy matching)", () => {
  test("schedule typo: 'minuets' → 'minutes'", () => {
    const result = parseIntent("Every 5 minuets check ETH price")
    expect(result.schedule).toBe("*/5 * * * *")
    expect(result.triggerType).toBe("cron")
  })

  test("schedule typo: 'housr' → 'hours'", () => {
    const result = parseIntent("Every 2 housr check portfolio balance")
    expect(result.schedule).toBe("0 */2 * * *")
  })

  test("action fuzzy: 'trasfer' → 'transfer'", () => {
    const result = parseIntent("Trasfer tokens to another wallet on Base")
    expect(result.actions).toContain("transfer")
  })

  test("data source fuzzy: 'prcice' → 'price'", () => {
    const result = parseIntent("Check prcice of BTC every hour")
    expect(result.dataSources).toContain("price-feed")
  })

  test("chain fuzzy: 'Etherem' → 'ethereum'", () => {
    const result = parseIntent("Deploy oracle on Etherem network")
    expect(result.chains).toContain("ethereum-sepolia")
  })
})

describe("parseIntent — abbreviation expansion", () => {
  test("'min' expands to 'minute' for schedule", () => {
    const result = parseIntent("Every 10 min check ETH price")
    expect(result.schedule).toBe("*/10 * * * *")
    expect(result.triggerType).toBe("cron")
  })

  test("'hr' expands to 'hour' for schedule", () => {
    const result = parseIntent("Every 1 hr update balances")
    expect(result.schedule).toBe("0 * * * *")
  })

  test("'mins' expands to 'minutes' for schedule", () => {
    const result = parseIntent("Every 30 mins poll price data")
    expect(result.schedule).toBe("*/30 * * * *")
  })

  test("'msg' expands to 'message' for action detection", () => {
    const result = parseIntent("Send a msg when ETH drops below $2000")
    expect(result.actions).toContain("alert")
  })
})

describe("parseIntent — stemming (morphological variants)", () => {
  test("'monitoring' stems to match 'monitor' signal", () => {
    const result = parseIntent("Start monitoring BTC prices continuously")
    expect(result.triggerType).toBe("cron")
    expect(result.dataSources).toContain("price-feed")
  })

  test("'pays out' detected via stemmed 'pay' → payout", () => {
    const result = parseIntent("Insurance pays out when rainfall drops below threshold")
    expect(result.actions).toContain("payout")
  })

  test("'listened' stems to match 'listen' signal", () => {
    const result = parseIntent("We listened for Transfer events on the contract yesterday")
    expect(result.triggerType).toBe("evm_log")
  })

  test("'distributing' stems to match 'distribute' action", () => {
    const result = parseIntent("Handle distributing rewards to stakers hourly")
    expect(result.actions).toContain("payout")
  })
})

describe("parseIntent — negation detection", () => {
  test("negated prompt has reduced confidence and negated flag", () => {
    const normal = parseIntent("Check the ETH price every hour")
    const negated = parseIntent("Do NOT check the ETH price every hour")
    expect(negated.confidence).toBeLessThan(normal.confidence)
    expect(negated.negated).toBe(true)
    expect(normal.negated).toBe(false)
  })

  test("'Stop monitoring' has reduced confidence and negated flag", () => {
    const result = parseIntent("Stop monitoring ETH price feed")
    expect(result.confidence).toBeLessThan(0.5)
    expect(result.negated).toBe(true)
  })

  test("negated prompt still extracts structure", () => {
    // Even negated, we still extract what they're talking about
    const result = parseIntent("Never check the price or send alerts")
    expect(result.triggerType).toBe("cron") // structural detection still works
    expect(result.confidence).toBeLessThan(0.5) // but confidence is penalized
  })

  test("non-negated prompt has full confidence", () => {
    const result = parseIntent("Every 5 minutes check ETH price")
    expect(result.confidence).toBeGreaterThan(0.5)
  })
})

describe("parseIntent — combined NLP stress tests", () => {
  test("slang with abbreviation: 'check dat eth every 10 min'", () => {
    const result = parseIntent("yo check dat eth bag every 10 min no cap")
    expect(result.schedule).toBe("*/10 * * * *")
    expect(result.chains).toContain("ethereum-sepolia")
  })

  test("typo + abbreviation: 'every 5 mins chekc prcice'", () => {
    const result = parseIntent("Every 5 mins chekc ETH prcice")
    expect(result.schedule).toBe("*/5 * * * *")
    expect(result.dataSources).toContain("price-feed")
  })

  test("multiple typos still produce valid output", () => {
    const result = parseIntent("Monotor BTC prize hourly and alrt if below $3000")
    expect(result).toBeDefined()
    expect(result.triggerType).not.toBe("unknown")
  })

  test("XSS-style input produces safe output", () => {
    const result = parseIntent('<script>alert("xss")</script> check ETH price every hour')
    expect(result.triggerType).toBe("cron")
    expect(result.dataSources).toContain("price-feed")
    // The word "alert" from the XSS should be detected as an action
    expect(result.actions).toContain("alert")
  })

  test("SQL-ish input produces valid output", () => {
    const result = parseIntent("Every 5 minutes; DROP TABLE workflows; check price")
    expect(result.schedule).toBe("*/5 * * * *")
    expect(result.triggerType).toBe("cron")
  })
})

// ─────────────────────────────────────────────
// Template Coverage Tests — from product spec §Template Selection Logic
// ─────────────────────────────────────────────
describe("parseIntent — full template coverage", () => {
  // Template 2: Cross-Chain Portfolio Rebalancer
  test("Template 2: portfolio rebalancing with yield monitoring", () => {
    const result = parseIntent("Rebalance my portfolio across chains when yield drops below 5%")
    expect(result.actions).toContain("rebalance")
    expect(result.dataSources).toContain("defi-api")
    expect(result.conditions.length).toBeGreaterThan(0)
  })

  // Template 3: AI Prediction Market Settlement
  test("Template 3: prediction market settlement", () => {
    const result = parseIntent("Settle prediction market outcomes for BTC reaching 100k")
    expect(result.actions).toContain("evmWrite")
    expect(result.dataSources).toContain("prediction-market")
  })

  // Template 4: Stablecoin Issuance Pipeline
  test("Template 4: stablecoin issuance with compliance", () => {
    const result = parseIntent("Mint stablecoins when compliance passes and reserves are sufficient")
    expect(result.actions).toContain("mint")
    expect(result.dataSources).toContain("compliance-api")
    expect(result.dataSources).toContain("reserve-api")
  })

  // Template 5: Proof of Reserve Monitor
  test("Template 5: proof of reserve monitoring", () => {
    const result = parseIntent("Monitor collateralization ratio and alert if under-collateralized")
    expect(result.dataSources).toContain("reserve-api")
    expect(result.actions).toContain("alert")
  })

  // Template 6: Tokenized Fund Lifecycle
  test("Template 6: tokenized fund with NAV and redemptions", () => {
    const result = parseIntent("Process fund redemptions and calculate NAV daily")
    expect(result.dataSources).toContain("nav-api")
    expect(result.actions).toContain("payout")
    expect(result.triggerType).toBe("cron")
  })

  // Template 8: Compliance-Gated DeFi Operations
  test("Template 8: compliance-gated operations", () => {
    const result = parseIntent("Gate DeFi operations behind KYC and AML checks on Base")
    expect(result.dataSources).toContain("compliance-api")
    expect(result.actions).toContain("evmWrite")
  })

  // Template 10: Custom Data Feed / NAV Oracle
  test("Template 10: custom oracle data feed", () => {
    const result = parseIntent("Aggregate custom data feeds and publish oracle values onchain")
    expect(result.dataSources).toContain("price-feed")
    expect(result.actions).toContain("evmWrite")
  })

  // DeFi-specific: liquidity pool monitoring
  test("DeFi: liquidity pool yield monitoring", () => {
    const result = parseIntent("Monitor liquidity pool APY every hour and rebalance if below 3%")
    expect(result.dataSources).toContain("defi-api")
    expect(result.actions).toContain("rebalance")
    expect(result.triggerType).toBe("cron")
  })

  // Consolidation action (cross-chain)
  test("cross-chain asset consolidation", () => {
    const result = parseIntent("Consolidate USDC from Ethereum and Arbitrum to Base when total drops below 10000")
    expect(result.actions).toContain("transfer")
    expect(result.chains).toContain("base-sepolia")
  })
})
