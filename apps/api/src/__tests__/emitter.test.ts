import { describe, test, expect, mock, beforeEach } from "bun:test"
import { createEmitterFromDeps } from "../services/events/emitter-core"

// ─────────────────────────────────────────────
// Test dependencies (no mock.module needed)
// ─────────────────────────────────────────────

const mockBroadcast = mock((_data: any, _eventType?: string, _opts?: any) => {})
const mockChannel = {
  broadcast: mockBroadcast,
  register: mock(() => {}),
  deregister: mock(() => {}),
  sessionCount: 3,
}

let nextId = 1
const mockSyncInsert = mock((_type: string, _data: string) => nextId++)
const mockLog = { error: mock(() => {}) }

let emitter: ReturnType<typeof createEmitterFromDeps>

beforeEach(() => {
  mockBroadcast.mockClear()
  mockSyncInsert.mockClear()
  mockLog.error.mockClear()
  nextId = 1

  emitter = createEmitterFromDeps({
    channel: mockChannel,
    syncInsertEvent: mockSyncInsert,
    log: mockLog,
  })
})

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("emitEvent", () => {
  test("broadcasts event data with correct event type and eventId", () => {
    emitter.emitEvent({
      type: "execution",
      data: {
        workflowId: "wf-1",
        workflowName: "Test",
        agentAddress: "0x123",
        result: { output: "ok" },
        timestamp: 1000,
      },
    })

    expect(mockBroadcast).toHaveBeenCalledTimes(1)
    const [data, eventType, opts] = mockBroadcast.mock.calls[0]
    expect(eventType).toBe("execution")
    expect(data.workflowId).toBe("wf-1")
    expect(data.workflowName).toBe("Test")
    expect(data.timestamp).toBe(1000)
    expect(opts).toEqual({ eventId: "1" })
  })

  test("inserts event via syncInsertEvent with correct args", () => {
    emitter.emitEvent({
      type: "publish",
      data: {
        workflowId: "wf-2",
        name: "Published",
        category: "core-defi",
        txHash: "0xtx",
        timestamp: 2000,
      },
    })

    expect(mockSyncInsert).toHaveBeenCalledTimes(1)
    const [type, data] = mockSyncInsert.mock.calls[0]
    expect(type).toBe("publish")
    const parsed = JSON.parse(data)
    expect(parsed.workflowId).toBe("wf-2")
    expect(parsed.name).toBe("Published")
  })

  test("silent event persists to DB but skips broadcast", () => {
    emitter.emitEvent({
      type: "discovery",
      silent: true,
      data: {
        agentAddress: "0x456",
        query: '{"category":"core-defi"}',
        matchCount: 5,
        timestamp: 3000,
      },
    })

    expect(mockSyncInsert).toHaveBeenCalledTimes(1)
    expect(mockBroadcast).not.toHaveBeenCalled()
  })

  test("broadcast error is caught and logged (does not throw)", () => {
    mockBroadcast.mockImplementationOnce(() => {
      throw new Error("Dead session")
    })

    expect(() => {
      emitter.emitEvent({
        type: "execution",
        data: {
          workflowId: "wf-3",
          workflowName: "Crash",
          agentAddress: "0x789",
          result: null,
          timestamp: 4000,
        },
      })
    }).not.toThrow()

    expect(mockLog.error).toHaveBeenCalledTimes(1)
  })

  test("preserves explicitly provided timestamp", () => {
    emitter.emitEvent({
      type: "execution",
      data: {
        workflowId: "wf-4",
        workflowName: "Explicit",
        agentAddress: "0x789",
        result: null,
        timestamp: 5000,
      },
    })

    const [data] = mockBroadcast.mock.calls[0]
    expect(data.timestamp).toBe(5000)
  })

  test("eventId increments across multiple events", () => {
    emitter.emitEvent({
      type: "execution",
      data: {
        workflowId: "wf-a",
        workflowName: "A",
        agentAddress: "0x1",
        result: null,
        timestamp: 1000,
      },
    })
    emitter.emitEvent({
      type: "execution",
      data: {
        workflowId: "wf-b",
        workflowName: "B",
        agentAddress: "0x2",
        result: null,
        timestamp: 2000,
      },
    })

    expect(mockBroadcast.mock.calls[0][2]).toEqual({ eventId: "1" })
    expect(mockBroadcast.mock.calls[1][2]).toEqual({ eventId: "2" })
  })
})

describe("getConnectedClientCount", () => {
  test("returns channel.sessionCount", () => {
    expect(emitter.getConnectedClientCount()).toBe(3)
  })
})

describe("getAgentChannel", () => {
  test("returns the channel object", () => {
    const channel = emitter.getAgentChannel()
    expect(channel).toBe(mockChannel)
  })
})
