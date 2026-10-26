/**
 * AVALIAÇÃO DAS CHAMADAS DO CENÁRIO "PRODUTOS" SEM GRAVAR NADA (21/10/2026) — banco só de leitura e memória em camada: nenhuma linha em
 * call_assessments, mensagens ou Acompanhamento; a composição e as demais etapas do motor nunca são chamadas (só análise da chamada).
 *
 * Três modos:
 *   - replay (padrão, SEM CUSTO): as respostas já pagas (análise, revisão, confirmação) gravadas na última avaliação de cada chamada
 *     alimentam um modelo falso; pedidos a provedores de IA ficam bloqueados. Mostra o que a lógica ATUAL do código faz com elas — serve
 *     para validar mudança de código. Mudança de prompt não se valida assim (a resposta é da versão antiga do prompt).
 *   - revisao (PAGO, UMA chamada): a análise é a gravada; só a revisão (e a confirmação) vão ao modelo.
 *   - completa (PAGO, UMA chamada): análise, revisão e confirmação vão ao modelo (no máximo 5 pedidos, contando as novas tentativas de
 *     formato; a revisão sozinha, no máximo 3).
 * As respostas pagas ficam num arquivo (--saida, padrão: pasta temporária) e podem ser reaproveitadas no replay com --respostas.
 *
 *   npx tsx scripts/dev/larissa-scenario/produtos/avaliar.ts [SV01,RP03…]
 *   npx tsx scripts/dev/larissa-scenario/produtos/avaliar.ts SV05 --respostas /tmp/pago-SV05-….json
 *   npx tsx scripts/dev/larissa-scenario/produtos/avaliar.ts SV05 --modo completa [--saida <pasta>]
 *
 * O replay precisa da última avaliação paga de cada chamada no banco (o "Executar agora" dos Workflows de teste); o modo pago, não (usa o
 * agente de teste do processo). Custo do modo pago: estimativa pelos tokens (as chamadas deste script não entram no registro de uso).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import "../../../../src/config/env.js"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { analyzeCall } from "../../../../src/modules/feedback-engine/application/analyze-call.js"
import { DEFAULT_ENGINE_BUDGET } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import type { EngineModelPort, EngineModelRequest } from "../../../../src/modules/feedback-engine/application/ports.js"
import type { ProductApplicabilityRecord } from "../../../../src/modules/feedback-engine/domain/product-applicability.js"
import { createGatewayEngineModel } from "../../../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { generateForRoute } from "../../../../src/shared/application/model-routing/llm-gateway.js"
import { CHAMADAS_REPARO } from "./chamadas-reparo.js"
import { CHAMADAS_EXTRAS } from "./chamadas-extras.js"
import { CHAMADAS_SEGUNDA_VIA } from "./chamadas-segunda-via.js"
import { AGENTS, PREFIX } from "./conteudo.js"
import { CHAMADAS_EXCECAO, EXCECAO_AGENT } from "./excecao-conteudo.js"

/** O mesmo prefixo do `external_id` que `cenario-produtos.ts` grava nas chamadas. */
const EXTERNAL_ID_PREFIX = "SCENARIO-PRODUTOS-"
const args = process.argv.slice(2)
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? null : null)
const mode = (option("--modo") ?? "replay") as "replay" | "revisao" | "completa"
if (!["replay", "revisao", "completa"].includes(mode)) throw new Error("--modo: replay, revisao ou completa.")
const keys = args[0] && !args[0].startsWith("--") ? new Set(args[0].split(",")) : null
if (mode !== "replay" && keys?.size !== 1) throw new Error("O modo pago avalia UMA chamada por vez (ex.: SV05 --modo completa).")
const savedPath = option("--respostas")
if (savedPath && keys?.size !== 1) throw new Error("--respostas vale para UMA chamada.")

const PAID_STAGES = new Set<EngineModelRequest["stage"]>(["CALL_ANALYSIS", "CALL_REVIEW", "CALL_CONFIRMATION"])
// Análise (+1 de formato), revisão (+1 de formato) e confirmação.
const MAX_REQUESTS = mode === "completa" ? 5 : mode === "revisao" ? 3 : 0
let providerRequests = 0
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (/generativelanguage|googleapis|anthropic|openai|x\.ai|ollama|11434/.test(url)) {
    providerRequests++
    if (providerRequests > MAX_REQUESTS) throw new Error(`TRAVA: ${mode === "replay" ? "replay não chama provedores" : `mais de ${MAX_REQUESTS} pedidos a provedores`}.`)
  }
  return realFetch(input, init)
}) as typeof fetch

type Stored = { text: string } | null
type Responses = { analysis: Stored; review: Stored; confirmation: Stored }
const expected = new Map([...CHAMADAS_SEGUNDA_VIA, ...CHAMADAS_REPARO, ...CHAMADAS_EXTRAS, ...CHAMADAS_EXCECAO].map((call) => [call.key, call.intent]))
const real = createGatewayEngineModel({ generate: (request) => generateForRoute({ ...request, transport: { ...request.transport, retries: 0 } }) })
const readDb = createReadOnlyDatabase(pool)

type Criterion = { documentId: string; text: string; status: string; downgrades?: string[]; productApplicability?: { effect: string; reason: string | null } }
const identificationLine = (record: ProductApplicabilityRecord | null | undefined) => {
  if (!record) return "sem avaliação"
  const name = (handle: string) => record.catalog.nodes.find((node) => node.handle === handle)?.name ?? handle
  return record.requests.map((request) => `${request.status} ${request.identified ? name(request.identified) : (request.possible ?? []).map(name).join("/")}`.trim()).join(" | ")
}

try {
  const runs = (await pool.query<{ key: string; organization_id: string; person_id: string; interaction_id: string; agent_id: string; responses: Responses | null; identification: ProductApplicabilityRecord | null }>(
    // Pessoa e agente: os da última execução; chamada nunca executada usa o agente de teste do processo (SV = segunda via, RP = reparo, EX = exceção).
    `select replace(i.external_id, $1, '') key, i.organization_id, i.operator_id person_id, i.id interaction_id,
            coalesce(r.agent_id, (select g.id from agents g where g.organization_id = i.organization_id and g.name = case when i.external_id like $1 || 'SV%' then $2 when i.external_id like $1 || 'EX%' then $4 else $3 end limit 1)) agent_id,
            r.provenance->'modelResponses' responses, a.product_identification identification
       from interactions i
       left join lateral (select * from feedback_analysis_runs x where x.interaction_id = i.id and x.kind = 'CALL_ANALYSIS'
                          order by (x.status = 'COMPLETED' and x.provenance->'modelResponses'->'analysis' is not null) desc, x.created_at desc limit 1) r on true
       left join call_assessments a on a.interaction_id = i.id and a.is_current
      where i.external_id like $1 || '%'`,
    [EXTERNAL_ID_PREFIX, AGENTS.SEGUNDA_VIA.name, AGENTS.REPARO.name, EXCECAO_AGENT.name],
  )).rows.filter((row) => !keys || keys.has(row.key)).sort((a, b) => a.key.localeCompare(b.key)).map((row) => ({ ...row, responses: row.responses ?? { analysis: null, review: null, confirmation: null } }))
  if (runs.length === 0) throw new Error("Nenhuma chamada do cenário com essas chaves (rode cenario-produtos.ts --chamadas).")
  if (savedPath) {
    const saved = JSON.parse(readFileSync(savedPath, "utf8")) as { stage: string; text: string }[]
    const pick = (stage: string): Stored => saved.find((entry) => entry.stage === stage) ?? null
    runs[0]!.responses = { analysis: pick("CALL_ANALYSIS") ?? runs[0]!.responses.analysis, review: pick("CALL_REVIEW"), confirmation: pick("CALL_CONFIRMATION") }
  }
  const spent: { stage: string; inputTokens: number; outputTokens: number }[] = []
  const paid: { stage: string; text: string }[] = []
  for (const run of runs) {
    const overlay = createInMemoryFeedbackMemoryStore()
    const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)
    const model: EngineModelPort = {
      async generate(request) {
        if (!PAID_STAGES.has(request.stage)) throw Object.assign(new Error(`etapa ${request.stage} bloqueada.`), { name: "EvaluationStop" })
        const stored = request.stage === "CALL_ANALYSIS" ? run.responses.analysis : request.stage === "CALL_REVIEW" ? run.responses.review : run.responses.confirmation
        const replay = mode === "replay" || (mode === "revisao" && request.stage === "CALL_ANALYSIS")
        if (replay) {
          if (!stored) throw Object.assign(new Error(`etapa ${request.stage} sem resposta gravada.`), { name: "EvaluationStop" })
          return { text: stored.text, model: "gravada", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 0, costUsd: 0, finishReason: "STOP" }
        }
        const response = await real.generate(request)
        spent.push({ stage: request.stage, inputTokens: response.usage?.inputTokens ?? 0, outputTokens: response.usage?.outputTokens ?? 0 })
        paid.push({ stage: request.stage, text: response.text })
        return response
      },
    }
    const deps = createEngineDeps({ db: readDb, stores, model, peerCallAnalyses: false, allowCollaborator: (id) => id === run.person_id, budget: { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: 12 } })
    // Direto na análise: a monitoria já entregue desta chamada (uma por chamada) faria o "Gerar feedback" abster.
    const analyzed = await analyzeCall(deps.analyze, { organizationId: run.organization_id, interactionId: run.interaction_id, collaboratorId: run.person_id, agentId: run.agent_id, trigger: { kind: "EVALUATION", selectionReason: `Avaliação sem gravar (${mode}).` } }).catch((error: unknown) => {
      console.log(`${run.key}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    })
    const analysis = analyzed?.assessment?.analysis as { productApplicability?: ProductApplicabilityRecord; criteria: Criterion[] } | undefined
    const intent = expected.get(run.key)
    console.log("=".repeat(110))
    console.log(`${run.key} · esperado: ${intent?.expectedIdentification ?? "?"} · erros plantados: ${intent?.failures.join(", ") || "—"}`)
    console.log(`  gravado : ${identificationLine(run.identification)}`)
    console.log(`  agora   : ${identificationLine(analysis?.productApplicability)}`)
    if (!analysis) continue
    const record = analysis.productApplicability
    const name = (handle: string) => record?.catalog.nodes.find((node) => node.handle === handle)?.name ?? handle
    for (const request of record?.requests ?? []) for (const unit of request.evidence) console.log(`    ${request.ref} ${unit.reader}:${unit.kind}:${unit.role}${unit.reason ? `(${unit.reason})` : ""} ${unit.supports.map(name).join("/")} «${(unit.quote ?? "").slice(0, 60)}»`)
    const ids = [...new Set(analysis.criteria.map((criterion) => criterion.documentId))].filter((id) => /^[0-9a-f-]{36}$/.test(id))
    const titles = new Map((await pool.query<{ id: string; title: string }>(`select id, title from knowledge_documents where id = any($1::uuid[])`, [ids])).rows.map((row) => [row.id, row.title.replace(PREFIX, "").trim()]))
    for (const criterion of analysis.criteria) {
      const product = criterion.productApplicability && criterion.productApplicability.effect !== "INDEPENDENT"
      if (!product && criterion.status !== "NOT_MET" && criterion.status !== "PARTIAL") continue
      const why = criterion.status === "NOT_OBSERVABLE" && criterion.downgrades?.length ? ` ⟵ ${criterion.downgrades.at(-1)}` : ""
      console.log(`    ${criterion.status.padEnd(15)} ${(criterion.productApplicability?.effect ?? "-").padEnd(12)} ${(titles.get(criterion.documentId) ?? "argumentário").slice(0, 40).padEnd(40)} · ${criterion.text.replace(/\s+/g, " ").slice(0, 90)}${why}`)
    }
  }
  console.log(`\nmodo: ${mode} · pedidos a provedores de IA: ${providerRequests}`)
  if (spent.length > 0) {
    for (const entry of spent) console.log(`  ${entry.stage}: ${entry.inputTokens} entrada + ${entry.outputTokens} saída`)
    console.log(`  estimativa: US$ ${spent.reduce((sum, entry) => sum + entry.inputTokens * 2e-6 + entry.outputTokens * 12e-6, 0).toFixed(3)} (US$ 2/M entrada, US$ 12/M saída)`)
    const out = join(option("--saida") ?? tmpdir(), `pago-${runs[0]!.key}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
    writeFileSync(out, JSON.stringify(paid, null, 1))
    console.log(`  respostas pagas: ${out} (replay: --respostas ${out})`)
  }
} finally {
  await pool.end()
}
