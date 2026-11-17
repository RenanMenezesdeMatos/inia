/**
 * BATERIA PAGA — COMUNICADOS E ALINHAMENTOS NA CONVERSA (`PUBLICATION_RELEVANCE_V1`, 17/11/2026). Modelo REAL, teto de US$ 1 (regra do
 * usuário). Nada é gravado em conversa: a camada A só LÊ o banco dev (comunicados no ar da pessoa); o gateway registra o uso de IA.
 *
 *   npx tsx scripts/dev/communications/paid-relevance-battery.ts --pessoa <personId> [--teto 1] [--so A,B]
 *
 * A — PONTA A PONTA no caminho do chat de texto (sem a tela): para cada pergunta, a decisão de comunicados/alinhamentos e o
 *     esclarecimento pelas bases correm como no `realtime-router` (mesmos serviços), `clarificationYieldsTo` decide quem responde e,
 *     quando é o agente, a orquestração real responde (o comunicado entra pelo prompt). Confere: escolhidos, quem respondeu e o texto.
 * B — SÓ A DECISÃO, com um catálogo maior em memória (comunicados de outros assuntos e um alinhamento) — a prova de que pergunta vaga
 *     ou de outro assunto não puxa comunicado aleatório.
 * Orçamento: antes de cada passo pago, o gasto desta execução + a reserva do passo tem de caber no teto; senão, para. O gasto vem da
 * telemetria das próprias chamadas (`runWithLlmTelemetry`: custo informado/estimado pelo gateway; sem preço, pelos tokens a US$ 2/M
 * entrada e US$ 12/M saída). `ai_usage_events` NÃO serve aqui: o registro de uso só acontece dentro do servidor (a 1ª rodada de
 * 17/11 leu US$ 0 por isso).
 */
import "../../../src/config/env.js"
import { pool } from "../../../src/infrastructure/database/pool.js"
import { resolveOrchestratorForSubject } from "../../../src/modules/assistant/application/resolve-orchestrator.js"
import { runOrchestratedReply } from "../../../src/modules/assistant/application/run-orchestrated-reply.js"
import { gatewayPublicationRelevanceModel } from "../../../src/modules/communications/application/publication-relevance-model.js"
import { clarificationYieldsTo, parseRelevanceSelection, PUBLICATION_RELEVANCE_SYSTEM, renderRelevanceRequest, type RelevanceInput } from "../../../src/modules/communications/domain/publication-relevance.js"
import { conversationPublicationsFor } from "../../../src/modules/communications/infrastructure/conversation-publications.js"
import { loadReadableKnowledge, postgresReadableKnowledgePorts } from "../../../src/modules/knowledge/application/knowledge-catalog.js"
import { knowledgeScaleRetrievalEnabled, sharedKnowledgeRecall } from "../../../src/modules/knowledge/application/knowledge-recall.js"
import { gatewayClarificationModel } from "../../../src/modules/knowledge-clarification/application/clarification-model.js"
import { loadClarificationGuardrails, loadSpecialistInstructions } from "../../../src/modules/knowledge-clarification/application/clarification-context.js"
import { createKnowledgeClarification } from "../../../src/modules/knowledge-clarification/application/knowledge-clarification-service.js"
import { createLlmTelemetryStore, runWithLlmTelemetry } from "../../../src/shared/application/llm-telemetry.js"
import { runWithAiOrganization } from "../../../src/shared/application/model-routing/ai-runtime.js"
import { costTotal } from "../../../src/shared/application/model-routing/model-pricing.js"

const args = process.argv.slice(2)
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? null : null)
const CAP_USD = Number(option("--teto") ?? 1)
const PERSON = option("--pessoa")
const ONLY = option("--so") ? new Set(option("--so")!.split(",")) : null
const ORG = "00000000-0000-4000-8000-000000000001"
if (!PERSON) throw new Error("Informe --pessoa <personId>.")
const telemetry = createLlmTelemetryStore({ policy: "REAL" })

class BudgetStop extends Error {}
async function spentUsd(): Promise<number> {
  return telemetry.calls.reduce((sum, call) => sum + (costTotal(call.cost) ?? ((call.promptTokens ?? 0) * 2 + ((call.outputTokens ?? 0) + (call.reasoningTokens ?? 0)) * 12) / 1_000_000), 0)
}
async function guard(reserve: number, label: string) {
  const spent = await spentUsd()
  if (spent + reserve > CAP_USD) throw new BudgetStop(`teto US$ ${CAP_USD}: gasto US$ ${spent.toFixed(4)} + reserva de "${label}" US$ ${reserve}`)
}

type Expect = { picks: "NONE" | "ANY" | string[]; answer?: RegExp; /** O funil (pergunta em aberto) tem de continuar — mesmo se a IA tivesse escolhido um comunicado/alinhamento. */ funnel?: boolean }
type Case = { id: string; question: string; expect: Expect; note?: string }

// ------------------------------------------------------------------------------------------------ A — ponta a ponta (banco dev)
const A_CASES: Case[] = [
  { id: "A-P1", question: "E sobre o comunicado de natal?", expect: { picks: "ANY", answer: /23\/11|Santa Praia/i } },
  { id: "A-P2", question: "Tem algo sobre a festa de fim de ano?", expect: { picks: "ANY", answer: /23\/11|Santa Praia/i } },
  { id: "A-P3", question: "Quais os comunicados?", expect: { picks: "ANY", answer: /festa|natal|23\/11/i } },
  { id: "A-P4", question: "O que a liderança avisou essa semana?", expect: { picks: "ANY", answer: /festa|natal|23\/11/i } },
  { id: "A-N1", question: "e aí?", expect: { picks: "NONE" } },
  { id: "A-N2", question: "me ajuda", expect: { picks: "NONE" } },
  { id: "A-N3", question: "Como faço a segunda via da fatura?", expect: { picks: "NONE" } },
  { id: "A-N4", question: "Como faço a alteração de dados cadastrais do gestor?", expect: { picks: "NONE" } },
  { id: "A-F1", question: "Reparo", expect: { picks: "NONE", funnel: true }, note: "funil: \"qual reparo?\"" },
  { id: "A-D1", question: "tem novidade?", expect: { picks: "ANY" }, note: "decisão: pedido de novidades = pedido de avisos da liderança" },
]

// ------------------------------------------------------------------------------------------------ B — só a decisão (catálogo maior)
const at = (iso: string) => new Date(iso)
const B_CATALOG: Pick<RelevanceInput, "communications" | "alignments"> = {
  communications: [
    { id: "festa", title: "Festa de fim de ano: 23/11 em Fortaleza e Curitiba", summary: "Confraternização de Natal e fim de ano no dia 23/11.", plainText: "", publishedAt: at("2026-11-17T18:11:00Z"), tags: ["Aviso"] },
    { id: "app", title: "Segunda via da fatura no App Meu Vivo", summary: "Onde fica a segunda via no app: Conta > Faturas.", plainText: "", publishedAt: at("2026-11-12T13:00:00Z"), tags: ["Processos"] },
    { id: "manut", title: "Manutenção do sistema de atendimento no sábado", summary: "O sistema fica fora do ar das 22h às 2h de sábado para domingo.", plainText: "", publishedAt: at("2026-11-14T12:00:00Z"), tags: ["Aviso"] },
    { id: "bf", title: "Campanha Black Friday", summary: "Ofertas de planos pós-pago válidas de 24 a 30/11.", plainText: "", publishedAt: at("2026-11-16T12:00:00Z"), tags: ["Campanha"] },
    { id: "ponto", title: "Novo registro de ponto pelo app RH", summary: "A partir de 01/12 o ponto passa a ser registrado pelo app do RH.", plainText: "", publishedAt: at("2026-11-10T12:00:00Z"), tags: ["Aviso"] },
  ],
  alignments: [
    { alignmentId: "envio-fatura", title: "Fatura: orientar o app em vez de enviar", guidance: "Durante a troca do sistema, oriente o cliente a acessar a fatura pelo App Meu Vivo ou pelo site. Não envie a fatura por e-mail.", processes: ["PR — Envio de fatura"], startsOn: "2026-11-10", endsOn: "2026-11-30" },
  ],
}
const B_CASES: Case[] = [
  { id: "B-P1", question: "E sobre o comunicado de natal?", expect: { picks: ["festa"] } },
  { id: "B-P2", question: "O sistema vai parar no fim de semana?", expect: { picks: ["manut"] } },
  { id: "B-P3", question: "O cliente quer que eu mande a fatura por e-mail, posso?", expect: { picks: ["envio-fatura"] }, note: "o alinhamento muda o processo; o comunicado do app pode vir junto" },
  { id: "B-P4", question: "Quais alinhamentos estão valendo pra mim?", expect: { picks: ["envio-fatura"] } },
  { id: "B-P5", question: "Quais os comunicados?", expect: { picks: "ANY" } },
  { id: "B-N1", question: "e aí?", expect: { picks: "NONE" } },
  { id: "B-N2", question: "me ajuda", expect: { picks: "NONE" } },
  { id: "B-N3", question: "Como faço a portabilidade de número?", expect: { picks: "NONE" } },
  { id: "B-N4", question: "Qual o meu TMA de ontem?", expect: { picks: "NONE" } },
  { id: "B-N5", question: "obrigado!", expect: { picks: "NONE" } },
  { id: "B-N6", question: "O cliente quer cancelar a linha, o que faço?", expect: { picks: "NONE" } },
]

function judge(expect: Expect, picked: string[]): boolean {
  if (expect.picks === "NONE") return picked.length === 0
  if (expect.picks === "ANY") return picked.length > 0
  return expect.picks.every((id) => picked.includes(id))
}

const results: { id: string; ok: boolean; detail: string }[] = []

async function runA() {
  const orchestrator = await resolveOrchestratorForSubject(pool, ORG, PERSON!, "INTERACTIVE")
  if (!orchestrator) throw new Error("A pessoa não tem Orquestrador interativo.")
  const clarification = createKnowledgeClarification({
    knowledge: (request) => loadReadableKnowledge(request, postgresReadableKnowledgePorts(pool)),
    model: gatewayClarificationModel,
    guardrails: (organizationId, agentIds) => loadClarificationGuardrails(pool, organizationId, agentIds),
    specialistInstructions: (organizationId, agentIds) => loadSpecialistInstructions(pool, organizationId, agentIds),
    now: () => new Date(),
    recall: knowledgeScaleRetrievalEnabled() ? sharedKnowledgeRecall(pool) : null,
  })
  for (const item of A_CASES) {
    if (ONLY && !ONLY.has("A") && !ONLY.has(item.id)) continue
    await guard(0.06, item.id)
    const history = [{ role: "user" as const, text: item.question }]
    const [publications, decision] = await Promise.all([
      conversationPublicationsFor(pool, { organizationId: ORG, personId: PERSON!, question: item.question, recentTurns: [] }),
      clarification.handle({ organizationId: ORG, personId: PERSON!, orchestratorAgentId: orchestrator.orchestratorAgentId || null, specialistAgentIds: orchestrator.specialists.map((specialist) => specialist.agentId), text: item.question, answer: null, previous: null, recentTurns: [] }),
    ])
    const yielded = decision.kind === "REPLY" ? clarificationYieldsTo(decision, publications) : null
    const picked = [...publications.selection.communicationIds, ...publications.selection.alignmentIds]
    const titles = publications.communications.map((entry) => entry.title)
    let answeredBy = decision.kind === "REPLY" && !yielded ? `BASES (${decision.state.status})` : `AGENTE${yielded ? ` (cedido: ${yielded})` : ""}`
    let text = decision.kind === "REPLY" && !yielded ? decision.content : ""
    if (!text && item.expect.answer) {
      await guard(0.08, `${item.id} agente`)
      const reply = await runOrchestratedReply(pool, orchestrator, history, "", PERSON!, { collaboratorConversation: true }, {}, { toleratesToolFailure: true })
      text = reply.text
    } else if (!text) answeredBy += " — orquestração não executada (sem verificação de texto)"
    // Funil: a resposta das bases é uma pergunta em aberto e continua sendo, mesmo com um comunicado/alinhamento escolhido (forçado aqui).
    const funnelOk = !item.expect.funnel || (decision.kind === "REPLY" && decision.state.status === "OPEN" && clarificationYieldsTo(decision, { selection: { communicationIds: ["forçado"], alignmentIds: ["forçado"] }, alignmentsInForce: [] }) === null)
    if (item.expect.funnel) answeredBy += funnelOk ? " — funil mantido (também com escolha forçada)" : " — FUNIL PERDIDO"
    const pickOk = judge(item.expect, picked) && funnelOk
    const answerOk = item.expect.answer ? item.expect.answer.test(text) : true
    const ok = pickOk && answerOk
    results.push({ id: item.id, ok, detail: `«${item.question}» → escolhidos: ${titles.length ? titles.join(" | ") : "nenhum"} · consultou IA: ${publications.consulted} · respondeu: ${answeredBy}${item.note ? ` · ${item.note}` : ""}\n      ${text ? `resposta: ${text.replace(/\s+/g, " ").slice(0, ONLY ? 4000 : 320)}` : ""}` })
    console.log(`${ok ? "OK  " : "FALHA"} ${item.id} ${results.at(-1)!.detail}`)
  }
}

async function runB() {
  for (const item of B_CASES) {
    if (ONLY && !ONLY.has("B") && !ONLY.has(item.id)) continue
    await guard(0.01, item.id)
    const request: RelevanceInput = { question: item.question, communications: B_CATALOG.communications, alignments: B_CATALOG.alignments, timeZone: "America/Sao_Paulo" }
    const raw = await runWithAiOrganization(ORG, () => gatewayPublicationRelevanceModel({ organizationId: ORG, system: PUBLICATION_RELEVANCE_SYSTEM, user: renderRelevanceRequest(request) }))
    const selection = parseRelevanceSelection(raw, request)
    const picked = [...selection.communicationIds, ...selection.alignmentIds]
    const ok = judge(item.expect, picked)
    results.push({ id: item.id, ok, detail: `«${item.question}» → ${picked.length ? picked.join(", ") : "nenhum"}${item.note ? ` · ${item.note}` : ""}` })
    console.log(`${ok ? "OK  " : "FALHA"} ${item.id} ${results.at(-1)!.detail}`)
  }
}

await runWithLlmTelemetry(telemetry, async () => {
try {
  console.log(`Bateria paga — teto US$ ${CAP_USD}`)
  if (!ONLY || ONLY.has("B") || [...ONLY].some((id) => id.startsWith("B-"))) {
    console.log("\nB — decisão com catálogo maior")
    await runB()
  }
  if (!ONLY || ONLY.has("A") || [...ONLY].some((id) => id.startsWith("A-"))) {
    console.log("\nA — ponta a ponta (banco dev)")
    await runA()
  }
} catch (error) {
  if (error instanceof BudgetStop) console.log(`\nPAROU: ${error.message}`)
  else throw error
} finally {
  await new Promise((resolve) => setTimeout(resolve, 3_000))
  const passed = results.filter((result) => result.ok).length
  console.log(`\nResultado: ${passed}/${results.length} · ${telemetry.calls.length} chamadas de IA · gasto US$ ${(await spentUsd()).toFixed(4)}`)
  await pool.end()
}
})
