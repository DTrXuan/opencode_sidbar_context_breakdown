import { describe, expect, test } from "bun:test"

// ─── Token estimation helpers ────────────────────────────────────────────────

const estimateTokens = (chars: number) => Math.ceil(chars / 4)

const charsFromUserPart = (part: any): { text: number; file: number; agent: number } => {
  if (part.type === "text") return { text: part.text.length, file: 0, agent: 0 }
  if (part.type === "file") return { text: 0, file: part.source?.text?.value?.length ?? 0, agent: 0 }
  if (part.type === "agent") return { text: 0, file: 0, agent: part.source?.value?.length ?? 0 }
  return { text: 0, file: 0, agent: 0 }
}

const charsFromAssistantPart = (part: any): {
  text: number
  reasoning: number
  tool: { name: string; chars: number } | null
} => {
  if (part.type === "text") return { text: part.text.length, reasoning: 0, tool: null }
  if (part.type === "reasoning") return { text: 0, reasoning: part.text?.length ?? 0, tool: null }
  if (part.type !== "tool") return { text: 0, reasoning: 0, tool: null }

  const toolName = part.tool ?? "unknown"
  const inputKeys = Object.keys(part.state?.input ?? {}).length * 16
  const status = part.state?.status
  let chars = inputKeys

  if (status === "pending") chars += part.state?.raw?.length ?? 0
  else if (status === "completed") chars += part.state?.output?.length ?? 0
  else if (status === "error") chars += part.state?.error?.length ?? 0

  return { text: 0, reasoning: 0, tool: { name: toolName, chars } }
}

const truncateName = (name: string, maxLen: number = 20) =>
  name.length > maxLen ? name.slice(0, maxLen - 3) + "..." : name

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Token Estimation", () => {
  describe("estimateTokens", () => {
    test("returns ceil(chars/4)", () => {
      expect(estimateTokens(0)).toBe(0)
      expect(estimateTokens(1)).toBe(1)
      expect(estimateTokens(4)).toBe(1)
      expect(estimateTokens(5)).toBe(2)
      expect(estimateTokens(100)).toBe(25)
      expect(estimateTokens(101)).toBe(26)
    })

    test("handles large numbers", () => {
      expect(estimateTokens(10000)).toBe(2500)
      expect(estimateTokens(999999)).toBe(250000)
    })
  })

  describe("charsFromUserPart", () => {
    test("counts text part", () => {
      const part = { type: "text", text: "hello world" }
      expect(charsFromUserPart(part)).toEqual({ text: 11, file: 0, agent: 0 })
    })

    test("counts file part", () => {
      const part = {
        type: "file",
        source: { text: { value: "file content here" } },
      }
      expect(charsFromUserPart(part)).toEqual({ text: 0, file: 17, agent: 0 })
    })

    test("counts agent part", () => {
      const part = {
        type: "agent",
        source: { value: "agent output" },
      }
      expect(charsFromUserPart(part)).toEqual({ text: 0, file: 0, agent: 12 })
    })

    test("handles missing source data", () => {
      expect(charsFromUserPart({ type: "file" })).toEqual({ text: 0, file: 0, agent: 0 })
      expect(charsFromUserPart({ type: "agent" })).toEqual({ text: 0, file: 0, agent: 0 })
    })

    test("returns zeros for unknown part type", () => {
      expect(charsFromUserPart({ type: "unknown" })).toEqual({ text: 0, file: 0, agent: 0 })
    })

    test("handles empty text", () => {
      expect(charsFromUserPart({ type: "text", text: "" })).toEqual({ text: 0, file: 0, agent: 0 })
    })
  })

  describe("charsFromAssistantPart", () => {
    test("counts text part", () => {
      const part = { type: "text", text: "response text" }
      expect(charsFromAssistantPart(part)).toEqual({ text: 13, reasoning: 0, tool: null })
    })

    test("counts reasoning part", () => {
      const part = { type: "reasoning", text: "thinking..." }
      expect(charsFromAssistantPart(part)).toEqual({ text: 0, reasoning: 11, tool: null })
    })

    test("counts tool part with pending status", () => {
      const part = {
        type: "tool",
        tool: "bash",
        state: {
          input: { command: "ls", description: "list" },
          status: "pending",
          raw: "executing command",
        },
      }
      const result = charsFromAssistantPart(part)
      expect(result.text).toBe(0)
      expect(result.reasoning).toBe(0)
      expect(result.tool).toEqual({ name: "bash", chars: 32 + 17 }) // 2 keys * 16 + raw length
    })

    test("counts tool part with completed status", () => {
      const part = {
        type: "tool",
        tool: "read",
        state: {
          input: { filePath: "/path" },
          status: "completed",
          output: "file contents",
        },
      }
      const result = charsFromAssistantPart(part)
      expect(result.tool).toEqual({ name: "read", chars: 16 + 13 }) // 1 key * 16 + output length
    })

    test("counts tool part with error status", () => {
      const part = {
        type: "tool",
        tool: "edit",
        state: {
          input: {},
          status: "error",
          error: "file not found",
        },
      }
      const result = charsFromAssistantPart(part)
      expect(result.tool).toEqual({ name: "edit", chars: 0 + 14 }) // 0 keys + error length
    })

    test("handles tool with no name", () => {
      const part = {
        type: "tool",
        state: { input: {}, status: "completed", output: "test" },
      }
      const result = charsFromAssistantPart(part)
      expect(result.tool?.name).toBe("unknown")
    })

    test("handles missing state data", () => {
      const part = { type: "tool", tool: "test" }
      const result = charsFromAssistantPart(part)
      expect(result.tool).toEqual({ name: "test", chars: 0 })
    })

    test("returns zeros for unknown part type", () => {
      expect(charsFromAssistantPart({ type: "unknown" })).toEqual({ text: 0, reasoning: 0, tool: null })
    })

    test("handles empty text", () => {
      expect(charsFromAssistantPart({ type: "text", text: "" })).toEqual({ text: 0, reasoning: 0, tool: null })
    })

    test("handles empty reasoning", () => {
      expect(charsFromAssistantPart({ type: "reasoning" })).toEqual({ text: 0, reasoning: 0, tool: null })
    })
  })

  describe("truncateName", () => {
    test("returns name unchanged if under limit", () => {
      expect(truncateName("short")).toBe("short")
      expect(truncateName("exactly20characters!")).toBe("exactly20characters!")
    })

    test("truncates name to maxLen with ellipsis", () => {
      expect(truncateName("this_is_a_very_long_tool_name")).toBe("this_is_a_very_lo...")
      expect(truncateName("abcdefghijklmnopqrstuvwxyz")).toBe("abcdefghijklmnopq...")
    })

    test("respects custom maxLen", () => {
      expect(truncateName("hello world", 8)).toBe("hello...")
      expect(truncateName("test", 10)).toBe("test")
    })

    test("handles edge cases", () => {
      expect(truncateName("")).toBe("")
      expect(truncateName("a", 1)).toBe("a")
      expect(truncateName("ab", 1)).toBe("...")
    })
  })
})

describe("Scaling Logic", () => {
  test("scales down when estimate exceeds actual", () => {
    const estTotal = 1000
    const actualInput = 800
    const scale = estTotal > actualInput && estTotal > 0 ? actualInput / estTotal : 1
    
    expect(scale).toBe(0.8)
    expect(Math.round(100 * scale)).toBe(80)
    expect(Math.round(500 * scale)).toBe(400)
  })

  test("no scaling when estimate equals actual", () => {
    const estTotal = 1000
    const actualInput = 1000
    const scale = estTotal > actualInput && estTotal > 0 ? actualInput / estTotal : 1
    
    expect(scale).toBe(1)
  })

  test("no scaling when estimate is less than actual", () => {
    const estTotal = 800
    const actualInput = 1000
    const scale = estTotal > actualInput && estTotal > 0 ? actualInput / estTotal : 1
    
    expect(scale).toBe(1)
  })

  test("handles zero estimate", () => {
    const estTotal = 0
    const actualInput = 1000
    const scale = estTotal > actualInput && estTotal > 0 ? actualInput / estTotal : 1
    
    expect(scale).toBe(1)
  })

  test("handles zero actual input", () => {
    const estTotal = 1000
    const actualInput = 0
    const scale = estTotal > actualInput && estTotal > 0 ? actualInput / estTotal : 1
    
    expect(scale).toBe(0)
  })
})

describe("Data Aggregation", () => {
  test("aggregates user message parts", () => {
    const parts = [
      { type: "text", text: "hello" },
      { type: "file", source: { text: { value: "content" } } },
      { type: "agent", source: { value: "output" } },
    ]

    const result = parts.reduce(
      (acc, p) => {
        const c = charsFromUserPart(p)
        return {
          text: acc.text + c.text,
          file: acc.file + c.file,
          agent: acc.agent + c.agent,
        }
      },
      { text: 0, file: 0, agent: 0 },
    )

    expect(result).toEqual({ text: 5, file: 7, agent: 6 })
  })

  test("aggregates assistant message parts", () => {
    const parts = [
      { type: "text", text: "response" },
      { type: "reasoning", text: "thinking" },
      { type: "tool", tool: "bash", state: { input: {}, status: "completed", output: "done" } },
    ]

    const result = parts.reduce(
      (acc, p) => {
        const c = charsFromAssistantPart(p)
        if (c.tool) {
          const existing = acc.tools.get(c.tool.name) ?? { count: 0, chars: 0 }
          acc.tools.set(c.tool.name, {
            count: existing.count + 1,
            chars: existing.chars + c.tool.chars,
          })
        }
        return {
          text: acc.text + c.text,
          reasoning: acc.reasoning + c.reasoning,
          tools: acc.tools,
        }
      },
      { text: 0, reasoning: 0, tools: new Map() },
    )

    expect(result.text).toBe(8)
    expect(result.reasoning).toBe(8)
    expect(result.tools.get("bash")).toEqual({ count: 1, chars: 4 })
  })

  test("aggregates multiple tool calls by name", () => {
    const parts = [
      { type: "tool", tool: "read", state: { input: {}, status: "completed", output: "a" } },
      { type: "tool", tool: "read", state: { input: {}, status: "completed", output: "bb" } },
      { type: "tool", tool: "edit", state: { input: {}, status: "completed", output: "ccc" } },
    ]

    const tools = new Map<string, { count: number; chars: number }>()
    
    parts.forEach((p) => {
      const c = charsFromAssistantPart(p)
      if (c.tool) {
        const existing = tools.get(c.tool.name) ?? { count: 0, chars: 0 }
        tools.set(c.tool.name, {
          count: existing.count + 1,
          chars: existing.chars + c.tool.chars,
        })
      }
    })

    expect(tools.get("read")).toEqual({ count: 2, chars: 3 })
    expect(tools.get("edit")).toEqual({ count: 1, chars: 3 })
  })

  test("creates top 3 tools + other aggregate", () => {
    const tools = [
      { name: "read", count: 10, tokens: 1000 },
      { name: "edit", count: 8, tokens: 800 },
      { name: "bash", count: 5, tokens: 500 },
      { name: "grep", count: 3, tokens: 300 },
      { name: "glob", count: 2, tokens: 200 },
    ]

    const sorted = tools.sort((a, b) => b.tokens - a.tokens)
    const topTools = sorted.slice(0, 3)
    const otherTools = sorted.slice(3)

    if (otherTools.length > 0) {
      topTools.push({
        name: "other",
        count: otherTools.reduce((sum, t) => sum + t.count, 0),
        tokens: otherTools.reduce((sum, t) => sum + t.tokens, 0),
      })
    }

    expect(topTools).toHaveLength(4)
    expect(topTools[0].name).toBe("read")
    expect(topTools[1].name).toBe("edit")
    expect(topTools[2].name).toBe("bash")
    expect(topTools[3]).toEqual({ name: "other", count: 5, tokens: 500 })
  })

  test("no other aggregate when <= 3 tools", () => {
    const tools = [
      { name: "read", count: 10, tokens: 1000 },
      { name: "edit", count: 8, tokens: 800 },
    ]

    const sorted = tools.sort((a, b) => b.tokens - a.tokens)
    const topTools = sorted.slice(0, 3)
    const otherTools = sorted.slice(3)

    if (otherTools.length > 0) {
      topTools.push({
        name: "other",
        count: otherTools.reduce((sum, t) => sum + t.count, 0),
        tokens: otherTools.reduce((sum, t) => sum + t.tokens, 0),
      })
    }

    expect(topTools).toHaveLength(2)
    expect(topTools.find((t) => t.name === "other")).toBeUndefined()
  })
})

describe("Percentage Calculations", () => {
  test("calculates percentage correctly", () => {
    const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
    
    expect(pct(50, 100)).toBe(50)
    expect(pct(1, 100)).toBe(1)
    expect(pct(99, 100)).toBe(99)
    expect(pct(33, 100)).toBe(33)
  })

  test("rounds percentages", () => {
    const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
    
    expect(pct(1, 3)).toBe(33) // 33.333... rounds to 33
    expect(pct(2, 3)).toBe(67) // 66.666... rounds to 67
    expect(pct(1, 6)).toBe(17) // 16.666... rounds to 17
  })

  test("handles zero total", () => {
    const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
    
    expect(pct(100, 0)).toBe(0)
    expect(pct(0, 0)).toBe(0)
  })

  test("filters out < 1% values", () => {
    const input = 10000
    const iPct = (n: number) => (input > 0 ? Math.round((n / input) * 100) : 0)
    
    expect(iPct(50)).toBe(1) // 0.5% rounds to 1%
    expect(iPct(49)).toBe(0) // 0.49% rounds to 0%
    expect(iPct(1)).toBe(0)
  })
})

describe("Average Calculations", () => {
  test("calculates per-message average", () => {
    const totalTokens = 1000
    const messageCount = 10
    const avg = messageCount > 0 ? Math.round(totalTokens / messageCount) : 0
    
    expect(avg).toBe(100)
  })

  test("calculates per-user-message average", () => {
    const userTokens = 600
    const userCount = 3
    const avg = userCount > 0 ? Math.round(userTokens / userCount) : 0
    
    expect(avg).toBe(200)
  })

  test("calculates per-assistant-message average", () => {
    const assistantTokens = 400
    const assistantCount = 2
    const avg = assistantCount > 0 ? Math.round(assistantTokens / assistantCount) : 0
    
    expect(avg).toBe(200)
  })

  test("handles zero count", () => {
    const tokens = 1000
    const count = 0
    const avg = count > 0 ? Math.round(tokens / count) : 0
    
    expect(avg).toBe(0)
  })
})

describe("Edge Cases", () => {
  test("handles empty messages array", () => {
    const messages: any[] = []
    const totalMessages = messages.length
    const userMessages = messages.filter((m) => m.role === "user").length
    const assistantMessages = messages.filter((m) => m.role === "assistant").length
    
    expect(totalMessages).toBe(0)
    expect(userMessages).toBe(0)
    expect(assistantMessages).toBe(0)
  })

  test("handles zero tokens", () => {
    const tokens = 0
    const pct = (n: number) => (tokens > 0 ? Math.round((n / tokens) * 100) : 0)
    
    expect(pct(100)).toBe(0)
    expect(pct(0)).toBe(0)
  })

  test("handles very large numbers", () => {
    const chars = 1000000
    const tokens = estimateTokens(chars)
    
    expect(tokens).toBe(250000)
    expect(tokens.toLocaleString()).toBe("250,000")
  })

  test("handles context window percentage", () => {
    const tokens = 50000
    const contextLimit = 200000
    const pct = Math.round((tokens / contextLimit) * 100)
    
    expect(pct).toBe(25)
  })

  test("handles missing context limit", () => {
    const contextLimit = null
    const pct = contextLimit ? Math.round((50000 / contextLimit) * 100) : null
    
    expect(pct).toBeNull()
  })
})

describe("Mode Cycling", () => {
  test("cycles through modes: expanded → compact → ultra → expanded", () => {
    let mode = "expanded"
    
    // expanded → compact
    mode = mode === "expanded" ? "compact" : mode === "compact" ? "ultra" : "expanded"
    expect(mode).toBe("compact")
    
    // compact → ultra
    mode = mode === "expanded" ? "compact" : mode === "compact" ? "ultra" : "expanded"
    expect(mode).toBe("ultra")
    
    // ultra → expanded
    mode = mode === "expanded" ? "compact" : mode === "compact" ? "ultra" : "expanded"
    expect(mode).toBe("expanded")
  })

  test("mode indicators", () => {
    const getIndicator = (mode: string) => 
      mode === "expanded" ? "▼" : mode === "compact" ? "▶" : "⊟"
    
    expect(getIndicator("expanded")).toBe("▼")
    expect(getIndicator("compact")).toBe("▶")
    expect(getIndicator("ultra")).toBe("⊟")
  })
})

describe("Number Formatting", () => {
  test("formats numbers with locale", () => {
    expect((1000).toLocaleString()).toBe("1,000")
    expect((1000000).toLocaleString()).toBe("1,000,000")
    expect((42).toLocaleString()).toBe("42")
  })

  test("formats currency", () => {
    const money = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    })
    
    expect(money.format(1.5)).toBe("$1.50")
    expect(money.format(0.001)).toBe("$0.00")
    expect(money.format(100)).toBe("$100.00")
  })
})

describe("Integration: Full Token Estimation Flow", () => {
  test("estimates and scales tokens for complete message set", () => {
    // Simulate a conversation
    const systemPrompt = "You are a helpful assistant."
    const userParts = [
      { type: "text", text: "Hello, can you help me?" },
      { type: "file", source: { text: { value: "const x = 1;" } } },
    ]
    const assistantParts = [
      { type: "text", text: "Of course! What do you need?" },
      { type: "reasoning", text: "User needs help" },
      { type: "tool", tool: "read", state: { input: { filePath: "/test" }, status: "completed", output: "file content" } },
    ]

    // Count chars
    const systemChars = systemPrompt.length
    const userChars = userParts.reduce((sum, p) => {
      const c = charsFromUserPart(p)
      return sum + c.text + c.file + c.agent
    }, 0)
    const assistantChars = assistantParts.reduce((sum, p) => {
      const c = charsFromAssistantPart(p)
      return sum + c.text + c.reasoning + (c.tool?.chars ?? 0)
    }, 0)

    // Estimate tokens
    const estSystem = estimateTokens(systemChars)
    const estUser = estimateTokens(userChars)
    const estAssistant = estimateTokens(assistantChars)
    const estTotal = estSystem + estUser + estAssistant

    expect(estSystem).toBe(7) // 28 chars / 4
    expect(estUser).toBe(9) // 35 chars / 4
    expect(estAssistant).toBe(18) // 71 chars / 4 (30 + 16 + 16 + 12)
    expect(estTotal).toBe(34)

    // Simulate scaling
    const actualInput = 30
    const scale = estTotal > actualInput ? actualInput / estTotal : 1
    
    const scaledSystem = Math.round(estSystem * scale)
    const scaledUser = Math.round(estUser * scale)
    const scaledAssistant = Math.round(estAssistant * scale)

    expect(scale).toBeCloseTo(0.882, 2)
    expect(scaledSystem).toBe(6)
    expect(scaledUser).toBe(8)
    expect(scaledAssistant).toBe(16)
    expect(scaledSystem + scaledUser + scaledAssistant).toBe(30)
  })
})
