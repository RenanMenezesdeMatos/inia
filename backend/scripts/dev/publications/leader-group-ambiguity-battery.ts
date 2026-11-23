/**
 * BATERIA PAGA — GESTOR COM VÁRIOS GRUPOS E PROCESSOS DIFERENTES (17/11/2026). Pergunta do usuário: "se o gerente sênior tem 5 Grupos e
 * pergunta como abrir um reparo, e cada Grupo tem um processo diferente, como é a resposta?" — a IA não pode chutar.
 *
 *   npx tsx scripts/dev/publications/leader-group-ambiguity-battery.ts [--teto 1] [--repeticoes 3] [--so P1,P2]
 *
 * Modelo REAL da liderança com a ferramenta REAL de consulta de processo (`buildProcessConsultationToolset`) e as regras reais
 * (`INIA_CHAT_PERSONA` + `LEADERSHIP_RESPONSE_RULES`). O Orquestrador de cada Grupo é SIMULADO (sem custo): devolve o processo de reparo
 * daquele Grupo com um código único (RES-7, EMP-4…), para saber exatamente qual processo chegou à resposta. Nada é gravado.
 *   P1 5 Grupos, Orquestradores diferentes, "como abro um reparo?" sem Grupo  → não pode responder procedimento sem saber o Grupo;
 *   P2 o Grupo citado ("na Fibra")                                             → só o processo da Fibra;
 *   P3 dois Grupos citados                                                     → os dois, separados;
 *   P4 os 5 Grupos no MESMO Orquestrador                                       → uma consulta, sem perguntar Grupo.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import "../../../src/config/env.js"
import { pool } from "../../../src/infrastructure/database/pool.js"
import type { InteractiveOrchestratorScope } from "../../../src/modules/assistant/application/resolve-orchestrator.js"
import { LEADERSHIP_RESPONSE_RULES } from "../../../src/modules/leadership-analytics/application/leadership-context.js"
import { buildProcessConsultationToolset, type ProcessConsultation, type ProcessScope } from "../../../src/modules/leadership-analytics/application/process-consultation.js"
import type { OrchestratedReply } from "../../../src/modules/assistant/application/run-orchestrated-reply.js"
import { applyProcessGroupRule, INIA_CHAT_PERSONA } from "../../../src/modules/realtime/presentation/realtime-router.js"
import { runWithAiOrganization } from "../../../src/shared/application/model-routing/ai-runtime.js"
import { generateForRoute, routeFor, type GatewayRequest, type GatewayResponse } from "../../../src/shared/application/model-routing/llm-gateway.js"
import { costTotal } from "../../../src/shared/application/model-routing/model-pricing.js"

const args = process.argv.slice(2)
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? null : null)
const CAP_USD = Number(option("--teto") ?? 1)
const REPEAT = Number(option("--repeticoes") ?? 3)
const OUT_DIR = option("--saida") ?? "/private/tmp/claude-501/-Users-renanmenezes--claude-spares-spare-Iu7bMZ/429e2ebe-8a5c-442b-bc2f-25ba201c7d2e/scratchpad/gestores-bateria"
const ORG = "00000000-0000-4000-8000-000000000001"
const ONLY = option("--so") ? new Set(option("--so")!.split(",")) : null
const wants = (id: string) => !ONLY || ONLY.has(id)

let spentUsd = 0
const ledger: { label: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; reported: boolean }[] = []
class BudgetStop extends Error {}
async function guarded(label: string, request: GatewayRequest): Promise<GatewayResponse> {
  if (spentUsd + 0.04 > CAP_USD) throw new BudgetStop(`teto de US$ ${CAP_USD} — gasto US$ ${spentUsd.toFixed(4)}`)
  const response = await runWithAiOrganization(ORG, () => generateForRoute(request))
  const inputTokens = response.usage.promptTokens ?? 0
  const outputTokens = Math.max((response.usage.totalTokens ?? 0) - inputTokens, (response.usage.outputTokens ?? 0) + (response.usage.reasoningTokens ?? 0))
  const reported = costTotal(response.cost)
  const cost = reported ?? (inputTokens * 2 + outputTokens * 12) / 1_000_000
  spentUsd += cost
  ledger.push({ label, model: response.model, inputTokens, outputTokens, costUsd: cost, reported: reported !== null })
  return response
}

// ------------------------------------------------------------------------------------------------ cenário
const GROUPS = [
  { teamId: "10000000-0000-4000-8000-000000000001", name: "Residencial", code: "RES-7", step: "abrir o reparo no Portal Técnico, aba Visita, e agendar a janela com o cliente" },
  { teamId: "10000000-0000-4000-8000-000000000002", name: "Empresarial", code: "EMP-4", step: "abrir o chamado no Sistema B2B com prioridade pelo contrato SLA do cliente" },
  { teamId: "10000000-0000-4000-8000-000000000003", name: "Fibra", code: "FIB-2", step: "rodar o teste de linha no Diagnóstico Fibra antes de abrir o reparo no Portal Técnico" },
  { teamId: "10000000-0000-4000-8000-000000000004", name: "Móvel", code: "MOV-9", step: "registrar a ocorrência no Atende Móvel e orientar a troca do chip na loja" },
  { teamId: "10000000-0000-4000-8000-000000000005", name: "Ouvidoria", code: "OUV-3", step: "abrir a manifestação na fila de Ouvidoria e retornar ao cliente em até 5 dias úteis" },
]
const CODES = GROUPS.map((group) => group.code)
const ownOrchestrators: InteractiveOrchestratorScope[] = GROUPS.map((group, index) => ({ id: `orch-${index + 1}`, name: `INIA ${group.name}`, scopeType: "GROUPS", teamIds: [group.teamId] }))
const sharedOrchestrator: InteractiveOrchestratorScope[] = [{ id: "orch-all", name: "INIA Todos os grupos", scopeType: "ALL_TEAMS", teamIds: [] }]

const scope: ProcessScope = {
  groups: GROUPS.map(({ teamId, name }) => ({ teamId, name })),
  groupsOfStructure: () => ({ kind: "NOT_FOUND", message: "Estrutura não encontrada." }),
}

/** Orquestrador simulado: devolve o processo do Grupo consultado (ou o geral, no compartilhado). */
function consultOf(log: string[]) {
  return async (consultation: ProcessConsultation) => {
    log.push(consultation.groupNames.join("+") || consultation.orchestrator.name)
    if (consultation.orchestrator.id === "orch-all") return { text: `Procedimento geral de reparo (GER-1): confirmar o titular, registrar o defeito e abrir o reparo no Portal Técnico.`, trace: {} }
    const group = GROUPS.find((candidate) => consultation.teamIds.includes(candidate.teamId))!
    return { text: `Procedimento de reparo do Grupo ${group.name} (${group.code}): ${group.step}.`, trace: {} }
  }
}

const SYSTEM = [
  INIA_CHAT_PERSONA,
  "",
  "Você conversa com Carlos, gerente sênior. Ele lidera equipes nos Grupos: Residencial, Empresarial, Fibra, Móvel e Ouvidoria.",
  LEADERSHIP_RESPONSE_RULES,
].join("\n")

const route = (tools: number) => routeFor({ purpose: "ORCHESTRATOR_ROUTING", phase: "PLANNING", toolSchemaCount: tools })
type Turn = { role: "user" | "model"; text?: string; functionCalls?: unknown; functionResponses?: unknown }

/** Uma resposta da liderança: o modelo chama a ferramenta quantas vezes quiser (até 4 rodadas), como no chat. */
async function converse(label: string, question: string, orchestrators: InteractiveOrchestratorScope[]) {
  const consulted: string[] = []
  // Como no produto (leadershipReply): as falas da pessoa vão à ferramenta e a regra final do sistema decide o texto.
  const toolset = buildProcessConsultationToolset({ scope, orchestrators, consult: consultOf(consulted), askerTexts: [question] })!
  const final = (text: string) => applyProcessGroupRule({ text } as OrchestratedReply, toolset.outcome?.() ?? null).text
  const contents: Turn[] = [{ role: "user", text: question }]
  const toolResults: string[] = []
  for (let round = 0; round < 4; round += 1) {
    const response = await guarded(`${label}:r${round}`, { systemPrompt: SYSTEM, contents: contents as never, tools: toolset.declarations as never, structuredOutput: false, route: route(toolset.declarations.length), classification: { phase: "PLANNING", purpose: "ORCHESTRATOR_ROUTING", source: "CHAT", semanticType: "TEXT", tags: ["paid-battery:leader-groups"] } })
    if (response.kind === "text") return { answer: final(response.text), modelText: response.text, consulted, toolResults }
    const calls = response.calls
    const responses = []
    for (const call of calls) {
      const result = await toolset.execute(call.name, call.args)
      toolResults.push(`${JSON.stringify(call.args)} → ${result.text}`)
      responses.push({ name: call.name, response: { result: result.text } })
    }
    contents.push({ role: "model", functionCalls: calls }, { role: "user", functionResponses: responses })
  }
  return { answer: final("(sem resposta em 4 rodadas)"), modelText: "", consulted, toolResults }
}

const checks: { scenario: string; check: string; pass: boolean }[] = []
const results: unknown[] = []
/** Marca de cada procedimento (código ou o sistema próprio do Grupo) — o que mostra qual processo chegou à resposta. */
const MARKERS: Record<string, RegExp> = { "RES-7": /RES-7|aba Visita/i, "EMP-4": /EMP-4|Sistema B2B/i, "FIB-2": /FIB-2|Diagn[óo]stico Fibra/i, "MOV-9": /MOV-9|Atende M[óo]vel/i, "OUV-3": /OUV-3|fila de Ouvidoria/i }
const codesIn = (text: string) => CODES.filter((code) => MARKERS[code]!.test(text))
function check(scenario: string, description: string, pass: boolean) {
  checks.push({ scenario, check: description, pass })
  console.log(`  ${pass ? "✓" : "✗"} ${scenario} — ${description}`)
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  if (wants("P1")) {
    for (let run = 1; run <= REPEAT; run += 1) {
      const outcome = await converse(`P1#${run}`, "Como abro um reparo?", ownOrchestrators)
      results.push({ scenario: `P1#${run}`, ...outcome })
      const used = codesIn(outcome.answer)
      check(`P1#${run}`, `não respondeu procedimento de nenhum Grupo sem saber qual (usou: ${used.join(", ") || "nenhum"}; consultou: ${outcome.consulted.join(", ") || "nenhum"})`, used.length === 0)
      check(`P1#${run}`, "perguntou de qual Grupo é a dúvida, listando os 5", GROUPS.every((group) => outcome.answer.includes(group.name)))
    }
  }
  if (wants("P2")) {
    const outcome = await converse("P2", "Como a equipe de Fibra abre um reparo?", ownOrchestrators)
    results.push({ scenario: "P2", ...outcome })
    check("P2", `consultou só a Fibra (consultou: ${outcome.consulted.join(", ")})`, outcome.consulted.length === 1 && outcome.consulted[0] === "Fibra")
    check("P2", "respondeu com o processo da Fibra e nenhum outro", JSON.stringify(codesIn(outcome.answer)) === JSON.stringify(["FIB-2"]))
  }
  if (wants("P3")) {
    const outcome = await converse("P3", "Como Fibra e Móvel abrem um reparo?", ownOrchestrators)
    results.push({ scenario: "P3", ...outcome })
    check("P3", `consultou Fibra e Móvel (consultou: ${outcome.consulted.join(", ")})`, outcome.consulted.includes("Fibra") && outcome.consulted.includes("Móvel") && outcome.consulted.length === 2)
    check("P3", "respondeu os dois processos, sem outros", codesIn(outcome.answer).sort().join() === ["FIB-2", "MOV-9"].sort().join())
  }
  if (wants("P4")) {
    const outcome = await converse("P4", "Como abro um reparo?", sharedOrchestrator)
    results.push({ scenario: "P4", ...outcome })
    check("P4", `uma consulta ao Orquestrador comum (consultou: ${outcome.consulted.join(", ")})`, outcome.consulted.length === 1)
    check("P4", "respondeu o processo geral", outcome.answer.includes("Portal Técnico") || outcome.answer.includes("GER-1"))
  }
}

main()
  .catch((error) => {
    if (error instanceof BudgetStop) console.error(`PARADO: ${error.message}`)
    else console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    const file = join(OUT_DIR, `gestores-grupos-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
    writeFileSync(file, JSON.stringify({ capUsd: CAP_USD, spentUsd, ledger, checks, results }, null, 1))
    console.log(`\n${checks.filter((item) => item.pass).length}/${checks.length} verificações passaram · ${ledger.length} chamadas · US$ ${spentUsd.toFixed(4)}`)
    console.log(`Respostas completas: ${file}`)
    await pool.end()
  })
