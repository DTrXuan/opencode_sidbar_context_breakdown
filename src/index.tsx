/** @jsxImportSource @opentui/solid */
import type { AssistantMessage, UserMessage } from "@opencode-ai/sdk/v2"
import type { Part } from "@opencode-ai/sdk/v2/client"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo } from "solid-js"

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

const charsFromUserPart = (part: Part): number => {
  if (part.type === "text") return part.text.length
  if (part.type === "file") return (part as any).source?.text?.value?.length ?? 0
  if (part.type === "agent") return (part as any).source?.value?.length ?? 0
  return 0
}

const charsFromAssistantPart = (part: Part): { assistant: number; tool: number } => {
  if (part.type === "text") return { assistant: part.text.length, tool: 0 }
  if (part.type === "reasoning") return { assistant: (part as any).text?.length ?? 0, tool: 0 }
  if (part.type !== "tool") return { assistant: 0, tool: 0 }
  const p = part as any
  const inputKeys = Object.keys(p.state?.input ?? {}).length * 16
  const status = p.state?.status
  if (status === "pending")   return { assistant: 0, tool: inputKeys + (p.state?.raw?.length ?? 0) }
  if (status === "completed") return { assistant: 0, tool: inputKeys + (p.state?.output?.length ?? 0) }
  if (status === "error")     return { assistant: 0, tool: inputKeys + (p.state?.error?.length ?? 0) }
  return { assistant: 0, tool: inputKeys }
}

// ─── View component ──────────────────────────────────────────────────────────

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const cost = createMemo(() =>
    msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0),
  )

  const state = createMemo(() => {
    const messages = msg()
    const last = messages.findLast(
      (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
    )
    if (!last) return { tokens: 0, percent: null, breakdown: null, composition: null }

    const t = last.tokens
    const tokens = t.input + t.output + t.reasoning + t.cache.read + t.cache.write
    const model = props.api.state.provider.find((p) => p.id === last.providerID)?.models[last.modelID]

    // % of context window used
    const pct = (n: number) => (tokens > 0 ? Math.round((n / tokens) * 100) : 0)

    // Estimate per-role composition of the input token budget
    const systemPrompt = messages
      .findLast((m): m is UserMessage => m.role === "user" && !!(m as any).system)
      ?.system as string | undefined

    const counts = messages.reduce(
      (acc, m) => {
        const parts = props.api.state.part(m.id) as Part[]
        if (m.role === "user") {
          return { ...acc, user: acc.user + parts.reduce((s, p) => s + charsFromUserPart(p), 0) }
        }
        if (m.role === "assistant") {
          const r = parts.reduce(
            (s, p) => { const n = charsFromAssistantPart(p); return { assistant: s.assistant + n.assistant, tool: s.tool + n.tool } },
            { assistant: 0, tool: 0 },
          )
          return { ...acc, assistant: acc.assistant + r.assistant, tool: acc.tool + r.tool }
        }
        return acc
      },
      { system: systemPrompt?.length ?? 0, user: 0, assistant: 0, tool: 0 },
    )

    const est = {
      system:    estimateTokens(counts.system),
      user:      estimateTokens(counts.user),
      assistant: estimateTokens(counts.assistant),
      tool:      estimateTokens(counts.tool),
    }
    const estTotal = est.system + est.user + est.assistant + est.tool
    const input = t.input
    // Scale down proportionally if our estimate exceeds actual input tokens
    const scale = estTotal > input && estTotal > 0 ? input / estTotal : 1
    const scaled = {
      system:    Math.floor(est.system * scale),
      user:      Math.floor(est.user * scale),
      assistant: Math.floor(est.assistant * scale),
      tool:      Math.floor(est.tool * scale),
    }
    const iPct = (n: number) => (input > 0 ? Math.round((n / input) * 100) : 0)

    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
      breakdown: {
        input:      pct(t.input),
        output:     pct(t.output),
        reasoning:  pct(t.reasoning),
        cacheRead:  pct(t.cache.read),
        cacheWrite: pct(t.cache.write),
      },
      composition: {
        system:    iPct(scaled.system),
        user:      iPct(scaled.user),
        assistant: iPct(scaled.assistant),
        tool:      iPct(scaled.tool),
      },
    }
  })

  const bd = () => state().breakdown
  const cp = () => state().composition

  return (
    <box>
      <text fg={theme().text}><b>Context</b></text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens ({state().percent ?? 0}% used)</text>
      {bd() && bd()!.input > 0 && (
        <text fg={theme().textMuted}>  Input      {bd()!.input}%</text>
      )}
      {cp() && cp()!.system > 0 && (
        <text fg={theme().textMuted}>    System   {cp()!.system}%</text>
      )}
      {cp() && cp()!.user > 0 && (
        <text fg={theme().textMuted}>    User     {cp()!.user}%</text>
      )}
      {cp() && cp()!.assistant > 0 && (
        <text fg={theme().textMuted}>    History  {cp()!.assistant}%</text>
      )}
      {cp() && cp()!.tool > 0 && (
        <text fg={theme().textMuted}>    Tools    {cp()!.tool}%</text>
      )}
      {bd() && bd()!.output > 0 && (
        <text fg={theme().textMuted}>  Output     {bd()!.output}%</text>
      )}
      {bd() && bd()!.reasoning > 0 && (
        <text fg={theme().textMuted}>  Reasoning  {bd()!.reasoning}%</text>
      )}
      {bd() && bd()!.cacheRead > 0 && (
        <text fg={theme().textMuted}>  Cache read {bd()!.cacheRead}%</text>
      )}
      {bd() && bd()!.cacheWrite > 0 && (
        <text fg={theme().textMuted}>  Cache wrt  {bd()!.cacheWrite}%</text>
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
