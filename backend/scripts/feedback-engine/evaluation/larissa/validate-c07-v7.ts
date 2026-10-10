/**
 * SUBSTITUÍDO por `evaluate-round-v8.ts` (02/10): este script simulava vigência dos argumentários (início 30 dias antes da chamada) —
 * nunca o execute. AVALIAÇÃO MÍNIMA FUTURA (preparada, NÃO executada em 01/10/2026): C07 da Larissa Monteiro (DEMO-OP-0001) com o contrato
 * `CALL_ANALYSIS_PROMPT_V5` / `CALL_ANALYSIS_LOGIC_V7` (aplicabilidade × evidência × cumprimento semânticos, regra composta por parte)
 * e com os 6 ARGUMENTÁRIOS do anexo (contas em atraso, bloqueio após pagamento, cartão, segunda via, técnico fixo, franquia) injetados
 * EM MEMÓRIA como se estivessem vigentes na data da chamada — nenhum deles descreve a situação da C07, então o motor NÃO deveria
 * aplicá-los (teste negativo de gatilho por situação, não por palavras). Plano e critérios: docs/dev/feedback-engine.md › Avaliação
 * futura C07 (V7). O gabarito de 30/09 ("Corrigir o status" como desvio obrigatório) é ANTERIOR ao princípio atual e não vale aqui.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/validate-c07-v7.ts                                   → ENSAIO: zero requisição
 *   npx tsx scripts/feedback-engine/evaluation/larissa/validate-c07-v7.ts --execute --authorized-by-user     → rodada PAGA única
 *
 * Travas (iguais às rodadas anteriores): orçamento na fronteira HTTP (cada POST, inclusive nova tentativa, com reserva do pior caso),
 * teto de requisições do medidor, retry de transporte 0, só a Larissa, sem pares, banco SOMENTE LEITURA, memória e mensagens na RAM,
 * nada publicado/entregue/notificado, gabarito fora do motor. Existindo artefato pago desta rodada, nova execução é recusada.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { generateForRoute } from "../../../../src/shared/application/model-routing/llm-gateway.js"
import { argumentScriptSourceOf, normalizeArgumentScriptContent, type ArgumentScriptContentInput, type ArgumentScriptSource } from "../../../../src/modules/argument-scripts/domain/argument-script.js"
import { DEFAULT_ENGINE_BUDGET } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { generateFeedback } from "../../../../src/modules/feedback-engine/application/generate-feedback.js"
import type { EngineModelPort } from "../../../../src/modules/feedback-engine/application/ports.js"
import { CALL_ANALYSIS_LOGIC_VERSION, CALL_ANALYSIS_PROMPT_VERSION, COMPOSITION_PROMPT_VERSION, COMPOSITION_VERSION, VERIFICATION_PROMPT_VERSION } from "../../../../src/modules/feedback-engine/domain/versions.js"
import { CALL_REVIEW_PROMPT_VERSION } from "../../../../src/modules/feedback-engine/domain/call-review.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "../../../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { createPaidBudget } from "../paid-budget.js"
import { loadFrozenSources } from "./frozen-call.js"

const here = dirname(fileURLToPath(import.meta.url))
const execute = process.argv.includes("--execute")
if (execute) throw new Error("Substituído por evaluate-round-v8.ts: este script simulava vigência dos argumentários.")
if (execute && !process.argv.includes("--authorized-by-user")) throw new Error("Rodada paga só com autorização explícita do usuário (--authorized-by-user).")
if (execute && readdirSync(join(here, "results")).some((name) => name.startsWith("validate-c07-v7-paid-"))) throw new Error("Rodada paga V7 já executada: não repita para escolher outro texto.")
/** análise + revisão + redação + verificação (4) + folga para UMA reescrita (redação + verificação). */
const LIMITS = { maxRequests: 6, maxUsd: 0.3, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }
const KEY = "C07"

const realFetch = globalThis.fetch
if (!execute) globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (LIMITS.hostPattern.test(url) || /anthropic|openai|x\.ai/.test(url)) throw new Error(`ENSAIO: requisição a ${new URL(url).host} bloqueada.`)
  return realFetch(input, init)
}) as typeof fetch

/** Os 6 cenários do anexo "Argumentário Sugerido" (campos preservados; nada inventado além da classificação deve/pode do próprio texto). */
const SCENARIOS: { name: string; content: ArgumentScriptContentInput }[] = [
  { name: "Contas em atraso", content: { trigger: "Durante a ligação, o cliente ou o colaborador menciona contas em atraso.", operatorGuidance: [{ text: "Indicar a utilização do Vivo em Dia para consultar os valores em aberto e verificar opções de parcelamento, caso necessário.", modality: "MUST" }], requiredPoints: [{ mode: "ALL", items: [{ text: "Orientar o acesso ao Vivo em Dia e mencionar a possibilidade de consultar débitos e opções de parcelamento.", condition: null }] }], avoid: [{ text: "Não garantir condições, quantidade de parcelas ou aprovação antes da consulta." }, { text: "Não mencionar nomes de sistemas internos." }], suggestedScript: "Para consultar os valores em aberto e verificar as opções de parcelamento disponíveis, você pode acessar o Vivo em Dia. Por lá, é possível visualizar os débitos e escolher a melhor alternativa para regularização.", monitoringReference: "A transcrição deve registrar a indicação do Vivo em Dia, a consulta de valores em aberto e a possibilidade de parcelamento." } },
  { name: "Bloqueio após pagamento", content: { trigger: "O cliente informa que os serviços estão bloqueados, que já realizou o pagamento das faturas e deseja o desbloqueio.", operatorGuidance: [{ text: "Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente. Em caso positivo, orientar que a solicitação pode ser realizada pelo aplicativo.", modality: "MUST" }], requiredPoints: [{ mode: "ALL", items: [{ text: "Condicionar a orientação à disponibilidade da funcionalidade para o cliente.", condition: null }] }], avoid: [{ text: "Não prometer desbloqueio imediato." }, { text: "Não afirmar que a funcionalidade está disponível sem validar." }, { text: "Não mencionar nomes de sistemas internos." }], suggestedScript: "Vou verificar as opções disponíveis para o seu atendimento. Caso a funcionalidade esteja disponível, você poderá informar o pagamento diretamente pelo aplicativo, de forma rápida e prática.", monitoringReference: "A transcrição deve demonstrar que o operador verificou a disponibilidade e orientou o uso do aplicativo somente quando aplicável." } },
  { name: "Pagamento com cartão (serviço bloqueado)", content: { trigger: "O cliente informa que os serviços estão bloqueados e demonstra necessidade de regularizar a fatura.", operatorGuidance: [{ text: "Informar que, quando a opção estiver disponível, o pagamento pode ser realizado com cartão de crédito pelo aplicativo. Esclarecer que, para utilizar essa opção, o cliente precisa cadastrar o cartão no aplicativo.", modality: "MUST" }], requiredPoints: [{ mode: "ALL", items: [{ text: "Apresentar o cartão de crédito como alternativa, condicionada à disponibilidade, e informar a necessidade de cadastrar o cartão no aplicativo.", condition: null }] }], avoid: [{ text: "Não pressionar o cliente a escolher a forma de pagamento." }, { text: "Não prometer liberação imediata do serviço." }, { text: "Não mencionar nomes de sistemas internos." }], suggestedScript: "Se preferir e a opção estiver disponível para você, o pagamento pode ser realizado com cartão de crédito pelo aplicativo. Para utilizar essa alternativa, é necessário cadastrar o cartão no próprio aplicativo.", monitoringReference: "A transcrição deve conter a orientação sobre pagamento com cartão de crédito, a necessidade de cadastrar o cartão no aplicativo e a ausência de garantia de disponibilização ou desbloqueio imediato." } },
  { name: "Segunda via", content: { trigger: "Durante a ligação, o cliente solicita a segunda via da fatura ou do parcelamento.", operatorGuidance: [{ text: "Verificar se a solicitação é referente à segunda via da fatura ou do parcelamento. Após a confirmação, orientar o cliente sobre a consulta pelo aplicativo, conforme a opção disponível.", modality: "MUST" }], requiredPoints: [{ mode: "ALL", items: [{ text: "Confirmar se a solicitação é de segunda via da fatura ou do parcelamento antes de orientar o acesso pelo aplicativo.", condition: null }] }], avoid: [{ text: "Não encerrar o atendimento sem tratar a necessidade apresentada pelo cliente." }, { text: "Não mencionar nomes de sistemas internos." }], suggestedScript: "Para te orientar corretamente, preciso confirmar: você precisa da segunda via da fatura ou do parcelamento? Após essa confirmação, vou indicar como realizar a consulta pelo aplicativo.", monitoringReference: "A transcrição deve registrar a confirmação do tipo de segunda via solicitada, fatura ou parcelamento, e a orientação de consulta pelo aplicativo." } },
  { name: "Problema técnico no serviço fixo", content: { trigger: "O cliente menciona problema técnico no serviço fixo, por exemplo, internet sem funcionamento.", operatorGuidance: [{ text: "Realizar o suporte conforme o fluxo aplicável. Caso seja necessário abrir reparo, informar que o status poderá ser acompanhado pelo aplicativo.", modality: "MUST" }], requiredPoints: [{ mode: "ALL", items: [{ text: "Prestar suporte antes de direcionar o acompanhamento.", condition: null }, { text: "Mencionar o aplicativo para acompanhar o reparo.", condition: "houver abertura de reparo" }] }], avoid: [{ text: "Não direcionar apenas ao aplicativo sem prestar o suporte." }, { text: "Não prometer prazo ou solução sem respaldo." }, { text: "Não mencionar nomes de sistemas internos." }], suggestedScript: "Vou realizar as verificações necessárias para ajudar na solução. Caso seja preciso abrir um reparo, você poderá acompanhar o andamento da solicitação diretamente pelo aplicativo.", monitoringReference: "A transcrição deve demonstrar a realização do suporte e, quando houver reparo aberto, a orientação para acompanhar o status pelo aplicativo." } },
  { name: "Fim da franquia de dados", content: { trigger: "O cliente informa que está sem pacote de dados ou que a franquia de internet acabou.", operatorGuidance: [{ text: "Informar que o consumo da franquia pode ser acompanhado pelo aplicativo e que, caso precise, o cliente pode comprar um pacote adicional de dados por esse canal.", modality: "MUST" }], requiredPoints: [{ mode: "ALL", items: [{ text: "Orientar o acompanhamento do consumo da franquia e informar a possibilidade de comprar pacote adicional de dados pelo aplicativo.", condition: null }] }], avoid: [{ text: "Não afirmar que a falta de conexão está necessariamente relacionada ao fim da franquia sem realizar as validações cabíveis." }, { text: "Não mencionar nomes de sistemas internos." }], suggestedScript: "Você pode acompanhar o consumo da sua franquia de internet diretamente pelo aplicativo. Caso precise de mais dados, também poderá verificar e comprar um pacote adicional pelo próprio aplicativo, conforme as opções disponíveis para a sua linha.", monitoringReference: "A transcrição deve registrar a orientação para consultar o consumo da franquia e a possibilidade de comprar pacote adicional de dados pelo aplicativo." } },
]
const injectedScripts = (callAt: Date): ArgumentScriptSource[] => SCENARIOS.map((scenario, index) => argumentScriptSourceOf({
  scriptId: `00000000-0000-4000-8000-0000000c7a0${index + 1}`,
  versionId: `eval-${index + 1}`,
  version: 1,
  name: scenario.name,
  areaName: "Atendimento ao Cliente",
  scope: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, teamName: null, subteamName: null },
  subjectName: null,
  conversion: "NATIVE",
  content: normalizeArgumentScriptContent(scenario.content),
  contentHash: `eval-${index + 1}`,
  effectiveFrom: new Date(callAt.getTime() - 30 * 86_400_000),
  effectiveUntil: null,
  sourceDocumentId: null,
  sourceDocumentTitle: null,
  sourceReference: "Anexo: Argumentário Sugerido | Atendimento ao Cliente (29/09)",
}, null))

const readDb = createReadOnlyDatabase(pool)
const report: Record<string, unknown> = {
  kind: execute ? "PAID_VALIDATION_V7" : "DRY_RUN_V7",
  ranAt: new Date().toISOString(),
  model: ENGINE_MODEL,
  call: KEY,
  limits: LIMITS,
  versions: { analysisLogic: CALL_ANALYSIS_LOGIC_VERSION, analysisPrompt: CALL_ANALYSIS_PROMPT_VERSION, reviewPrompt: CALL_REVIEW_PROMPT_VERSION, composition: COMPOSITION_VERSION, compositionPrompt: COMPOSITION_PROMPT_VERSION, verificationPrompt: VERIFICATION_PROMPT_VERSION },
}
try {
  const frozen = await loadFrozenSources(readDb, KEY)
  const overlay = createInMemoryFeedbackMemoryStore()
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)
  const sizes: { stage: string; tag: string | null; chars: number }[] = []
  const responses: { stage: string; tag: string | null; text: string | null; error: string | null; usage: unknown }[] = []
  const budget = createPaidBudget(LIMITS, realFetch)
  if (execute) globalThis.fetch = budget.fetch
  const real = createGatewayEngineModel({ generate: (request) => generateForRoute({ ...request, transport: { ...request.transport, retries: 0 } }) })
  const model: EngineModelPort = {
    async generate(request) {
      sizes.push({ stage: request.stage, tag: request.tag ?? null, chars: request.systemPrompt.length + request.contents.reduce((sum, turn) => sum + turn.text.length, 0) })
      if (!execute) throw Object.assign(new Error("ENSAIO: pedido medido, não enviado."), { name: "DryRunStop" })
      budget.setLabel(`${KEY} · ${request.stage}${request.tag ? `:${request.tag}` : ""}`)
      try {
        const response = await real.generate(request)
        responses.push({ stage: request.stage, tag: request.tag ?? null, text: response.text, error: null, usage: response.usage ?? null })
        return response
      } catch (error) {
        responses.push({ stage: request.stage, tag: request.tag ?? null, text: null, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), usage: null })
        throw error
      }
    },
  }
  const deps = createEngineDeps({ db: readDb, stores, model, peerCallAnalyses: false, allowCollaborator: (id) => id === frozen.person.id, budget: { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: LIMITS.maxRequests } })
  const scripts = injectedScripts(frozen.interaction.startedAt)
  deps.analyze.loadArgumentScripts = async () => scripts
  report.sources = { person: { id: frozen.person.id, name: frozen.person.name, matricula: frozen.person.matricula }, interaction: { id: frozen.interaction.id, transcriptSha256: frozen.call.transcriptSha256 }, documents: frozen.chosen.selected.map((document) => ({ id: document.documentId, title: document.title, version: document.version })), argumentScripts: scripts.map((script) => ({ name: script.name, effectiveFrom: script.effectiveFrom.toISOString(), injected: "IN_MEMORY_FOR_EVALUATION" })) }
  let generation: unknown = null
  try {
    generation = await generateFeedback(deps, { organizationId: frozen.org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: `validacao-v7-${KEY}`, sourceNodeId: `analise-v7-${KEY}`, domain: "MONITORING", sourceNodeOutput: null, collaboratorId: frozen.person.id, interactionId: frozen.interaction.id, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: "Avaliação mínima V7 (C07): aplicabilidade × evidência e argumentários.", now: new Date() })
  } catch (error) {
    generation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
  const assessment = overlay.assessments.find((entry) => entry.isCurrent) ?? null
  const message = [...overlay.messages.values()][0] ?? null
  const criteria = assessment?.analysis.criteria ?? []
  report.result = {
    generation,
    stages: sizes.map((entry) => entry.stage),
    argumentScripts: assessment?.analysis.argumentScripts ?? null,
    composites: assessment?.analysis.composites ?? null,
    coverageLimits: assessment?.analysis.coverageLimits ?? null,
    determinate: criteria.filter((criterion) => ["MET", "NOT_MET", "PARTIAL"].includes(criterion.proposedStatus)).map((criterion) => ({ rule: criterion.text, part: criterion.obligation?.part ?? null, proposed: criterion.proposedStatus, final: criterion.status, confirmation: criterion.confirmation, applicability: criterion.applicability ?? null, observability: criterion.observability ?? null, executionClaim: criterion.executionClaim ?? null, requiredAction: criterion.requiredAction ?? null, evidenceNeeded: criterion.evidenceNeeded ?? null })),
    message: message ? { status: message.status, abstainReason: message.abstainReason, card: message.message?.card ?? null, text: message.message?.text ?? null, brief: message.brief } : null,
  }
  report.requests = sizes
  report.responses = responses
  report.budget = execute ? { totals: budget.totals(), ledger: budget.ledger } : null
  report.meter = deps.meter.summary()
} catch (error) {
  report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
} finally {
  await pool.end()
}
mkdirSync(join(here, "results"), { recursive: true })
const out = join(here, "results", `validate-c07-v7-${execute ? "paid" : "dry-run"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ kind: report.kind, error: report.error ?? null, requests: report.requests }, null, 2))
console.log(`\nArtefato: ${out}`)
