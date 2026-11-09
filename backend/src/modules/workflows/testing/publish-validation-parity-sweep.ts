import type { TriggerConfig } from "../domain/trigger-config-schema.js"
import { loadOfficialModelWorkflows } from "./official-model-workflows.js"
import type { ParitySetup } from "./publish-validation-parity.js"

/**
 * Varredura determinística da paridade: parte dos 22 Workflows-modelo (válidos dos dois lados) e aplica de 1 a 3 mutações
 * sorteadas por uma semente fixa — troca de gatilho/modo, remoção/religação de nós e arestas, destinatário/superfície/conteúdo
 * do Output, formato e fonte do "Chamar agente", origem/tipo do "Gerar feedback", Conditions e critérios, ranking, campos
 * estruturados, e nós novos inseridos numa aresta (Definir variável, Escalonar, feedback direto, "Gerar feedback", grupo).
 * Mesma semente = mesmas amostras: uma falha é reproduzível pelo índice e pelo `trace` da amostra.
 */

export type SweepSample = ParitySetup & { index: number; trace: string[] }

/** Tipo do valor das flags reais usadas nos modelos (channel_flags) e semântica operacional dos indicadores (migration 052). */
const FLAG_VALUE_TYPES: Record<string, "BOOLEAN" | "NUMERIC"> = {
  "60c9cda8-63de-4443-b6b6-7f7c66e91931": "BOOLEAN",
  "383e42c6-898c-4c35-b94c-6e40ff696ab5": "NUMERIC",
  "de009d6c-decd-4a03-87cb-fbc7052289b0": "BOOLEAN",
}
const OPERATIONAL_AGGREGATION = { TMA: "WEIGHTED_AVERAGE", MONITORIA_QUALIDADE: "WEIGHTED_AVERAGE", NOTA_URA: "WEIGHTED_AVERAGE", ADERENCIA: "RATE" } as const

/** mulberry32 — PRNG pequeno e determinístico. */
function createRandom(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const TRIGGERS: { trigger: TriggerConfig; flag?: "BOOLEAN" | "NUMERIC" }[] = [
  { trigger: { kind: "channel_flag", channelFlagId: "60c9cda8-63de-4443-b6b6-7f7c66e91931" }, flag: "BOOLEAN" },
  { trigger: { kind: "channel_flag", channelFlagId: "383e42c6-898c-4c35-b94c-6e40ff696ab5" }, flag: "NUMERIC" },
  { trigger: { kind: "indicator", indicatorCode: "TMA" } },
  { trigger: { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, anchorDate: "2026-09-16" } },
  { trigger: { kind: "schedule", mode: "RELATIVE_TO_SHIFT", relative: { anchor: "START", offsetMinutes: 30 }, intervalDays: 1 } },
  { trigger: { kind: "manual", context: "INTERACTION" } },
  { trigger: { kind: "manual", context: "COLLABORATOR" } },
  { trigger: { kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode: "TMA" } },
]

const HISTORY = { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 } }
const CONDITIONS: Record<string, unknown>[] = [
  { comparator: "GT", thresholdNumeric: 3 },
  { comparator: "EQUALS", thresholdBoolean: true },
  { comparator: "GT", thresholdNumeric: 300, historicalQuery: HISTORY },
  { comparator: "GT", thresholdNumeric: 90, historicalQuery: { ...HISTORY, source: "INDICATOR_ACHIEVEMENT" } },
  { comparator: "GT", thresholdNumeric: 90, historicalQuery: { ...HISTORY, source: "INDICATOR_ACHIEVEMENT", aggregation: "AVERAGE" } },
  { comparator: "EQUALS", thresholdText: "Q4", historicalQuery: { ...HISTORY, source: "OPERATIONAL_QUARTILE", minimumSampleSize: 3 } },
  { comparator: "GT", thresholdText: "x", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } },
  { comparator: "CONTAINS", thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } },
  { comparator: "IS_EMPTY", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" } },
  { comparator: "EQUALS", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "TMA" } },
]
const STRUCTURED_FIELDS = [
  { kind: "FIELD", key: "nota", label: "Nota", type: "NUMBER", required: false },
  { kind: "FIELD", key: "lista", label: "Lista", type: "ARRAY", required: false },
  { kind: "FIELD", key: "categoria", label: "Categoria", type: "ENUM", required: false, options: [{ value: "A" }, { value: "B" }] },
  { kind: "FIELD", key: "ok", label: "Ok", type: "BOOLEAN", required: false },
]
const VARIABLE_IDS = ["0a7a0000-0000-4000-8000-0000000000f1", "0a7a0000-0000-4000-8000-0000000000f2"]
const VARIABLE_TYPES = ["BOOLEAN", "NUMERIC", "TEXT"] as const

type MutableNode = { id: string; type: string; label: string; position: unknown; config: Record<string, unknown> }
type MutableEdge = { id: string; source: string; sourceHandle: string; target: string }
type MutableGraph = { nodes: MutableNode[]; edges: MutableEdge[] }

function mutate(sample: SweepSample, random: () => number) {
  const graph = sample.graph as MutableGraph
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!
  const steps = 1 + Math.floor(random() * 3)
  for (let step = 0; step < steps; step++) {
    const nodes = graph.nodes
    const ofType = (predicate: (node: MutableNode) => boolean) => nodes.filter(predicate)
    const kind = Math.floor(random() * 20)
    if (kind === 0) {
      const chosen = pick(TRIGGERS)
      sample.trigger = chosen.trigger
      sample.flagValueType = chosen.flag
      sample.trace.push(`gatilho ${JSON.stringify(chosen.trigger)}`)
    } else if (kind === 1) {
      sample.consolidated = !sample.consolidated
      sample.trace.push(`consolidado=${sample.consolidated}`)
    } else if (kind === 2) {
      const candidates = ofType((node) => node.type !== "trigger")
      if (candidates.length === 0) continue
      const removed = pick(candidates)
      graph.nodes = nodes.filter((node) => node !== removed)
      graph.edges = graph.edges.filter((edge) => edge.source !== removed.id && edge.target !== removed.id)
      sample.trace.push(`remove nó ${removed.id}`)
    } else if (kind === 3) {
      if (graph.edges.length === 0) continue
      const removed = pick(graph.edges)
      graph.edges = graph.edges.filter((edge) => edge !== removed)
      sample.trace.push(`remove aresta ${removed.source}>${removed.target}`)
    } else if (kind === 4) {
      if (graph.edges.length === 0) continue
      const rewired = pick(graph.edges)
      rewired.target = pick(nodes).id
      sample.trace.push(`religa ${rewired.source}>${rewired.target}`)
    } else if (kind === 5) {
      const outputs = ofType((node) => node.type === "output")
      if (outputs.length === 0) continue
      const target = pick(outputs)
      target.config.target = pick([{ type: "CURRENT_OPERATOR" }, { type: "ROLE", role: "SUPERVISOR" }, { type: "SUPERVISOR_OF_OPERATOR" }])
      const surfaces = ["FOLLOW_UP", "AVATAR", "CHAT", "INBOX", "NOTIFICATION"].filter(() => random() < 0.4)
      if (random() < 0.5) target.config.surfaces = surfaces.length > 0 ? surfaces : ["FOLLOW_UP"]
      sample.trace.push(`output ${target.id} ${JSON.stringify(target.config.target)} ${target.config.surfaces}`)
    } else if (kind === 6) {
      const outputs = ofType((node) => node.type === "output")
      if (outputs.length === 0) continue
      const target = pick(outputs)
      target.config.source = `nodeOutputs.${pick(nodes).id}${random() < 0.3 ? ".campo" : ""}`
      sample.trace.push(`output ${target.id} conteúdo=${target.config.source}`)
    } else if (kind === 7) {
      const agents = ofType((node) => node.type === "action" && node.config.actionType === "CALL_AGENT")
      if (agents.length === 0) continue
      const target = pick(agents)
      const contract = pick([undefined, "FEEDBACK", "PROCESS_AUDIT", "PROCESS_ASSESSMENT", "INDICATOR_DIAGNOSIS", "PRV_CLOSING_DIAGNOSIS", "RECOGNITION"])
      if (contract) target.config.outputContract = contract
      else delete target.config.outputContract
      const source = pick([undefined, null, { kind: "PERFORMANCE", closures: 1 }, { kind: "PERFORMANCE", closures: 1, indicatorCode: "TMA" }, { kind: "MONITORING", sampleSize: 3, period: "WEEK" }])
      if (source === null) delete target.config.scheduledDataSource
      else if (source) target.config.scheduledDataSource = source
      sample.trace.push(`agent ${target.id} formato=${contract} fonte=${JSON.stringify(source)}`)
    } else if (kind === 8) {
      const orchestrators = ofType((node) => node.type === "orchestrator")
      if (orchestrators.length === 0) continue
      const target = pick(orchestrators)
      target.config.specialistOutputContract = pick(["FEEDBACK", "PROCESS_ASSESSMENT"])
      sample.trace.push(`orquestrador ${target.id} especialistas=${target.config.specialistOutputContract}`)
    } else if (kind === 9) {
      const feedbacks = ofType((node) => node.type === "action" && node.config.actionType === "GENERATE_FEEDBACK")
      if (feedbacks.length === 0) continue
      const target = pick(feedbacks)
      if (random() < 0.5) target.config.feedbackDomain = pick(["AUTO", "MONITORING", "INDICATOR"])
      else target.config.sourceNodeId = pick(nodes).id
      sample.trace.push(`feedback ${target.id} ${JSON.stringify(target.config)}`)
    } else if (kind === 10) {
      const conditions = ofType((node) => node.type === "condition")
      if (conditions.length === 0) continue
      const target = pick(conditions)
      target.config = structuredClone(pick(CONDITIONS))
      sample.trace.push(`condição ${target.id} ${JSON.stringify(target.config)}`)
    } else if (kind === 11) {
      const conditions = ofType((node) => node.type === "condition")
      if (conditions.length === 0) continue
      const target = pick(conditions)
      sample.variables = random() < 0.8 ? [{ id: VARIABLE_IDS[0]!, type: pick(VARIABLE_TYPES), name: "V" }] : []
      target.config = pick([
        { sourcePath: `variables.${VARIABLE_IDS[0]}`, comparator: "EQUALS", thresholdBoolean: true },
        { sourcePath: `variables.${VARIABLE_IDS[0]}`, comparator: "GT", thresholdNumeric: 3 },
        { sourcePath: `variables.${VARIABLE_IDS[0]}`, comparator: "CONTAINS", thresholdText: "x" },
      ])
      sample.trace.push(`condição ${target.id} variável ${JSON.stringify(sample.variables)} ${JSON.stringify(target.config)}`)
    } else if (kind === 12) {
      const selects = ofType((node) => node.type === "select_employees" && Boolean(node.config.criterion))
      if (selects.length === 0) continue
      const target = pick(selects)
      target.config.criterion = structuredClone(pick(CONDITIONS.filter((item) => item.historicalQuery || item.performanceQuery)))
      sample.trace.push(`critério ${target.id} ${JSON.stringify(target.config.criterion)}`)
    } else if (kind === 13) {
      const selects = ofType((node) => node.type === "select_employees")
      if (selects.length === 0) continue
      const target = pick(selects)
      const ranking: Record<string, unknown> = {}
      if (random() < 0.85) ranking.source = pick(["MEASUREMENT", "INDICATOR_ACHIEVEMENT", "PRV_ACHIEVEMENT"])
      if (random() < 0.85) ranking.indicatorCode = "TMA"
      if (random() < 0.85) ranking.aggregation = pick(["AVERAGE", "MINIMUM", "MAXIMUM", "WEIGHTED_AVERAGE", "SUM", "LATEST"])
      if (random() < 0.85) ranking.period = pick([{ kind: "ROLLING_DAYS", days: 7 }, { kind: "CLOSURES", unit: "MONTH", count: 3 }, { kind: "CALENDAR", unit: "MONTH", phase: "PREVIOUS" }])
      if (random() < 0.85) ranking.selection = pick(["HIGHEST", "LOWEST", "BEST", "WORST", "IMPROVED", "DECLINED", "OPERATIONAL_QUARTILE"])
      if (random() < 0.85) ranking.count = pick([1, 3])
      if (random() < 0.5) ranking.rankingBasis = pick(["VALUE", "CHANGE"])
      if (random() < 0.3) ranking.operationalQuartile = "Q4"
      if (random() < 0.2) ranking.minimumCoverage = 0.5
      target.config = { selectionMode: "RANKING", ...(random() < 0.9 ? { ranking } : {}) }
      sample.trace.push(`ranking ${target.id} ${JSON.stringify(target.config)}`)
    } else if (kind === 14) {
      const orchestrators = ofType((node) => node.type === "orchestrator")
      if (orchestrators.length === 0) continue
      sample.orchestrators = [...new Set(orchestrators.map((node) => String(node.config.orchestratorId)))].map((id) => ({ id, structuredOutput: { schemaVersion: 1, nodes: STRUCTURED_FIELDS } as never }))
      const consumers = ofType((node) => node.type === "output" || node.type === "human_review")
      if (consumers.length === 0) continue
      const target = pick(consumers)
      const path = `nodeOutputs.${pick(orchestrators).id}${pick(["", ".structuredResult.nota", ".structuredResult.lista", ".structuredResult.sumiu", ".structuredResult.categoria"])}`
      if (target.type === "output") target.config.source = path
      else target.config.contentSource = path
      sample.trace.push(`estruturado ${target.id} <- ${path}`)
    } else {
      insertNode(sample, graph, kind, random, pick)
    }
  }
}

function insertNode(sample: SweepSample, graph: MutableGraph, kind: number, random: () => number, pick: <T>(list: readonly T[]) => T) {
  if (graph.edges.length === 0) return
  const split = pick(graph.edges)
  const nodes = graph.nodes
  const id = `novo-${sample.trace.length}-${Math.floor(random() * 1000)}`
  let config: Record<string, unknown>
  let type = "action"
  if (kind === 15) {
    sample.variables = VARIABLE_IDS.map((variableId, index) => ({ id: variableId, type: pick(VARIABLE_TYPES), name: `V${index}` })).filter(() => random() < 0.85)
    config = pick([
      { actionType: "SET_VARIABLE", variableId: VARIABLE_IDS[0], value: true },
      { actionType: "SET_VARIABLE", variableId: VARIABLE_IDS[0], value: 3 },
      { actionType: "SET_VARIABLE", variableId: VARIABLE_IDS[0], value: "x" },
      { actionType: "SET_VARIABLE", variableId: VARIABLE_IDS[0] },
      { actionType: "SET_VARIABLE", variableId: VARIABLE_IDS[0], sourcePath: `variables.${VARIABLE_IDS[1]}` },
      { actionType: "SET_VARIABLE", variableId: VARIABLE_IDS[0], sourcePath: `variables.${VARIABLE_IDS[0]}` },
      { actionType: "SET_VARIABLE", variableId: VARIABLE_IDS[0], sourcePath: "nodeOutputs.trigger" },
      { actionType: "SET_VARIABLE", variableId: VARIABLE_IDS[0], sourcePath: `nodeOutputs.${pick(nodes).id}` },
      { actionType: "SET_VARIABLE", variableId: VARIABLE_IDS[0], sourcePath: `nodeOutputs.${pick(nodes).id}.structuredResult.nota` },
      { actionType: "SET_VARIABLE", variableId: VARIABLE_IDS[0], sourcePath: "algo" },
    ])
  } else if (kind === 16) {
    const reviews = nodes.filter((node) => node.type === "human_review")
    config = {
      actionType: "ESCALATE",
      target: pick([
        { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" },
        { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: reviews.length > 0 ? pick(reviews).id : "nao-existe" },
        { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: pick(nodes).id },
      ]),
      surfaces: pick([["FOLLOW_UP"], ["AVATAR"], ["CHAT", "FOLLOW_UP"]]),
      ...(random() < 0.7 ? { contentSource: `nodeOutputs.${pick(nodes).id}${pick(["", ".structuredResult.nota", ".structuredResult.lista", ".structuredResult.sumiu"])}` } : {}),
    }
  } else if (kind === 17) {
    config = { actionType: "GENERATE_INTERACTION_FEEDBACK", interactionSource: pick([{ kind: "TRIGGER_INTERACTION" }, { kind: "COLLABORATOR_SAMPLE", period: "WEEK", sampleSize: 3, strategy: "MOST_RECENT" }]) }
  } else if (kind === 18) {
    config = { actionType: "GENERATE_FEEDBACK", sourceNodeId: pick(nodes).id, feedbackDomain: pick(["AUTO", "MONITORING", "INDICATOR"]) }
  } else {
    type = "condition"
    sample.variables = random() < 0.8 ? [{ id: VARIABLE_IDS[1]!, type: pick(VARIABLE_TYPES), name: "G" }] : []
    const rule = pick([
      { sourcePath: `variables.${VARIABLE_IDS[1]}`, comparator: "EQUALS", thresholdBoolean: true },
      { sourcePath: `variables.${VARIABLE_IDS[1]}`, comparator: "GT", thresholdNumeric: 2 },
      { sourcePath: `nodeOutputs.${pick(nodes).id}.structuredResult.nota`, comparator: "GT", thresholdNumeric: 2 },
      { sourcePath: `nodeOutputs.${pick(nodes).id}.structuredResult.sumiu`, comparator: "GT", thresholdNumeric: 2 },
      { sourcePath: `nodeOutputs.${pick(nodes).id}.structuredResult.categoria`, comparator: "EQUALS", thresholdText: "Z" },
      { comparator: "GT", thresholdNumeric: 2 },
      { sourcePath: `variables.${VARIABLE_IDS[1]}`, comparator: "GT" },
    ])
    config = { comparator: "EQUALS", group: { operator: "ALL", rules: [rule] } }
  }
  graph.nodes.push({ id, type, label: `Novo ${type}`, position: { x: 0, y: 0 }, config })
  const previousTarget = split.target
  split.target = id
  for (const handle of type === "condition" ? ["true", "false"] : ["always"]) graph.edges.push({ id: `${id}-${handle}`, source: id, sourceHandle: handle, target: previousTarget })
  sample.trace.push(`insere ${type} ${JSON.stringify(config)} depois de ${split.source}`)
}

export function* sweepSamples(seed: number, count: number): Generator<SweepSample> {
  const models = loadOfficialModelWorkflows()
  const random = createRandom(seed)
  for (let index = 0; index < count; index++) {
    const model = models[index % models.length]!
    const sample: SweepSample = {
      index,
      trace: [`Modelo ${model.key}`],
      trigger: model.trigger,
      flagValueType: model.trigger.kind === "channel_flag" ? FLAG_VALUE_TYPES[model.trigger.channelFlagId] : undefined,
      consolidated: Boolean(model.consolidatedStructure),
      ...(model.consolidatedStructure ? { structure: model.consolidatedStructure } : {}),
      graph: structuredClone(model.graph),
      operationalAggregation: OPERATIONAL_AGGREGATION,
    }
    mutate(sample, random)
    // Estrutura dos modelos (âncoras reais da massa demo) não existe na hierarquia dos casos: a resolução de destinatário
    // por estrutura é só do backend e tem casos próprios — aqui a estrutura padrão dos casos, que resolve todo cargo.
    delete sample.structure
    yield sample
  }
}

