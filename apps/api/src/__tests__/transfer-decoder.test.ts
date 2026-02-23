import { describe, test, expect } from "bun:test"

// ─────────────────────────────────────────────
// Transfer Decoder — Reference Implementation Tests
// ─────────────────────────────────────────────
// Template 12's handler logic runs inside CRE SDK (not importable).
// This file tests a standalone reference implementation of the same
// algorithm: address decoding, direction filtering, threshold
// comparison, and exchange detection.

// ERC-20 Transfer event topic hash: keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

interface TransferDecodeResult {
  matched: boolean
  reason?: string
  from?: string
  to?: string
  value?: string
  isExchange?: boolean
  direction?: "incoming" | "outgoing"
}

interface DecodeConfig {
  watchAddresses: string
  minTransferAmountWei: string
  filterDirection: "incoming" | "outgoing" | "both"
  knownExchangeAddresses: string
}

/**
 * Reference implementation of Template 12's handler decode + filter logic.
 * Pure function — no CRE SDK dependency.
 */
function decodeAndFilterTransferLog(
  topics: string[],
  data: string,
  config: DecodeConfig,
): TransferDecodeResult {
  // Validate topics
  if (topics.length < 3) {
    return { matched: false, reason: "invalid_log_topics" }
  }

  if (topics[0] !== TRANSFER_TOPIC) {
    return { matched: false, reason: "not_transfer_event" }
  }

  // Decode addresses from 32-byte padded topics (take last 20 bytes = 40 hex chars)
  const fromAddress = ("0x" + topics[1].slice(26)).toLowerCase()
  const toAddress = ("0x" + topics[2].slice(26)).toLowerCase()
  const transferValue = BigInt(data)

  // Parse watch list
  const watchSet = new Set(
    config.watchAddresses.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)
  )
  const minAmount = BigInt(config.minTransferAmountWei)

  // Direction filter
  const isFromWatched = watchSet.has(fromAddress)
  const isToWatched = watchSet.has(toAddress)

  let matched = false
  if (config.filterDirection === "incoming") matched = isToWatched
  else if (config.filterDirection === "outgoing") matched = isFromWatched
  else matched = isFromWatched || isToWatched

  if (!matched) {
    return { matched: false, reason: "address_not_watched" }
  }

  // Threshold filter
  if (transferValue < minAmount) {
    return { matched: false, reason: "below_threshold", value: transferValue.toString() }
  }

  // Exchange detection
  const exchangeSet = new Set(
    config.knownExchangeAddresses.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)
  )
  const counterparty = isFromWatched ? toAddress : fromAddress
  const isExchange = exchangeSet.has(counterparty)

  return {
    matched: true,
    from: fromAddress,
    to: toAddress,
    value: transferValue.toString(),
    isExchange,
    direction: isFromWatched ? "outgoing" : "incoming",
  }
}

// ─────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────

const WATCHED_ADDR = "0x1234567890abcdef1234567890abcdef12345678"
const OTHER_ADDR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const EXCHANGE_ADDR = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

// 32-byte padded address: 24 zeros + 20-byte address (without 0x prefix)
const padAddress = (addr: string) => "0x" + "0".repeat(24) + addr.slice(2)

const DEFAULT_CONFIG: DecodeConfig = {
  watchAddresses: WATCHED_ADDR,
  minTransferAmountWei: "1000000000000000000", // 1e18
  filterDirection: "both",
  knownExchangeAddresses: EXCHANGE_ADDR,
}

const makeTopics = (from: string, to: string) => [
  TRANSFER_TOPIC,
  padAddress(from),
  padAddress(to),
]

// 100e18 in hex
const VALUE_100 = "0x" + (BigInt("100000000000000000000")).toString(16)
// 0.5e18 in hex (below default threshold)
const VALUE_HALF = "0x" + (BigInt("500000000000000000")).toString(16)

// ─────────────────────────────────────────────
// Suite 1: Topic Validation
// ─────────────────────────────────────────────

describe("transfer decoder — topic validation", () => {
  test("rejects log with fewer than 3 topics", () => {
    const result = decodeAndFilterTransferLog(
      [TRANSFER_TOPIC, padAddress(WATCHED_ADDR)],
      VALUE_100,
      DEFAULT_CONFIG,
    )
    expect(result.matched).toBe(false)
    expect(result.reason).toBe("invalid_log_topics")
  })

  test("rejects log with empty topics array", () => {
    const result = decodeAndFilterTransferLog([], VALUE_100, DEFAULT_CONFIG)
    expect(result.matched).toBe(false)
    expect(result.reason).toBe("invalid_log_topics")
  })

  test("rejects log with wrong event signature", () => {
    const topics = [
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      padAddress(WATCHED_ADDR),
      padAddress(OTHER_ADDR),
    ]
    const result = decodeAndFilterTransferLog(topics, VALUE_100, DEFAULT_CONFIG)
    expect(result.matched).toBe(false)
    expect(result.reason).toBe("not_transfer_event")
  })
})

// ─────────────────────────────────────────────
// Suite 2: Address Decoding
// ─────────────────────────────────────────────

describe("transfer decoder — address decoding", () => {
  test("correctly extracts from and to addresses from 32-byte padded topics", () => {
    const topics = makeTopics(WATCHED_ADDR, OTHER_ADDR)
    const result = decodeAndFilterTransferLog(topics, VALUE_100, DEFAULT_CONFIG)
    expect(result.matched).toBe(true)
    expect(result.from).toBe(WATCHED_ADDR)
    expect(result.to).toBe(OTHER_ADDR)
  })

  test("case-insensitive address matching", () => {
    const upperAddr = WATCHED_ADDR.toUpperCase().replace("0X", "0x")
    const config = { ...DEFAULT_CONFIG, watchAddresses: upperAddr }
    const topics = makeTopics(WATCHED_ADDR, OTHER_ADDR)
    const result = decodeAndFilterTransferLog(topics, VALUE_100, config)
    // Both config address and decoded address are lowercased
    expect(result.matched).toBe(true)
  })

  test("handles mixed-case addresses in watch list", () => {
    const mixedCase = "0x1234567890ABCDEF1234567890abcdef12345678"
    const config = { ...DEFAULT_CONFIG, watchAddresses: mixedCase }
    const topics = makeTopics(WATCHED_ADDR, OTHER_ADDR)
    const result = decodeAndFilterTransferLog(topics, VALUE_100, config)
    expect(result.matched).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Suite 3: Direction Filtering
// ─────────────────────────────────────────────

describe("transfer decoder — direction filtering", () => {
  test("incoming filter: matches when watched address is recipient", () => {
    const config = { ...DEFAULT_CONFIG, filterDirection: "incoming" as const }
    const topics = makeTopics(OTHER_ADDR, WATCHED_ADDR) // to = watched
    const result = decodeAndFilterTransferLog(topics, VALUE_100, config)
    expect(result.matched).toBe(true)
    expect(result.direction).toBe("incoming")
  })

  test("incoming filter: rejects when watched address is sender", () => {
    const config = { ...DEFAULT_CONFIG, filterDirection: "incoming" as const }
    const topics = makeTopics(WATCHED_ADDR, OTHER_ADDR) // from = watched
    const result = decodeAndFilterTransferLog(topics, VALUE_100, config)
    expect(result.matched).toBe(false)
    expect(result.reason).toBe("address_not_watched")
  })

  test("outgoing filter: matches when watched address is sender", () => {
    const config = { ...DEFAULT_CONFIG, filterDirection: "outgoing" as const }
    const topics = makeTopics(WATCHED_ADDR, OTHER_ADDR) // from = watched
    const result = decodeAndFilterTransferLog(topics, VALUE_100, config)
    expect(result.matched).toBe(true)
    expect(result.direction).toBe("outgoing")
  })

  test("outgoing filter: rejects when watched address is recipient", () => {
    const config = { ...DEFAULT_CONFIG, filterDirection: "outgoing" as const }
    const topics = makeTopics(OTHER_ADDR, WATCHED_ADDR) // to = watched
    const result = decodeAndFilterTransferLog(topics, VALUE_100, config)
    expect(result.matched).toBe(false)
    expect(result.reason).toBe("address_not_watched")
  })

  test("both filter: matches regardless of direction", () => {
    const config = { ...DEFAULT_CONFIG, filterDirection: "both" as const }
    const topicsOut = makeTopics(WATCHED_ADDR, OTHER_ADDR)
    const topicsIn = makeTopics(OTHER_ADDR, WATCHED_ADDR)
    expect(decodeAndFilterTransferLog(topicsOut, VALUE_100, config).matched).toBe(true)
    expect(decodeAndFilterTransferLog(topicsIn, VALUE_100, config).matched).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Suite 4: Threshold Filtering
// ─────────────────────────────────────────────

describe("transfer decoder — threshold filtering", () => {
  test("rejects transfer below minimum threshold", () => {
    const topics = makeTopics(WATCHED_ADDR, OTHER_ADDR)
    const result = decodeAndFilterTransferLog(topics, VALUE_HALF, DEFAULT_CONFIG)
    expect(result.matched).toBe(false)
    expect(result.reason).toBe("below_threshold")
    expect(result.value).toBe("500000000000000000")
  })

  test("accepts transfer exactly at threshold", () => {
    const config = { ...DEFAULT_CONFIG, minTransferAmountWei: "100000000000000000000" }
    const topics = makeTopics(WATCHED_ADDR, OTHER_ADDR)
    const result = decodeAndFilterTransferLog(topics, VALUE_100, config)
    expect(result.matched).toBe(true)
    expect(result.value).toBe("100000000000000000000")
  })

  test("accepts transfer above threshold", () => {
    const topics = makeTopics(WATCHED_ADDR, OTHER_ADDR)
    const result = decodeAndFilterTransferLog(topics, VALUE_100, DEFAULT_CONFIG)
    expect(result.matched).toBe(true)
  })

  test("zero threshold accepts any non-zero transfer", () => {
    const config = { ...DEFAULT_CONFIG, minTransferAmountWei: "0" }
    const topics = makeTopics(WATCHED_ADDR, OTHER_ADDR)
    const result = decodeAndFilterTransferLog(topics, "0x1", config)
    expect(result.matched).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Suite 5: Exchange Detection
// ─────────────────────────────────────────────

describe("transfer decoder — exchange detection", () => {
  test("detects known exchange address as counterparty", () => {
    const topics = makeTopics(WATCHED_ADDR, EXCHANGE_ADDR)
    const result = decodeAndFilterTransferLog(topics, VALUE_100, DEFAULT_CONFIG)
    expect(result.matched).toBe(true)
    expect(result.isExchange).toBe(true)
  })

  test("unknown counterparty is not flagged as exchange", () => {
    const topics = makeTopics(WATCHED_ADDR, OTHER_ADDR)
    const result = decodeAndFilterTransferLog(topics, VALUE_100, DEFAULT_CONFIG)
    expect(result.matched).toBe(true)
    expect(result.isExchange).toBe(false)
  })

  test("handles multiple exchange addresses", () => {
    const exchange2 = "0xcccccccccccccccccccccccccccccccccccccccc"
    const config = {
      ...DEFAULT_CONFIG,
      knownExchangeAddresses: `${EXCHANGE_ADDR}, ${exchange2}`,
    }
    const topics = makeTopics(WATCHED_ADDR, exchange2)
    const result = decodeAndFilterTransferLog(topics, VALUE_100, config)
    expect(result.isExchange).toBe(true)
  })

  test("empty exchange list means no exchange detection", () => {
    const config = { ...DEFAULT_CONFIG, knownExchangeAddresses: "" }
    const topics = makeTopics(WATCHED_ADDR, EXCHANGE_ADDR)
    const result = decodeAndFilterTransferLog(topics, VALUE_100, config)
    expect(result.isExchange).toBe(false)
  })
})
