// VARREDURA dos prompts do CHAT: esclarecimento pelas bases (planejador), roteamento do Orquestrador e especialista, montados pelas
// funções REAIS para perguntas reais do banco de dev. Mede o peso de cada parte, o texto repetido dentro de cada pedido e o que vai
// em mais de uma chamada da mesma pergunta. Só leitura, rede bloqueada, nenhuma IA. Saída: só números.
//
//   cd backend && npx tsx ../docs/dev/varredura-prompts/chat.mts
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
const { loadReadableKnowledge, postgresReadableKnowledgePorts } = await import(B + "/src/modules/knowledge/application/knowledge-catalog.ts")
const { loadClarificationGuardrails } = await import(B + "/src/modules/knowledge-clarification/application/clarification-context.ts")
const { KnowledgeWorkspace, DEFAULT_NAVIGATION_BUDGET } = await import(B + "/src/modules/knowledge-clarification/domain/knowledge-workspace.ts")
const { PLANNER_SYSTEM, renderPlannerSystem } = await import(B + "/src/modules/knowledge-clarification/domain/clarification-prompts.ts")
const { buildSystemPromptWithTrace } = await import(B + "/src/modules/agents/application/build-system-prompt.ts")

const K = 3.99
const tok = (chars: number) => Math.round(chars / K)
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
function repeated(text: string, size = 8): number {
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ w: m[0], at: m.index! }))
  const seen = new Set<string>()
  const covered = new Uint8Array(text.length)
  for (let i = 0; i + size <= words.length; i++) {
    const key = words.slice(i, i + size).map((x) => x.w).join(" ")
    if (seen.has(key)) for (let c = words[i]!.at; c < words[i + size - 1]!.at + words[i + size - 1]!.w.length; c++) covered[c] = 1
    seen.add(key)
  }
  let chars = 0
  for (const v of covered) chars += v
  return chars
}
/** Quanto de `b` (por linhas de 30+ caracteres) já está em `a`. */
const sharedLines = (a: string, b: string) => {
  const set = new Set(a.split("\n").map((line) => line.trim()).filter((line) => line.length >= 30))
  return b.split("\n").map((line) => line.trim()).filter((line) => line.length >= 30 && set.has(line)).reduce((sum, line) => sum + line.length + 1, 0)
}

const msgs = (
  await db.query(`
  select distinct on (i.organization_id, i.operator_id) i.organization_id org, i.operator_id person, i.content
    from assistant_interactions i
   where i.role = 'user' and i.occurred_at >= now() - interval '30 days' and length(i.content) between 8 and 600
   order by i.organization_id, i.operator_id, i.occurred_at desc`)
).rows

const planner: Record<string, number>[] = []
const routing: Record<string, number>[] = []
const specialist: Record<string, number>[] = []
for (const m of msgs) {
  const o = await resolveOrchestratorForSubject(db, m.org, m.person, "INTERACTIVE", m.content)
  if (!o) continue
  const agentIds = [...new Set([o.orchestratorAgentId, ...o.specialists.map((s: any) => s.agentId)].filter(Boolean))] as string[]
  const guardrails = await loadClarificationGuardrails(db, m.org, o.orchestratorAgentId ? [o.orchestratorAgentId] : [])
  const knowledge = await loadReadableKnowledge({ organizationId: m.org, viewerPersonId: m.person, agentIds }, postgresReadableKnowledgePorts(db))
  const workspace = new KnowledgeWorkspace([...knowledge.sources.values()], DEFAULT_NAVIGATION_BUDGET)
  const view = workspace.render()
  const system = renderPlannerSystem({ guardrails, glossary: knowledge.glossary, coverage: workspace.coverage(), catalog: view.catalog })
  const glossaryChars = knowledge.glossary.reduce((sum: number, g: any) => sum + g.term.length + g.definition.length + 5, 0)
  planner.push({ total: system.length, instructions: String(PLANNER_SYSTEM).length, guardrails: guardrails.length, glossary: glossaryChars, catalog: view.catalog.length, bases: knowledge.sources.size, repeated: repeated(system) })
  const tools = JSON.stringify(o.tools)
  routing.push({ orchestrator: o.systemPrompt.length, tools: tools.length, nTools: o.tools.length, toolsRepeated: repeated(tools) })
  for (const s of o.specialists.slice(0, 3)) {
    const row = (await db.query(`select name, objective, description, context_prompt, active, specialty, specialty_kind, domain, capability, consolidated_input, investigation_capabilities, organization_id from agents where id = $1`, [s.agentId])).rows[0]
    if (!row?.active) continue
    const built = await buildSystemPromptWithTrace(db, s.agentId, row, { query: m.content, collaboratorConversation: true, askerQuestion: m.content })
    specialist.push({ total: built.systemPrompt.length, knowledge: built.knowledge?.injectedChars ?? 0, repeated: repeated(built.systemPrompt), guardrailsAlsoInClarification: sharedLines(guardrails, built.systemPrompt) })
  }
}
const mean = (rows: Record<string, number>[], key: string) => tok(avg(rows.map((r) => r[key]!)))
console.log(JSON.stringify({ pessoasComPergunta: msgs.length, planejador: planner.length, roteamento: routing.length, especialista: specialist.length }))
console.log(JSON.stringify({ planejador_sistema_tokens: { total: mean(planner, "total"), instrucoes: mean(planner, "instructions"), limitesEAssuntosProibidos: mean(planner, "guardrails"), glossario: mean(planner, "glossary"), listaDasBases: mean(planner, "catalog"), repetidoDentro: mean(planner, "repeated") }, basesListadas: +avg(planner.map((p) => p.bases!)).toFixed(1) }))
console.log(JSON.stringify({ roteamento_tokens: { promptDoOrquestrador: mean(routing, "orchestrator"), ferramentas: mean(routing, "tools"), repetidoNasFerramentas: mean(routing, "toolsRepeated") }, ferramentas: +avg(routing.map((r) => r.nTools!)).toFixed(1) }))
console.log(JSON.stringify({ especialista_sistema_tokens: { total: mean(specialist, "total"), trechoDasBases: mean(specialist, "knowledge"), repetidoDentro: mean(specialist, "repeated"), limitesTambemNoEsclarecimento: mean(specialist, "guardrailsAlsoInClarification") } }))
await db.end()
