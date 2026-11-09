/**
 * VALIDAÇÃO DO FORMATO "RECONHECIMENTO" COM O MODELO REAL (05/11/2026). Dados fictícios sobre o agente real do banco de desenvolvimento,
 * pelo mesmo caminho do Workflow (`actionExecutors.CALL_AGENT` e `executeSynthesisAgent`). Nada é gravado: o banco é só leitura, o registro
 * de execuções é descartado e a conferência de resposta fica desligada. O uso de IA continua registrado, porque o gasto é real.
 *
 * Ensaio, sem custo (mostra o pedido do primeiro cenário e o limite de cada chamada):
 *   INIA_RESPONSE_CHECK=OFF npx tsx scripts/dev/recognition-validation.ts
 * Rodada paga, só com autorização do usuário:
 *   INIA_RESPONSE_CHECK=OFF npx tsx scripts/dev/recognition-validation.ts --execute --authorized-by-user --out <arquivo.json>
 *
 * TETO GARANTIDO: antes de cada tentativa, reserva o pior caso (entrada = bytes do corpo, pois um token nunca ocupa menos de um byte; saída e
 * raciocínio, cada um no teto de saída do pedido) pelo maior preço da tabela. Não coube, não envia. Sem preço, ou POST para outro destino, bloqueia.
 * Sem uso informado pelo provedor, a tentativa fica cobrada pela reserva. Uma chamada por vez, para a reserva valer de verdade.
 *
 * Critérios fixados ANTES de rodar, para cada texto: (C1) reconhece pelo motivo, com o número certo; (C2) todo item fora da meta é dito como
 * abaixo, com o número, e nada é tratado como meta batida; (C3) não elogia número abaixo da meta; (C4) só números fornecidos; (C5) não atribui
 * causa (esforço, dedicação, prática); (C6) não diz como melhorar; (C7) sem colegas nomeados nem promessa; (C8) fecha com o que manter e o que
 * merece atenção; (C9) lê como reconhecimento, não como cobrança. Sozinho no recorte: não sugere ter superado colegas. Evolução: não calcula
 * a variação. Síntese: separa quem ficou abaixo da meta, não atribui causa, não propõe decisão disciplinar e não diz que todos bateram a meta.
 */
import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import type { Database } from "../../src/infrastructure/database/pool.js"
import { pool } from "../../src/infrastructure/database/pool.js"
import { createAiRuntime } from "../../src/modules/ai-management/application/ai-runtime-service.js"
import { createReadOnlyDatabase } from "../../src/modules/qa-lab/application/read-only-database.js"
import { actionExecutors, type ActionExecutionContext } from "../../src/modules/workflows/application/action-executors.js"
import type { EmployeeFanInOutput } from "../../src/modules/workflows/application/consolidate-results-executor.js"
import type { EmployeeCollectionOutput, RankedMember } from "../../src/modules/workflows/application/select-employees-executor.js"
import { executeSynthesisAgent } from "../../src/modules/workflows/application/synthesis-agent-executor.js"
import type { ActionConfig, FlowGraph } from "../../src/modules/workflows/domain/graph-schema.js"
import { registerAiRuntime, runWithAiOrganization } from "../../src/shared/application/model-routing/ai-runtime.js"

const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : undefined)
const execute = process.argv.includes("--execute")
if (execute && !process.argv.includes("--authorized-by-user")) throw new Error("Rodada paga exige --authorized-by-user.")
if (process.env.INIA_RESPONSE_CHECK !== "OFF") throw new Error("Rode com INIA_RESPONSE_CHECK=OFF: a conferência faria outra chamada e gravaria no banco.")
const OUT = argument("out")
if (execute && !OUT) throw new Error("Rodada paga exige --out <arquivo.json>.")

/** O teto de US$ 1 vale para a validação inteira: rodadas anteriores descontam dele (--already-spent). */
const CAP_USD = 1 - Number(argument("already-spent") ?? 0)
const MAX_ATTEMPTS = 24
const REPETITIONS = 3
/** Rodada parcial: "--only=S1,S6,S7" roda só esses cenários (3 vezes o S7, 1 vez os demais) e as sínteses S1+S6. */
const ONLY = argument("only")?.split(",") ?? null
const ORGANIZATION = "00000000-0000-4000-8000-000000000001"
const RECOGNITION_AGENT = "ba01f07b-c2ed-422a-9af3-d911b4f50cde"
const SYNTHESIS_AGENT = "c820644d-4871-4720-b972-cbe8806a3939"
const SYNTHESIS_MISSION = "Monte a visão consolidada dos destaques do mês (melhor PRV de cada Subgrupo). Todos os listados são reconhecidos pela posição, inclusive quem ficou fora da meta: diga quem se destacou, com quais números e quem ficou fora da meta. Nos próximos passos, comece reconhecendo cada pessoa listada pela posição dela. Quem aparecer como sem reconhecimento fica fora dos destaques: diga apenas que não houve comparação. Os resultados não mostram a causa: não explique por que eles aconteceram nem sugira melhoria de processo ou técnica."

type Price = { input: number; output: number }
type Attempt = { label: string; model: string; bodyBytes: number; maxOutput: number; reservedUsd: number; spentUsd: number; usageKnown: boolean; status: number | "BLOCKED" | "DRY_RUN"; promptTokens: number | null; outputTokens: number | null; thoughtsTokens: number | null; ms: number }

class BudgetBlocked extends Error {}
class DryRunStop extends Error {}

/** Trava na fronteira HTTP: é ali que toda tentativa aparece, inclusive as repetições internas do cliente. */
function createGuard(prices: Map<string, Price>, defaultMaxOutput: number, base: typeof fetch) {
  const attempts: Attempt[] = []
  let label = "sem-etapa"
  let lastBody: unknown = null
  const spent = () => attempts.reduce((sum, attempt) => sum + attempt.spentUsd, 0)
  const guarded: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    if ((init?.method ?? "GET").toUpperCase() === "GET") return base(input, init)
    if (!/generativelanguage\.googleapis\.com/.test(url)) throw new BudgetBlocked(`POST para destino não previsto: ${new URL(url).host}`)
    const model = /\/models\/([^:/?]+)/.exec(url)?.[1] ?? ""
    const price = prices.get(model)
    if (!price) throw new BudgetBlocked(`Sem preço na tabela para o modelo "${model}": o teste pago não roda.`)
    const body = typeof init?.body === "string" ? init.body : null
    if (body === null) throw new BudgetBlocked("Corpo do pedido sem tamanho calculável.")
    const parsed = JSON.parse(body) as { generationConfig?: { maxOutputTokens?: number } }
    lastBody = parsed
    const bodyBytes = Buffer.byteLength(body)
    const maxOutput = parsed.generationConfig?.maxOutputTokens ?? defaultMaxOutput
    const reservedUsd = (bodyBytes * price.input + 2 * maxOutput * price.output) / 1_000_000
    const attempt: Attempt = { label, model, bodyBytes, maxOutput, reservedUsd, spentUsd: 0, usageKnown: true, status: "BLOCKED", promptTokens: null, outputTokens: null, thoughtsTokens: null, ms: 0 }
    attempts.push(attempt)
    if (!execute) {
      attempt.status = "DRY_RUN"
      throw new DryRunStop("Ensaio: pedido medido, não enviado.")
    }
    if (attempts.filter((item) => item.status !== "BLOCKED").length >= MAX_ATTEMPTS || spent() + reservedUsd > CAP_USD) throw new BudgetBlocked(`Teto: gasto US$ ${spent().toFixed(4)} + pior caso US$ ${reservedUsd.toFixed(4)} passaria de US$ ${CAP_USD}.`)
    attempt.spentUsd = reservedUsd
    attempt.usageKnown = false
    const started = Date.now()
    const response = await base(input, init)
    attempt.ms = Date.now() - started
    attempt.status = response.status
    try {
      const usage = ((await response.clone().json()) as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }).usageMetadata
      if (usage?.promptTokenCount !== undefined) {
        attempt.promptTokens = usage.promptTokenCount
        attempt.outputTokens = usage.candidatesTokenCount ?? 0
        attempt.thoughtsTokens = usage.thoughtsTokenCount ?? 0
        attempt.spentUsd = (usage.promptTokenCount * price.input + (attempt.outputTokens + attempt.thoughtsTokens) * price.output) / 1_000_000
        attempt.usageKnown = true
      }
    } catch {
      // Sem uso confirmado, fica cobrada a reserva inteira.
    }
    return response
  }
  return { fetch: guarded, attempts, spent, setLabel: (value: string) => (label = value), lastBody: () => lastBody }
}

type Prv = { period: string; achievement: number; quartile: string }
type Indicator = { period: string; code: string; name: string; unit: string; direction: "HIGHER" | "LOWER"; value: number; target: number; achievement: number; weight: number; quartile: string }
type Scenario = { key: string; description: string; employeeId: string; employeeName: string; subteam: string; basis: "BEST" | "IMPROVED"; closures: number; rankedCount: number; member: RankedMember; prv: Prv[]; indicators: Indicator[] }

const tma = (period: string, value: number, achievement: number, quartile = "Q1"): Indicator => ({ period, code: "TMA", name: "Tempo médio de atendimento", unit: "SECONDS", direction: "LOWER", value, target: 400, achievement, weight: 40, quartile })
const fcr = (period: string, value: number, achievement: number, quartile = "Q1"): Indicator => ({ period, code: "FCR", name: "Resolução no primeiro contato", unit: "PERCENT", direction: "HIGHER", value, target: 70, achievement, weight: 60, quartile })
const person = (suffix: string) => `10000000-0000-4000-8000-0000000000${suffix}`

const SCENARIOS: Scenario[] = [
  { key: "S1-acima-da-meta", description: "Melhor do Subgrupo, tudo dentro da meta", employeeId: person("01"), employeeName: "Gabriel Teste", subteam: "Voz", basis: "BEST", closures: 1, rankedCount: 12, member: { employeeId: person("01"), value: 112, position: 1 }, prv: [{ period: "2026-10", achievement: 112, quartile: "Q1" }], indicators: [tma("2026-10", 350, 114.3), fcr("2026-10", 78, 111.4)] },
  { key: "S2-prv-abaixo-misto", description: "Melhor do Subgrupo com PRV abaixo da meta, um indicador dentro e outro fora", employeeId: person("02"), employeeName: "Iara Teste", subteam: "Digital", basis: "BEST", closures: 1, rankedCount: 9, member: { employeeId: person("02"), value: 85, position: 1 }, prv: [{ period: "2026-10", achievement: 85, quartile: "Q1" }], indicators: [tma("2026-10", 350, 114.3), fcr("2026-10", 62, 88.6)] },
  { key: "S3-tudo-abaixo", description: "Melhor do Subgrupo com tudo abaixo da meta", employeeId: person("03"), employeeName: "Caio Teste", subteam: "Retenção", basis: "BEST", closures: 1, rankedCount: 15, member: { employeeId: person("03"), value: 72, position: 1 }, prv: [{ period: "2026-10", achievement: 72, quartile: "Q2" }], indicators: [tma("2026-10", 470, 85.1, "Q3"), fcr("2026-10", 58, 82.9, "Q2")] },
  { key: "S4-prv-acima-indicador-fora", description: "PRV acima da meta, com um indicador fora", employeeId: person("04"), employeeName: "Lia Teste", subteam: "Suporte", basis: "BEST", closures: 1, rankedCount: 7, member: { employeeId: person("04"), value: 104, position: 1 }, prv: [{ period: "2026-10", achievement: 104, quartile: "Q1" }], indicators: [tma("2026-10", 430, 93, "Q2"), fcr("2026-10", 80, 114.3)] },
  { key: "S5-evolucao-abaixo", description: "Maior evolução do Subgrupo, ainda abaixo da meta", employeeId: person("05"), employeeName: "Rui Teste", subteam: "Voz", basis: "IMPROVED", closures: 2, rankedCount: 10, member: { employeeId: person("05"), previousValue: 70, currentValue: 81, change: 11, performanceChange: 11, position: 1 }, prv: [{ period: "2026-10", achievement: 81, quartile: "Q2" }, { period: "2026-09", achievement: 70, quartile: "Q3" }], indicators: [tma("2026-10", 420, 95.2, "Q2"), fcr("2026-10", 64, 91.4, "Q2"), tma("2026-09", 480, 83.3, "Q3"), fcr("2026-09", 55, 78.6, "Q3")] },
  { key: "S7-sozinho-dentro-da-meta", description: "Única pessoa com dados no Subgrupo, dentro da meta", employeeId: person("07"), employeeName: "Eli Teste", subteam: "Crédito", basis: "BEST", closures: 1, rankedCount: 1, member: { employeeId: person("07"), value: 103, position: 1 }, prv: [{ period: "2026-10", achievement: 103, quartile: "Q1" }], indicators: [tma("2026-10", 390, 102.6, "Q2"), fcr("2026-10", 66, 94.3, "Q2")] },
  { key: "S6-unica-pessoa", description: "Única pessoa com dados no Subgrupo, fora da meta: não deve chamar a IA", employeeId: person("06"), employeeName: "Noa Teste", subteam: "Crédito", basis: "BEST", closures: 1, rankedCount: 1, member: { employeeId: person("06"), value: 91, position: 1 }, prv: [{ period: "2026-10", achievement: 91, quartile: "Q2" }], indicators: [tma("2026-10", 390, 102.6, "Q2"), fcr("2026-10", 66, 94.3, "Q2")] },
]

const collectionOf = (scenarios: Scenario[]): EmployeeCollectionOutput => ({
  kind: "EMPLOYEE_COLLECTION",
  mode: "RANKING",
  memberIds: scenarios.map((scenario) => scenario.employeeId),
  evaluatedCount: scenarios.reduce((sum, scenario) => sum + scenario.rankedCount, 0),
  selectedCount: scenarios.length,
  sourceKind: "STRUCTURE",
  sourceNodeId: null,
  selectedAt: new Date().toISOString(),
  ranking: { source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "MONTH" }, selection: scenarios[0]!.basis, count: 1, rankingBasis: scenarios[0]!.basis === "IMPROVED" ? "CHANGE" : "VALUE", partitionBy: "SUBTEAM" },
  direction: "HIGHER",
  partitionBy: "SUBTEAM",
  requestedCountPerPartition: 1,
  rankedCount: scenarios.reduce((sum, scenario) => sum + scenario.rankedCount, 0),
  noDataCount: 0,
  partitions: scenarios.map((scenario) => ({ id: `subgrupo-${scenario.key}`, name: scenario.subteam, evaluatedCount: scenario.rankedCount, rankedCount: scenario.rankedCount, noDataCount: 0, selectedCount: 1, members: [scenario.member], calculation: { source: "PRV_ACHIEVEMENT", indicatorCode: null, aggregation: "AVERAGE", periodLabel: "Mês anterior", windowLabel: null, previousWindowLabel: null, direction: "HIGHER", minimumCoverage: null } })),
})

const position = { x: 0, y: 0 }
const GRAPH = {
  nodes: [
    { id: "selecionar", type: "select_employees", label: "Selecionar", position, config: {} },
    { id: "aplicar", type: "apply_individually", label: "Aplicar", position, config: {} },
    { id: "agente", type: "action", label: "Reconhecer", position, config: {} },
  ],
  edges: [
    { id: "1", source: "selecionar", sourceHandle: "always", target: "aplicar" },
    { id: "2", source: "aplicar", sourceHandle: "always", target: "agente" },
  ],
} as unknown as FlowGraph

/** Só os fechamentos e as pessoas são fictícios: agente, versão, Governança e roteamento vêm do banco real, em modo leitura. */
function overlayDb(real: Database, scenarios: Scenario[]): Database {
  const respond = (rows: unknown[]) => Promise.resolve({ rows, rowCount: rows.length })
  const query = ((sql: unknown, params?: unknown[]) => {
    const text = typeof sql === "string" ? sql : ((sql as { text?: string }).text ?? "")
    const scenario = scenarios[0]!
    if (text.includes("from employee_prv_performance")) return respond(scenario.prv.map((row, index) => ({ id: `prv-${index}`, reference_period: row.period, achievement_percent: String(row.achievement), quartile: row.quartile })))
    if (text.includes("from employee_indicator_performance")) return respond(scenario.indicators.map((row, index) => ({ id: `ind-${index}`, reference_period: row.period, code: row.code, name: row.name, unit: row.unit, desired_direction: row.direction, value: String(row.value), target_value: String(row.target), achievement_percent: String(row.achievement), weight_percent: String(row.weight), quartile: row.quartile })))
    if (/select team_id from people/.test(text)) return respond([{ team_id: "20000000-0000-4000-8000-000000000001" }])
    if (/select id, name from people where id = any/.test(text)) return respond(scenarios.map((item) => ({ id: item.employeeId, name: item.employeeName })))
    return (real.query as (...args: unknown[]) => unknown)(sql, params)
  }) as Database["query"]
  return { ...real, query }
}

const recorder = { start: async () => randomUUID(), complete: async () => undefined, fail: async () => undefined }

function contextFor(real: Database, scenario: Scenario): ActionExecutionContext {
  return {
    db: overlayDb(real, [scenario]),
    organizationId: ORGANIZATION,
    workflowId: "validacao-reconhecimento",
    workflowVersionId: null,
    nodeId: "agente",
    graph: GRAPH,
    enrollment: { id: randomUUID(), interactionId: null, indicatorMeasurementId: null, scheduledSubjectId: scenario.employeeId, matchedFlagName: null, matchedValueBoolean: null, matchedValueNumeric: null, nodeOutputs: {}, variables: {} },
    scopeType: "ALL_TEAMS",
    teamId: null,
    subteamId: null,
    inputContext: "",
    now: new Date(),
    effects: { agentRuns: recorder } as unknown as ActionExecutionContext["effects"],
    readCollection: async () => collectionOf([scenario]),
  }
}

/** Número fora do que o agente recebeu. Só um auxílio para a leitura humana, nunca a decisão. */
function unexpectedNumbers(text: string, allowed: Set<string>): string[] {
  const found = text.match(/\d+(?:[.,]\d+)?/g) ?? []
  return [...new Set(found.map((value) => value.replace(",", ".")))].filter((value) => !allowed.has(value))
}

async function main(): Promise<void> {
  const priceRows = await pool.query<{ provider_model_id: string; input: string; output: string }>(
    `select m.provider_model_id, max(p.input_per_million) as input, max(greatest(p.output_per_million, coalesce(p.reasoning_per_million, 0))) as output
       from ai_model_pricing p join ai_models m on m.id = p.model_id where p.organization_id = $1 and p.currency = 'USD' group by 1`,
    [ORGANIZATION],
  )
  const prices = new Map(priceRows.rows.map((row) => [row.provider_model_id, { input: Number(row.input), output: Number(row.output) }]))
  const limit = await pool.query<{ max_output_tokens: number | null }>(`select max(max_output_tokens) as max_output_tokens from ai_models where organization_id = $1 and kind = 'TEXT'`, [ORGANIZATION]).catch(() => ({ rows: [{ max_output_tokens: null }] }))
  const defaultMaxOutput = limit.rows[0]?.max_output_tokens ?? 65_536

  const realFetch = globalThis.fetch
  const guard = createGuard(prices, defaultMaxOutput, realFetch)
  globalThis.fetch = guard.fetch
  registerAiRuntime(createAiRuntime(pool))
  const readDb = createReadOnlyDatabase(pool)

  const results: { scenario: string; description: string; repetition: number; input: string | null; fields: Record<string, unknown> | null; unexpectedNumbers: string[]; error: string | null }[] = []
  const firstOutputs = new Map<string, unknown>()

  const runScenario = async (scenario: Scenario, repetition: number) => {
    guard.setLabel(`${scenario.key}#${repetition}`)
    const config: ActionConfig = { actionType: "CALL_AGENT", agentId: RECOGNITION_AGENT, outputContract: "RECOGNITION", scheduledDataSource: { kind: "PERFORMANCE", closures: scenario.closures } }
    try {
      const result = await runWithAiOrganization(ORGANIZATION, () => actionExecutors.CALL_AGENT!(config, contextFor(readDb, scenario)))
      if ((result.nodeOutput as { kind?: string }).kind === "RECOGNITION_SKIPPED") {
        if (repetition === 1) firstOutputs.set(scenario.key, result.nodeOutput)
        results.push({ scenario: scenario.key, description: scenario.description, repetition, input: null, fields: { skipped: (result.nodeOutput as { text: string }).text }, unexpectedNumbers: [], error: null })
        return
      }
      const output = result.nodeOutput as { input: { structured: Record<string, string>; observedBehavior: string; evidenceFound: string; impactedIndicator: string; contextSnapshot: unknown } }
      const allowed = new Set([...scenario.prv.flatMap((row) => [String(row.achievement)]), ...scenario.indicators.flatMap((row) => [row.value, row.target, row.achievement, row.weight].map(String)), "100", "2026", "10", "09", String(scenario.rankedCount), "1", ...("previousValue" in scenario.member ? [String(scenario.member.previousValue), String(scenario.member.currentValue)] : [])])
      const text = [output.input.structured.title, output.input.structured.summary, output.input.structured.recommendation].join(" ")
      if (repetition === 1) firstOutputs.set(scenario.key, output)
      results.push({ scenario: scenario.key, description: scenario.description, repetition, input: null, fields: { title: output.input.structured.title, summary: output.input.structured.summary, relatedProcedure: output.input.structured.relatedProcedure, recommendation: output.input.structured.recommendation, observedBehavior: output.input.observedBehavior, evidenceFound: output.input.evidenceFound, impactedIndicator: output.input.impactedIndicator }, unexpectedNumbers: unexpectedNumbers(text, allowed), error: null })
    } catch (error) {
      if (error instanceof DryRunStop || (error instanceof Error && /Ensaio: pedido medido/.test(error.message))) throw new DryRunStop(error.message)
      results.push({ scenario: scenario.key, description: scenario.description, repetition, input: null, fields: null, unexpectedNumbers: [], error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })
      if (error instanceof BudgetBlocked || (error instanceof Error && /Teto: gasto|Sem preço na tabela|destino não previsto/.test(error.message))) throw error
    }
  }

  if (!execute) {
    await runScenario(SCENARIOS[1]!, 1).catch((error) => {
      console.log(`Ensaio parou como esperado: ${error instanceof Error ? error.message : String(error)}`)
    })
    const body = guard.lastBody() as { systemInstruction?: { parts?: { text?: string }[] }; contents?: { parts?: { text?: string }[] }[]; generationConfig?: Record<string, unknown> } | null
    console.log("\n--- SISTEMA (fim) ---\n", (body?.systemInstruction?.parts?.map((part) => part.text).join("\n") ?? "").slice(-1400))
    console.log("\n--- TURNO ---\n", body?.contents?.flatMap((turn) => turn.parts?.map((part) => part.text) ?? []).join("\n"))
    console.log("\n--- generationConfig ---\n", JSON.stringify(body?.generationConfig))
    console.log("\n--- reserva ---\n", guard.attempts)
    const worst = guard.attempts[0]?.reservedUsd ?? 0
    console.log(`\nTeto US$ ${CAP_USD}; pior caso por tentativa US$ ${worst.toFixed(4)}. Sobra para gasto real: US$ ${(CAP_USD - worst).toFixed(4)}.`)
    return
  }

  let stopped: string | null = null
  try {
    for (const scenario of SCENARIOS.filter((item) => !ONLY || ONLY.some((key) => item.key.startsWith(key)))) {
      const repetitions = ONLY && !scenario.key.startsWith("S7") ? 1 : REPETITIONS
      for (let repetition = 1; repetition <= repetitions; repetition += 1) await runScenario(scenario, repetition)
    }
  } catch (error) {
    stopped = error instanceof Error ? error.message : String(error)
  }

  const syntheses: { pair: string; text: string | null; structured: unknown; error: string | null }[] = []
  if (!stopped) {
    const scenarioOf = (key: string) => SCENARIOS.find((item) => item.key.startsWith(key))!
    const pairs = ONLY ? [[scenarioOf("S1"), scenarioOf("S6")], [scenarioOf("S1"), scenarioOf("S6")]] : [[scenarioOf("S1"), scenarioOf("S2")], [scenarioOf("S1"), scenarioOf("S3")]]
    for (const pair of pairs) {
      const key = pair.map((scenario) => scenario.key).join("+")
      guard.setLabel(`SINTESE ${key}`)
      const fanIn: EmployeeFanInOutput = { kind: "EMPLOYEE_FAN_IN", sourceFanOutNodeId: "aplicar", expectedCount: 2, completedCount: 2, failedCount: 0, joinedAt: new Date().toISOString(), children: pair.map((scenario) => ({ employeeId: scenario.employeeId, childEnrollmentId: randomUUID(), status: "completed" as const, nodeOutputs: { agente: firstOutputs.get(scenario.key) } })) }
      try {
        const synthesis = await runWithAiOrganization(ORGANIZATION, () =>
          executeSynthesisAgent({ actionType: "CALL_AGENT", agentId: SYNTHESIS_AGENT, instruction: SYNTHESIS_MISSION }, { db: overlayDb(readDb, [...pair]), organizationId: ORGANIZATION, inputContext: "", fanIn, collection: collectionOf([...pair]), recorder: recorder as never }),
        )
        syntheses.push({ pair: key, text: synthesis.nodeOutput.text, structured: synthesis.nodeOutput.structured, error: null })
      } catch (error) {
        syntheses.push({ pair: key, text: null, structured: null, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })
        if (error instanceof Error && /Teto: gasto/.test(error.message)) break
      }
    }
  }

  const totals = { attempts: guard.attempts.filter((attempt) => typeof attempt.status === "number").length, blocked: guard.attempts.filter((attempt) => attempt.status === "BLOCKED").length, spentUsd: guard.spent(), unknownUsage: guard.attempts.filter((attempt) => !attempt.usageKnown).length }
  writeFileSync(OUT!, JSON.stringify({ at: new Date().toISOString(), totals, stopped, results, syntheses, attempts: guard.attempts }, null, 2))
  console.log(JSON.stringify({ totals, stopped, ok: results.filter((result) => !result.error).length, failed: results.filter((result) => result.error).map((result) => `${result.scenario}#${result.repetition}: ${result.error}`), syntheses: syntheses.map((item) => item.error ?? "ok") }, null, 2))
}

await main().finally(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300))
  await pool.end()
})
