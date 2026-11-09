import { emptyStrategyConfig } from "../../indicator-diagnosis/domain/diagnostic-strategy.js"
import { nodeBranches, type FlowNode } from "../domain/graph-schema.js"
import type { TriggerConfig } from "../domain/trigger-config-schema.js"
import { PARITY_TEAM_ID, type ParityDbFacts, type ParitySetup } from "./publish-validation-parity.js"

/**
 * Catálogo de casos do teste de paridade (validate-workflow-for-publish.parity.test.ts). Cada caso viola UMA regra num
 * Workflow que, sem ela, é publicável pelos dois lados — é isso que permite dizer que backend e editor apontaram a MESMA
 * regra (o backend para no primeiro problema e os códigos são compartilhados por várias regras: o grafo-base válido
 * garante que não há outra regra em jogo).
 *
 * Três listas:
 *   - MIRRORED: regras que o editor espelha — os dois lados dizem o mesmo código, no mesmo nó;
 *   - BACKEND_ONLY: regras que dependem de banco/ambiente (o editor não tem o dado) — só o backend recusa, por desenho;
 *   - ACCEPTED: casos de borda que os dois lados publicam (o editor não pode ser mais estrito que o backend).
 *
 * Não existe lista de divergências toleradas: o backend é a fonte da verdade e o editor o acompanha regra a regra. As 12
 * diferenças achadas em 07/10/2026 foram corrigidas no editor em 08/10/2026 (casos "D1".."D10" abaixo).
 */

// ---------------------------------------------------------------------------------------------
// Identificadores (UUIDs válidos: o esquema do backend exige).
// ---------------------------------------------------------------------------------------------

export const AGENT_ID = "0a7a0000-0000-4000-8000-0000000000b1"
export const ORCHESTRATOR_ID = "0a7a0000-0000-4000-8000-0000000000b2"
export const FLAG_ID = "0a7a0000-0000-4000-8000-0000000000b3"
const AGENT_VERSION_ID = "0a7a0000-0000-4000-8000-0000000000b4"
const ORCHESTRATOR_VERSION_ID = "0a7a0000-0000-4000-8000-0000000000b5"
export const VARIABLE_A = "0a7a0000-0000-4000-8000-0000000000c1"
export const VARIABLE_B = "0a7a0000-0000-4000-8000-0000000000c2"
const DOMAIN_ID = "0a7a0000-0000-4000-8000-0000000000c3"
const MISSING_UUID = "0a7a0000-0000-4000-8000-0000000000ff"
const POLICY_ID = "0a7a0000-0000-4000-8000-0000000000c4"
/** Outro Grupo, que não é o `PARITY_TEAM_ID`. */
const OTHER_TEAM_ID = "0a7a0000-0000-4000-8000-0000000000c6"

// ---------------------------------------------------------------------------------------------
// Gatilhos
// ---------------------------------------------------------------------------------------------

type TriggerSetup = Pick<ParitySetup, "trigger" | "flagValueType">
const trigger = (config: Record<string, unknown>) => config as unknown as TriggerConfig
export const FLAG_BOOLEAN: TriggerSetup = { trigger: trigger({ kind: "channel_flag", channelFlagId: FLAG_ID }), flagValueType: "BOOLEAN" }
export const FLAG_NUMERIC: TriggerSetup = { trigger: trigger({ kind: "channel_flag", channelFlagId: FLAG_ID }), flagValueType: "NUMERIC" }
export const INDICATOR: TriggerSetup = { trigger: trigger({ kind: "indicator", indicatorCode: "TMA" }) }
export const SCHEDULE: TriggerSetup = { trigger: trigger({ kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, anchorDate: "2026-09-16" }) }
export const MANUAL_INTERACTION: TriggerSetup = { trigger: trigger({ kind: "manual", context: "INTERACTION" }) }
export const MANUAL_COLLABORATOR: TriggerSetup = { trigger: trigger({ kind: "manual", context: "COLLABORATOR" }) }
export const MANUAL_MEASUREMENT: TriggerSetup = { trigger: trigger({ kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode: "TMA" }) }
const schedule = (config: Record<string, unknown>): TriggerSetup => ({ trigger: trigger({ kind: "schedule", intervalDays: 1, anchorDate: "2026-09-16", ...config }) })

// ---------------------------------------------------------------------------------------------
// Nós
// ---------------------------------------------------------------------------------------------

type Node = { id: string; type: string; label: string; position: { x: number; y: number }; config: Record<string, unknown> }
const node = (id: string, type: string, label: string, config: Record<string, unknown> = {}): Node => ({ id, type, label, position: { x: 0, y: 0 }, config })

export const triggerNode = (id = "trigger") => node(id, "trigger", "Gatilho")
export const endNode = (id = "end") => node(id, "end", "Fim")
export const agent = (id = "agent", config: Record<string, unknown> = {}) => node(id, "action", "Chamar agente", { actionType: "CALL_AGENT", agentId: AGENT_ID, ...config })
/** "Chamar agente" com fonte de dados — o que um gatilho por Agenda/Manual por colaborador exige. */
export const scheduledAgent = (id = "agent", config: Record<string, unknown> = {}) => agent(id, { scheduledDataSource: { kind: "MONITORING", sampleSize: 3, period: "WEEK" }, ...config })
export const orchestrator = (id = "orq", config: Record<string, unknown> = {}) => node(id, "orchestrator", "Orquestrador", { orchestratorId: ORCHESTRATOR_ID, instruction: "Analise.", ...config })
/** Output para a gestão (nunca "O próprio operador": esse caminho tem regras próprias de feedback oficial). */
export const output = (id = "out", source = "nodeOutputs.agent", config: Record<string, unknown> = {}) =>
  node(id, "output", "Output", { target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["FOLLOW_UP"], source, ...config })
export const waitNode = (id = "wait", durationMs = 3_600_000) => node(id, "wait", "Espera", { durationMs })
export const condition = (id: string, config: Record<string, unknown>) => node(id, "condition", "Condição", { comparator: "GT", ...config })
export const humanReview = (id: string, config: Record<string, unknown> = {}) => node(id, "human_review", "Revisão", { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, ...config })
export const escalate = (id: string, config: Record<string, unknown> = {}) => node(id, "action", "Escalonar", { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["FOLLOW_UP"], ...config })
export const setVariable = (id: string, config: Record<string, unknown>) => node(id, "action", "Definir variável", { actionType: "SET_VARIABLE", variableId: VARIABLE_A, ...config })
export const generateFeedback = (id = "fb", config: Record<string, unknown> = {}) => node(id, "action", "Gerar feedback", { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO", ...config })
export const interactionFeedback = (id: string, source: Record<string, unknown>) => node(id, "action", "Feedback direto", { actionType: "GENERATE_INTERACTION_FEEDBACK", interactionSource: source })
export const select = (id = "select", config: Record<string, unknown> = { selectionMode: "CONDITION", criterion: PRV_CRITERION }) => node(id, "select_employees", "Selecionar colaboradores", config)
export const apply = (id = "apply") => node(id, "apply_individually", "Aplicar individualmente")
export const join = (id = "join") => node(id, "consolidate_results", "Consolidar resultados")
export const policyNode = (id = "pol", config: Record<string, unknown> = {}) => node(id, "intervention_policy", "Avaliar política", { policyId: POLICY_ID, mode: "RECOMMEND_ONLY", analysisSourceNodeIds: [], ...config })

const PRV_CRITERION = { comparator: "LT", thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } }

type Edge = { id: string; source: string; sourceHandle: string; target: string }
export const edge = (source: string, sourceHandle: string, target: string): Edge => ({ id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target })

/** Grafo linear: TODAS as saídas de cada nó (Sim/Não/Sem dados, Aprovado/Reprovado/Escalar…) vão para o próximo. */
export function chain(...nodes: Node[]) {
  const edges: Edge[] = []
  nodes.forEach((current, index) => {
    const next = nodes[index + 1]
    if (!next) return
    for (const branch of nodeBranches(current as unknown as FlowNode)) edges.push(edge(current.id, branch.id, next.id))
  })
  return { nodes, edges }
}

/** Agente → Revisão: "Aprovado" publica, "Reprovado" volta ao agente (com ou sem Espera no caminho de volta), "Escalar" encerra. */
function reviewLoop(withWait: boolean) {
  const nodes = [triggerNode(), agent(), humanReview("review", { contentSource: "nodeOutputs.agent" }), output("out", "nodeOutputs.agent"), endNode(), ...(withWait ? [waitNode()] : [])]
  const back = withWait ? [edge("review", "rejected", "wait"), edge("wait", "always", "agent")] : [edge("review", "rejected", "agent")]
  return { nodes, edges: [edge("trigger", "always", "agent"), edge("agent", "always", "review"), edge("review", "approved", "out"), edge("review", "escalated", "end"), edge("out", "always", "end"), ...back] }
}

/** O mesmo grafo sem UMA saída de um nó (para os casos de saída desligada). */
const withoutBranch = (graph: { nodes: Node[]; edges: Edge[] }, nodeId: string, branch: string) => ({ ...graph, edges: graph.edges.filter((item) => !(item.source === nodeId && item.sourceHandle === branch)) })

const VARIABLES_AB: ParitySetup["variables"] = [
  { id: VARIABLE_A, type: "NUMERIC", name: "A" },
  { id: VARIABLE_B, type: "NUMERIC", name: "B" },
]
/** Resultado estruturado declarado do Orquestrador dos casos (número, lista, opção, sim/não). */
const STRUCTURED_ORCHESTRATOR: ParitySetup["orchestrators"] = [
  {
    id: ORCHESTRATOR_ID,
    structuredOutput: {
      schemaVersion: 1,
      nodes: [
        { kind: "FIELD", key: "nota", label: "Nota", type: "NUMBER", required: false },
        { kind: "FIELD", key: "lista", label: "Lista", type: "ARRAY", required: false },
        { kind: "FIELD", key: "categoria", label: "Categoria", type: "ENUM", required: false, options: [{ value: "A" }, { value: "B" }] },
        { kind: "FIELD", key: "ok", label: "Ok", type: "BOOLEAN", required: false },
      ],
    },
  },
]

const setup = (base: TriggerSetup, graph: unknown, extra: Partial<ParitySetup> = {}): ParitySetup => ({ ...base, consolidated: false, graph, ...extra })

/** Workflow consolidado multinível válido (o mesmo desenho do teste do publish): Seleção → fan-out → Agent → Output individual
 * → Join → Orquestrador → Output de gestão. Variações trocam UM nó. */
export function consolidatedGraph(replace: Partial<Record<"select" | "agent" | "outOp" | "orq" | "outMgr", Node>> = {}) {
  return chain(
    triggerNode(),
    replace.select ?? select(),
    apply(),
    replace.agent ?? agent("agent", { scheduledDataSource: { kind: "PERFORMANCE", closures: 1 } }),
    replace.outOp ?? node("out-op", "output", "Feedback ao operador", { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agent" }),
    join(),
    replace.orq ?? orchestrator(),
    replace.outMgr ?? node("out-mgr", "output", "Resumo à gestão", { target: { type: "ROLE", role: "SUPERVISOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orq" }),
    endNode(),
  )
}
const consolidated = (graph: unknown, extra: Partial<ParitySetup> = {}) => setup(SCHEDULE, graph, { consolidated: true, ...extra })
const withRanking = (ranking: Record<string, unknown>) => consolidated(consolidatedGraph({ select: select("select", { selectionMode: "RANKING", ranking }) }))
const RANKING_BEST = { source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "MONTH" }, selection: "BEST", count: 1, rankingBasis: "VALUE", partitionBy: "SUBTEAM" }
const RECOGNITION_AGENT = agent("agent", { outputContract: "RECOGNITION", scheduledDataSource: { kind: "PERFORMANCE", closures: 1 } })
const RANKING_OK = { source: "MEASUREMENT", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 }, selection: "HIGHEST", count: 3 }
/** Indicador "valor do indicador" de referência para Conditions históricas (TMA = média ponderada no banco falso). */
const HISTORY = { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 } }
const QUARTILE = { kind: "INDICATOR_THRESHOLD_COUNT", source: "OPERATIONAL_QUARTILE", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 } }
const conditionCase = (config: Record<string, unknown>, base: TriggerSetup = FLAG_BOOLEAN) => setup(base, chain(triggerNode(), condition("cond", config), endNode()))

// ---------------------------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------------------------

/** Família de regra = o arquivo onde ela mora nos dois lados (publish-validation/<família>.ts no backend,
 * workflow-validation/<família>.ts no editor). */
export type RuleFamily = "trigger-context" | "conditions" | "actions" | "orchestrators" | "review-escalation" | "outputs" | "fan-out" | "indicator-diagnosis" | "reliable-feedback" | "intervention-policy"

export type MirroredCase = {
  family: RuleFamily
  name: string
  setup: ParitySetup
  /** Código da regra (o mesmo nos dois lados). */
  code: string
  /** Nó onde o editor aponta o problema ("" = o Workflow inteiro). O backend, quando informa o nó, aponta o mesmo. */
  nodeId: string
  /** Nós adicionais em que o editor aponta a MESMA regra (o backend para no primeiro). */
  alsoNodeIds?: string[]
  /** Regras que a própria violação implica e que o editor também lista (o backend para na primeira). */
  alsoCodes?: string[]
}

export const MIRRORED: MirroredCase[] = [
  // ---- trigger-context: gatilho e contexto ------------------------------------------------------------------
  { family: "trigger-context", name: "dois nós Gatilho", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), triggerNode("trigger-2"), endNode())), code: "WORKFLOW_INVALID_GRAPH", nodeId: "trigger" },
  { family: "trigger-context", name: "sem nó Fim", setup: setup(FLAG_BOOLEAN, chain(triggerNode())), code: "WORKFLOW_INVALID_GRAPH", nodeId: "" },
  // C06 (4ª auditoria): "Reprovado → refazer" voltando ao agente sem Espera repetia a chamada paga sem pausa.
  { family: "trigger-context", name: "ciclo Revisão 'Reprovado' → agente sem Espera", setup: setup(FLAG_BOOLEAN, reviewLoop(false)), code: "WORKFLOW_PAID_CYCLE_WITHOUT_WAIT", nodeId: "agent" },
  // D5 (validação funcional de 20/10/2026): Condição sem a saída "Não" publicava e a execução morria quando a resposta era não.
  { family: "trigger-context", name: "Condição sem a saída 'Não'", setup: setup(FLAG_BOOLEAN, withoutBranch(chain(triggerNode(), condition("cond", { comparator: "EQUALS", thresholdBoolean: true }), endNode()), "cond", "false")), code: "WORKFLOW_MISSING_BRANCH_EDGE", nodeId: "cond" },
  { family: "trigger-context", name: "Revisão humana sem a saída 'Escalar'", setup: setup(FLAG_BOOLEAN, withoutBranch(chain(triggerNode(), humanReview("review", { contentSource: "nodeOutputs.trigger" }), endNode()), "review", "escalated")), code: "WORKFLOW_MISSING_BRANCH_EDGE", nodeId: "review" },
  { family: "trigger-context", name: "Agenda de calendário sem horário", setup: setup(schedule({ mode: "CALENDAR" }), chain(triggerNode(), endNode())), code: "WORKFLOW_INVALID_TRIGGER", nodeId: "trigger" },
  { family: "trigger-context", name: "Agenda com horário repetido", setup: setup(schedule({ mode: "CALENDAR", times: ["09:00", "09:00"] }), chain(triggerNode(), endNode())), code: "WORKFLOW_INVALID_TRIGGER", nodeId: "trigger" },
  { family: "trigger-context", name: "Agenda mensal por dia sem o dia", setup: setup(schedule({ mode: "CALENDAR", times: ["09:00"], frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH" } }), chain(triggerNode(), endNode())), code: "WORKFLOW_INVALID_TRIGGER", nodeId: "trigger" },
  { family: "trigger-context", name: "Agenda relativa sem momento", setup: setup(schedule({ mode: "RELATIVE_TO_SHIFT" }), chain(triggerNode(), endNode())), code: "WORKFLOW_INVALID_TRIGGER", nodeId: "trigger" },
  { family: "trigger-context", name: "Agenda relativa 'após o início' sem minutos", setup: setup(schedule({ mode: "RELATIVE_TO_SHIFT", relative: { anchor: "START" } }), chain(triggerNode(), endNode())), code: "WORKFLOW_INVALID_TRIGGER", nodeId: "trigger" },
  { family: "trigger-context", name: "Agenda relativa 'antes do fim' sem minutos", setup: setup(schedule({ mode: "RELATIVE_TO_SHIFT", relative: { anchor: "END" } }), chain(triggerNode(), endNode())), code: "WORKFLOW_INVALID_TRIGGER", nodeId: "trigger" },
  { family: "trigger-context", name: "Agenda relativa por percentual sem o percentual", setup: setup(schedule({ mode: "RELATIVE_TO_SHIFT", relative: { anchor: "PERCENTAGE" } }), chain(triggerNode(), endNode())), code: "WORKFLOW_INVALID_TRIGGER", nodeId: "trigger" },
  { family: "trigger-context", name: "Manual com medição sem indicador", setup: setup({ trigger: trigger({ kind: "manual", context: "INDICATOR_MEASUREMENT" }) }, chain(triggerNode(), endNode())), code: "WORKFLOW_INVALID_TRIGGER", nodeId: "trigger" },
  { family: "trigger-context", name: "Manual em modo Consolidado", setup: setup(MANUAL_COLLABORATOR, chain(triggerNode(), endNode()), { consolidated: true }), code: "WORKFLOW_MANUAL_TRIGGER_CONSOLIDATED", nodeId: "trigger" },
  { family: "trigger-context", name: "Estrutura Consolidada com gatilho por Flag", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), endNode()), { consolidated: true }), code: "WORKFLOW_CONSOLIDATED_MODE_INVALID_TRIGGER", nodeId: "trigger" },
  { family: "trigger-context", name: "Estrutura Consolidada com Agenda relativa ao expediente", setup: setup(schedule({ mode: "RELATIVE_TO_SHIFT", relative: { anchor: "START", offsetMinutes: 30 } }), chain(triggerNode(), endNode()), { consolidated: true }), code: "WORKFLOW_CONSOLIDATED_MODE_INVALID_TRIGGER", nodeId: "trigger" },
  { family: "trigger-context", name: "Agenda: 'Chamar agente' sem fonte de dados", setup: setup(SCHEDULE, chain(triggerNode(), agent(), output(), endNode())), code: "WORKFLOW_INVALID_ACTION", nodeId: "agent" },
  { family: "trigger-context", name: "Manual por colaborador: 'Chamar agente' sem fonte de dados", setup: setup(MANUAL_COLLABORATOR, chain(triggerNode(), agent(), output(), endNode())), code: "WORKFLOW_INVALID_ACTION", nodeId: "agent" },
  { family: "trigger-context", name: "Conformidade de processo com gatilho por Indicador", setup: setup(INDICATOR, chain(triggerNode(), agent("agent", { outputContract: "PROCESS_AUDIT" }), output(), endNode())), code: "WORKFLOW_PROCESS_AUDIT_REQUIRES_FLAG", nodeId: "agent" },
  { family: "trigger-context", name: "Avaliação de processo (Chamar agente) com Agenda", setup: setup(SCHEDULE, chain(triggerNode(), scheduledAgent("agent", { outputContract: "PROCESS_ASSESSMENT" }), output(), endNode())), code: "WORKFLOW_PROCESS_ASSESSMENT_REQUIRES_FLAG", nodeId: "agent" },
  { family: "trigger-context", name: "Avaliação de processo (Orquestrador) com Manual por colaborador", setup: setup(MANUAL_COLLABORATOR, chain(triggerNode(), orchestrator("orq", { specialistOutputContract: "PROCESS_ASSESSMENT" }), endNode())), code: "WORKFLOW_PROCESS_ASSESSMENT_REQUIRES_FLAG", nodeId: "orq" },
  { family: "trigger-context", name: "Feedback direto 'interação do gatilho' com Agenda", setup: setup(SCHEDULE, chain(triggerNode(), interactionFeedback("ifb", { kind: "TRIGGER_INTERACTION" }), endNode())), code: "WORKFLOW_INTERACTION_FEEDBACK_NO_INTERACTION", nodeId: "ifb" },
  { family: "trigger-context", name: "Feedback direto 'interação do gatilho' em modo Consolidado (caminho individual)", setup: consolidated(consolidatedGraph({ outOp: interactionFeedback("out-op", { kind: "TRIGGER_INTERACTION" }) }), { trigger: FLAG_BOOLEAN.trigger, flagValueType: "BOOLEAN" }), code: "WORKFLOW_INTERACTION_FEEDBACK_NO_INTERACTION", nodeId: "out-op", alsoCodes: ["WORKFLOW_CONSOLIDATED_MODE_INVALID_TRIGGER"] },
  { family: "conditions", name: "Condition sobre o valor do gatilho com Manual por colaborador", setup: conditionCase({ thresholdNumeric: 3 }, MANUAL_COLLABORATOR), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "Condition sobre o valor do gatilho com Manual com interação", setup: conditionCase({ thresholdNumeric: 3 }, MANUAL_INTERACTION), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },

  // ---- conditions: condição ----------------------------------------------------------------------------
  { family: "conditions", name: "valor do gatilho booleano com operador numérico", setup: conditionCase({ comparator: "GT", thresholdNumeric: 3 }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "valor do gatilho booleano sem verdadeiro/falso", setup: conditionCase({ comparator: "EQUALS" }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "valor do gatilho numérico sem número", setup: conditionCase({ comparator: "GT" }, FLAG_NUMERIC), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "valor do gatilho por Indicador sem número", setup: conditionCase({ comparator: "GT" }, INDICATOR), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "grupo: regra sem origem", setup: conditionCase({ comparator: "EQUALS", group: { operator: "ALL", rules: [{ sourcePath: "nodeOutputs.trigger", comparator: "GT", thresholdNumeric: 1 }, { comparator: "GT", thresholdNumeric: 1 }] } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "grupo: regra sem valor", setup: conditionCase({ comparator: "EQUALS", group: { operator: "ANY", rules: [{ sourcePath: "nodeOutputs.trigger", comparator: "GT" }] } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "origem sem valor para comparar", setup: conditionCase({ sourcePath: "nodeOutputs.trigger", comparator: "GT" }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "campo do resultado estruturado que não existe mais", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator(), condition("cond", { sourcePath: "nodeOutputs.orq.structuredResult.sumiu", thresholdNumeric: 1 }), endNode()), { orchestrators: STRUCTURED_ORCHESTRATOR }), code: "WORKFLOW_STRUCTURED_FIELD_NOT_FOUND", nodeId: "cond" },
  { family: "conditions", name: "histórico sem indicador", setup: conditionCase({ thresholdNumeric: 300, historicalQuery: { ...HISTORY, indicatorCode: undefined } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "histórico sem período", setup: conditionCase({ thresholdNumeric: 300, historicalQuery: { ...HISTORY, period: undefined } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "histórico: Quantidade de ocorrências com Atingimento", setup: conditionCase({ thresholdNumeric: 2, historicalQuery: { ...HISTORY, source: "INDICATOR_ACHIEVEMENT", aggregation: "COUNT", comparator: "LT", indicatorThreshold: 90, period: { kind: "CALENDAR", unit: "MONTH" } } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "histórico: Meta vigente com Atingimento", setup: conditionCase({ historicalQuery: { ...HISTORY, source: "INDICATOR_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CLOSURES", unit: "MONTH", count: 3 }, compareTo: { kind: "GOAL" } } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "histórico: Últimos N fechamentos com Quantidade de ocorrências", setup: conditionCase({ thresholdNumeric: 2, historicalQuery: { ...HISTORY, aggregation: "COUNT", comparator: "GT", indicatorThreshold: 300, period: { kind: "CLOSURES", unit: "MONTH", count: 3 } } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "histórico: Últimos N fechamentos com período anterior", setup: conditionCase({ thresholdNumeric: 1, historicalQuery: { ...HISTORY, period: { kind: "CLOSURES", unit: "MONTH", count: 3 }, compareTo: { kind: "PREVIOUS_PERIOD" } } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "histórico: Cobertura mínima com Quantidade de ocorrências", setup: conditionCase({ thresholdNumeric: 2, historicalQuery: { ...HISTORY, aggregation: "COUNT", comparator: "GT", indicatorThreshold: 300, minimumCoverage: 0.5 } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "histórico: Quantidade de ocorrências sem filtro de medição", setup: conditionCase({ thresholdNumeric: 2, historicalQuery: { ...HISTORY, aggregation: "COUNT" } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "histórico: Quantidade de ocorrências com 'Comparar com'", setup: conditionCase({ thresholdNumeric: 2, historicalQuery: { ...HISTORY, aggregation: "COUNT", comparator: "GT", indicatorThreshold: 300, compareTo: { kind: "GOAL" } } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "histórico: Quantidade de ocorrências com Mínimo de medições", setup: conditionCase({ thresholdNumeric: 2, historicalQuery: { ...HISTORY, aggregation: "COUNT", comparator: "GT", indicatorThreshold: 300, minimumSampleSize: 3 } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "histórico: Quantidade de ocorrências sem valor de referência", setup: conditionCase({ historicalQuery: { ...HISTORY, aggregation: "COUNT", comparator: "GT", indicatorThreshold: 300 } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "histórico: média sem valor de referência nem 'Comparar com'", setup: conditionCase({ historicalQuery: HISTORY }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "Quartil operacional sem indicador", setup: conditionCase({ comparator: "EQUALS", thresholdText: "Q4", historicalQuery: { ...QUARTILE, indicatorCode: undefined } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "Quartil operacional sem período", setup: conditionCase({ comparator: "EQUALS", thresholdText: "Q4", historicalQuery: { ...QUARTILE, period: undefined } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "Quartil operacional com Últimos N fechamentos", setup: conditionCase({ comparator: "EQUALS", thresholdText: "Q4", historicalQuery: { ...QUARTILE, period: { kind: "CLOSURES", unit: "MONTH", count: 3 } } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "Quartil operacional com Quantidade de ocorrências", setup: conditionCase({ comparator: "EQUALS", thresholdText: "Q4", historicalQuery: { ...QUARTILE, aggregation: "COUNT" } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "Quartil operacional com 'Comparar com'", setup: conditionCase({ comparator: "EQUALS", thresholdText: "Q4", historicalQuery: { ...QUARTILE, compareTo: { kind: "GOAL" } } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "Quartil operacional com operador numérico", setup: conditionCase({ comparator: "GT", thresholdText: "Q4", historicalQuery: QUARTILE }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "Quartil operacional com quartil inválido", setup: conditionCase({ comparator: "EQUALS", thresholdText: "Q5", historicalQuery: QUARTILE }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "performance de indicador sem indicador", setup: conditionCase({ thresholdNumeric: 90, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_ACHIEVEMENT" } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "performance: Recorrência fora de quartil", setup: conditionCase({ thresholdNumeric: 2, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT", recurrence: { periods: 3, matchQuartile: "Q4" } } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "performance: Recorrência de quartil sem quantidade", setup: conditionCase({ comparator: "GTE", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE", recurrence: { periods: 3, matchQuartile: "Q4" } } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "performance: Recorrência de quartil com operador não numérico", setup: conditionCase({ comparator: "CONTAINS", thresholdNumeric: 2, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE", recurrence: { periods: 3, matchQuartile: "Q4" } } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "performance: quartil com operador numérico", setup: conditionCase({ comparator: "GT", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "performance: quartil sem quartil de referência", setup: conditionCase({ comparator: "EQUALS", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "TMA" } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "performance: quartil inválido", setup: conditionCase({ comparator: "EQUALS", thresholdText: "Q9", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "performance: métrica numérica sem número", setup: conditionCase({ comparator: "GT", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },

  // ---- actions: ações e agentes ---------------------------------------------------------------------
  { family: "actions", name: "'Chamar agente' sem Output nem Escalonar com conteúdo", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), endNode())), code: "WORKFLOW_MISSING_OUTPUT", nodeId: "" },
  { family: "actions", name: "Definir variável: variável que não existe mais", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), setVariable("set", { variableId: MISSING_UUID, value: 1 }), endNode()), { variables: VARIABLES_AB }), code: "WORKFLOW_INVALID_ACTION", nodeId: "set" },
  { family: "actions", name: "Definir variável: sem valor nem origem", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), setVariable("set", {}), endNode()), { variables: VARIABLES_AB }), code: "WORKFLOW_INVALID_ACTION", nodeId: "set" },
  { family: "actions", name: "Definir variável: valor fixo de outro tipo", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), setVariable("set", { value: "texto" }), endNode()), { variables: VARIABLES_AB }), code: "WORKFLOW_INVALID_ACTION", nodeId: "set" },
  { family: "actions", name: "Definir variável: origem dinâmica inválida", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), setVariable("set", { sourcePath: "algo" }), endNode()), { variables: VARIABLES_AB }), code: "WORKFLOW_INVALID_ACTION", nodeId: "set" },
  { family: "actions", name: "Definir variável: variável de origem que não existe", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), setVariable("set", { sourcePath: `variables.${MISSING_UUID}` }), endNode()), { variables: VARIABLES_AB }), code: "WORKFLOW_INVALID_ACTION", nodeId: "set" },
  { family: "actions", name: "Definir variável: variável de origem de outro tipo", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), setVariable("set", { sourcePath: `variables.${VARIABLE_B}` }), endNode()), { variables: [{ id: VARIABLE_A, type: "NUMERIC", name: "A" }, { id: VARIABLE_B, type: "TEXT", name: "B" }] }), code: "WORKFLOW_INVALID_ACTION", nodeId: "set" },
  { family: "actions", name: "Definir variável: resultado de um nó que vem depois", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), setVariable("set", { sourcePath: "nodeOutputs.orq.structuredResult.nota" }), orchestrator(), endNode()), { variables: VARIABLES_AB, orchestrators: STRUCTURED_ORCHESTRATOR }), code: "WORKFLOW_INVALID_ACTION", nodeId: "set" },
  { family: "actions", name: "Definir variável: resultado de um nó que não existe", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), setVariable("set", { sourcePath: "nodeOutputs.sumiu" }), endNode()), { variables: VARIABLES_AB }), code: "WORKFLOW_INVALID_ACTION", nodeId: "set" },
  { family: "actions", name: "Definir variável: campo estruturado que não existe mais", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator(), setVariable("set", { sourcePath: "nodeOutputs.orq.structuredResult.sumiu" }), endNode()), { variables: VARIABLES_AB, orchestrators: STRUCTURED_ORCHESTRATOR }), code: "WORKFLOW_STRUCTURED_FIELD_NOT_FOUND", nodeId: "set" },
  { family: "actions", name: "Definir variável: campo estruturado de tipo incompatível", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator(), setVariable("set", { sourcePath: "nodeOutputs.orq.structuredResult.lista" }), endNode()), { variables: VARIABLES_AB, orchestrators: STRUCTURED_ORCHESTRATOR }), code: "WORKFLOW_INVALID_ACTION", nodeId: "set" },
  {
    family: "actions",
    name: "ciclo entre variáveis",
    setup: setup(FLAG_BOOLEAN, chain(triggerNode(), setVariable("set-a", { sourcePath: `variables.${VARIABLE_B}` }), setVariable("set-b", { variableId: VARIABLE_B, sourcePath: `variables.${VARIABLE_A}` }), endNode()), { variables: VARIABLES_AB }),
    code: "WORKFLOW_VARIABLE_CYCLE",
    nodeId: "set-b",
  },

  // ---- orchestrators: orquestrador (esquema do rascunho — o backend recusa ao SALVAR) -----------------------
  // ---- intervention-policy: nó "Avaliar política de acompanhamento" -------------------------------------------------------------
  { family: "intervention-policy", name: "Avaliar política sem política escolhida", setup: setup(MANUAL_COLLABORATOR, chain(triggerNode(), policyNode("pol", { policyId: "" }), endNode())), code: "VALIDATION_ERROR", nodeId: "pol" },
  { family: "intervention-policy", name: "referência de análise que vem depois do nó", setup: setup(MANUAL_COLLABORATOR, chain(triggerNode(), policyNode("pol", { analysisSourceNodeIds: ["end"] }), endNode())), code: "WORKFLOW_INTERVENTION_POLICY_SOURCE_NOT_ANCESTOR", nodeId: "pol" },
  { family: "orchestrators", name: "Orquestrador sem orquestrador escolhido", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator("orq", { orchestratorId: "" }), endNode())), code: "VALIDATION_ERROR", nodeId: "orq" },
  { family: "orchestrators", name: "Orquestrador sem instrução", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator("orq", { instruction: "   " }), endNode())), code: "VALIDATION_ERROR", nodeId: "orq" },
  { family: "orchestrators", name: "roteamento por domínios sem domínio", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator("orq", { routing: { mode: "DOMAINS", businessDomainIds: [] } }), endNode())), code: "VALIDATION_ERROR", nodeId: "orq" },

  // ---- review-escalation: revisão humana e escalonamento ------------------------------------------------------
  { family: "review-escalation", name: "Revisão relativa a uma revisão que não existe", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), humanReview("hr", { reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "nao-existe" } }), endNode())), code: "WORKFLOW_INVALID_HUMAN_REVIEW", nodeId: "hr" },
  { family: "review-escalation", name: "Revisão relativa a um nó que não é revisão", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), humanReview("hr", { reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "trigger" } }), endNode())), code: "WORKFLOW_INVALID_HUMAN_REVIEW", nodeId: "hr" },
  { family: "review-escalation", name: "Revisão relativa a uma revisão que vem depois", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), humanReview("hr-2", { reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "hr-1" } }), humanReview("hr-1"), endNode())), code: "WORKFLOW_INVALID_HUMAN_REVIEW", nodeId: "hr-2" },
  { family: "review-escalation", name: "Revisão com campo estruturado que não existe mais", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator(), humanReview("hr", { contentSource: "nodeOutputs.orq.structuredResult.sumiu" }), endNode()), { orchestrators: STRUCTURED_ORCHESTRATOR }), code: "WORKFLOW_INVALID_HUMAN_REVIEW", nodeId: "hr" },
  { family: "review-escalation", name: "Escalonar relativo a uma revisão que não existe", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), escalate("esc", { target: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "nao-existe" } }), endNode())), code: "WORKFLOW_INVALID_ACTION", nodeId: "esc" },
  { family: "review-escalation", name: "Escalonar o resultado inteiro para o Avatar", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator(), escalate("esc", { contentSource: "nodeOutputs.orq", surfaces: ["AVATAR"] }), endNode()), { orchestrators: STRUCTURED_ORCHESTRATOR }), code: "WORKFLOW_INVALID_ACTION", nodeId: "esc" },
  { family: "review-escalation", name: "Escalonar uma lista para o Chat", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator(), escalate("esc", { contentSource: "nodeOutputs.orq.structuredResult.lista", surfaces: ["CHAT"] }), endNode()), { orchestrators: STRUCTURED_ORCHESTRATOR }), code: "WORKFLOW_INVALID_ACTION", nodeId: "esc" },
  { family: "review-escalation", name: "Escalonar campo estruturado que não existe mais", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator(), escalate("esc", { contentSource: "nodeOutputs.orq.structuredResult.sumiu" }), endNode()), { orchestrators: STRUCTURED_ORCHESTRATOR }), code: "WORKFLOW_INVALID_ACTION", nodeId: "esc" },

  // ---- outputs: output e destinatários (o Output do feedback confiável está em reliable-feedback) --------------------------------------------------------------
  { family: "outputs", name: "Output sem conteúdo", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), output("out", ""), endNode())), code: "VALIDATION_ERROR", nodeId: "out" },
  { family: "outputs", name: "Output do resultado inteiro para o Avatar", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator(), output("out", "nodeOutputs.orq", { surfaces: ["AVATAR"] }), endNode()), { orchestrators: STRUCTURED_ORCHESTRATOR }), code: "WORKFLOW_INVALID_OUTPUT", nodeId: "out" },
  { family: "outputs", name: "Output de uma lista para o Chat", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator(), output("out", "nodeOutputs.orq.structuredResult.lista", { surfaces: ["CHAT"] }), endNode()), { orchestrators: STRUCTURED_ORCHESTRATOR }), code: "WORKFLOW_INVALID_OUTPUT", nodeId: "out" },
  { family: "outputs", name: "Output de campo estruturado que não existe mais", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator(), output("out", "nodeOutputs.orq.structuredResult.sumiu"), endNode()), { orchestrators: STRUCTURED_ORCHESTRATOR }), code: "WORKFLOW_INVALID_OUTPUT", nodeId: "out" },
  { family: "reliable-feedback", name: "resultado do Agent direto no Acompanhamento do operador (Flag)", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), output("out", "nodeOutputs.agent", { target: { type: "CURRENT_OPERATOR" } }), endNode())), code: "WORKFLOW_FEEDBACK_REQUIRES_RELIABILITY", nodeId: "out" },
  { family: "reliable-feedback", name: "resultado do Orquestrador direto no Chat do operador (Indicador)", setup: setup(INDICATOR, chain(triggerNode(), orchestrator(), output("out", "nodeOutputs.orq", { target: { type: "CURRENT_OPERATOR" }, surfaces: ["CHAT"] }), endNode())), code: "WORKFLOW_FEEDBACK_REQUIRES_RELIABILITY", nodeId: "out" },
  { family: "reliable-feedback", name: "Output de um campo do feedback confiável", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), generateFeedback(), output("out", "nodeOutputs.fb.texto", { target: { type: "CURRENT_OPERATOR" } }), endNode())), code: "WORKFLOW_OUTPUT_FEEDBACK_SOURCE_INVALID", nodeId: "out" },
  { family: "reliable-feedback", name: "feedback confiável em Pendências", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), generateFeedback(), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" }, surfaces: ["INBOX"] }), endNode())), code: "WORKFLOW_OUTPUT_SURFACE_UNSUPPORTED", nodeId: "out" },
  { family: "reliable-feedback", name: "feedback confiável no Chat de outra pessoa", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), generateFeedback(), output("out", "nodeOutputs.fb", { surfaces: ["CHAT"] }), endNode())), code: "WORKFLOW_OUTPUT_CONVERSATIONAL_TARGET_INVALID", nodeId: "out" },
  { family: "reliable-feedback", name: "Output do feedback direto de atendimento (legado)", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), interactionFeedback("ifb", { kind: "TRIGGER_INTERACTION" }), output("out", "nodeOutputs.ifb"), endNode())), code: "WORKFLOW_OUTPUT_FEEDBACK_SOURCE_INVALID", nodeId: "out" },
  {
    family: "reliable-feedback",
    name: "Output do feedback confiável sem saída ligada",
    setup: setup(FLAG_BOOLEAN, { nodes: [triggerNode(), agent(), generateFeedback(), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" } }), endNode()], edges: [edge("trigger", "always", "agent"), edge("agent", "always", "fb"), edge("fb", "always", "out")] }),
    code: "WORKFLOW_MISSING_BRANCH_EDGE",
    nodeId: "out",
  },

  // ---- reliable-feedback: "Gerar feedback" e o Output que o publica -----------------------------------------------
  { family: "reliable-feedback", name: "origem que não existe", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), generateFeedback("fb", { sourceNodeId: "sumiu" }), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" } }), endNode())), code: "WORKFLOW_FEEDBACK_SOURCE_NOT_FOUND", nodeId: "fb" },
  { family: "reliable-feedback", name: "origem sem escolha (rascunho salva, publicação recusa)", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), generateFeedback("fb", { sourceNodeId: "" }), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" } }), endNode())), code: "VALIDATION_ERROR", nodeId: "fb" },
  { family: "reliable-feedback", name: "origem que não é Agent nem Orquestrador", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), output("out-1"), generateFeedback("fb", { sourceNodeId: "out-1" }), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" } }), endNode())), code: "WORKFLOW_FEEDBACK_SOURCE_INCOMPATIBLE", nodeId: "fb" },
  { family: "reliable-feedback", name: "origem que vem depois", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), generateFeedback(), agent(), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" } }), endNode())), code: "WORKFLOW_FEEDBACK_SOURCE_NOT_ANCESTOR", nodeId: "fb" },
  { family: "reliable-feedback", name: "tipo automático ambíguo (Agenda, Agent sem formato)", setup: setup(SCHEDULE, chain(triggerNode(), scheduledAgent(), generateFeedback(), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" } }), endNode())), code: "WORKFLOW_FEEDBACK_DOMAIN_AMBIGUOUS", nodeId: "fb" },
  { family: "reliable-feedback", name: "monitoria com gatilho por Indicador", setup: setup(INDICATOR, chain(triggerNode(), agent(), generateFeedback("fb", { feedbackDomain: "MONITORING" }), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" } }), endNode())), code: "WORKFLOW_FEEDBACK_MONITORING_REQUIRES_INTERACTION", nodeId: "fb" },
  { family: "reliable-feedback", name: "indicador a partir de Orquestrador", setup: setup(INDICATOR, chain(triggerNode(), orchestrator(), generateFeedback("fb", { sourceNodeId: "orq", feedbackDomain: "INDICATOR" }), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" } }), endNode())), code: "WORKFLOW_FEEDBACK_INDICATOR_ORCHESTRATOR_UNSUPPORTED", nodeId: "fb" },
  { family: "reliable-feedback", name: "indicador sem medição do gatilho (Flag)", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), generateFeedback("fb", { feedbackDomain: "INDICATOR" }), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" } }), endNode())), code: "WORKFLOW_FEEDBACK_INDICATOR_REQUIRES_CANONICAL_CONTEXT", nodeId: "fb" },
  {
    family: "reliable-feedback",
    name: "fechamento do PRV com gatilho por Indicador",
    setup: setup(INDICATOR, chain(triggerNode(), agent("agent", { outputContract: "PRV_CLOSING_DIAGNOSIS", scheduledDataSource: { kind: "PERFORMANCE", closures: 1 } }), generateFeedback(), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" } }), endNode())),
    code: "WORKFLOW_PRV_DIAGNOSIS_REQUIRES_SCHEDULE",
    nodeId: "fb",
    alsoNodeIds: ["agent"],
  },
  {
    family: "reliable-feedback",
    name: "Gerar feedback sem saída ligada",
    setup: setup(FLAG_BOOLEAN, { nodes: [triggerNode(), agent(), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" } }), generateFeedback(), endNode()], edges: [edge("trigger", "always", "agent"), edge("agent", "always", "fb"), edge("out", "always", "end")] }),
    code: "WORKFLOW_MISSING_BRANCH_EDGE",
    nodeId: "fb",
    // O Output deste grafo também está solto (não vem depois do "Gerar feedback"): ligando só a saída do nó, é a regra
    // seguinte que o backend aponta — o editor lista as duas de uma vez.
    alsoCodes: ["WORKFLOW_FEEDBACK_SOURCE_NOT_ANCESTOR"],
  },
  { family: "reliable-feedback", name: "Gerar feedback sem Output que o entregue", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), generateFeedback(), output("out", "nodeOutputs.agent"), endNode())), code: "WORKFLOW_FEEDBACK_WITHOUT_OUTPUT", nodeId: "fb" },

  // ---- indicator-diagnosis: indicador e estratégia --------------------------------------------------------------
  { family: "indicator-diagnosis", name: "reconhecimento sem seleção antes", setup: setup(SCHEDULE, chain(triggerNode(), RECOGNITION_AGENT, output(), endNode())), code: "WORKFLOW_RECOGNITION_REQUIRES_RANKING", nodeId: "agent" },
  { family: "indicator-diagnosis", name: "reconhecimento com seleção por critério", setup: consolidated(consolidatedGraph({ agent: RECOGNITION_AGENT })), code: "WORKFLOW_RECOGNITION_REQUIRES_RANKING", nodeId: "agent" },
  { family: "indicator-diagnosis", name: "reconhecimento com ranking de piores", setup: consolidated(consolidatedGraph({ select: select("select", { selectionMode: "RANKING", ranking: { ...RANKING_BEST, selection: "WORST" } }), agent: RECOGNITION_AGENT })), code: "WORKFLOW_RECOGNITION_REQUIRES_RANKING", nodeId: "agent" },
  { family: "indicator-diagnosis", name: "reconhecimento com fonte de monitoria", setup: consolidated(consolidatedGraph({ select: select("select", { selectionMode: "RANKING", ranking: RANKING_BEST }), agent: agent("agent", { outputContract: "RECOGNITION", scheduledDataSource: { kind: "MONITORING", sampleSize: 3, period: "WEEK" } }) })), code: "WORKFLOW_RECOGNITION_REQUIRES_RANKING", nodeId: "agent" },
  { family: "indicator-diagnosis", name: "fechamento do PRV com gatilho por Flag", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent("agent", { outputContract: "PRV_CLOSING_DIAGNOSIS", scheduledDataSource: { kind: "PERFORMANCE", closures: 1 } }), output(), endNode())), code: "WORKFLOW_PRV_DIAGNOSIS_REQUIRES_SCHEDULE", nodeId: "agent" },
  { family: "indicator-diagnosis", name: "fechamento do PRV com Agenda e fonte de monitoria", setup: setup(SCHEDULE, chain(triggerNode(), scheduledAgent("agent", { outputContract: "PRV_CLOSING_DIAGNOSIS" }), output(), endNode())), code: "WORKFLOW_PRV_DIAGNOSIS_REQUIRES_SCHEDULE", nodeId: "agent" },
  { family: "indicator-diagnosis", name: "diagnóstico do indicador com gatilho por Flag", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent("agent", { outputContract: "INDICATOR_DIAGNOSIS" }), output(), endNode())), code: "WORKFLOW_INDICATOR_DIAGNOSIS_REQUIRES_INDICATOR", nodeId: "agent" },
  { family: "indicator-diagnosis", name: "diagnóstico do indicador com Agenda e fechamentos sem indicador", setup: setup(SCHEDULE, chain(triggerNode(), agent("agent", { outputContract: "INDICATOR_DIAGNOSIS", scheduledDataSource: { kind: "PERFORMANCE", closures: 1 } }), output(), endNode())), code: "WORKFLOW_INDICATOR_DIAGNOSIS_REQUIRES_INDICATOR", nodeId: "agent" },

  // ---- fan-out: modo Consolidado, fan-out/join, coleção e ranking ---------------------------------------------------
  { family: "fan-out", name: "'O próprio operador' depois de Consolidar resultados", setup: consolidated(consolidatedGraph({ outMgr: node("out-mgr", "output", "Resumo", { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orq" }) })), code: "WORKFLOW_OUTPUT_TARGET_INVALID_MODE", nodeId: "out-mgr" },
  { family: "fan-out", name: "'O próprio operador' antes de Selecionar colaboradores", setup: consolidated(chain(triggerNode(), output("out", "nodeOutputs.trigger", { target: { type: "CURRENT_OPERATOR" } }), endNode())), code: "WORKFLOW_OUTPUT_TARGET_INVALID_MODE", nodeId: "out" },
  { family: "fan-out", name: "Performance do colaborador sobre a estrutura", setup: consolidated(chain(triggerNode(), condition("cond", { thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } }), endNode())), code: "WORKFLOW_PERFORMANCE_QUERY_INVALID_MODE", nodeId: "cond" },
  { family: "fan-out", name: "Quartil operacional sobre a estrutura", setup: consolidated(chain(triggerNode(), condition("cond", { comparator: "EQUALS", thresholdText: "Q4", historicalQuery: QUARTILE }), endNode())), code: "WORKFLOW_OPERATIONAL_QUARTILE_INVALID_MODE", nodeId: "cond" },
  { family: "fan-out", name: "Revisão humana sobre a estrutura", setup: consolidated(chain(triggerNode(), humanReview("hr"), endNode())), code: "WORKFLOW_HUMAN_REVIEW_INVALID_MODE", nodeId: "hr" },
  { family: "fan-out", name: "Revisão humana depois de Consolidar resultados", setup: consolidated(consolidatedGraph({ orq: humanReview("orq") })), code: "WORKFLOW_HUMAN_REVIEW_INVALID_MODE", nodeId: "orq" },
  { family: "fan-out", name: "Orquestrador sobre a estrutura", setup: consolidated(chain(triggerNode(), orchestrator(), endNode())), code: "WORKFLOW_ORCHESTRATOR_INVALID_MODE", nodeId: "orq" },
  { family: "fan-out", name: "Avaliar política de acompanhamento sobre a estrutura", setup: consolidated(chain(triggerNode(), policyNode(), endNode())), code: "WORKFLOW_INTERVENTION_POLICY_INVALID_MODE", nodeId: "pol" },
  { family: "fan-out", name: "Chamar agente sobre a estrutura", setup: consolidated(chain(triggerNode(), agent("agent", { scheduledDataSource: { kind: "PERFORMANCE", closures: 1 } }), output(), endNode())), code: "WORKFLOW_ACTION_INVALID_MODE", nodeId: "agent" },
  { family: "fan-out", name: "Escalonar sobre a estrutura", setup: consolidated(chain(triggerNode(), escalate("esc"), endNode())), code: "WORKFLOW_ACTION_INVALID_MODE", nodeId: "esc" },
  { family: "fan-out", name: "Feedback direto de atendimento sobre a estrutura", setup: consolidated(chain(triggerNode(), interactionFeedback("ifb", { kind: "COLLABORATOR_SAMPLE", period: "WEEK", sampleSize: 3, strategy: "MOST_RECENT" }), endNode())), code: "WORKFLOW_ACTION_INVALID_MODE", nodeId: "ifb" },
  {
    family: "fan-out",
    name: "Selecionar colaboradores depois de Aplicar individualmente",
    setup: consolidated(chain(triggerNode(), select(), apply(), select("select-2"), apply("apply-2"), agent("agent", { scheduledDataSource: { kind: "PERFORMANCE", closures: 1 } }), join(), orchestrator(), output("out-mgr", "nodeOutputs.orq", { target: { type: "ROLE", role: "SUPERVISOR" } }), endNode())),
    code: "WORKFLOW_SELECT_EMPLOYEES_INVALID_MODE",
    nodeId: "select-2",
  },
  { family: "fan-out", name: "Selecionar colaboradores sem critério", setup: consolidated(consolidatedGraph({ select: select("select", { selectionMode: "CONDITION" }) })), code: "WORKFLOW_SELECT_EMPLOYEES_MISSING_CRITERION", nodeId: "select" },
  { family: "fan-out", name: "Selecionar colaboradores por ranking sem ranking", setup: consolidated(consolidatedGraph({ select: select("select", { selectionMode: "RANKING" }) })), code: "WORKFLOW_SELECT_EMPLOYEES_MISSING_RANKING", nodeId: "select" },
  { family: "fan-out", name: "Aplicar individualmente sem coleção", setup: consolidated(chain(triggerNode(), apply(), endNode())), code: "WORKFLOW_APPLY_INDIVIDUALLY_INVALID_MODE", nodeId: "apply" },
  {
    family: "fan-out",
    name: "Join alcançado por dois Aplicar individualmente",
    setup: consolidated({
      nodes: [triggerNode(), select(), apply("apply-1"), apply("apply-2"), join(), endNode()],
      edges: [edge("trigger", "always", "select"), edge("select", "always", "apply-1"), { ...edge("select", "always", "apply-2"), id: "select-2" }, edge("apply-1", "always", "join"), edge("apply-2", "always", "join"), edge("join", "always", "end")],
    }),
    code: "WORKFLOW_CONSOLIDATE_RESULTS_AMBIGUOUS_ORIGIN",
    nodeId: "join",
  },
  {
    family: "fan-out",
    name: "Aplicar individualmente alcança dois Joins",
    setup: consolidated({
      nodes: [triggerNode(), select(), apply(), condition("cond", { comparator: "EQUALS", thresholdBoolean: true, sourcePath: "nodeOutputs.trigger" }), join("join-1"), join("join-2"), endNode()],
      edges: [edge("trigger", "always", "select"), edge("select", "always", "apply"), edge("apply", "always", "cond"), edge("cond", "true", "join-1"), edge("cond", "false", "join-2"), edge("join-1", "always", "end"), edge("join-2", "always", "end")],
    }),
    code: "WORKFLOW_APPLY_INDIVIDUALLY_MULTIPLE_JOINS",
    nodeId: "apply",
    // Com dois Joins, o caminho até o segundo "escapa" do Join pareado.
    alsoCodes: ["WORKFLOW_FAN_OUT_PATH_ESCAPES_JOIN"],
  },
  {
    family: "fan-out",
    name: "Consolidar resultados sem Aplicar individualmente (direto da coleção)",
    setup: consolidated(chain(triggerNode(), select(), join(), endNode())),
    code: "WORKFLOW_CONSOLIDATE_RESULTS_INVALID_MODE",
    nodeId: "join",
    // Sem "Aplicar individualmente" o Join também não tem origem; no backend essa segunda regra nunca é a primeira (o
    // contexto de entrada errado sempre a precede).
    alsoCodes: ["WORKFLOW_CONSOLIDATE_RESULTS_MISSING_ORIGIN"],
  },
  {
    family: "fan-out",
    name: "caminho individual escapa do Join",
    setup: consolidated({
      nodes: [triggerNode(), select(), apply(), condition("cond", { comparator: "EQUALS", thresholdBoolean: true, sourcePath: "nodeOutputs.trigger" }), join(), endNode()],
      edges: [edge("trigger", "always", "select"), edge("select", "always", "apply"), edge("apply", "always", "cond"), edge("cond", "true", "join"), edge("cond", "false", "end"), edge("join", "always", "end")],
    }),
    code: "WORKFLOW_FAN_OUT_PATH_ESCAPES_JOIN",
    nodeId: "apply",
  },
  { family: "fan-out", name: "ranking sem indicador", setup: withRanking({ ...RANKING_OK, indicatorCode: undefined }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },
  { family: "fan-out", name: "ranking sem agregação", setup: withRanking({ ...RANKING_OK, aggregation: undefined }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },
  { family: "fan-out", name: "ranking sem período", setup: withRanking({ ...RANKING_OK, period: undefined }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },
  { family: "fan-out", name: "ranking sem direção", setup: withRanking({ ...RANKING_OK, selection: undefined }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },
  { family: "fan-out", name: "ranking sem quantidade", setup: withRanking({ ...RANKING_OK, count: undefined }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },
  { family: "fan-out", name: "ranking por valor com direção de evolução", setup: withRanking({ ...RANKING_OK, selection: "IMPROVED" }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },
  { family: "fan-out", name: "ranking por evolução com direção de valor", setup: withRanking({ ...RANKING_OK, rankingBasis: "CHANGE", selection: "HIGHEST" }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },
  { family: "fan-out", name: "ranking por evolução com Últimos N fechamentos", setup: withRanking({ ...RANKING_OK, rankingBasis: "CHANGE", selection: "IMPROVED", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },
  { family: "fan-out", name: "Quartil operacional com fonte oficial", setup: withRanking({ ...RANKING_OK, source: "INDICATOR_ACHIEVEMENT", aggregation: "AVERAGE", selection: "OPERATIONAL_QUARTILE", operationalQuartile: "Q4", count: undefined }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },
  { family: "fan-out", name: "Quartil operacional com Últimos N fechamentos", setup: withRanking({ ...RANKING_OK, selection: "OPERATIONAL_QUARTILE", operationalQuartile: "Q4", count: undefined, period: { kind: "CLOSURES", unit: "MONTH", count: 3 } }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },
  { family: "fan-out", name: "Quartil operacional sem o quartil", setup: withRanking({ ...RANKING_OK, selection: "OPERATIONAL_QUARTILE", count: undefined }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },
  { family: "fan-out", name: "ranking oficial com agregação operacional", setup: withRanking({ ...RANKING_OK, source: "INDICATOR_ACHIEVEMENT", aggregation: "WEIGHTED_AVERAGE", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },
  { family: "fan-out", name: "ranking oficial com Cobertura mínima", setup: withRanking({ ...RANKING_OK, source: "INDICATOR_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CLOSURES", unit: "MONTH", count: 3 }, minimumCoverage: 0.5 }), code: "WORKFLOW_INVALID_SELECTION_RANKING", nodeId: "select" },

  // ---- diferenças achadas em 07/10/2026 e corrigidas no editor em 08/10/2026 (o editor passou a seguir o backend) ----
  { family: "fan-out", name: "D1 · nós de coleção (Selecionar/Aplicar) num Workflow Individual", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), select(), apply(), endNode())), code: "WORKFLOW_EMPLOYEE_COLLECTION_INVALID_MODE", nodeId: "select", alsoNodeIds: ["apply"] },
  {
    family: "fan-out",
    name: "D2 · critério de 'Selecionar colaboradores' com operador incompatível (mesmas regras da Condition)",
    setup: consolidated(consolidatedGraph({ select: select("select", { selectionMode: "CONDITION", criterion: { comparator: "CONTAINS", thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } } }) })),
    code: "WORKFLOW_INVALID_SELECTION_CRITERION",
    nodeId: "select",
  },
  { family: "conditions", name: "D3 · histórico com fonte oficial e agregação operacional", setup: conditionCase({ thresholdNumeric: 90, historicalQuery: { ...HISTORY, source: "INDICATOR_ACHIEVEMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "D4 · histórico com fonte oficial e período de dias/semana", setup: conditionCase({ thresholdNumeric: 90, historicalQuery: { ...HISTORY, source: "INDICATOR_ACHIEVEMENT", aggregation: "AVERAGE" } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "D5 · Quartil operacional com Mínimo de medições", setup: conditionCase({ comparator: "EQUALS", thresholdText: "Q4", historicalQuery: { ...QUARTILE, minimumSampleSize: 3 } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "D6 · performance numérica com operador que não é numérico", setup: conditionCase({ comparator: "CONTAINS", thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { family: "conditions", name: "D8a · Condition sobre variável que não existe mais", setup: conditionCase({ sourcePath: `variables.${MISSING_UUID}`, comparator: "GT", thresholdNumeric: 1 }), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  {
    family: "conditions",
    name: "D8b · Condition sobre variável com valor do tipo errado",
    setup: setup(FLAG_BOOLEAN, chain(triggerNode(), condition("cond", { sourcePath: `variables.${VARIABLE_A}`, comparator: "EQUALS", thresholdText: "x" }), endNode()), { variables: VARIABLES_AB }),
    code: "WORKFLOW_INVALID_CONDITION",
    nodeId: "cond",
  },
  {
    family: "conditions",
    name: "D8c · Condition sobre opção de campo estruturado fora da lista",
    setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator(), condition("cond", { sourcePath: "nodeOutputs.orq.structuredResult.categoria", comparator: "EQUALS", thresholdText: "Z" }), endNode()), { orchestrators: STRUCTURED_ORCHESTRATOR }),
    code: "WORKFLOW_INVALID_CONDITION",
    nodeId: "cond",
  },
  { family: "conditions", name: "D9 · Condition sobre o valor do gatilho com gatilho por Agenda", setup: conditionCase({ thresholdNumeric: 3 }, SCHEDULE), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  {
    family: "reliable-feedback",
    name: "D10 · Output do feedback confiável ANTES do 'Gerar feedback'",
    setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), output("out", "nodeOutputs.fb", { target: { type: "CURRENT_OPERATOR" } }), generateFeedback(), endNode())),
    code: "WORKFLOW_FEEDBACK_SOURCE_NOT_ANCESTOR",
    nodeId: "out",
  },
]

// ---------------------------------------------------------------------------------------------
// Casos de borda que os dois lados publicam — o editor nunca pode recusar o que o backend aceita (ele bloqueia o dry-run).
// ---------------------------------------------------------------------------------------------

export type AcceptedCase = { name: string; setup: ParitySetup }

export const ACCEPTED: AcceptedCase[] = [
  // D7 (decisão de 08/10/2026: o editor segue o backend) — "está vazio"/"não está vazio" não comparam com um quartil.
  { name: "D7 · quartil de performance com 'está vazio' sem quartil de referência", setup: conditionCase({ comparator: "IS_EMPTY", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" } }) },
  { name: "D7 · quartil de performance com 'não está vazio' sem quartil de referência", setup: conditionCase({ comparator: "NOT_EMPTY", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" } }) },
  // C06: com uma Espera no caminho de volta o ciclo publica (o motor ainda limita as execuções do nó pago por execução).
  { name: "C06 · ciclo Revisão 'Reprovado' → Espera → agente", setup: setup(FLAG_BOOLEAN, reviewLoop(true)) },
  // D5: só nó alcançável a partir do Gatilho precisa de todas as saídas — um nó solto no canvas nunca roda.
  { name: "D5 · Condição solta no canvas, sem ligação nenhuma", setup: setup(FLAG_BOOLEAN, { nodes: [triggerNode(), endNode(), condition("loose", { comparator: "EQUALS", thresholdBoolean: true })], edges: [edge("trigger", "always", "end")] }) },
  // Quartil oficial entre "Aplicar individualmente" e "Consolidar resultados": lê o fechamento da própria pessoa (o editor oferece a opção).
  { name: "quartil oficial no caminho individual de um Workflow consolidado", setup: consolidated({
    nodes: [triggerNode(), select(), apply(), condition("cond", { comparator: "EQUALS", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" } }), join(), endNode()],
    edges: [edge("trigger", "always", "select"), edge("select", "always", "apply"), edge("apply", "always", "cond"), edge("cond", "true", "join"), edge("cond", "false", "join"), edge("cond", "no_data", "join"), edge("join", "always", "end")],
  }) },
  // PEN-076: etapa com a versão do Orquestrador fixada. A versão de agente de grafos antigos é ignorada (revisão de 03/11/2026: o
  // agente vale pela vigente) — continua aceita.
  { name: "etapa com a versão do agente fixada", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), agent("agent", { agentVersionId: AGENT_VERSION_ID }), output(), endNode())) },
  { name: "etapa com a versão do Orquestrador fixada", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator("orq", { orchestratorVersionId: ORCHESTRATOR_VERSION_ID }), output("out", "nodeOutputs.orq"), endNode())) },
  {
    name: "versão fixada do Orquestrador no mesmo Grupo do Workflow",
    setup: setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator("orq", { orchestratorVersionId: ORCHESTRATOR_VERSION_ID }), output("out", "nodeOutputs.orq"), endNode()), {
      scope: { scopeType: "TEAM", teamId: PARITY_TEAM_ID, subteamId: null },
      db: {
        orchestrator: (id) => ({ id, output_schema: null, structured_output: null, output_instructions: null, scopeType: "TEAM", teamId: PARITY_TEAM_ID, subteamId: null, name: "Orquestrador", active: true, invocation_mode: "WORKFLOW" }),
        orchestratorVersion: (id) => ({ id, scopeType: "TEAM", teamId: PARITY_TEAM_ID, subteamId: null }),
      },
    }),
  },
]

// ---------------------------------------------------------------------------------------------
// Só backend: dependem de banco ou do ambiente — o editor não tem o dado para checar (por desenho; o dry-run do backend
// `POST /:id/validate` cobre no editor). `reason` = o dado que falta ao editor.
// ---------------------------------------------------------------------------------------------

export type BackendOnlyCase = { name: string; reason: string; setup: ParitySetup; code: string; nodeId?: string; env?: "INTERACTION_FEEDBACK_OFF" }

const withDb = (base: ParitySetup, db: Partial<ParityDbFacts>): ParitySetup => ({ ...base, db })
const VALID_AGENT_FLOW = setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), output(), endNode()))
const VALID_ORCHESTRATOR_FLOW = setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator(), output("out", "nodeOutputs.orq"), endNode()))
const VALID_POLICY_FLOW = setup(MANUAL_COLLABORATOR, chain(triggerNode(), policyNode(), endNode()))
const policyRow = (extra: Record<string, unknown>) => (policyId: string) => ({ id: policyId, name: "Política", active: true, scope_type: "ORGANIZATION", team_id: null, subteam_id: null, subteam_team_id: null, published: 1, ...extra })
const agentRow = (row: Record<string, unknown>) => () => ({ id: AGENT_ID, name: "Agente", active: true, agent_type: "CALL_FEEDBACK", specialty: null, specialty_kind: "PERFORMANCE", domain: null, consolidated_input: true, ...row })
const orchestratorRow = (row: Record<string, unknown>) => () => ({ id: ORCHESTRATOR_ID, output_schema: null, structured_output: null, output_instructions: null, scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Orquestrador", active: true, invocation_mode: "WORKFLOW", ...row })
const indicatorRow = (row: Record<string, unknown>) => (code: string) => ({ id: "0a7a0000-0000-4000-8000-0000000000d1", code, name: code, active: true, daily_supported: true, official_closure_supported: true, desired_direction: "HIGHER", operational_aggregation: "WEIGHTED_AVERAGE", ...row })
const indicatorDiagnosisFlow = setup(INDICATOR, chain(triggerNode(), agent("agent", { outputContract: "INDICATOR_DIAGNOSIS" }), output(), endNode()))
const directDiagnosisFlow = setup(SCHEDULE, chain(triggerNode(), agent("agent", { outputContract: "INDICATOR_DIAGNOSIS", scheduledDataSource: { kind: "PERFORMANCE", closures: 1, indicatorCode: "TMA" } }), output(), endNode()))

export const BACKEND_ONLY: BackendOnlyCase[] = [
  {
    name: "Filtro Populacional com gatilho por Flag",
    reason: "Filtro Populacional do rascunho: o editor não o recebe e as rotas do rascunho já recusam a combinação",
    setup: setup(FLAG_BOOLEAN, chain(triggerNode(), endNode()), { populationFilter: { kind: "EMPLOYEE", employeeId: "0a7a0000-0000-4000-8000-0000000000a7" } }),
    code: "WORKFLOW_POPULATION_FILTER_INVALID_TRIGGER",
    nodeId: "trigger",
  },
  { name: "agente que não existe", reason: "catálogo de agentes", setup: withDb(VALID_AGENT_FLOW, { agent: () => null }), code: "WORKFLOW_AGENT_NOT_FOUND", nodeId: "agent" },
  { name: "agente inativo", reason: "catálogo de agentes", setup: withDb(VALID_AGENT_FLOW, { agent: agentRow({ active: false }) }), code: "WORKFLOW_AGENT_INACTIVE", nodeId: "agent" },
  { name: "agente de outro Grupo", reason: "abrangência do agente", setup: withDb(VALID_AGENT_FLOW, { agent: agentRow({ scope_type: "TEAM", team_id: PARITY_TEAM_ID, subteam_id: null }) }), code: "WORKFLOW_AGENT_SCOPE_FORBIDDEN", nodeId: "agent" },
  { name: "agente nunca publicado", reason: "versões do agente", setup: withDb(VALID_AGENT_FLOW, { agent: agentRow({ current_version_id: null }) }), code: "WORKFLOW_AGENT_NOT_PUBLISHED", nodeId: "agent" },
  {
    name: "destinatário fixo inexistente, inativo ou de outra organização",
    reason: "cadastro de pessoas",
    setup: withDb(setup(FLAG_BOOLEAN, chain(triggerNode(), agent(), output("out", "nodeOutputs.agent", { target: { type: "USER", userId: "0a7a0000-0000-4000-8000-0000000000f9" } }), endNode())), { person: () => null }),
    code: "WORKFLOW_RECIPIENT_NOT_FOUND",
  },
  { name: "agente-coordenador chamado direto", reason: "tipo do agente", setup: withDb(VALID_AGENT_FLOW, { agent: agentRow({ agent_type: "ORCHESTRATOR" }) }), code: "WORKFLOW_AGENT_INVALID_TYPE", nodeId: "agent" },
  { name: "Agent que não aceita resultado consolidado depois do Join", reason: "especialidade do agente", setup: withDb(consolidated(consolidatedGraph({ orq: agent("orq", { instruction: "Sintetize." }) })), { agent: agentRow({ consolidated_input: false }) }), code: "WORKFLOW_AGENT_NOT_CONSOLIDATED", nodeId: "orq" },
  { name: "Agent de síntese no caminho individual", reason: "especialidade do agente", setup: withDb(VALID_AGENT_FLOW, { agent: agentRow({ specialty_kind: "SYNTHESIS" }) }), code: "WORKFLOW_AGENT_SYNTHESIS_REQUIRES_JOIN", nodeId: "agent" },
  { name: "Orquestrador que não existe", reason: "catálogo de orquestradores", setup: withDb(VALID_ORCHESTRATOR_FLOW, { orchestrator: () => null }), code: "WORKFLOW_ORCHESTRATOR_NOT_FOUND", nodeId: "orq" },
  { name: "Orquestrador inativo", reason: "catálogo de orquestradores", setup: withDb(VALID_ORCHESTRATOR_FLOW, { orchestrator: orchestratorRow({ active: false }) }), code: "WORKFLOW_ORCHESTRATOR_INACTIVE", nodeId: "orq" },
  { name: "versão fixada que não é do Orquestrador", reason: "versões do orquestrador", setup: withDb(setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator("orq", { orchestratorVersionId: ORCHESTRATOR_VERSION_ID }), output("out", "nodeOutputs.orq"), endNode())), { orchestratorVersion: () => null }), code: "WORKFLOW_ORCHESTRATOR_VERSION_NOT_FOUND", nodeId: "orq" },
  // A execução usa o alcance e os especialistas da versão FIXADA, não os de hoje: fixar a versão de quando o Orquestrador era de outro Grupo
  // levaria os especialistas e as bases daquele Grupo para os colaboradores deste, mesmo com o Orquestrador de hoje no Grupo certo.
  {
    name: "versão fixada de quando o Orquestrador era de outro Grupo",
    reason: "abrangência da versão do orquestrador",
    setup: withDb(setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator("orq", { orchestratorVersionId: ORCHESTRATOR_VERSION_ID }), output("out", "nodeOutputs.orq"), endNode()), { scope: { scopeType: "TEAM", teamId: PARITY_TEAM_ID, subteamId: null } }), {
      orchestrator: orchestratorRow({ scopeType: "TEAM", teamId: PARITY_TEAM_ID }),
      orchestratorVersion: (id) => ({ id, scopeType: "TEAM", teamId: OTHER_TEAM_ID, subteamId: null }),
    }),
    code: "WORKFLOW_ORCHESTRATOR_VERSION_SCOPE_FORBIDDEN",
    nodeId: "orq",
  },
  { name: "Orquestrador só de chat/voz", reason: "modo de invocação do orquestrador", setup: withDb(VALID_ORCHESTRATOR_FLOW, { orchestrator: orchestratorRow({ invocation_mode: "INTERACTIVE" }) }), code: "WORKFLOW_ORCHESTRATOR_INVALID_INVOCATION", nodeId: "orq" },
  { name: "Orquestrador de outro Grupo", reason: "abrangência do orquestrador", setup: withDb(VALID_ORCHESTRATOR_FLOW, { orchestrator: orchestratorRow({ scopeType: "TEAM", teamId: PARITY_TEAM_ID }) }), code: "WORKFLOW_ORCHESTRATOR_SCOPE_FORBIDDEN" },
  {
    name: "roteamento declarado com domínio sem especialista",
    reason: "especialistas do orquestrador por domínio",
    setup: withDb(setup(FLAG_BOOLEAN, chain(triggerNode(), orchestrator("orq", { routing: { mode: "DOMAINS", businessDomainIds: [DOMAIN_ID] } }), output("out", "nodeOutputs.orq"), endNode())), { businessDomain: (id) => ({ id, name: "Faturamento", active: true, specialists: 0 }) }),
    code: "WORKFLOW_ORCHESTRATOR_ROUTING_DOMAIN_INVALID",
    nodeId: "orq",
  },
  { name: "destinatário de gestão inexistente na estrutura", reason: "hierarquia (reports_to)", setup: consolidated(consolidatedGraph(), { structure: { kind: "TEAM", teamId: "0a7a0000-0000-4000-8000-0000000000fe" } }), code: "WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND", nodeId: "out-mgr" },
  { name: "destinatário de gestão ambíguo na estrutura", reason: "hierarquia (reports_to)", setup: consolidated(consolidatedGraph(), { structure: { kind: "TEAM", teamId: PARITY_TEAM_ID } }), code: "WORKFLOW_OUTPUT_RECIPIENT_AMBIGUOUS", nodeId: "out-mgr" },
  { name: "indicador da fonte de dados que não existe", reason: "catálogo de indicadores", setup: withDb(setup(SCHEDULE, chain(triggerNode(), agent("agent", { scheduledDataSource: { kind: "INDICATOR", indicatorCode: "SUMIU", period: "WEEK" } }), output(), endNode())), { indicator: () => null }), code: "INDICATOR_NOT_FOUND" },
  { name: "indicador desativado", reason: "catálogo de indicadores", setup: withDb(conditionCase({ thresholdNumeric: 300, historicalQuery: HISTORY }), { indicator: indicatorRow({ active: false }) }), code: "WORKFLOW_INDICATOR_INACTIVE", nodeId: "cond" },
  { name: "janela operacional sem medição operacional", reason: "capacidades do indicador", setup: withDb(conditionCase({ thresholdNumeric: 300, historicalQuery: HISTORY }), { indicator: indicatorRow({ daily_supported: false }) }), code: "WORKFLOW_INDICATOR_NOT_OPERATIONAL", nodeId: "cond" },
  { name: "fechamento oficial sem fechamento habilitado", reason: "capacidades do indicador", setup: withDb(conditionCase({ thresholdNumeric: 90, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_ACHIEVEMENT", indicatorCode: "TMA" } }), { indicator: indicatorRow({ official_closure_supported: false }) }), code: "WORKFLOW_INDICATOR_NO_OFFICIAL_CLOSURE", nodeId: "cond" },
  { name: "agregação incompatível com a semântica operacional do indicador", reason: "semântica operacional do indicador", setup: conditionCase({ thresholdNumeric: 300, historicalQuery: { ...HISTORY, aggregation: "AVERAGE" } }), code: "WORKFLOW_INVALID_CONDITION" },
  { name: "Quartil operacional de indicador sem direção oficial", reason: "direção oficial do indicador", setup: withDb(conditionCase({ comparator: "EQUALS", thresholdText: "Q4", historicalQuery: QUARTILE }), { indicator: indicatorRow({ desired_direction: "TARGET" }) }), code: "WORKFLOW_INVALID_CONDITION" },
  { name: "ranking 'Melhores' de indicador sem direção oficial", reason: "direção oficial do indicador", setup: withDb(withRanking({ ...RANKING_OK, selection: "BEST" }), { indicator: indicatorRow({ desired_direction: "TARGET" }) }), code: "WORKFLOW_SELECTION_RANKING_DIRECTION_UNAVAILABLE" },
  { name: "diagnóstico do indicador sem estratégia publicada", reason: "estratégia de diagnóstico do indicador", setup: withDb(indicatorDiagnosisFlow, { strategyConfig: null }), code: "WORKFLOW_INDICATOR_DIAGNOSIS_STRATEGY_MISSING" },
  { name: "diagnóstico do indicador com Agent fora dos domínios da estratégia", reason: "estratégia de diagnóstico × domínio do agente", setup: withDb(indicatorDiagnosisFlow, { strategyConfig: { ...emptyStrategyConfig(), allowedBusinessDomainIds: [DOMAIN_ID] } }), code: "WORKFLOW_INDICATOR_DIAGNOSIS_DOMAIN_NOT_ALLOWED" },
  { name: "diagnóstico direto de indicador sem fechamento oficial", reason: "catálogo de indicadores", setup: withDb(directDiagnosisFlow, { indicator: indicatorRow({ official_closure_supported: false }) }), code: "WORKFLOW_INDICATOR_DIAGNOSIS_INDICATOR_UNAVAILABLE", nodeId: "agent" },
  { name: "política de acompanhamento que não existe", reason: "catálogo de políticas", setup: withDb(VALID_POLICY_FLOW, { interventionPolicy: () => null }), code: "WORKFLOW_INTERVENTION_POLICY_NOT_FOUND", nodeId: "pol" },
  { name: "política de acompanhamento inativa", reason: "catálogo de políticas", setup: withDb(VALID_POLICY_FLOW, { interventionPolicy: policyRow({ active: false }) }), code: "WORKFLOW_INTERVENTION_POLICY_INACTIVE", nodeId: "pol" },
  { name: "política de acompanhamento sem versão publicada", reason: "versões da política", setup: withDb(VALID_POLICY_FLOW, { interventionPolicy: policyRow({ published: 0 }) }), code: "WORKFLOW_INTERVENTION_POLICY_UNPUBLISHED", nodeId: "pol" },
  { name: "política de outro Grupo que o Workflow", reason: "escopo da política", setup: { ...withDb(VALID_POLICY_FLOW, { interventionPolicy: policyRow({ scope_type: "GROUP", team_id: "0a7a0000-0000-4000-8000-0000000000c5" }) }), scope: { scopeType: "TEAM", teamId: PARITY_TEAM_ID, subteamId: null } }, code: "WORKFLOW_INTERVENTION_POLICY_SCOPE_MISMATCH", nodeId: "pol" },
  { name: "feedback direto de atendimento com o módulo desligado", reason: "módulo desligado no ambiente (INIA_INTERACTION_FEEDBACK_PIPELINE)", setup: setup(FLAG_BOOLEAN, chain(triggerNode(), interactionFeedback("ifb", { kind: "TRIGGER_INTERACTION" }), endNode())), code: "WORKFLOW_INTERACTION_FEEDBACK_DISABLED", nodeId: "ifb", env: "INTERACTION_FEEDBACK_OFF" },
]

/** Codes que só o backend emite (dependem de banco/ambiente) — o editor nunca pode usá-los. */
export const BACKEND_ONLY_CODES = [
  "WORKFLOW_AGENT_NOT_FOUND",
  "WORKFLOW_AGENT_INACTIVE",
  "WORKFLOW_AGENT_SCOPE_FORBIDDEN",
  "WORKFLOW_AGENT_NOT_PUBLISHED",
  "WORKFLOW_RECIPIENT_NOT_FOUND",
  "WORKFLOW_AGENT_INVALID_TYPE",
  "WORKFLOW_AGENT_NOT_CONSOLIDATED",
  "WORKFLOW_AGENT_SYNTHESIS_REQUIRES_JOIN",
  "WORKFLOW_ORCHESTRATOR_NOT_FOUND",
  "WORKFLOW_ORCHESTRATOR_INACTIVE",
  "WORKFLOW_ORCHESTRATOR_VERSION_NOT_FOUND",
  "WORKFLOW_ORCHESTRATOR_VERSION_SCOPE_FORBIDDEN",
  "WORKFLOW_ORCHESTRATOR_INVALID_INVOCATION",
  "WORKFLOW_ORCHESTRATOR_SCOPE_FORBIDDEN",
  "WORKFLOW_ORCHESTRATOR_ROUTING_DOMAIN_INVALID",
  "WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND",
  "WORKFLOW_OUTPUT_RECIPIENT_AMBIGUOUS",
  "INDICATOR_NOT_FOUND",
  "WORKFLOW_INDICATOR_INACTIVE",
  "WORKFLOW_INDICATOR_NOT_OPERATIONAL",
  "WORKFLOW_INDICATOR_NO_OFFICIAL_CLOSURE",
  "WORKFLOW_SELECTION_RANKING_DIRECTION_UNAVAILABLE",
  "WORKFLOW_INDICATOR_DIAGNOSIS_STRATEGY_MISSING",
  "WORKFLOW_INDICATOR_DIAGNOSIS_DOMAIN_NOT_ALLOWED",
  "WORKFLOW_INDICATOR_DIAGNOSIS_INDICATOR_UNAVAILABLE",
  "WORKFLOW_INTERACTION_FEEDBACK_DISABLED",
  "WORKFLOW_INTERVENTION_POLICY_NOT_FOUND",
  "WORKFLOW_INTERVENTION_POLICY_INACTIVE",
  "WORKFLOW_INTERVENTION_POLICY_UNPUBLISHED",
  "WORKFLOW_INTERVENTION_POLICY_SCOPE_MISMATCH",
  "WORKFLOW_POPULATION_FILTER_INVALID_TRIGGER",
]

/** Mensagens do backend de regras "só backend" que compartilham código com regras espelhadas (varredura aleatória). */
export const BACKEND_ONLY_MESSAGES = [/cuja semântica operacional é/, /sem direção de desempenho oficial definida/]
