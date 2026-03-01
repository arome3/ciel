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
    expect(result.entities).toEqual({})
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

  // Wallet-API: balance keyword
  test("wallet-api detected from balance keyword", () => {
    const result = parseIntent("Check wallet balance for whale addresses on Ethereum")
    expect(result.dataSources).toContain("wallet-api")
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

// ─────────────────────────────────────────────
// Expanded Data Source Tests (Doc 21)
// ─────────────────────────────────────────────
describe("parseIntent — expanded data sources", () => {
  test("github-api from pull request keywords (multi-word)", () => {
    const result = parseIntent("Every hour check for new pull request merges on the repository and alert")
    expect(result.dataSources).toContain("github-api")
    expect(result.triggerType).toBe("cron")
  })

  test("news-api from sentiment keywords", () => {
    const result = parseIntent("Monitor Reuters headlines for inflation sentiment and alert when negative")
    expect(result.dataSources).toContain("news-api")
    expect(result.actions).toContain("alert")
  })

  test("sports-api from game keywords (multi-word)", () => {
    const result = parseIntent("Track Super Bowl scores from ESPN and settle prediction market")
    expect(result.dataSources).toContain("sports-api")
  })

  test("social-api from twitter keywords", () => {
    const result = parseIntent("Watch for viral tweets about Ethereum and alert when trending")
    expect(result.dataSources).toContain("social-api")
  })

  test("exchange-api from binance keywords", () => {
    const result = parseIntent("Every 5 minutes check Binance order book depth for ETHUSDT")
    expect(result.dataSources).toContain("exchange-api")
    expect(result.triggerType).toBe("cron")
  })

  test("wallet-api from whale keywords", () => {
    const result = parseIntent("Track whale wallet movements and alert on large transfers")
    expect(result.dataSources).toContain("wallet-api")
  })

  test("compound: news-api + exchange-api detected simultaneously", () => {
    const result = parseIntent("When Bloomberg reports inflation data, check Binance spot prices and rebalance")
    expect(result.dataSources).toContain("news-api")
    expect(result.dataSources).toContain("exchange-api")
  })
})

// ─────────────────────────────────────────────
// Disambiguation Tests
// ─────────────────────────────────────────────
describe("parseIntent — disambiguation", () => {
  test("'risk score' should NOT trigger sports-api", () => {
    const result = parseIntent("Calculate my risk score daily")
    expect(result.dataSources).not.toContain("sports-api")
  })

  test("'address this issue' should NOT trigger wallet-api", () => {
    const result = parseIntent("Address this performance issue in the pipeline")
    expect(result.dataSources).not.toContain("wallet-api")
  })

  test("'work-life balance' should NOT trigger wallet-api", () => {
    const result = parseIntent("Improve work-life balance and productivity")
    expect(result.dataSources).not.toContain("wallet-api")
  })

  test("'pattern match' should NOT trigger sports-api", () => {
    const result = parseIntent("The match was a pattern match in the regex engine")
    expect(result.dataSources).not.toContain("sports-api")
  })

  test("'score' + confirming 'espn' SHOULD trigger sports-api", () => {
    const result = parseIntent("Check live score updates from ESPN every hour")
    expect(result.dataSources).toContain("sports-api")
  })

  test("'balance' + confirming 'whale' SHOULD trigger wallet-api", () => {
    const result = parseIntent("Track whale wallet balance every hour")
    expect(result.dataSources).toContain("wallet-api")
  })

  test("'exchange' + confirming 'binance' SHOULD trigger exchange-api", () => {
    const result = parseIntent("Monitor Binance exchange prices hourly")
    expect(result.dataSources).toContain("exchange-api")
  })

  test("'Track NFL scores from ESPN every hour' → sports-api confirmed", () => {
    const result = parseIntent("Track NFL scores from ESPN every hour")
    expect(result.dataSources).toContain("sports-api")
  })

  test("'Check wallet balance on etherscan for whale' → wallet-api confirmed", () => {
    const result = parseIntent("Check wallet balance on etherscan for whale addresses")
    expect(result.dataSources).toContain("wallet-api")
  })

  test("'Pool resources for the media article' should NOT trigger defi-api or news-api", () => {
    const result = parseIntent("Pool resources for the media article project")
    expect(result.dataSources).not.toContain("defi-api")
    expect(result.dataSources).not.toContain("news-api")
  })
})

// ─────────────────────────────────────────────
// Entity Extraction Tests
// ─────────────────────────────────────────────
describe("parseIntent — entity extraction", () => {
  test("'Check Binance order book' → entities has exchange-api: ['binance']", () => {
    const result = parseIntent("Check Binance order book depth hourly")
    expect(result.entities["exchange-api"]).toContain("binance")
  })

  test("'Monitor Reuters headlines' → entities has news-api: ['reuters']", () => {
    const result = parseIntent("Monitor Reuters headlines for inflation sentiment")
    expect(result.entities["news-api"]).toContain("reuters")
  })

  test("'Compare Binance and Coinbase' → entities has exchange-api with both", () => {
    const result = parseIntent("Compare Binance and Coinbase prices every hour")
    expect(result.entities["exchange-api"]).toContain("binance")
    expect(result.entities["exchange-api"]).toContain("coinbase")
  })

  test("'Monitor ETH price hourly' → entities is empty", () => {
    const result = parseIntent("Monitor ETH price hourly")
    expect(Object.keys(result.entities).length).toBe(0)
  })
})

// ─────────────────────────────────────────────
// Multi-word Boundary Protection Tests
// ─────────────────────────────────────────────
describe("parseIntent — multi-word boundary protection", () => {
  test("'reorder bookmarks daily' should NOT match 'order book'", () => {
    const result = parseIntent("reorder bookmarks daily")
    expect(result.dataSources).not.toContain("exchange-api")
  })

  test("'supermarket delivery tracking' should NOT match 'super bowl'", () => {
    const result = parseIntent("supermarket delivery tracking")
    expect(result.dataSources).not.toContain("sports-api")
  })

  test("'Track Super Bowl scores' SHOULD match sports-api", () => {
    const result = parseIntent("Track Super Bowl scores every hour from ESPN")
    expect(result.dataSources).toContain("sports-api")
  })

  test("'Check order book depth on Binance' SHOULD match exchange-api", () => {
    const result = parseIntent("Check order book depth on Binance every 5 minutes")
    expect(result.dataSources).toContain("exchange-api")
  })
})

// ─────────────────────────────────────────────
// Fuzzy Matching for 4-char Data Source Keywords
// ─────────────────────────────────────────────
describe("parseIntent — fuzzy matching for 4-char keywords", () => {
  test("'gane' fuzzy-corrects to 'game' → sports-api with confirming espn", () => {
    const result = parseIntent("Check espn gane scores hourly")
    expect(result.dataSources).toContain("sports-api")
  })

  test("'newz' fuzzy-corrects to 'news' → news-api with confirming reuters", () => {
    const result = parseIntent("Reuters newz about inflation daily")
    expect(result.dataSources).toContain("news-api")
  })

  test("'gane' alone without confirming keyword should be disambiguated away", () => {
    // "gane" fuzzy-matches "game" but "game" is ambiguous — no confirming keyword
    const result = parseIntent("Check the gane status every hour")
    expect(result.dataSources).not.toContain("sports-api")
  })

  test("'crip' fuzzy-corrects to 'crop' → weather-api", () => {
    const result = parseIntent("Monitor crip insurance payouts when rainfall drops below 50mm")
    expect(result.dataSources).toContain("weather-api")
  })
})

// ─────────────────────────────────────────────
// DEX Swap Detection Tests (Doc 19)
// ─────────────────────────────────────────────
describe("parseIntent — DEX swap detection (Doc 19)", () => {
  test("Template 11: DEX swap detection with price threshold", () => {
    const result = parseIntent("Buy $500 worth of ETH on Uniswap when price drops below $2000")
    expect(result.actions).toContain("dexSwap")
    expect(result.dataSources).toContain("price-feed")
    expect(result.conditions.length).toBeGreaterThan(0)
  })

  test("DEX keywords map to dexSwap action", () => {
    const result = parseIntent("Sell ETH on Uniswap every day")
    expect(result.actions).toContain("dexSwap")
  })
})

// ─────────────────────────────────────────────
// Template 12: Wallet Activity Monitor
// ─────────────────────────────────────────────
describe("parseIntent — wallet activity monitor (Template 12)", () => {
  test("'Watch this wallet for large ETH transfers' → evm_log + wallet-api", () => {
    const result = parseIntent("Watch this wallet for large ETH transfers")
    expect(result.triggerType).toBe("evm_log")
    expect(result.dataSources).toContain("wallet-api")
  })

  test("'Alert me when a whale wallet moves more than 100 ETH' → wallet-api + alert", () => {
    const result = parseIntent("Alert me when a whale wallet moves more than 100 ETH")
    expect(result.dataSources).toContain("wallet-api")
    expect(result.actions).toContain("alert")
  })

  test("'Watch wallet; if it sends ETH to Coinbase, alert me' → wallet-api + alert + entity", () => {
    const result = parseIntent("Watch wallet; if it sends ETH to Coinbase, alert me")
    expect(result.dataSources).toContain("wallet-api")
    expect(result.actions).toContain("alert")
    expect(result.entities["exchange-api"]).toContain("coinbase")
  })

  test("'Monitor whale wallets and sell my ETH if they dump' → wallet-api + dexSwap", () => {
    const result = parseIntent("Monitor whale wallets and sell my ETH on Uniswap if they dump")
    expect(result.dataSources).toContain("wallet-api")
    expect(result.actions).toContain("dexSwap")
  })

  test("'swap' keyword maps to dexSwap, not transfer", () => {
    const result = parseIntent("Swap WETH for USDC when price goes above $3000")
    expect(result.actions).toContain("dexSwap")
    expect(result.actions).not.toContain("transfer")
  })

  test("short keywords 'buy', 'dex', 'amm' detected via word-boundary scan", () => {
    const result = parseIntent("Buy tokens on a dex with low amm slippage")
    expect(result.actions).toContain("dexSwap")
  })

  // ── False positive prevention (disambiguation) ──

  test("'Buy insurance' does NOT trigger dexSwap", () => {
    const result = parseIntent("Buy insurance against flight delay")
    expect(result.actions).not.toContain("dexSwap")
  })

  test("'Sell data feed results' does NOT trigger dexSwap", () => {
    const result = parseIntent("Sell data feed results to consumers onchain")
    expect(result.actions).not.toContain("dexSwap")
  })

  test("'Trade alerts' does NOT trigger dexSwap", () => {
    const result = parseIntent("Trade alerts when price moves more than 5%")
    expect(result.actions).not.toContain("dexSwap")
  })

  test("'dex' alone triggers dexSwap via regex fallback", () => {
    const result = parseIntent("Use a dex to convert my tokens every hour")
    expect(result.actions).toContain("dexSwap")
  })
})

// ─────────────────────────────────────────────
// Template 13-16: New data sources and actions
// ─────────────────────────────────────────────
describe("parseIntent — chainlink-feeds data source (Template 13)", () => {
  test("'Read Chainlink data feed latestAnswer' → chainlink-feeds", () => {
    const result = parseIntent("Read Chainlink data feed latestAnswer every 5 minutes")
    expect(result.dataSources).toContain("chainlink-feeds")
  })

  test("'price proxy' → chainlink-feeds", () => {
    const result = parseIntent("Read price proxy contract for ETH/USD feed")
    expect(result.dataSources).toContain("chainlink-feeds")
  })

  test("'Chainlink price oracle' → chainlink-feeds", () => {
    const result = parseIntent("Query Chainlink price oracle for market data")
    expect(result.dataSources).toContain("chainlink-feeds")
  })

  test("'Chainlink' entity extraction", () => {
    const result = parseIntent("Read Chainlink data feed for price")
    expect(result.entities["chainlink-feeds"]).toContain("chainlink")
  })
})

describe("parseIntent — kv-store data source (Template 14)", () => {
  test("'persist state to S3 storage' → kv-store", () => {
    const result = parseIntent("Persist state to S3 storage with moving average")
    expect(result.dataSources).toContain("kv-store")
  })

  test("'stateful workflow' → kv-store", () => {
    const result = parseIntent("Build a stateful workflow that remembers previous values")
    expect(result.dataSources).toContain("kv-store")
  })

  test("'accumulate values over time' → kv-store", () => {
    const result = parseIntent("Accumulate counter values over time hourly")
    expect(result.dataSources).toContain("kv-store")
  })
})

describe("parseIntent — ccip data source (Template 15)", () => {
  test("'cross-chain transfer using CCIP' → ccip", () => {
    const result = parseIntent("Cross-chain transfer tokens using CCIP from Ethereum to Base")
    expect(result.dataSources).toContain("ccip")
  })

  test("'bridge tokens' → ccip", () => {
    const result = parseIntent("Bridge tokens between Ethereum and Base every hour")
    expect(result.dataSources).toContain("ccip")
  })

  test("'multi-chain token transfer' → ccip", () => {
    const result = parseIntent("Multi-chain token transfer via Chainlink CCIP")
    expect(result.dataSources).toContain("ccip")
  })
})

// ─────────────────────────────────────────────
// Synonym Expansion Tests
// ─────────────────────────────────────────────
describe("parseIntent — synonym expansion", () => {
  test("'crypto went up' triggers price-feed + alert signals", () => {
    const result = parseIntent("Check if my crypto went up and text me")
    expect(result.dataSources).toContain("price-feed")
    expect(result.actions).toContain("alert")
  })

  test("'coin dropped' triggers price-feed via synonym", () => {
    const result = parseIntent("My coin dropped, let me know when it recovers")
    expect(result.dataSources).toContain("price-feed")
    expect(result.actions).toContain("alert")
  })

  test("'keep an eye on' expands to monitor watch", () => {
    const result = parseIntent("Keep an eye on ETH price every hour")
    expect(result.triggerType).toBe("cron")
  })

  test("'pay people' expands to payout distribute", () => {
    const result = parseIntent("Pay people when rainfall drops below 50mm")
    expect(result.actions).toContain("payout")
  })

  test("'cron job' expands to schedule cron", () => {
    const result = parseIntent("Set up a cron job to check prices")
    expect(result.triggerType).toBe("cron")
  })

  test("'blockchain event' expands to event emit log", () => {
    const result = parseIntent("React to a blockchain event when tokens move")
    expect(result.triggerType).toBe("evm_log")
  })

  test("'big transfer' expands to large threshold whale transfer", () => {
    const result = parseIntent("Alert me on big transfers from whale wallets")
    expect(result.dataSources).toContain("wallet-api")
  })

  test("'winners' expands to outcome resolution settle", () => {
    const result = parseIntent("Pay winners after the game ends")
    expect(result.actions).toContain("payout")
  })
})

// ─────────────────────────────────────────────
// Trigger Scores Tests
// ─────────────────────────────────────────────
describe("parseIntent — triggerScores", () => {
  test("triggerScores is populated on non-empty prompt", () => {
    const result = parseIntent("Every 5 minutes check ETH price")
    expect(result.triggerScores).toBeDefined()
    expect(result.triggerScores!.cron).toBeGreaterThan(0)
  })

  test("evm_log prompt has evmLog score > 0", () => {
    const result = parseIntent("Listen for Transfer events on the contract")
    expect(result.triggerScores).toBeDefined()
    expect(result.triggerScores!.evmLog).toBeGreaterThan(0)
  })

  test("dual-trigger prompt has both cron and evmLog > 0", () => {
    const result = parseIntent("Respond to both scheduled cron and on-chain log events")
    expect(result.triggerScores).toBeDefined()
    expect(result.triggerScores!.cron).toBeGreaterThan(0)
    expect(result.triggerScores!.evmLog).toBeGreaterThan(0)
  })

  test("empty prompt has no triggerScores", () => {
    const result = parseIntent("")
    expect(result.triggerScores).toBeUndefined()
  })
})

describe("parseIntent — new actions (evmRead, ccipTransfer)", () => {
  test("'read contract' → evmRead action", () => {
    const result = parseIntent("Read contract state from on-chain data feed")
    expect(result.actions).toContain("evmRead")
  })

  test("'ccip transfer' → ccipTransfer action", () => {
    const result = parseIntent("Do a CCIP transfer of tokens to Base chain")
    expect(result.actions).toContain("ccipTransfer")
  })
})

// ─────────────────────────────────────────────
// Institutional Data Sources (T17-T22)
// ─────────────────────────────────────────────
describe("parseIntent — institutional data sources", () => {
  test("payment-api from 'wire transfer' keywords", () => {
    const result = parseIntent("Initiate wire transfer payments every 4 hours")
    expect(result.dataSources).toContain("payment-api")
  })

  test("payment-api from 'swift' keyword", () => {
    const result = parseIntent("Send SWIFT payment for settled trades")
    expect(result.dataSources).toContain("payment-api")
  })

  test("payment-api from 'remittance' keyword", () => {
    const result = parseIntent("Process remittance payments on a schedule")
    expect(result.dataSources).toContain("payment-api")
  })

  test("settlement-api from 'reconciliation' keyword", () => {
    const result = parseIntent("Run daily reconciliation of on-chain settlements")
    expect(result.dataSources).toContain("settlement-api")
  })

  test("settlement-api from 'clearing' keyword", () => {
    const result = parseIntent("Clearing house settlement verification every hour")
    expect(result.dataSources).toContain("settlement-api")
  })

  test("settlement-api from 'delivery versus payment' via dvp synonym", () => {
    const result = parseIntent("Check DvP settlement status for trades")
    expect(result.dataSources).toContain("settlement-api")
  })

  test("registry-api from 'shareholder' keyword", () => {
    const result = parseIntent("Update shareholder registry when equity transfers occur")
    expect(result.dataSources).toContain("registry-api")
  })

  test("registry-api from 'cap table' via synonym expansion", () => {
    const result = parseIntent("Maintain the cap table on chain with compliance")
    expect(result.dataSources).toContain("registry-api")
  })

  test("registry-api from 'transfer agent' keyword", () => {
    const result = parseIntent("Process share transfers through a digital transfer agent")
    expect(result.dataSources).toContain("registry-api")
  })
})

// ─────────────────────────────────────────────
// Institutional Actions (T17-T22)
// ─────────────────────────────────────────────
describe("parseIntent — institutional actions", () => {
  test("'stablecoin redeem' → burn action (multi-word key)", () => {
    const result = parseIntent("Stablecoin redeem and burn USDC after compliance check")
    expect(result.actions).toContain("burn")
  })

  test("'burn redeem' → burn action (multi-word key)", () => {
    const result = parseIntent("Burn redeem tokens from the stablecoin supply")
    expect(result.actions).toContain("burn")
  })

  test("'token burn' → burn action", () => {
    const result = parseIntent("Process token burn after compliance verification")
    expect(result.actions).toContain("burn")
  })

  test("short 'redeem' alone stays as payout (T6 backward compat)", () => {
    const result = parseIntent("Redeem my fund tokens for NAV value")
    expect(result.actions).toContain("payout")
    expect(result.actions).not.toContain("burn")
  })

  test("'escrow lock' → escrowLock action", () => {
    const result = parseIntent("Escrow lock funds until delivery is confirmed")
    expect(result.actions).toContain("escrowLock")
  })

  test("'release escrow' → escrowRelease action", () => {
    const result = parseIntent("Release escrow when settlement conditions are met")
    expect(result.actions).toContain("escrowRelease")
  })

  test("'initiate payment' → initiatePayment action", () => {
    const result = parseIntent("Initiate payment instruction to the bank gateway")
    expect(result.actions).toContain("initiatePayment")
  })

  test("'distribute dividend' → distribute action (multi-word key)", () => {
    const result = parseIntent("Distribute dividend to all equity holders monthly")
    expect(result.actions).toContain("distribute")
  })

  test("'shareholder payout' → distribute action (multi-word key)", () => {
    const result = parseIntent("Shareholder payout based on pro rata allocation")
    expect(result.actions).toContain("distribute")
  })

  test("short 'distribute' alone stays as payout (backward compat)", () => {
    const result = parseIntent("Distribute rewards to pool participants")
    expect(result.actions).toContain("payout")
  })
})

// ─────────────────────────────────────────────
// Institutional Synonym Expansion
// ─────────────────────────────────────────────
describe("parseIntent — institutional synonym expansion", () => {
  test("'dvp' expands to include settlement keywords", () => {
    const result = parseIntent("Check DvP status for pending trades")
    expect(result.dataSources).toContain("settlement-api")
  })

  test("'pro rata' expands to include distribute/dividend keywords", () => {
    const result = parseIntent("Calculate pro rata payout for shareholders")
    expect(result.actions).toContain("distribute")
  })

  test("'t+1' expands to settlement cycle", () => {
    const result = parseIntent("Verify T+1 settlement completion daily")
    expect(result.dataSources).toContain("settlement-api")
  })

  test("'wire transfer' synonym expands to payment initiation", () => {
    const result = parseIntent("Process wire transfer to counterparty bank")
    expect(result.dataSources).toContain("payment-api")
  })
})

// ─────────────────────────────────────────────
// Negative Disambiguation Tests
// ─────────────────────────────────────────────
describe("parseIntent — negative disambiguation", () => {
  test("'shares data' does NOT trigger nav-api (disambiguation)", () => {
    const result = parseIntent("The service shares data with external systems")
    expect(result.dataSources).not.toContain("nav-api")
  })

  test("'fund shares' DOES trigger nav-api (confirming context)", () => {
    const result = parseIntent("Calculate fund shares for investor redemptions")
    expect(result.dataSources).toContain("nav-api")
  })

  test("'swift' alone maps to payment-api (no false synonym expansion)", () => {
    const result = parseIntent("Process swift banking messages")
    expect(result.dataSources).toContain("payment-api")
  })

  test("'payments' singular retains payment-api signal", () => {
    const result = parseIntent("Set up recurring payments for subscriptions")
    expect(result.dataSources).toContain("payment-api")
  })

  test("escrow + release context → escrowRelease (not escrowLock)", () => {
    const result = parseIntent("Release the escrow after delivery is confirmed")
    expect(result.actions).toContain("escrowRelease")
    expect(result.actions).not.toContain("escrowLock")
  })

  test("escrow + unlock context → escrowRelease (not escrowLock)", () => {
    const result = parseIntent("Unlock the escrow funds for the beneficiary")
    expect(result.actions).toContain("escrowRelease")
    expect(result.actions).not.toContain("escrowLock")
  })

  test("bare 'escrow' without release context → escrowLock (default)", () => {
    const result = parseIntent("Set up an escrow for the property transaction")
    expect(result.actions).toContain("escrowLock")
  })

  test("null-coercion prevention: 'settlement' alone is ambiguous", () => {
    // "settlement" is in AMBIGUOUS_KEYWORDS — needs confirming context
    const result = parseIntent("Track settlement status updates")
    // Should only include settlement-api if there's confirming context
    // "settlement" is ambiguous but appears in DATA_SOURCE_MAP
    // The disambiguation Phase 4 should require confirming keywords
  })
})
