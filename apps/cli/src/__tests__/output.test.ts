import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { setJsonMode, setNoColor, isJsonMode, json, statusIcon, error } from "../output"

describe("output", () => {
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {})
    errorSpy = spyOn(console, "error").mockImplementation(() => {})
    setJsonMode(false)
    setNoColor(false)
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    setJsonMode(false)
    setNoColor(false)
  })

  describe("json mode", () => {
    it("tracks json mode state", () => {
      expect(isJsonMode()).toBe(false)
      setJsonMode(true)
      expect(isJsonMode()).toBe(true)
      setJsonMode(false)
      expect(isJsonMode()).toBe(false)
    })

    it("outputs valid JSON", () => {
      setJsonMode(true)
      json({ status: "ok", count: 42 })

      expect(logSpy).toHaveBeenCalledTimes(1)
      const output = logSpy.mock.calls[0][0]
      const parsed = JSON.parse(output)
      expect(parsed.status).toBe("ok")
      expect(parsed.count).toBe(42)
    })

    it("pretty-prints JSON with 2-space indent", () => {
      json({ a: 1 })
      const output = logSpy.mock.calls[0][0]
      expect(output).toContain("  ")
      expect(output).toContain("\n")
    })
  })

  describe("error output", () => {
    it("outputs to stderr in human mode", () => {
      error("something went wrong")
      expect(errorSpy).toHaveBeenCalledTimes(1)
      const output = errorSpy.mock.calls[0][0]
      expect(output).toContain("something went wrong")
    })

    it("outputs JSON to stderr in json mode", () => {
      setJsonMode(true)
      error("bad request")
      expect(errorSpy).toHaveBeenCalledTimes(1)
      const output = errorSpy.mock.calls[0][0]
      const parsed = JSON.parse(output)
      expect(parsed.error).toBe("bad request")
    })
  })

  describe("statusIcon", () => {
    it("returns checkmark for success states", () => {
      setNoColor(true)
      expect(statusIcon("success")).toBe("[OK]")
      expect(statusIcon("passed")).toBe("[OK]")
      expect(statusIcon("deployed")).toBe("[OK]")
    })

    it("returns cross for failure states", () => {
      setNoColor(true)
      expect(statusIcon("failed")).toBe("[FAIL]")
      expect(statusIcon("error")).toBe("[FAIL]")
    })

    it("returns pending for in-progress states", () => {
      setNoColor(true)
      expect(statusIcon("pending")).toBe("[..]")
      expect(statusIcon("running")).toBe("[..]")
    })

    it("returns status text for unknown states", () => {
      setNoColor(true)
      expect(statusIcon("custom")).toBe("[custom]")
    })
  })
})
