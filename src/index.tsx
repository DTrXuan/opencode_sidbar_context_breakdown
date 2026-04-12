/** @jsxImportSource @opentui/solid */
import type { AssistantMessage, UserMessage } from "@opencode-ai/sdk/v2"
import type { Part } from "@opencode-ai/sdk/v2/client"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal } from "solid-js"

const PLUGIN_ID = "opencode-sidbar-context-breakdown"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

// ─── Token estimation helpers ────────────────────────────────────────────────
// The API only returns aggregate input/output/reasoning/cache counts,
// not a per-role breakdown.  We estimate by counting characters in message
// parts and dividing by 4 (the widely-used chars-per-token approximation).

const estimateTokens = (chars: number) => Math.ceil(chars / 4)

// Enhanced user part breakdown: text, file, agent
const charsFromUserPart = (part: Part): { text: number; file: number; agent: number } => {
  if (part.type === "text") return { text: part.text.length, file: 0, agent: 0 }
  if (part.type === "file") return { text: 0, file: (part as any).source?.text?.value?.length ?? 0, agent: 0 }
  if (part.type === "agent") return { text: 0, file: 0, agent: (part as any).source?.value?.length ?? 0 }
  return { text: 0, file: 0, agent: 0 }
}

// Enhanced assistant part breakdown: text, reasoning, tool (with name)
const charsFromAssistantPart = (part: Part): {
  text: number
  reasoning: number
  tool: { name: string; chars: number } | null
} => {
  if (part.type === "text") return { text: part.text.length, reasoning: 0, tool: null }
  if (part.type === "reasoning") return { text: 0, reasoning: (part as any).text?.length ?? 0, tool: null }
  if (part.type !== "tool") return { text: 0, reasoning: 0, tool: null }

  const p = part as any
  const toolName = p.tool ?? "unknown"
  const inputKeys = Object.keys(p.state?.input ?? {}).length * 16
  const status = p.state?.status
  let chars = inputKeys

  if (status === "pending") chars += p.state?.raw?.length ?? 0
  else if (status === "completed") chars += p.state?.output?.length ?? 0
  else if (status === "error") chars += p.state?.error?.length ?? 0

  return { text: 0, reasoning: 0, tool: { name: toolName, chars } }
}

// Truncate tool names to max length
const truncateName = (name: string, maxLen: number = 20) =>
  name.length > maxLen ? name.slice(0, maxLen - 3) + "..." : name

// ─── View component ──────────────────────────────────────────────────────────

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [mode, setMode] = createSignal<"detail" | "compact">("detail") // Default: detail (expanded)
  const toggleMode = () => {
    setMode(mode() === "detail" ? "compact" : "detail")
  }

  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const cost = createMemo(() =>
    msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0),
  )

  const state = createMemo(() => {
    const messages = msg()
    const last = messages.findLast(
      (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
    )
    if (!last)
      return {
        tokens: 0,
        percent: null,
        breakdown: null,
        composition: null,
        messageCount: null,
        averages: null,
      }

    const t = last.tokens
    const tokens = t.input + t.output + t.reasoning + t.cache.read + t.cache.write
    const model = props.api.state.provider.find((p) => p.id === last.providerID)?.models[last.modelID]

    // % of context window used
    const pct = (n: number) => (tokens > 0 ? Math.round((n / tokens) * 100) : 0)

    // Estimate per-role composition of the input token budget
    const systemPrompt = messages
      .findLast((m): m is UserMessage => m.role === "user" && !!(m as any).system)
      ?.system as string | undefined

    // Enhanced counts with detailed breakdown
    const counts = messages.reduce(
      (acc, m) => {
        const parts = props.api.state.part(m.id) as Part[]

        if (m.role === "user") {
          const breakdown = parts.reduce(
            (s, p) => {
              const c = charsFromUserPart(p)
              return {
                text: s.text + c.text,
                file: s.file + c.file,
                agent: s.agent + c.agent,
              }
            },
            { text: 0, file: 0, agent: 0 },
          )
          return {
            ...acc,
            user: {
              text: acc.user.text + breakdown.text,
              file: acc.user.file + breakdown.file,
              agent: acc.user.agent + breakdown.agent,
              count: acc.user.count + 1,
            },
          }
        }

        if (m.role === "assistant") {
          const breakdown = parts.reduce(
            (s, p) => {
              const c = charsFromAssistantPart(p)
              if (c.tool) {
                const existing = s.tools.get(c.tool.name) ?? { count: 0, chars: 0 }
                s.tools.set(c.tool.name, {
                  count: existing.count + 1,
                  chars: existing.chars + c.tool.chars,
                })
              }
              return {
                text: s.text + c.text,
                reasoning: s.reasoning + c.reasoning,
                tools: s.tools,
              }
            },
            {
              text: 0,
              reasoning: 0,
              tools: new Map<string, { count: number; chars: number }>(),
            },
          )

          // Merge tool maps
          breakdown.tools.forEach((value, key) => {
            const existing = acc.tools.get(key) ?? { count: 0, chars: 0 }
            acc.tools.set(key, {
              count: existing.count + value.count,
              chars: existing.chars + value.chars,
            })
          })

          return {
            ...acc,
            assistant: {
              text: acc.assistant.text + breakdown.text,
              reasoning: acc.assistant.reasoning + breakdown.reasoning,
              count: acc.assistant.count + 1,
            },
          }
        }

        return acc
      },
      {
        system: systemPrompt?.length ?? 0,
        user: { text: 0, file: 0, agent: 0, count: 0 },
        assistant: { text: 0, reasoning: 0, count: 0 },
        tools: new Map<string, { count: number; chars: number }>(),
      },
    )

    // Estimate tokens for all components
    const est = {
      system: estimateTokens(counts.system),
      user: {
        text: estimateTokens(counts.user.text),
        file: estimateTokens(counts.user.file),
        agent: estimateTokens(counts.user.agent),
      },
      assistant: {
        text: estimateTokens(counts.assistant.text),
        reasoning: estimateTokens(counts.assistant.reasoning),
      },
      tools: new Map(
        Array.from(counts.tools).map(([name, data]) => [name, { count: data.count, tokens: estimateTokens(data.chars) }]),
      ),
    }

    const estTotal =
      est.system +
      est.user.text +
      est.user.file +
      est.user.agent +
      est.assistant.text +
      est.assistant.reasoning +
      Array.from(est.tools.values()).reduce((sum, t) => sum + t.tokens, 0)

    const input = t.input
    // Scale down proportionally if our estimate exceeds actual input tokens
    const scale = estTotal > input && estTotal > 0 ? input / estTotal : 1

    // Use Math.round instead of Math.floor for better accuracy
    const scaled = {
      system: Math.round(est.system * scale),
      user: {
        text: Math.round(est.user.text * scale),
        file: Math.round(est.user.file * scale),
        agent: Math.round(est.user.agent * scale),
      },
      assistant: {
        text: Math.round(est.assistant.text * scale),
        reasoning: Math.round(est.assistant.reasoning * scale),
      },
      tools: new Map(
        Array.from(est.tools).map(([name, data]) => [name, { count: data.count, tokens: Math.round(data.tokens * scale) }]),
      ),
    }

    const iPct = (n: number) => (input > 0 ? Math.round((n / input) * 100) : 0)

    // Calculate totals
    const userTotal = scaled.user.text + scaled.user.file + scaled.user.agent
    const assistantTotal = scaled.assistant.text + scaled.assistant.reasoning
    const toolsTotal = Array.from(scaled.tools.values()).reduce((sum, t) => sum + t.tokens, 0)
    const totalToolCalls = Array.from(scaled.tools.values()).reduce((sum, t) => sum + t.count, 0)

    // Calculate averages
    const avgPerMsg = messages.length > 0 ? Math.round(input / messages.length) : 0
    const avgPerUser = counts.user.count > 0 ? Math.round(userTotal / counts.user.count) : 0
    const avgPerAssistant = counts.assistant.count > 0 ? Math.round(assistantTotal / counts.assistant.count) : 0

    // Count specific part types
    const fileCount = messages.reduce((sum, m) => {
      if (m.role !== "user") return sum
      const parts = props.api.state.part(m.id) as Part[]
      return sum + parts.filter((p) => p.type === "file").length
    }, 0)

    const agentCount = messages.reduce((sum, m) => {
      if (m.role !== "user") return sum
      const parts = props.api.state.part(m.id) as Part[]
      return sum + parts.filter((p) => p.type === "agent").length
    }, 0)

    const reasoningCount = messages.reduce((sum, m) => {
      if (m.role !== "assistant") return sum
      const parts = props.api.state.part(m.id) as Part[]
      return sum + parts.filter((p) => p.type === "reasoning").length
    }, 0)

    // Prepare top 3 tools + "other"
    const sortedTools = Array.from(scaled.tools)
      .map(([name, data]) => ({ name, count: data.count, tokens: data.tokens }))
      .sort((a, b) => b.tokens - a.tokens)

    const topTools = sortedTools.slice(0, 3)
    const otherTools = sortedTools.slice(3)

    if (otherTools.length > 0) {
      topTools.push({
        name: "other",
        count: otherTools.reduce((sum, t) => sum + t.count, 0),
        tokens: otherTools.reduce((sum, t) => sum + t.tokens, 0),
      })
    }

    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
      messageCount: {
        total: messages.length,
        user: counts.user.count,
        assistant: counts.assistant.count,
      },
      averages: {
        perMessage: avgPerMsg,
        perUser: avgPerUser,
        perAssistant: avgPerAssistant,
      },
      breakdown: {
        input: pct(t.input),
        output: pct(t.output),
        reasoning: pct(t.reasoning),
        cacheRead: pct(t.cache.read),
        cacheWrite: pct(t.cache.write),
      },
      composition: {
        inputTokens: input,
        system: iPct(scaled.system) >= 1 ? { pct: iPct(scaled.system), tokens: scaled.system } : null,
        user: {
          total: { pct: iPct(userTotal), tokens: userTotal },
          text:
            iPct(scaled.user.text) >= 1
              ? { pct: iPct(scaled.user.text), tokens: scaled.user.text, count: counts.user.count }
              : null,
          file: iPct(scaled.user.file) >= 1 ? { pct: iPct(scaled.user.file), tokens: scaled.user.file, count: fileCount } : null,
          agent:
            iPct(scaled.user.agent) >= 1 ? { pct: iPct(scaled.user.agent), tokens: scaled.user.agent, count: agentCount } : null,
        },
        assistant: {
          total: { pct: iPct(assistantTotal), tokens: assistantTotal },
          text:
            iPct(scaled.assistant.text) >= 1
              ? { pct: iPct(scaled.assistant.text), tokens: scaled.assistant.text, count: counts.assistant.count }
              : null,
          reasoning:
            iPct(scaled.assistant.reasoning) >= 1
              ? { pct: iPct(scaled.assistant.reasoning), tokens: scaled.assistant.reasoning, count: reasoningCount }
              : null,
        },
        tool:
          iPct(toolsTotal) >= 1
            ? {
                total: { pct: iPct(toolsTotal), tokens: toolsTotal, count: totalToolCalls },
                byName: topTools.map((t) => ({ ...t, name: truncateName(t.name) })),
              }
            : null,
      },
    }
  })

  const bd = () => state().breakdown
  const cp = () => state().composition
  const mc = () => state().messageCount
  const avg = () => state().averages

  return (
    <box>
      <box onMouseDown={toggleMode}>
        <text fg={theme().text}>
          {mode() === "detail" ? "▼" : "▶"} <b>Context management</b>
        </text>
        <text fg={theme().textMuted}>
          {state().tokens.toLocaleString()} tokens ({state().percent ?? 0}% used)
          {mc() && (
            <>
              {" • "}
              {mc()!.total} msgs
              {mode() === "detail" && ` (${mc()!.user} user, ${mc()!.assistant} assistant)`}
              {avg() && ` • avg ${avg()!.perMessage.toLocaleString()}/msg`}
            </>
          )}
        </text>
      </box>

       {/* Compact mode: always show Input/Output/Reasoning/Cache percentages */}
       {mode() === "compact" && bd() && (
         <>
           <text fg={theme().textMuted}>
             Input {bd()!.input}%
           </text>
           <text fg={theme().textMuted}>
             Output {bd()!.output}%
           </text>
           <text fg={theme().textMuted}>
             Reasoning {bd()!.reasoning}%
           </text>
           <text fg={theme().textMuted}>
             Cache read {bd()!.cacheRead}%
           </text>
           <text fg={theme().textMuted}>
             Cache wrt {bd()!.cacheWrite}%
           </text>
         </>
       )}

      {/* Detail mode: show full breakdown */}
      {mode() === "detail" && (
        <>
          {/* Input summary with token count */}
          {bd() && bd()!.input > 0 && cp() && (
            <text fg={theme().textMuted}>
              Input {bd()!.input}% ({cp()!.inputTokens.toLocaleString()} tokens)
            </text>
          )}

          {/* Detailed breakdown - System, User, History, Tools */}
          {(() => {
            const composition = cp()
            const averages = avg()
            if (!composition) return null
            
            return (
              <>
                {/* System */}
                {composition.system && (
                  <text fg={theme().textMuted}>
                    System {composition.system.pct}% ({composition.system.tokens.toLocaleString()} tokens)
                  </text>
                )}

                {/* User breakdown */}
                {composition.user.total.pct >= 1 && (
                  <>
                    <text fg={theme().textMuted}>
                      User {composition.user.total.pct}% ({composition.user.total.tokens.toLocaleString()} tokens)
                      {averages && averages.perUser > 0 && ` • avg ${averages.perUser.toLocaleString()}/msg`}
                    </text>
                    {composition.user.text && (
                      <text fg={theme().textMuted}>
                        Text {composition.user.text.pct}% ({composition.user.text.tokens.toLocaleString()} tokens) •{" "}
                        {composition.user.text.count} msgs
                      </text>
                    )}
                    {composition.user.file && (
                      <text fg={theme().textMuted}>
                        Files {composition.user.file.pct}% ({composition.user.file.tokens.toLocaleString()} tokens) •{" "}
                        {composition.user.file.count} files
                      </text>
                    )}
                    {composition.user.agent && (
                      <text fg={theme().textMuted}>
                        Agent {composition.user.agent.pct}% ({composition.user.agent.tokens.toLocaleString()} tokens) •{" "}
                        {composition.user.agent.count} mentions
                      </text>
                    )}
                  </>
                )}

                {/* History breakdown */}
                {composition.assistant.total.pct >= 1 && (
                  <>
                    <text fg={theme().textMuted}>
                      History {composition.assistant.total.pct}% ({composition.assistant.total.tokens.toLocaleString()} tokens)
                      {averages && averages.perAssistant > 0 && ` • avg ${averages.perAssistant.toLocaleString()}/msg`}
                    </text>
                    {composition.assistant.text && (
                      <text fg={theme().textMuted}>
                        Text {composition.assistant.text.pct}% ({composition.assistant.text.tokens.toLocaleString()} tokens) •{" "}
                        {composition.assistant.text.count} msgs
                      </text>
                    )}
                    {composition.assistant.reasoning && (
                      <text fg={theme().textMuted}>
                        Reasoning {composition.assistant.reasoning.pct}% ({composition.assistant.reasoning.tokens.toLocaleString()} tokens) •{" "}
                        {composition.assistant.reasoning.count} msgs
                      </text>
                    )}
                  </>
                )}

                {/* Tools breakdown */}
                {composition.tool && composition.tool.total.pct >= 1 && (
                  <text fg={theme().textMuted}>
                    Tools {composition.tool.total.pct}% ({composition.tool.total.tokens.toLocaleString()} tokens) • {composition.tool.total.count} calls
                  </text>
                )}
              </>
            )
          })()}

          {/* Output, Reasoning, Cache */}
          {bd() && bd()!.output > 0 && (
            <text fg={theme().textMuted}>
              Output {bd()!.output}%
            </text>
          )}
          {bd() && bd()!.reasoning > 0 && (
            <text fg={theme().textMuted}>
              Reasoning {bd()!.reasoning}%
            </text>
          )}
          {bd() && bd()!.cacheRead > 0 && (
            <text fg={theme().textMuted}>
              Cache read {bd()!.cacheRead}%
            </text>
          )}
          {bd() && bd()!.cacheWrite > 0 && (
            <text fg={theme().textMuted}>
              Cache wrt {bd()!.cacheWrite}%
            </text>
          )}
        </>
      )}

      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
    </box>
  )
}

// ─── Plugin registration ─────────────────────────────────────────────────────

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: PLUGIN_ID,
  tui,
}

export default plugin
