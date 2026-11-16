// Quanto de cada prompt do CHAT se repete entre perguntas diferentes — o que um cache por prefixo (como o do Azure OpenAI) aproveita.
// Esclarecimento pelas bases (planejador) e especialista, montados pelas funções REAIS com perguntas reais do banco de dev.
// Só leitura, rede bloqueada, IA trocada por um dublê que só ANOTA o prompt (nenhuma chamada sai). Saída: só números e rótulos.
//
//   cd backend && npx tsx ../docs/dev/cache-prompt-azure/chat-stages-prefix.mts
import { createRequire } from "node:module"
const B = new URL("../../../backend", import.meta.url).pathname.replace(/\/$/, "")
const require = createRequire(B + "/package.json")
const pg = require("pg")
;(globalThis as any).fetch = async () => {
  throw new Error("REDE BLOQUEADA")
}
const db = new pg.Pool({ connectionString: "postgresql://renanmenezes@localhost:5432/inia", options: "-c default_transaction_read_only=on -c statement_timeout=30000", max: 4 })
if ((await db.query("show default_transaction_read_only")).rows[0].default_transaction_read_only !== "on") throw new Error("não está em leitura")

const { resolveOrchestratorForSubject } = await import(B + "/src/modules/assistant/application/resolve-orchestrator.ts")
const { createKnowledgeClarification } = await import(B + "/src/modules/knowledge-clarification/application/knowledge-clarification-service.ts")
const { loadReadableKnowledge, postgresReadableKnowledgePorts } = await import(B + "/src/modules/knowledge/application/knowledge-catalog.ts")
const { loadClarificationGuardrails, loadSpecialistInstructions } = await import(B + "/src/modules/knowledge-clarification/application/clarification-context.ts")
const { buildSystemPromptWithTrace } = await import(B + "/src/modules/agents/application/build-system-prompt.ts")

const K = 3.99 // caracteres por token (média medida em 04/11 contra o provedor)
const tok = (chars: number) => Math.round(chars / K)
const lcp = (a: string, b: string) => {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}
const q = (a: number[], p: number) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!
}
const stats = (chars: number[]) => ({ p10: tok(q(chars, 0.1)), p50: tok(q(chars, 0.5)), p90: tok(q(chars, 0.9)) })

const msgs = (
  await db.query(`
  select i.organization_id org, i.operator_id person, i.content, i.occurred_at
    from assistant_interactions i
   where i.role = 'user' and i.occurred_at >= now() - interval '30 days' and length(i.content) between 8 and 600
   order by i.occurred_at desc limit 120`)
).rows

// Dublê da IA: anota o prompt e devolve algo fora do contrato (o fluxo encerra sozinho, sem resposta).
let captured: { stage: string; system: string; user: string; correction: boolean }[] = []
const clarification = createKnowledgeClarification({
  knowledge: (request: any) => loadReadableKnowledge(request, postgresReadableKnowledgePorts(db)),
  model: async (input: any) => {
    captured.push({ stage: input.stage, system: input.system, user: input.user, correction: input.correction })
    return "{}"
  },
  guardrails: (organizationId: string, agentIds: readonly string[]) => loadClarificationGuardrails(db, organizationId, agentIds),
  specialistInstructions: (organizationId: string, agentIds: readonly string[]) => loadSpecialistInstructions(db, organizationId, agentIds),
})
const silence = <T>(fn: () => Promise<T>) => {
  const [warn, error, info] = [console.warn, console.error, console.info]
  console.warn = console.error = console.info = () => {}
  return fn().finally(() => {
    console.warn = warn
    console.error = error
    console.info = info
  })
}

type Planner = { orch: string; person: string; system: string; user: string }
type Specialist = { agent: string; system: string; staticChars: number | null; knowledgeChars: number | null }
const planners: Planner[] = []
const specialists: Specialist[] = []
const errors = new Map<string, number>()
const agentRows = new Map<string, any>()
let noOrch = 0

for (const m of msgs) {
  try {
    const o = await resolveOrchestratorForSubject(db, m.org, m.person, "INTERACTIVE", m.content)
    if (!o) {
      noOrch++
      continue
    }
    // 1) Esclarecimento: a PRIMEIRA chamada do planejador para a pergunta (sem conversa anterior).
    captured = []
    await silence(() =>
      clarification.handle({ organizationId: m.org, personId: m.person, orchestratorAgentId: o.orchestratorAgentId || null, specialistAgentIds: o.specialists.map((s: any) => s.agentId), text: m.content, answer: null, previous: null, recentTurns: [] }),
    )
    const first = captured.find((call) => call.stage === "PLANNER" && !call.correction)
    if (first) planners.push({ orch: o.orchestratorId, person: m.person, system: first.system, user: first.user })
    // 2) Especialista: o prompt de sistema de cada especialista do Orquestrador, com a pergunta como consulta (o que o chat faz).
    for (const specialist of o.specialists.slice(0, 3)) {
      if (!agentRows.has(specialist.agentId)) {
        const row = (await db.query(`select name, objective, description, context_prompt, active, specialty, specialty_kind, domain, capability, consolidated_input, investigation_capabilities, organization_id from agents where id = $1`, [specialist.agentId])).rows[0]
        agentRows.set(specialist.agentId, row ?? null)
      }
      const row = agentRows.get(specialist.agentId)
      if (!row?.active) continue
      const built = await silence(() => buildSystemPromptWithTrace(db, specialist.agentId, row, { query: m.content, collaboratorConversation: true, askerQuestion: m.content }))
      specialists.push({ agent: specialist.agentId, system: built.systemPrompt, staticChars: null, knowledgeChars: built.knowledge?.injectedChars ?? null })
    }
  } catch (e) {
    const k = e instanceof Error ? e.message.slice(0, 80) : "erro"
    errors.set(k, (errors.get(k) ?? 0) + 1)
  }
}

console.log(JSON.stringify({ mensagens: msgs.length, semOrquestrador: noOrch, planejador: planners.length, especialista: specialists.length, erros: [...errors.entries()].slice(0, 5) }))

/** Prefixo comum entre perguntas diferentes do mesmo grupo: consecutivas e todos os pares (até 12 para trás). */
function prefix(rows: { key: string; text: string; person?: string }[], label: string) {
  const groups = new Map<string, { text: string; person?: string }[]>()
  for (const row of rows) {
    if (!groups.has(row.key)) groups.set(row.key, [])
    groups.get(row.key)!.push(row)
  }
  for (const [key, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 4)) {
    const consecutive: number[] = []
    const otherPeople: number[] = []
    for (let i = 1; i < list.length; i++) {
      consecutive.push(lcp(list[i - 1]!.text, list[i]!.text))
      for (let j = Math.max(0, i - 12); j < i; j++) if (list[j]!.person && list[j]!.person !== list[i]!.person) otherPeople.push(lcp(list[j]!.text, list[i]!.text))
    }
    console.log(
      JSON.stringify({
        etapa: label,
        grupo: key.slice(0, 8),
        perguntas: list.length,
        pessoas: new Set(list.map((r) => r.person)).size,
        tamanho_tokens: stats(list.map((r) => r.text.length)),
        prefixoComum_seguidas_tokens: stats(consecutive),
        prefixoComum_entrePessoas_tokens: otherPeople.length ? stats(otherPeople) : null,
        textosDistintos: new Set(list.map((r) => r.text)).size,
      }),
    )
  }
}

// Planejador: o SISTEMA (instruções + limites + glossário + lista das bases) e o pedido inteiro (sistema + pergunta).
prefix(planners.map((p) => ({ key: p.orch, text: p.system, person: p.person })), "esclarecimento: sistema")
prefix(planners.map((p) => ({ key: p.orch, text: p.system + "\n\u0000\n" + p.user, person: p.person })), "esclarecimento: pedido inteiro")
console.log(JSON.stringify({ etapa: "esclarecimento: pergunta (parte do usuário)", tokens: stats(planners.map((p) => p.user.length)) }))
// Especialista: o sistema inteiro (o trecho da base escolhido pela pergunta entra nele).
prefix(specialists.map((s) => ({ key: s.agent, text: s.system })), "especialista: sistema")
console.log(JSON.stringify({ etapa: "especialista: trecho das bases", tokens: stats(specialists.filter((s) => s.knowledgeChars !== null).map((s) => s.knowledgeChars!)) }))
await db.end()
