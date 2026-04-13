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

const fmt = new Intl.NumberFormat("en-US")

const fmtNum = (n: number) => fmt.format(n)

const estimateTokens = (chars: number) => Math.ceil(chars / 4)

const charsFromUserPart = (part: Part): { text: number; file: number; agent: number } => {
  if (part.type === "text") return { text: part.text.length, file: 0, agent: 0 }
  if (part.type === "file") return { text: 0, file: (part as any).source?.text?.value?.length ?? 0, agent: 0 }
  if (part.type === "agent") return { text: 0, file: 0, agent: (part as any).source?.value?.length ?? 0 }
  return { text: 0, file: 0, agent: 0 }
}

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

const truncateName = (name: string, maxLen: number = 20) =>
  name.length > maxLen ? name.slice(0, maxLen - 3) + "..." : name

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [mode, setMode] = createSignal<"detail" | "compact">("detail")
  const toggleMode = () => {
    setMode(mode() === "detail" ? "compact" : "detail")
  }

  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const cost = createMemo(() =>
    msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0),
  )
  const est = createMemo(() => {
    const messages = msg()
    const last = messages.findLast(
      (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
    )
    if (!last) return 0
    const t = last.tokens
    const INPUT_RATE = 3 / 1000000
    const OUTPUT_RATE = 15 / 1000000
    const CACHE_WRITE_RATE = 3.75 / 1000000
    const CACHE_READ_RATE = 0.30 / 1000000
    const cache = t.cache ?? { write: 0, read: 0 }
    return t.input * INPUT_RATE + t.output * OUTPUT_RATE + t.reasoning * OUTPUT_RATE + cache.write * CACHE_WRITE_RATE + cache.read * CACHE_READ_RATE
  })

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
    const cache = t.cache ?? { read: 0, write: 0 }
    const tokens = t.input + t.output + t.reasoning + cache.read + cache.write
    const model = props.api.state.provider.find((p) => p.id === last.providerID)?.models[last.modelID]

    const pct = (n: number) => (tokens > 0 ? Math.round((n / tokens) * 100) : 0)

    const systemPrompt = messages
      .findLast((m): m is UserMessage => m.role === "user" && !!(m as any).system)
      ?.system as string | undefined

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
    const scale = estTotal > input && estTotal > 0 ? input / estTotal : 1

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

    const userTotal = scaled.user.text + scaled.user.file + scaled.user.agent
    const assistantTotal = scaled.assistant.text + scaled.assistant.reasoning
    const toolsTotal = Array.from(scaled.tools.values()).reduce((sum, t) => sum + t.tokens, 0)
    const totalToolCalls = Array.from(scaled.tools.values()).reduce((sum, t) => sum + t.count, 0)

    const avgPerMsg = messages.length > 0 ? Math.round(input / messages.length) : 0
    const avgPerUser = counts.user.count > 0 ? Math.round(userTotal / counts.user.count) : 0
    const avgPerAssistant = counts.assistant.count > 0 ? Math.round(assistantTotal / counts.assistant.count) : 0

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

    const sortedTools = Array.from(scaled.tools)
      .map(([name, data]) => ({ name, count: data.count, tokens: data.tokens, pct: iPct(data.tokens) }))
      .sort((a, b) => b.tokens - a.tokens)

    const topTools = sortedTools.slice(0, 3)
    const otherTools = sortedTools.slice(3)

    if (otherTools.length > 0) {
      topTools.push({
        name: "other",
        count: otherTools.reduce((sum, t) => sum + t.count, 0),
        tokens: otherTools.reduce((sum, t) => sum + t.tokens, 0),
        pct: iPct(otherTools.reduce((sum, t) => sum + t.tokens, 0)),
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
        cacheRead: pct(cache.read),
        cacheWrite: pct(cache.write),
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

  const mkBar = (pct: number, len: number = 8) => {
    const filled = Math.round((pct / 100) * len)
    return "█".repeat(filled) + "░".repeat(len - filled)
  }

  return (
    <box>
      <box onMouseDown={toggleMode}>
        <text fg={theme().text}>
          {mode() === "detail" ? "▼" : "▷"} <b>Context</b> {mkBar(state().percent ?? 0)}
        </text>
        <box style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <text fg={theme().text}>{fmtNum(state().tokens)} tokens ({state().percent ?? 0}%)</text>
          {cost() !== undefined && (
            <>
              <text fg={theme().textMuted}>|</text>
              <text fg="#f44">Act{money.format(cost())}</text>
            </>
          )}
          {(est() ?? 0) > 0 && (
            <>
              <text fg={theme().textMuted}>|</text>
              <text fg="#4f4">Est{money.format(est() ?? 0)}</text>
            </>
          )}
        </box>
        {mc() && (
          <text fg={theme().textMuted}>
            {mc()!.total} msgs ({mc()!.user}U / {mc()!.assistant}A)
          </text>
        )}
        {avg() && (
          <text fg={theme().textMuted}>
            avg {fmtNum(avg()!.perMessage)}/msg
          </text>
        )}
      </box>

      {mode() === "compact" && cp() ? (
        <box style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {cp()!.system ? (
            <>
              <text fg="#5af">Sys </text>
              <text fg="#5af">{cp()!.system!.pct}%</text>
              <text fg={theme().textMuted}> | </text>
            </>
          ) : null}
          <text fg="#adf">U </text>
          <text fg="#adf">{cp()!.user.total.pct}%</text>
          <text fg={theme().textMuted}> | </text>
          {cp()!.assistant.total.pct >= 1 ? (
            <>
              <text fg="#fda">H </text>
              <text fg="#fda">{cp()!.assistant.total.pct}%</text>
              <text fg={theme().textMuted}> | </text>
            </>
          ) : null}
          {cp()!.tool && cp()!.tool!.total.pct >= 1 ? (
            <>
              <text fg="#daf">T </text>
              <text fg="#daf">{cp()!.tool!.total.pct}%</text>
            </>
          ) : null}
        </box>
      ) : null}

      {mode() === "detail" && (
        <>
          {bd() && bd()!.input > 0 && cp() && bd() && (
            <text fg={theme().textMuted}>---</text>
          )}
          {bd() && bd()!.input > 0 && cp() && bd() && (
            <text fg={theme().text}>
              In {bd()!.input}% {fmtNum(cp()!.inputTokens)}
            </text>
          )}

          {(() => {
            const composition = cp()
            const averages = avg()
            if (!composition) return null

            return (
              <>
                {composition.system && (
                  <text fg="#5af">System {composition.system.pct}% {fmtNum(composition.system.tokens)}</text>
                )}

                {composition.user.total.pct >= 1 && (
                  <>
                    <text fg="#adf">User {composition.user.total.pct}% {fmtNum(composition.user.total.tokens)}</text>
                    {composition.user.text && (
                      <text fg={theme().textMuted}>  text {composition.user.text.pct}% {fmtNum(composition.user.text.tokens)} ({composition.user.text.count})</text>
                    )}
                    {composition.user.file && (
                      <text fg={theme().textMuted}>  file {composition.user.file.pct}% {fmtNum(composition.user.file.tokens)} ({composition.user.file.count})</text>
                    )}
                    {composition.user.agent && (
                      <text fg={theme().textMuted}>  agent {composition.user.agent.pct}% {fmtNum(composition.user.agent.tokens)}</text>
                    )}
                  </>
                )}

                {composition.assistant.total.pct >= 1 && (
                  <>
                    <text fg="#fda">History {composition.assistant.total.pct}% {fmtNum(composition.assistant.total.tokens)}</text>
                    {composition.assistant.text && (
                      <text fg={theme().textMuted}>  text {composition.assistant.text.pct}% {fmtNum(composition.assistant.text.tokens)} ({composition.assistant.text.count})</text>
                    )}
                    {composition.assistant.reasoning && (
                      <text fg={theme().textMuted}>  thnk {composition.assistant.reasoning.pct}% {fmtNum(composition.assistant.reasoning.tokens)}</text>
                    )}
                  </>
                )}

                {composition.tool && composition.tool.total.pct >= 1 && (
                  <>
                    <text fg="#daf">Tools {composition.tool.total.pct}% {fmtNum(composition.tool.total.tokens)} ({composition.tool.total.count}calls)</text>
                    {composition.tool.byName.map((tool) => (
                      <text fg={theme().textMuted}>  {tool.name} {tool.pct}% {fmtNum(tool.tokens)} ({tool.count})</text>
                    ))}
                  </>
                )}
              </>
            )
          })()}

          {bd() && (bd()!.output > 0 || bd()!.reasoning > 0 || bd()!.cacheRead > 0 || bd()!.cacheWrite > 0) && (
            <text fg={theme().textMuted}>---</text>
          )}
          {bd() && bd()!.output > 0 && (
            <text fg={theme().textMuted}>Out {bd()!.output}%</text>
          )}
          {bd() && bd()!.reasoning > 0 && (
            <text fg={theme().textMuted}>Thnk {bd()!.reasoning}%</text>
          )}
          {bd() && bd()!.cacheRead > 0 && (
            <text fg={theme().textMuted}>CacheR {bd()!.cacheRead}%</text>
          )}
          {bd() && bd()!.cacheWrite > 0 && (
            <text fg={theme().textMuted}>CacheW {bd()!.cacheWrite}%</text>
          )}
        </>
      )}
    </box>
  )
}

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
