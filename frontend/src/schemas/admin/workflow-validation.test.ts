import { describe, expect, it } from "vitest"
import { validateWorkflowGraph, type VariableInfo } from "./workflow-validation"
import { buildIndicatorAnalysisConfig, type IndicatorAnalysisKind } from "@/components/admin/workflows/node-config-panel"
import type { Orchestrator } from "./assistant.schema"
import type { FlowGraph, FlowNode } from "./workflow-graph.schema"
import type { WorkflowTrigger } from "./workflow.schema"

const position = { x: 0, y: 0 }
const trigger: WorkflowTrigger = { kind: "channel_flag", channelFlagId: "flag-1", channel: "VOICE", flagName: "Rechamada", valueType: "BOOLEAN" }

const triggerNode: FlowNode = { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} }
const endNode: FlowNode = { id: "end", type: "end", label: "Fim", position, config: {} }

function conditionNode(config: Extract<FlowNode, { type: "condition" }>["config"], id = "cond-1"): FlowNode {
  return { id, type: "condition", label: "Condição", position, config }
}

/** Nós soltos entre o Gatilho e o Fim: cada teste olha a configuração de um nó, não as ligações (o Gatilho segue direto para o Fim). */
function graphWith(...nodes: FlowNode[]): FlowGraph {
  return { nodes: [triggerNode, ...nodes, endNode], edges: [{ id: "trigger-always-end", source: "trigger", sourceHandle: "always", target: "end" }] }
}

describe("validateWorkflowGraph — group AND/OR (Parte 3)", () => {
  it("passa quando toda regra do grupo tem origem e valor", () => {
    const node = conditionNode({
      comparator: "EQUALS",
      group: { operator: "ANY", rules: [{ comparator: "EQUALS", thresholdBoolean: true, sourcePath: "variables.var-1" }] },
    })
    // A variável precisa existir no workflow (o backend recusa a referência a uma variável apagada).
    const variablesById = new Map<string, VariableInfo>([["var-1", { type: "BOOLEAN", name: "Reincidente" }]])
    expect(validateWorkflowGraph(graphWith(node), trigger, new Map(), variablesById)).toEqual([])
  })

  it("sinaliza cada regra sem origem selecionada, identificada pelo índice", () => {
    const node = conditionNode({
      comparator: "EQUALS",
      group: {
        operator: "ALL",
        rules: [
          { comparator: "EQUALS", thresholdBoolean: true, sourcePath: "variables.var-1" },
          { comparator: "GT", sourcePath: "" },
        ],
      },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({ nodeId: "cond-1", code: "WORKFLOW_INVALID_CONDITION", message: '"Condição (regra 2)" precisa de uma origem selecionada.' })
  })
})

describe("validateWorkflowGraph — histórico do indicador (Parte 2)", () => {
  it("exige indicador e período mesmo sem COUNT", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 3.3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "", aggregation: "AVERAGE" },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({ nodeId: "cond-1", code: "WORKFLOW_INVALID_CONDITION", message: "Selecione o indicador do histórico." })
    expect(issues).toContainEqual({ nodeId: "cond-1", code: "WORKFLOW_INVALID_CONDITION", message: "Defina o período do histórico." })
  })

  it("passa quando o histórico é AVERAGE com período e valor de referência", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 3.3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "Nota URA", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 } },
    })
    expect(validateWorkflowGraph(graphWith(node), trigger)).toEqual([])
  })

  it('rejeita "Comparar com" junto de Quantidade de ocorrências (COUNT) — só faz sentido pra Média/Mínimo/Máximo', () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "Nota URA",
        aggregation: "COUNT",
        comparator: "LT",
        indicatorThreshold: 3,
        period: { kind: "ROLLING_DAYS", days: 7 },
        compareTo: { kind: "GOAL" },
      },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({
      nodeId: "cond-1",
      code: "WORKFLOW_INVALID_CONDITION",
      message: 'O nó "Condição" usa Quantidade de ocorrências, que sempre compara contra um valor fixo — "Comparar com" só se aplica a Média/Mínimo/Máximo.',
    })
  })

  it('rejeita "Mínimo de medições" junto de Quantidade de ocorrências (COUNT)', () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "Nota URA",
        aggregation: "COUNT",
        comparator: "LT",
        indicatorThreshold: 3,
        period: { kind: "ROLLING_DAYS", days: 7 },
        minimumSampleSize: 3,
      },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({
      nodeId: "cond-1",
      code: "WORKFLOW_INVALID_CONDITION",
      message: 'O nó "Condição" usa Quantidade de ocorrências, que não usa Mínimo de medições — esse campo só se aplica a Média/Mínimo/Máximo.',
    })
  })

  it("aceita Média + Comparar com Meta sem valor de referência fixo (resolvido em tempo de execução)", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: null,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "Qualidade",
        aggregation: "AVERAGE",
        period: { kind: "ROLLING_DAYS", days: 30 },
        compareTo: { kind: "GOAL" },
      },
    })
    expect(validateWorkflowGraph(graphWith(node), trigger)).toEqual([])
  })

  it("rejeita Últimos N fechamentos junto de Quantidade de ocorrências (COUNT)", () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "Nota URA",
        aggregation: "COUNT",
        comparator: "LT",
        indicatorThreshold: 3,
        period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
      },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({
      nodeId: "cond-1",
      code: "WORKFLOW_INVALID_CONDITION",
      message: 'O nó "Condição" usa Últimos N fechamentos, que não está disponível pra Quantidade de ocorrências — use Média, Mínimo ou Máximo.',
    })
  })

  it("rejeita Últimos N fechamentos junto de Comparar com Período anterior", () => {
    const node = conditionNode({
      comparator: "GT",
      thresholdNumeric: null,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "TMA",
        aggregation: "AVERAGE",
        period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
        compareTo: { kind: "PREVIOUS_PERIOD" },
      },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({ nodeId: "cond-1", code: "WORKFLOW_INVALID_CONDITION", message: 'O nó "Condição" usa Últimos N fechamentos, que não está disponível com Comparar com Período anterior.' })
  })

  it("não exige indicador pra Atingimento do PRV (source PRV_ACHIEVEMENT) — fonte própria, sem indicador (regressão)", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 70,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", period: { kind: "ROLLING_DAYS", days: 30 } },
    })
    expect(validateWorkflowGraph(graphWith(node), trigger)).toEqual([])
  })

  it("aceita Últimos N fechamentos com Média e Comparar com Meta — Valor do indicador (source MEASUREMENT, única origem em que Meta é uma referência válida)", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: null,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "Qualidade",
        aggregation: "AVERAGE",
        period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
        compareTo: { kind: "GOAL" },
      },
    })
    expect(validateWorkflowGraph(graphWith(node), trigger)).toEqual([])
  })

  it("rejeita Meta vigente junto de Atingimento do indicador — Atingimento já representa a relação com a meta, nunca comparado de novo contra ela", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: null,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "Qualidade",
        aggregation: "AVERAGE",
        source: "INDICATOR_ACHIEVEMENT",
        period: { kind: "ROLLING_DAYS", days: 30 },
        compareTo: { kind: "GOAL" },
      },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({
      nodeId: "cond-1",
      code: "WORKFLOW_INVALID_CONDITION",
      message: 'O nó "Condição" usa Meta vigente como referência, que só está disponível pra Valor do indicador — para Atingimento, compare com um valor fixo ou com o período anterior.',
    })
  })

  it("rejeita Meta vigente junto de Atingimento do PRV — mesma regra, sem indicador nenhum envolvido", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: null,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", period: { kind: "ROLLING_DAYS", days: 30 }, compareTo: { kind: "GOAL" } },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({
      nodeId: "cond-1",
      code: "WORKFLOW_INVALID_CONDITION",
      message: 'O nó "Condição" usa Meta vigente como referência, que só está disponível pra Valor do indicador — para Atingimento, compare com um valor fixo ou com o período anterior.',
    })
  })

  it("aceita Atingimento do indicador com Valor fixo (regressão — combinação válida continua passando)", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 90,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "Qualidade", aggregation: "AVERAGE", source: "INDICATOR_ACHIEVEMENT", period: { kind: "ROLLING_DAYS", days: 30 } },
    })
    expect(validateWorkflowGraph(graphWith(node), trigger)).toEqual([])
  })

  it("aceita Atingimento do indicador com Período anterior (regressão — combinação válida continua passando)", () => {
    const node = conditionNode({
      comparator: "GT",
      thresholdNumeric: null,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "Qualidade",
        aggregation: "AVERAGE",
        source: "INDICATOR_ACHIEVEMENT",
        period: { kind: "ROLLING_DAYS", days: 30 },
        compareTo: { kind: "PREVIOUS_PERIOD" },
      },
    })
    expect(validateWorkflowGraph(graphWith(node), trigger)).toEqual([])
  })

  it("aceita Atingimento do PRV com Valor fixo (regressão — combinação válida continua passando)", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 80,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", period: { kind: "ROLLING_DAYS", days: 30 } },
    })
    expect(validateWorkflowGraph(graphWith(node), trigger)).toEqual([])
  })

  it("aceita Atingimento do PRV com Período anterior (regressão — combinação válida continua passando)", () => {
    const node = conditionNode({
      comparator: "GT",
      thresholdNumeric: null,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", period: { kind: "ROLLING_DAYS", days: 30 }, compareTo: { kind: "PREVIOUS_PERIOD" } },
    })
    expect(validateWorkflowGraph(graphWith(node), trigger)).toEqual([])
  })

  it("rejeita Quantidade de ocorrências (COUNT) junto de Atingimento do indicador — COUNT conta MEDIÇÃO bruta, só existe pra Valor", () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "Qualidade",
        aggregation: "COUNT",
        source: "INDICATOR_ACHIEVEMENT",
        comparator: "LT",
        indicatorThreshold: 3,
        period: { kind: "ROLLING_DAYS", days: 7 },
      },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({
      nodeId: "cond-1",
      code: "WORKFLOW_INVALID_CONDITION",
      message: 'O nó "Condição" usa Quantidade de ocorrências, que só está disponível pra Valor do indicador — Atingimento/PRV sempre agregam (Média/Mínimo/Máximo).',
    })
  })

  it("rejeita Quantidade de ocorrências (COUNT) junto de Atingimento do PRV — mesma regra, sem indicador nenhum envolvido", () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        aggregation: "COUNT",
        source: "PRV_ACHIEVEMENT",
        comparator: "LT",
        indicatorThreshold: 3,
        period: { kind: "ROLLING_DAYS", days: 7 },
      },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({
      nodeId: "cond-1",
      code: "WORKFLOW_INVALID_CONDITION",
      message: 'O nó "Condição" usa Quantidade de ocorrências, que só está disponível pra Valor do indicador — Atingimento/PRV sempre agregam (Média/Mínimo/Máximo).',
    })
  })

  it("aceita Quantidade de ocorrências com source MEASUREMENT explícito (regressão — nunca rejeita a única origem válida)", () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "Nota URA",
        aggregation: "COUNT",
        source: "MEASUREMENT",
        comparator: "LT",
        indicatorThreshold: 3,
        period: { kind: "ROLLING_DAYS", days: 7 },
      },
    })
    expect(validateWorkflowGraph(graphWith(node), trigger)).toEqual([])
  })

  it("aceita Atingimento do PRV com Mínimo/Máximo (matriz de agregação — só COUNT é proibido)", () => {
    for (const aggregation of ["MINIMUM", "MAXIMUM"] as const) {
      const node = conditionNode({
        comparator: "LT",
        thresholdNumeric: 80,
        historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation, source: "PRV_ACHIEVEMENT", period: { kind: "ROLLING_DAYS", days: 30 } },
      })
      expect(validateWorkflowGraph(graphWith(node), trigger), aggregation).toEqual([])
    }
  })
})

describe("validateWorkflowGraph — regressão: toda troca de 'O que deseja analisar?' produz uma Condition publicável", () => {
  // buildIndicatorAnalysisConfig (node-config/indicator-analysis.ts) foi corrigida pra revalidar período/
  // agregação/quartil ao trocar a origem, em vez de reconstruir do zero — este teste prova que
  // NENHUMA combinação de origem->origem produzida por ela deixa um payload que o backend/
  // frontend rejeitariam (reusa as MESMAS regras já existentes acima, nunca duplica).
  const KINDS: IndicatorAnalysisKind[] = ["VALUE", "ACHIEVEMENT", "PRV_ACHIEVEMENT", "QUARTILE", "OPERATIONAL_QUARTILE", "PRV_QUARTILE"]
  const empty: Extract<FlowNode, { type: "condition" }>["config"] = { comparator: "EQUALS", thresholdNumeric: null, thresholdBoolean: null }

  // Preenche só o que a UI exigiria do admin antes de tentar publicar (indicador/valor de
  // referência) — isola os problemas de período/agregação/quartil que esta correção trata,
  // sem confundir com "esqueci de escolher o indicador".
  function completed(config: Extract<FlowNode, { type: "condition" }>["config"]): Extract<FlowNode, { type: "condition" }>["config"] {
    let next = config
    // PRV nunca tem indicador (fonte própria, employee_prv_performance) — preencher aqui
    // esconderia a regressão real desta task (PRV_ACHIEVEMENT tinha que publicar SEM indicador).
    if (next.historicalQuery && next.historicalQuery.source !== "PRV_ACHIEVEMENT" && !next.historicalQuery.indicatorCode) {
      next = { ...next, historicalQuery: { ...next.historicalQuery, indicatorCode: "NOTA_URA" } }
    }
    if (next.performanceQuery?.metric === "INDICATOR_QUARTILE" && !next.performanceQuery.indicatorCode) {
      next = { ...next, performanceQuery: { ...next.performanceQuery, indicatorCode: "NOTA_URA" } }
    }
    const aggregation = next.historicalQuery?.aggregation ?? "COUNT"
    if (next.historicalQuery && aggregation !== "COUNT" && !next.historicalQuery.compareTo && (next.thresholdNumeric === undefined || next.thresholdNumeric === null)) {
      next = { ...next, thresholdNumeric: 50 }
    }
    return next
  }

  for (const from of KINDS) {
    for (const to of KINDS) {
      it(`${from} -> ${to} nunca deixa payload inválido escondido`, () => {
        const before = completed(buildIndicatorAnalysisConfig(from, empty))
        const after = completed(buildIndicatorAnalysisConfig(to, before))
        const issues = validateWorkflowGraph(graphWith(conditionNode(after)), trigger)
        expect(issues).toEqual([])
      })
    }
  }
})

describe("validateWorkflowGraph — performance (Parte 8)", () => {
  it("exige que o valor de quartil esteja entre Q1 e Q4", () => {
    const node = conditionNode({
      comparator: "EQUALS",
      thresholdText: "Q9",
      performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({ nodeId: "cond-1", code: "WORKFLOW_INVALID_CONDITION", message: "Valor de quartil inválido — use Q1, Q2, Q3, Q4." })
  })

  it("não exige indicatorCode pra métricas de PRV", () => {
    const node = conditionNode({
      comparator: "EQUALS",
      thresholdText: "Q4",
      performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" },
    })
    expect(validateWorkflowGraph(graphWith(node), trigger)).toEqual([])
  })

  it("exige indicatorCode pra métricas do indicador", () => {
    const node = conditionNode({
      comparator: "GT",
      thresholdNumeric: 80,
      performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_ACHIEVEMENT" },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({ nodeId: "cond-1", code: "WORKFLOW_INVALID_CONDITION", message: "Selecione o indicador desta métrica de performance." })
  })

  it("rejeita Recorrência (últimos N fechamentos) numa métrica que não é quartil", () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_ACHIEVEMENT", indicatorCode: "Qualidade", recurrence: { periods: 3, matchQuartile: "Q4" } },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({ nodeId: "cond-1", code: "WORKFLOW_INVALID_CONDITION", message: 'O nó "Condição" usa Recorrência, que só está disponível para Quartil do indicador ou Quartil do PRV.' })
  })

  it("aceita Recorrência de Quartil válida", () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "Monitoria", recurrence: { periods: 3, matchQuartile: "Q4" } },
    })
    expect(validateWorkflowGraph(graphWith(node), trigger)).toEqual([])
  })

  it("rejeita Recorrência de Quartil com operador não-numérico (compara a CONTAGEM de fechamentos)", () => {
    const node = conditionNode({
      comparator: "CONTAINS",
      thresholdNumeric: 3,
      performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE", recurrence: { periods: 3, matchQuartile: "Q4" } },
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({ nodeId: "cond-1", code: "WORKFLOW_INVALID_CONDITION", message: "Recorrência compara uma quantidade de fechamentos — use um operador numérico." })
  })
})

describe("validateWorkflowGraph — Human Review hierárquico (Parte 4)", () => {
  function humanReviewNode(config: Extract<FlowNode, { type: "human_review" }>["config"], id: string): FlowNode {
    return { id, type: "human_review", label: "Revisão", position, config }
  }

  it("rejeita revisor relativo a um node de revisão que não existe", () => {
    const node = humanReviewNode({ reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "hr-fantasma" } }, "hr-1")
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({ nodeId: "hr-1", code: "WORKFLOW_INVALID_HUMAN_REVIEW", message: "A revisão anterior selecionada não existe mais neste workflow." })
  })

  it("rejeita revisor relativo a uma revisão que não é ancestral (via edges)", () => {
    const first = humanReviewNode({ reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } }, "hr-1")
    const second = humanReviewNode({ reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "hr-1" } }, "hr-2")
    // Sem edge ligando hr-1 -> hr-2: findAncestorNodeIds não considera hr-1 ancestral de hr-2.
    const graph: FlowGraph = { nodes: [triggerNode, first, second, endNode], edges: [] }
    const issues = validateWorkflowGraph(graph, trigger)
    expect(issues).toContainEqual({ nodeId: "hr-2", code: "WORKFLOW_INVALID_HUMAN_REVIEW", message: "A revisão anterior selecionada precisa vir ANTES deste nó no fluxo." })
  })

  it("aceita revisor relativo a uma revisão de fato ancestral", () => {
    const first = humanReviewNode({ reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } }, "hr-1")
    const second = humanReviewNode({ reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "hr-1" } }, "hr-2")
    const graph: FlowGraph = {
      nodes: [triggerNode, first, second, endNode],
      // Revisão humana sai por Aprovado/Reprovado/Escalar (nunca "Sempre"): todas ligadas, senão a execução morreria.
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "hr-1" },
        ...["approved", "rejected", "escalated"].map((branch) => ({ id: `hr-1-${branch}`, source: "hr-1", sourceHandle: branch, target: "hr-2" })),
        ...["approved", "rejected", "escalated"].map((branch) => ({ id: `hr-2-${branch}`, source: "hr-2", sourceHandle: branch, target: "end" })),
      ],
    }
    const issues = validateWorkflowGraph(graph, trigger)
    expect(issues.filter((issue) => issue.nodeId === "hr-2")).toEqual([])
  })
})

describe("validateWorkflowGraph — Output para Avatar/Chat (Parte 1)", () => {
  const orchestrator: Orchestrator = {
    id: "orch-def",
    name: "Diagnóstico",
    active: true,
    recommendSupportMaterials: false,
    createdAt: "2026-01-01T00:00:00Z",
    scopeType: "ALL_TEAMS",
    teamId: null,
    teamName: null,
    subteamId: null,
    subteamName: null,
    orchestratorAgentId: "agent-orch",
    orchestratorAgentName: "Agente Orquestrador",
    specialists: [],
    invocationMode: "BOTH",
    policyKind: null,
    policyDomains: [],
    routingPolicy: null,
    routingDomains: [],
    businessDomains: [],
    structuredOutput: null,
    structuredOutputSource: "LEGACY_SCHEMA",
    structuredOutputReview: null,
    structuredOutputFields: null,
    outputInstructions: null,
    outputSchema: [{ key: "diagnosis", label: "Diagnóstico", fields: [{ key: "items", label: "Itens", type: "ARRAY" }] }],
  }
  const orchestratorNode: FlowNode = { id: "orch", type: "orchestrator", label: "Orquestrador", position, config: { orchestratorId: "orch-def", instruction: "Analise." } }

  it("bloqueia publicar o resultado completo pra Avatar quando o schema de origem é conhecido", () => {
    const output: FlowNode = {
      id: "out-1",
      type: "output",
      label: "Output",
      position,
      config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["AVATAR"], source: "nodeOutputs.orch" },
    }
    const graph: FlowGraph = { nodes: [triggerNode, orchestratorNode, output, endNode], edges: [] }
    const issues = validateWorkflowGraph(graph, trigger, new Map([["orch-def", orchestrator]]))
    expect(issues.some((issue) => issue.nodeId === "out-1" && issue.message.includes("resultado completo"))).toBe(true)
  })

  it("bloqueia publicar um campo do tipo lista pra Chat", () => {
    const output: FlowNode = {
      id: "out-1",
      type: "output",
      label: "Output",
      position,
      config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["CHAT"], source: "nodeOutputs.orch.structuredResult.diagnosis.items" },
    }
    const graph: FlowGraph = { nodes: [triggerNode, orchestratorNode, output, endNode], edges: [] }
    const issues = validateWorkflowGraph(graph, trigger, new Map([["orch-def", orchestrator]]))
    expect(issues.some((issue) => issue.nodeId === "out-1" && issue.message.includes("lista"))).toBe(true)
  })

  it("nunca bloqueia quando a origem não tem schema conhecido (preserva TESTE 07)", () => {
    const callAgent: FlowNode = { id: "agent-1", type: "action", label: "Chamar agente", position, config: { actionType: "CALL_AGENT", agentId: "agent-1" } }
    const output: FlowNode = {
      id: "out-1",
      type: "output",
      label: "Output",
      position,
      // Workflow Outputs V1: para o PRÓPRIO operador, resultado investigativo em Chat/Avatar exige "Gerar feedback" — este
      // teste prova só a regra do schema, com a entrega à gestão.
      config: { target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["AVATAR"], source: "nodeOutputs.agent-1" },
    }
    const graph: FlowGraph = { nodes: [triggerNode, callAgent, output, endNode], edges: [{ id: "e", source: "agent-1", sourceHandle: "always", target: "out-1" }] }
    const issues = validateWorkflowGraph(graph, trigger)
    expect(issues.filter((issue) => issue.nodeId === "out-1")).toEqual([])
  })
})

describe("validateWorkflowGraph — Escalonar: Target + Conteúdo compartilhados (evolução do Escalonamento)", () => {
  const orchestrator: Orchestrator = {
    id: "orch-def",
    name: "Diagnóstico",
    active: true,
    recommendSupportMaterials: false,
    createdAt: "2026-01-01T00:00:00Z",
    scopeType: "ALL_TEAMS",
    teamId: null,
    teamName: null,
    subteamId: null,
    subteamName: null,
    orchestratorAgentId: "agent-orch",
    orchestratorAgentName: "Agente Orquestrador",
    specialists: [],
    invocationMode: "BOTH",
    policyKind: null,
    policyDomains: [],
    routingPolicy: null,
    routingDomains: [],
    businessDomains: [],
    structuredOutput: null,
    structuredOutputSource: "LEGACY_SCHEMA",
    structuredOutputReview: null,
    structuredOutputFields: null,
    outputInstructions: null,
    outputSchema: [{ key: "diagnosis", label: "Diagnóstico", fields: [{ key: "items", label: "Itens", type: "ARRAY" }] }],
  }
  const orchestratorNode: FlowNode = { id: "orch", type: "orchestrator", label: "Orquestrador", position, config: { orchestratorId: "orch-def", instruction: "Analise." } }

  function escalateNode(config: Extract<FlowNode, { type: "action" }>["config"], id = "esc-1"): FlowNode {
    return { id, type: "action", label: "Escalonar", position, config }
  }

  it("rejeita target ROLE_OF_PREVIOUS_REVIEWER apontando pra um node de revisão que não existe (mesma checagem do Human Review, reaproveitada)", () => {
    const node = escalateNode({
      actionType: "ESCALATE",
      target: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "hr-fantasma" },
      surfaces: ["NOTIFICATION"],
    })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({ nodeId: "esc-1", code: "WORKFLOW_INVALID_ACTION", message: "A revisão anterior selecionada não existe mais neste workflow." })
  })

  it("bloqueia conteúdo do tipo lista escalonado pra Chat (mesma guarda do Output, reaproveitada)", () => {
    const escalate = escalateNode({
      actionType: "ESCALATE",
      target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" },
      contentSource: "nodeOutputs.orch.structuredResult.diagnosis.items",
      surfaces: ["CHAT"],
    })
    const graph: FlowGraph = { nodes: [triggerNode, orchestratorNode, escalate, endNode], edges: [] }
    const issues = validateWorkflowGraph(graph, trigger, new Map([["orch-def", orchestrator]]))
    expect(issues.some((issue) => issue.nodeId === "esc-1" && issue.message.includes("lista"))).toBe(true)
  })

  it("nunca bloqueia quando a origem escalonada não tem schema conhecido (preserva TESTE 07)", () => {
    const callAgent: FlowNode = { id: "agent-1", type: "action", label: "Chamar agente", position, config: { actionType: "CALL_AGENT", agentId: "agent-1" } }
    const escalate = escalateNode({
      actionType: "ESCALATE",
      target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" },
      contentSource: "nodeOutputs.agent-1",
      surfaces: ["CHAT"],
    })
    const graph: FlowGraph = { nodes: [triggerNode, callAgent, escalate, endNode], edges: [{ id: "e", source: "agent-1", sourceHandle: "always", target: "esc-1" }] }
    const issues = validateWorkflowGraph(graph, trigger)
    expect(issues.filter((issue) => issue.nodeId === "esc-1")).toEqual([])
  })

  it("um Escalonar com contentSource satisfaz a exigência de publicar o resultado de um agente chamado (mesmo mecanismo de entrega do Output)", () => {
    const callAgent: FlowNode = { id: "agent-1", type: "action", label: "Chamar agente", position, config: { actionType: "CALL_AGENT", agentId: "agent-1" } }
    const escalate = escalateNode({
      actionType: "ESCALATE",
      target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" },
      contentSource: "nodeOutputs.agent-1",
      surfaces: ["NOTIFICATION"],
    })
    const graph: FlowGraph = { nodes: [triggerNode, callAgent, escalate, endNode], edges: [] }
    const issues = validateWorkflowGraph(graph, trigger)
    expect(issues.filter((issue) => issue.nodeId === "")).toEqual([])
  })

  it("ainda exige um Output (ou Escalonar com conteúdo) quando o grafo chama um agente", () => {
    const callAgent: FlowNode = { id: "agent-1", type: "action", label: "Chamar agente", position, config: { actionType: "CALL_AGENT", agentId: "agent-1" } }
    const escalate = escalateNode({ actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["NOTIFICATION"] })
    const graph: FlowGraph = { nodes: [triggerNode, callAgent, escalate, endNode], edges: [] }
    const issues = validateWorkflowGraph(graph, trigger)
    expect(issues).toContainEqual({ nodeId: "", code: "WORKFLOW_MISSING_OUTPUT", message: "O workflow chama um agente mas não tem nenhum nó Output — adicione um, senão o resultado nunca é publicado." })
  })
})

describe("validateWorkflowGraph — Definir variável, valor dinâmico (evolução de Variáveis do Workflow)", () => {
  function setVariableNode(config: Extract<FlowNode, { type: "action" }>["config"], id = "action-1"): FlowNode {
    return { id, type: "action", label: "Definir variável", position, config }
  }

  it("sinaliza quando a variável referenciada não existe mais", () => {
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "gone", value: 1 })
    const issues = validateWorkflowGraph(graphWith(node), trigger)
    expect(issues).toContainEqual({ nodeId: "action-1", code: "WORKFLOW_INVALID_ACTION", message: "Selecione qual variável esta ação deve definir." })
  })

  it("sinaliza valor fixo incompatível com o tipo da variável", () => {
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "var-1", value: "não é número" })
    const variablesById = new Map<string, VariableInfo>([["var-1", { type: "NUMERIC", name: "Pontuação" }]])
    const issues = validateWorkflowGraph(graphWith(node), trigger, new Map(), variablesById)
    expect(issues).toContainEqual({ nodeId: "action-1", code: "WORKFLOW_INVALID_ACTION", message: "O valor definido não é compatível com o tipo da variável." })
  })

  it("passa com origem dinâmica = valor do gatilho", () => {
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "nodeOutputs.trigger" })
    const variablesById = new Map<string, VariableInfo>([["var-1", { type: "NUMERIC", name: "Nota recebida" }]])
    const issues = validateWorkflowGraph(graphWith(node), trigger, new Map(), variablesById)
    expect(issues.filter((issue) => issue.nodeId === "action-1")).toEqual([])
  })

  it("sinaliza origem dinâmica apontando pra um nó que não é ancestral (branch impossível)", () => {
    const sibling: FlowNode = { id: "sibling", type: "action", label: "Outro", position, config: { actionType: "CALL_AGENT", agentId: "agent-1" } }
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "nodeOutputs.sibling" })
    const variablesById = new Map<string, VariableInfo>([["var-1", { type: "NUMERIC", name: "Pontuação" }]])
    // "sibling" não tem nenhuma edge ligando ao node da Action — nunca é ancestral.
    const graph: FlowGraph = { nodes: [triggerNode, sibling, node, endNode], edges: [] }
    const issues = validateWorkflowGraph(graph, trigger, new Map(), variablesById)
    expect(issues).toContainEqual({ nodeId: "action-1", code: "WORKFLOW_INVALID_ACTION", message: "Essa variável depende de um resultado que não está mais disponível neste caminho." })
  })

  it("sinaliza origem dinâmica = variável de outro tipo", () => {
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "var-b", sourcePath: "variables.var-a" })
    const variablesById = new Map<string, VariableInfo>([
      ["var-a", { type: "TEXT", name: "Feedback" }],
      ["var-b", { type: "NUMERIC", name: "Pontuação" }],
    ])
    const issues = validateWorkflowGraph(graphWith(node), trigger, new Map(), variablesById)
    expect(issues).toContainEqual({
      nodeId: "action-1",
      code: "WORKFLOW_INVALID_ACTION",
      message: '"Definir variável" tenta atribuir o valor de uma variável de outro tipo — os tipos precisam ser exatamente iguais.',
    })
  })

  it("passa com origem dinâmica = outra variável do mesmo tipo", () => {
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "var-b", sourcePath: "variables.var-a" })
    const variablesById = new Map<string, VariableInfo>([
      ["var-a", { type: "NUMERIC", name: "Pontuação de risco" }],
      ["var-b", { type: "NUMERIC", name: "Score final" }],
    ])
    const issues = validateWorkflowGraph(graphWith(node), trigger, new Map(), variablesById)
    expect(issues.filter((issue) => issue.nodeId === "action-1")).toEqual([])
  })

  it("sinaliza um ciclo entre variáveis (A depende de B, B depende de A), mesmo indireto", () => {
    const setA: FlowNode = { id: "set-a", type: "action", label: "Definir A", position, config: { actionType: "SET_VARIABLE", variableId: "var-a", sourcePath: "variables.var-b" } }
    const setB: FlowNode = { id: "set-b", type: "action", label: "Definir B", position, config: { actionType: "SET_VARIABLE", variableId: "var-b", sourcePath: "variables.var-a" } }
    const variablesById = new Map<string, VariableInfo>([
      ["var-a", { type: "NUMERIC", name: "Variável A" }],
      ["var-b", { type: "NUMERIC", name: "Variável B" }],
    ])
    const issues = validateWorkflowGraph(graphWith(setA, setB), trigger, new Map(), variablesById)
    expect(issues.some((issue) => issue.message.startsWith("Ciclo entre variáveis:") && issue.message.includes("Variável A") && issue.message.includes("Variável B"))).toBe(true)
  })

  it("sinaliza uma variável referenciando a si mesma", () => {
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "variables.var-1" })
    const variablesById = new Map<string, VariableInfo>([["var-1", { type: "NUMERIC", name: "Pontuação de risco" }]])
    const issues = validateWorkflowGraph(graphWith(node), trigger, new Map(), variablesById)
    expect(issues.some((issue) => issue.message.startsWith("Ciclo entre variáveis:"))).toBe(true)
  })
})

describe("validateWorkflowGraph — Trigger por agenda (evolução do Trigger, espelha validateScheduleTrigger do backend)", () => {
  it("rejeita horários repetidos, com mensagem amigável", () => {
    const scheduleTrigger: WorkflowTrigger = { kind: "schedule", times: ["09:00", "09:00"], intervalDays: 1, frequency: { type: "DAILY" } }
    const issues = validateWorkflowGraph(graphWith(), scheduleTrigger)
    expect(issues).toContainEqual({ nodeId: "trigger", code: "WORKFLOW_INVALID_TRIGGER", message: "Horários repetidos não são permitidos." })
  })

  it("rejeita Mensal por dia do mês sem o dia escolhido", () => {
    const scheduleTrigger: WorkflowTrigger = {
      kind: "schedule",
      times: ["09:00"],
      intervalDays: 1,
      frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH" },
    }
    const issues = validateWorkflowGraph(graphWith(), scheduleTrigger)
    expect(issues).toContainEqual({ nodeId: "trigger", code: "WORKFLOW_INVALID_TRIGGER", message: "Escolha o dia do mês." })
  })

  it("aceita uma Agenda válida (Mensal, Último dia) sem levantar nenhum issue", () => {
    const scheduleTrigger: WorkflowTrigger = { kind: "schedule", times: ["18:00"], intervalDays: 1, frequency: { type: "MONTHLY", mode: "LAST_DAY" } }
    const issues = validateWorkflowGraph(graphWith(), scheduleTrigger)
    expect(issues.filter((issue) => issue.nodeId === "trigger")).toEqual([])
  })

  it("rejeita horário vazio quando o modo é calendário", () => {
    const scheduleTrigger: WorkflowTrigger = { kind: "schedule", times: [], intervalDays: 1, frequency: { type: "DAILY" } }
    const issues = validateWorkflowGraph(graphWith(), scheduleTrigger)
    expect(issues).toContainEqual({ nodeId: "trigger", code: "WORKFLOW_INVALID_TRIGGER", message: "Adicione pelo menos um horário." })
  })
})

describe("validateWorkflowGraph — Trigger por agenda relativo ao expediente (evolução do agendamento relativo)", () => {
  it("rejeita quando nenhum momento (relative) foi escolhido", () => {
    const trigger: WorkflowTrigger = { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1 }
    const issues = validateWorkflowGraph(graphWith(), trigger)
    expect(issues).toContainEqual({ nodeId: "trigger", code: "WORKFLOW_INVALID_TRIGGER", message: "Escolha o momento do expediente." })
  })

  it("rejeita 'Após o início' sem a quantidade de minutos", () => {
    const trigger: WorkflowTrigger = { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1, relative: { anchor: "START" } }
    const issues = validateWorkflowGraph(graphWith(), trigger)
    expect(issues).toContainEqual({ nodeId: "trigger", code: "WORKFLOW_INVALID_TRIGGER", message: "Defina quantos minutos após o início." })
  })

  it("rejeita 'Antes do fim' sem a antecedência", () => {
    const trigger: WorkflowTrigger = { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1, relative: { anchor: "END" } }
    const issues = validateWorkflowGraph(graphWith(), trigger)
    expect(issues).toContainEqual({ nodeId: "trigger", code: "WORKFLOW_INVALID_TRIGGER", message: "Defina quantos minutos antes do fim." })
  })

  it("rejeita 'Percentual da jornada' sem o percentual", () => {
    const trigger: WorkflowTrigger = { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1, relative: { anchor: "PERCENTAGE" } }
    const issues = validateWorkflowGraph(graphWith(), trigger)
    expect(issues).toContainEqual({ nodeId: "trigger", code: "WORKFLOW_INVALID_TRIGGER", message: "Defina o percentual da jornada." })
  })

  it("aceita uma Agenda relativa bem formada sem levantar nenhum issue, mesmo sem horários (times) definido", () => {
    const trigger: WorkflowTrigger = { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1, relative: { anchor: "PERCENTAGE", percentage: 50 } }
    const issues = validateWorkflowGraph(graphWith(), trigger)
    expect(issues.filter((issue) => issue.nodeId === "trigger")).toEqual([])
  })
})

describe("validateWorkflowGraph — Condition com gatilho por agenda (regressão)", () => {
  // Achado real (auditoria de Escopo Administrativo/Unidade de Análise): esta função rejeitava
  // TODO node Condition sempre que o gatilho era "schedule", com a mensagem "Condição não é
  // suportada com gatilho por agenda" — verdade quando o visual builder foi criado, mas nunca
  // atualizada depois que a Agenda passou a suportar Histórico/Performance/Grupo/sourcePath de
  // verdade (o backend nunca teve essa restrição). Isso travava o botão Publicar de workflows
  // reais em produção. Estes testes travam a correção.
  const scheduleTrigger: WorkflowTrigger = { kind: "schedule", mode: "CALENDAR", intervalDays: 1, times: ["09:00"] }

  it("aceita uma Condition de historicalQuery bem formada com gatilho por agenda", () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", period: { kind: "ROLLING_DAYS", days: 7 }, comparator: "LT", indicatorThreshold: 3 },
    })
    expect(validateWorkflowGraph(graphWith(node), scheduleTrigger)).toEqual([])
  })

  it("aceita uma Condition de performanceQuery bem formada com gatilho por agenda", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 80,
      performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" },
    })
    expect(validateWorkflowGraph(graphWith(node), scheduleTrigger)).toEqual([])
  })

  it("aceita historicalQuery com Comparação (Meta/Período anterior) sem thresholdNumeric — valor vem do backend em tempo de execução", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: null,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "PRODUTIVIDADE",
        aggregation: "AVERAGE",
        period: { kind: "CALENDAR", unit: "MONTH", phase: "CURRENT" },
        compareTo: { kind: "GOAL" },
      },
    })
    expect(validateWorkflowGraph(graphWith(node), scheduleTrigger)).toEqual([])
  })

  it("ainda sinaliza uma Ação Chamar agente sem fonte de dados quando o gatilho é agenda", () => {
    const actionNode: FlowNode = { id: "action-1", type: "action", label: "Ação", position, config: { actionType: "CALL_AGENT", agentId: "agent-1" } }
    const issues = validateWorkflowGraph(graphWith(actionNode), scheduleTrigger)
    expect(issues).toContainEqual({ nodeId: "action-1", code: "WORKFLOW_INVALID_ACTION", message: "Defina a fonte de dados desta ação — o gatilho é por agenda." })
  })
})

describe("validateWorkflowGraph — Performance do colaborador é inválida em modo Consolidado", () => {
  const scheduleTrigger: WorkflowTrigger = { kind: "schedule", mode: "CALENDAR", intervalDays: 1, times: ["09:00"] }

  it("aceita performanceQuery normalmente quando o modo não é informado (Individual, padrão)", () => {
    const node = conditionNode({ comparator: "LT", thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } })
    expect(validateWorkflowGraph(graphWith(node), scheduleTrigger)).toEqual([])
  })

  it("rejeita performanceQuery quando o Workflow está em modo Consolidado", () => {
    const node = conditionNode({ comparator: "LT", thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } })
    const issues = validateWorkflowGraph(graphWith(node), scheduleTrigger, new Map(), new Map(), true)
    expect(issues).toContainEqual({
      nodeId: node.id,
      code: "WORKFLOW_PERFORMANCE_QUERY_INVALID_MODE",
      message: `O nó "${node.label}" usa Performance do colaborador, que não é uma Condition válida quando o Workflow analisa uma estrutura consolidada — troque para Histórico do indicador, adicione "Aplicar individualmente" antes deste nó, ou remova-o.`,
    })
  })

  it("historicalQuery continua válido em modo Consolidado — só performanceQuery é bloqueada", () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", period: { kind: "ROLLING_DAYS", days: 7 }, comparator: "LT", indicatorThreshold: 3 },
    })
    expect(validateWorkflowGraph(graphWith(node), scheduleTrigger, new Map(), new Map(), true)).toEqual([])
  })
})

describe('validateWorkflowGraph — Output "O próprio operador" é inválido em modo Consolidado', () => {
  const scheduleTrigger: WorkflowTrigger = { kind: "schedule", mode: "CALENDAR", intervalDays: 1, times: ["09:00"] }

  function outputNode(target: Extract<FlowNode, { type: "output" }>["config"]["target"], id = "out-1"): FlowNode {
    return { id, type: "output", label: "Notificar", position, config: { target, surfaces: ["INBOX"], source: "nodeOutputs.trigger" } }
  }

  it('aceita "O próprio operador" normalmente quando o modo não é informado (Individual, padrão)', () => {
    const node = outputNode({ type: "CURRENT_OPERATOR" })
    expect(validateWorkflowGraph(graphWith(node), scheduleTrigger)).toEqual([])
  })

  it('rejeita "O próprio operador" quando o Workflow está em modo Consolidado', () => {
    const node = outputNode({ type: "CURRENT_OPERATOR" })
    const issues = validateWorkflowGraph(graphWith(node), scheduleTrigger, new Map(), new Map(), true)
    expect(issues).toContainEqual({
      nodeId: node.id,
      code: "WORKFLOW_OUTPUT_TARGET_INVALID_MODE",
      message: `O nó "${node.label}" usa "O próprio operador" como destinatário, que exige um colaborador individual como alvo — troque o destinatário, adicione "Aplicar individualmente" antes deste nó, ou remova-o.`,
    })
  })

  it("outros destinatários continuam válidos em modo Consolidado — só CURRENT_OPERATOR é bloqueado", () => {
    const node = outputNode({ type: "SUPERVISOR_OF_OPERATOR" })
    expect(validateWorkflowGraph(graphWith(node), scheduleTrigger, new Map(), new Map(), true)).toEqual([])
  })
})

describe("validateWorkflowGraph — Selecionar colaboradores por Ranking (evolução: Por critério vs Por ranking)", () => {
  const scheduleTrigger: WorkflowTrigger = { kind: "schedule", mode: "CALENDAR", intervalDays: 1, times: ["09:00"] }
  const VALID_RANKING = {
    source: "MEASUREMENT" as const,
    indicatorCode: "QUALIDADE",
    aggregation: "AVERAGE" as const,
    period: { kind: "ROLLING_DAYS" as const, days: 90 },
    selection: "LOWEST" as const,
    count: 5,
  }

  function rankingSelectNode(ranking?: object, selectionMode: "RANKING" | undefined = "RANKING"): FlowNode {
    return { id: "select", type: "select_employees", label: "Selecionar colaboradores", position, config: { selectionMode, ranking: ranking as never } }
  }

  it("aceita um ranking completo e válido", () => {
    expect(validateWorkflowGraph(graphWith(rankingSelectNode(VALID_RANKING)), scheduleTrigger, new Map(), new Map(), true)).toEqual([])
  })

  it("rejeita selectionMode RANKING sem nenhuma configuração de ranking", () => {
    const node = rankingSelectNode(undefined)
    const issues = validateWorkflowGraph(graphWith(node), scheduleTrigger, new Map(), new Map(), true)
    expect(issues).toContainEqual({ nodeId: node.id, code: "WORKFLOW_SELECT_EMPLOYEES_MISSING_RANKING", message: `O nó "${node.label}" ("Selecionar colaboradores") precisa de uma configuração de ranking.` })
  })

  it("rejeita ranking sem indicador (fonte MEASUREMENT)", () => {
    const node = rankingSelectNode({ ...VALID_RANKING, indicatorCode: undefined })
    const issues = validateWorkflowGraph(graphWith(node), scheduleTrigger, new Map(), new Map(), true)
    expect(issues.some((issue) => issue.nodeId === node.id && issue.message.includes("indicador"))).toBe(true)
  })

  it("rejeita ranking sem agregação/período/direção de seleção/quantidade", () => {
    expect(validateWorkflowGraph(graphWith(rankingSelectNode({ ...VALID_RANKING, aggregation: undefined })), scheduleTrigger, new Map(), new Map(), true).length).toBeGreaterThan(0)
    expect(validateWorkflowGraph(graphWith(rankingSelectNode({ ...VALID_RANKING, period: undefined })), scheduleTrigger, new Map(), new Map(), true).length).toBeGreaterThan(0)
    expect(validateWorkflowGraph(graphWith(rankingSelectNode({ ...VALID_RANKING, selection: undefined })), scheduleTrigger, new Map(), new Map(), true).length).toBeGreaterThan(0)
    expect(validateWorkflowGraph(graphWith(rankingSelectNode({ ...VALID_RANKING, count: undefined })), scheduleTrigger, new Map(), new Map(), true).length).toBeGreaterThan(0)
  })

  it("aceita PRV_ACHIEVEMENT sem indicatorCode — fonte própria, mesma regra da Condition", () => {
    const node = rankingSelectNode({ source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 90 }, selection: "WORST", count: 3 })
    expect(validateWorkflowGraph(graphWith(node), scheduleTrigger, new Map(), new Map(), true)).toEqual([])
  })

  describe("quartil operacional (camada de medição operacional)", () => {
    const QUARTILE_RANKING = { source: "MEASUREMENT" as const, indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE" as const, period: { kind: "ROLLING_DAYS" as const, days: 7 }, selection: "OPERATIONAL_QUARTILE" as const, operationalQuartile: "Q4" as const }

    it("aceita Q4 operacional de TMA nos últimos 7 dias SEM quantidade (entram todos do quartil)", () => {
      expect(validateWorkflowGraph(graphWith(rankingSelectNode(QUARTILE_RANKING)), scheduleTrigger, new Map(), new Map(), true)).toEqual([])
    })

    it("rejeita quartil operacional sobre fonte oficial, sobre Últimos N fechamentos e sem o quartil-alvo", () => {
      const official = validateWorkflowGraph(graphWith(rankingSelectNode({ ...QUARTILE_RANKING, source: "INDICATOR_ACHIEVEMENT", aggregation: "AVERAGE" })), scheduleTrigger, new Map(), new Map(), true)
      expect(official.some((issue) => issue.message.includes("Quartil operacional"))).toBe(true)
      const closures = validateWorkflowGraph(graphWith(rankingSelectNode({ ...QUARTILE_RANKING, period: { kind: "CLOSURES", unit: "MONTH", count: 3 } })), scheduleTrigger, new Map(), new Map(), true)
      expect(closures.some((issue) => issue.message.includes("janela de período"))).toBe(true)
      const missing = validateWorkflowGraph(graphWith(rankingSelectNode({ ...QUARTILE_RANKING, operationalQuartile: undefined })), scheduleTrigger, new Map(), new Map(), true)
      expect(missing.some((issue) => issue.message.includes("Q1..Q4"))).toBe(true)
    })

    it("rejeita agregação operacional (média ponderada/soma/último valor) com fonte oficial", () => {
      const issues = validateWorkflowGraph(graphWith(rankingSelectNode({ ...VALID_RANKING, source: "PRV_ACHIEVEMENT", indicatorCode: undefined, aggregation: "WEIGHTED_AVERAGE" })), scheduleTrigger, new Map(), new Map(), true)
      expect(issues.some((issue) => issue.message.includes("agregação operacional"))).toBe(true)
    })
  })

  it("selectionMode ausente continua exigindo `criterion` (Por critério), nunca `ranking` — backward compatibility", () => {
    const node = rankingSelectNode(VALID_RANKING, undefined)
    delete (node.config as { selectionMode?: unknown }).selectionMode
    const issues = validateWorkflowGraph(graphWith(node), scheduleTrigger, new Map(), new Map(), true)
    expect(issues).toContainEqual({ nodeId: node.id, code: "WORKFLOW_SELECT_EMPLOYEES_MISSING_CRITERION", message: `O nó "${node.label}" ("Selecionar colaboradores") precisa de um critério de seleção configurado.` })
  })

  // --- Evolução de Evolução/Grupo: rankingBasis CHANGE + partitionBy ---
  const VALID_CHANGE_RANKING = {
    source: "MEASUREMENT" as const,
    indicatorCode: "QUALIDADE",
    aggregation: "AVERAGE" as const,
    period: { kind: "ROLLING_DAYS" as const, days: 30 },
    rankingBasis: "CHANGE" as const,
    selection: "DECLINED" as const,
    count: 2,
  }

  it("aceita um ranking CHANGE válido, com e sem partitionBy", () => {
    expect(validateWorkflowGraph(graphWith(rankingSelectNode(VALID_CHANGE_RANKING)), scheduleTrigger, new Map(), new Map(), true)).toEqual([])
    expect(validateWorkflowGraph(graphWith(rankingSelectNode({ ...VALID_CHANGE_RANKING, partitionBy: "SUBTEAM" })), scheduleTrigger, new Map(), new Map(), true)).toEqual([])
  })

  it("rejeita CHANGE com direção de seleção de VALUE (ex.: HIGHEST)", () => {
    const node = rankingSelectNode({ ...VALID_CHANGE_RANKING, selection: "HIGHEST" })
    const issues = validateWorkflowGraph(graphWith(node), scheduleTrigger, new Map(), new Map(), true)
    expect(issues.some((issue) => issue.nodeId === node.id && issue.message.includes("Evolução"))).toBe(true)
  })

  it("rejeita VALUE com direção de seleção de CHANGE (ex.: IMPROVED)", () => {
    const node = rankingSelectNode({ ...VALID_RANKING, selection: "IMPROVED" })
    const issues = validateWorkflowGraph(graphWith(node), scheduleTrigger, new Map(), new Map(), true)
    expect(issues.some((issue) => issue.nodeId === node.id && issue.message.includes("Valor"))).toBe(true)
  })

  it('rejeita CHANGE com período "Últimos N fechamentos" (CLOSURES)', () => {
    const node = rankingSelectNode({ ...VALID_CHANGE_RANKING, period: { kind: "CLOSURES", unit: "MONTH", count: 3 } })
    const issues = validateWorkflowGraph(graphWith(node), scheduleTrigger, new Map(), new Map(), true)
    expect(issues.some((issue) => issue.nodeId === node.id && issue.message.includes("fechamentos"))).toBe(true)
  })

  it("VALUE continua aceitando CLOSURES normalmente — só CHANGE bloqueia (regressão)", () => {
    const node = rankingSelectNode({ ...VALID_RANKING, period: { kind: "CLOSURES", unit: "MONTH", count: 3 } })
    expect(validateWorkflowGraph(graphWith(node), scheduleTrigger, new Map(), new Map(), true)).toEqual([])
  })
})

describe("validateWorkflowGraph — Consolidar resultados (fan-in/JOIN)", () => {
  const scheduleTrigger: WorkflowTrigger = { kind: "schedule", mode: "CALENDAR", intervalDays: 1, times: ["09:00"] }
  const select: FlowNode = { id: "select", type: "select_employees", label: "Selecionar Q4", position, config: { criterion: { comparator: "EQUALS", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "NOTA_URA" } } } }
  const apply: FlowNode = { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position, config: {} }
  const join: FlowNode = { id: "join", type: "consolidate_results", label: "Consolidar resultados", position, config: {} }
  const orchestrator: FlowNode = { id: "orchestrator", type: "orchestrator", label: "Resumo executivo", position, config: { orchestratorId: "orch-1", instruction: "Resuma." } }

  function fullGraph(nodes: FlowNode[], edges: FlowGraph["edges"]): FlowGraph {
    return { nodes: [triggerNode, ...nodes, endNode], edges }
  }

  it("aceita um fan-out completo: Apply -> Join -> Orchestrator -> Fim", () => {
    const graph = fullGraph(
      [select, apply, join, orchestrator],
      [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
        { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
        { id: "e3", source: "apply", sourceHandle: "always", target: "join" },
        { id: "e4", source: "join", sourceHandle: "always", target: "orchestrator" },
        { id: "e5", source: "orchestrator", sourceHandle: "always", target: "end" },
      ],
    )
    expect(validateWorkflowGraph(graph, scheduleTrigger, new Map(), new Map(), true)).toEqual([])
  })

  it("rejeita Join sem 'Aplicar individualmente' de origem", () => {
    const graph = fullGraph([join], [{ id: "e1", source: "trigger", sourceHandle: "always", target: "join" }, { id: "e2", source: "join", sourceHandle: "always", target: "end" }])
    const issues = validateWorkflowGraph(graph, scheduleTrigger, new Map(), new Map(), true)
    expect(issues.length).toBeGreaterThan(0)
    // Contexto errado (não-EMPLOYEE) já é pego antes da checagem de origem — mesma precedência do backend.
    expect(issues[0]?.message).toContain("Consolidar resultados")
  })

  it("rejeita um caminho que ESCAPA do fan-out sem passar pelo Join", () => {
    const branch: FlowNode = { id: "branch", type: "condition", label: "Ramo", position, config: { comparator: "EQUALS", thresholdBoolean: true } }
    const escapedEnd: FlowNode = { id: "escaped-end", type: "end", label: "Fim (escapou)", position, config: {} }
    const graph = fullGraph(
      [select, apply, branch, join, escapedEnd],
      [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
        { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
        { id: "e3", source: "apply", sourceHandle: "always", target: "branch" },
        { id: "e4", source: "branch", sourceHandle: "true", target: "join" },
        { id: "e5", source: "branch", sourceHandle: "false", target: "escaped-end" },
        { id: "e6", source: "join", sourceHandle: "always", target: "end" },
      ],
    )
    const issues = validateWorkflowGraph(graph, scheduleTrigger, new Map(), new Map(), true)
    expect(issues.some((issue) => issue.message.includes("Nem todos os caminhos individuais"))).toBe(true)
  })

  it("aceita convergência com branch: Condition TRUE e FALSE, ambos levando ao MESMO Join", () => {
    // Trigger é Agenda (schedule) — um Condition "legado" (valor bruto do gatilho) não é válido
    // nesse modo (sem relação com fan-in/JOIN); usa historicalQuery, mesmo shape já válido usado
    // no resto deste arquivo.
    const branch: FlowNode = {
      id: "branch",
      type: "condition",
      label: "Ramo",
      position,
      config: { comparator: "GTE", thresholdNumeric: 80, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 } } },
    }
    const setVar: FlowNode = { id: "set-var", type: "action", label: "Marcar", position, config: { actionType: "SET_CONFIG_VALUE", configKey: "flag_teste", valueType: "BOOLEAN", value: true } }
    const graph = fullGraph(
      [select, apply, branch, setVar, join],
      [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
        { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
        { id: "e3", source: "apply", sourceHandle: "always", target: "branch" },
        { id: "e4", source: "branch", sourceHandle: "true", target: "join" },
        { id: "e5", source: "branch", sourceHandle: "false", target: "set-var" },
        { id: "e6", source: "set-var", sourceHandle: "always", target: "join" },
        { id: "e7", source: "join", sourceHandle: "always", target: "end" },
        // Condição histórica tem a saída "Sem dados": desligada, a execução morreria sem dados (todas as saídas convergem no Join).
        { id: "e8", source: "branch", sourceHandle: "no_data", target: "join" },
      ],
    )
    expect(validateWorkflowGraph(graph, scheduleTrigger, new Map(), new Map(), true)).toEqual([])
  })

  it("Orchestrator é liberado logo após o Join, mas Revisão humana continua exigindo EMPLOYEE mesmo pós-JOIN", () => {
    const review: FlowNode = { id: "review", type: "human_review", label: "Revisão", position, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } } }
    const graph = fullGraph(
      [select, apply, join, review],
      [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
        { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
        { id: "e3", source: "apply", sourceHandle: "always", target: "join" },
        { id: "e4", source: "join", sourceHandle: "always", target: "review" },
        { id: "e5", source: "review", sourceHandle: "approved", target: "end" },
        { id: "e6", source: "review", sourceHandle: "rejected", target: "end" },
        { id: "e7", source: "review", sourceHandle: "escalated", target: "end" },
      ],
    )
    const issues = validateWorkflowGraph(graph, scheduleTrigger, new Map(), new Map(), true)
    expect(issues.some((issue) => issue.nodeId === "review")).toBe(true)
  })

  it("regressão: 'Aplicar individualmente' sem Join continua publicando normalmente (JOIN é opcional)", () => {
    const review: FlowNode = { id: "review", type: "human_review", label: "Revisão", position, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } } }
    const graph = fullGraph(
      [select, apply, review],
      [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
        { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
        { id: "e3", source: "apply", sourceHandle: "always", target: "review" },
        { id: "e4", source: "review", sourceHandle: "approved", target: "end" },
        { id: "e5", source: "review", sourceHandle: "rejected", target: "end" },
        { id: "e6", source: "review", sourceHandle: "escalated", target: "end" },
      ],
    )
    expect(validateWorkflowGraph(graph, scheduleTrigger, new Map(), new Map(), true)).toEqual([])
  })
})

describe("validateWorkflowGraph — quartil operacional e cobertura mínima (hardening operacional × oficial)", () => {
  const quartile = (patch: Partial<Extract<FlowNode, { type: "condition" }>["config"]> = {}, queryPatch: Record<string, unknown> = {}) =>
    conditionNode({
      comparator: "EQUALS",
      thresholdNumeric: null,
      thresholdText: "Q4",
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", source: "OPERATIONAL_QUARTILE", period: { kind: "ROLLING_DAYS", days: 7 }, ...queryPatch },
      ...patch,
    })

  it("Quartil operacional válido: indicador + janela de dias + agregação de valor + É igual a Q4", () => {
    expect(validateWorkflowGraph(graphWith(quartile()), trigger)).toEqual([])
  })

  it("rejeita fechamentos, COUNT, Comparar com, comparador numérico e quartil inválido", () => {
    expect(validateWorkflowGraph(graphWith(quartile({}, { period: { kind: "CLOSURES", unit: "MONTH", count: 1 } })), trigger).map((i) => i.message).join(" ")).toMatch(/fechamentos/)
    expect(validateWorkflowGraph(graphWith(quartile({}, { aggregation: "COUNT" })), trigger).map((i) => i.message).join(" ")).toMatch(/Quantidade de ocorrências/)
    expect(validateWorkflowGraph(graphWith(quartile({}, { compareTo: { kind: "GOAL" } })), trigger).map((i) => i.message).join(" ")).toMatch(/Comparar com/)
    expect(validateWorkflowGraph(graphWith(quartile({ comparator: "GT" })), trigger).map((i) => i.message).join(" ")).toMatch(/É igual a/)
    expect(validateWorkflowGraph(graphWith(quartile({ thresholdText: "Q9" })), trigger).map((i) => i.message).join(" ")).toMatch(/Selecione o quartil operacional/)
  })

  it("buildIndicatorAnalysisConfig('OPERATIONAL_QUARTILE') herda indicador/janela/agregação de Valor do indicador e nunca leva 'fechamentos' junto", () => {
    const fromValue = buildIndicatorAnalysisConfig("OPERATIONAL_QUARTILE", {
      comparator: "LT",
      thresholdNumeric: 400,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 14 }, minimumCoverage: 0.7 },
    })
    expect(fromValue).toMatchObject({ comparator: "EQUALS", thresholdText: "Q4", historicalQuery: { source: "OPERATIONAL_QUARTILE", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 14 }, minimumCoverage: 0.7 } })
    const fromClosures = buildIndicatorAnalysisConfig("OPERATIONAL_QUARTILE", {
      comparator: "GTE",
      thresholdNumeric: 1,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "COUNT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
    })
    expect(fromClosures.historicalQuery).toMatchObject({ aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 } })
    expect(validateWorkflowGraph(graphWith(conditionNode(fromValue)), trigger)).toEqual([])
  })

  it("Cobertura mínima só existe pra Valor do indicador com agregação — Atingimento/COUNT são rejeitados", () => {
    const ok = conditionNode({ comparator: "GT", thresholdNumeric: 400, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 }, minimumCoverage: 0.7 } })
    expect(validateWorkflowGraph(graphWith(ok), trigger)).toEqual([])
    const official = conditionNode({ comparator: "GT", thresholdNumeric: 80, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "AVERAGE", source: "INDICATOR_ACHIEVEMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 }, minimumCoverage: 0.7 } })
    expect(validateWorkflowGraph(graphWith(official), trigger).map((i) => i.message).join(" ")).toMatch(/Cobertura mínima/)
  })
})

describe("validateWorkflowGraph — Avaliação de processo (V1.6.0) exige transcrição: só com Flag de canal", () => {
  const indicatorTrigger = { kind: "indicator", indicatorCode: "TMA", indicatorName: "TMA", unit: "", valueType: "NUMERIC" } as unknown as WorkflowTrigger
  const callAgent: FlowNode = { id: "agent-1", type: "action", label: "Chamar agente", position, config: { actionType: "CALL_AGENT", agentId: "agent-1", outputContract: "PROCESS_ASSESSMENT" } }
  const orchestrator: FlowNode = { id: "orch", type: "orchestrator", label: "Orquestrador", position, config: { orchestratorId: "orch-def", instruction: "Analise.", specialistOutputContract: "PROCESS_ASSESSMENT" } }
  const message = "\"Avaliação de processo\" exige uma transcrição de chamada — só disponível com gatilho por Flag de canal ou Manual com interação."

  it("Chamar agente e Orquestrador com Avaliação de processo fora de Flag → issue no nó", () => {
    const issues = validateWorkflowGraph(graphWith(callAgent, orchestrator), indicatorTrigger)
    expect(issues).toContainEqual({ nodeId: "agent-1", code: "WORKFLOW_PROCESS_ASSESSMENT_REQUIRES_FLAG", message })
    expect(issues).toContainEqual({ nodeId: "orch", code: "WORKFLOW_PROCESS_ASSESSMENT_REQUIRES_FLAG", message })
  })
  it("com gatilho por Flag o formato é aceito", () => {
    const issues = validateWorkflowGraph(graphWith(callAgent, orchestrator), trigger)
    expect(issues.filter((issue) => issue.message === message)).toEqual([])
  })
})

describe("validateWorkflowGraph — V1.7.1 roteamento declarado do Orquestrador", () => {
  const message = "Marque ao menos um domínio no roteamento, ou volte para \"Decidido pela IA\"."
  const orchestrator = (routing: Extract<FlowNode, { type: "orchestrator" }>["config"]["routing"]): FlowNode => ({ id: "orch", type: "orchestrator", label: "Orquestrador", position, config: { orchestratorId: "orch-def", instruction: "Analise.", routing } })
  it("Domínios fixos sem nenhum domínio marcado → issue no nó; com domínio, ou decidido pela IA, nenhuma", () => {
    expect(validateWorkflowGraph(graphWith(orchestrator({ mode: "DOMAINS", businessDomainIds: [] })), trigger)).toContainEqual({ nodeId: "orch", code: "VALIDATION_ERROR", message })
    for (const routing of [{ mode: "DOMAINS" as const, businessDomainIds: ["d1"] }, { mode: "MODEL" as const }, undefined]) {
      expect(validateWorkflowGraph(graphWith(orchestrator(routing)), trigger).filter((issue) => issue.message === message)).toEqual([])
    }
  })
})

describe("validateWorkflowGraph — gatilho Manual (espelha o publish pela origem de dados)", () => {
  const manualInteraction = { kind: "manual", context: "INTERACTION" } as WorkflowTrigger
  const manualCollaborator = { kind: "manual", context: "COLLABORATOR" } as WorkflowTrigger
  const callAgent: FlowNode = { id: "agent-1", type: "action", label: "Chamar agente", position, config: { actionType: "CALL_AGENT", agentId: "agent-1", outputContract: "PROCESS_ASSESSMENT" } }
  const assessment = "\"Avaliação de processo\" exige uma transcrição de chamada — só disponível com gatilho por Flag de canal ou Manual com interação."

  it("Manual com interação aceita a Avaliação de processo (a execução carrega a interação escolhida)", () => {
    expect(validateWorkflowGraph(graphWith(callAgent), manualInteraction).filter((issue) => issue.message === assessment)).toEqual([])
  })

  it("Manual por colaborador recusa a Avaliação de processo e pede a fonte de dados do \"Chamar agente\"", () => {
    const messages = validateWorkflowGraph(graphWith(callAgent), manualCollaborator).map((issue) => issue.message)
    expect(messages).toContain(assessment)
    expect(messages).toContain("Defina a fonte de dados desta ação — o gatilho Manual por colaborador não traz interação nem medição.")
  })

  it("Manual com medição exige o indicador; nunca Consolidado", () => {
    const withoutIndicator = { kind: "manual", context: "INDICATOR_MEASUREMENT" } as WorkflowTrigger
    expect(validateWorkflowGraph(graphWith(), withoutIndicator).map((issue) => issue.message)).toContain("Escolha o indicador cuja medição será selecionada a cada execução manual.")
    expect(validateWorkflowGraph(graphWith(), manualCollaborator, new Map(), new Map(), true).map((issue) => issue.message).join(" ")).toMatch(/Manual executa para um colaborador/)
  })

  it("Condition sobre o valor do gatilho: Manual com interação não carrega valor", () => {
    const legacy = conditionNode({ comparator: "LTE", thresholdNumeric: 3 })
    expect(validateWorkflowGraph(graphWith(legacy), manualInteraction).map((issue) => issue.message).join(" ")).toMatch(/não fornece um/)
    expect(validateWorkflowGraph(graphWith(legacy), { kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode: "TMA" } as WorkflowTrigger)).toEqual([])
  })
})

describe("validateWorkflowGraph — o que o rascunho exige e referências a etapas removidas (auditoria de UX, 04/11/2026)", () => {
  const trigger: WorkflowTrigger = { kind: "manual", context: "COLLABORATOR" }
  const position = { x: 0, y: 0 }
  const base = (...nodes: FlowNode[]): FlowGraph => ({
    nodes: [{ id: "trigger", type: "trigger", label: "Início", position, config: {} }, ...nodes, { id: "end", type: "end", label: "Fim", position, config: {} }],
    edges: [],
  })
  const messagesFor = (graph: FlowGraph, nodeId: string) =>
    validateWorkflowGraph(graph, trigger)
      .filter((issue) => issue.nodeId === nodeId)
      .map((issue) => issue.message)

  it("WF-01: \"Chamar agente\" sem agente vira problema na lista, e o rascunho continua salvando", () => {
    const node: FlowNode = { id: "agente", type: "action", label: "Análise", position, config: { actionType: "CALL_AGENT", agentId: "" } }
    expect(messagesFor(base(node), "agente")).toContain("Escolha o agente desta etapa.")
  })

  it("WF-01: Output sem destino ou sem pessoa, e Revisão de pessoa específica sem pessoa, viram problema local", () => {
    const output: FlowNode = { id: "saida", type: "output", label: "Saída", position, config: { target: { type: "USER", userId: "" }, surfaces: [], source: "nodeOutputs.trigger" } }
    const review: FlowNode = { id: "revisao", type: "human_review", label: "Revisão", position, config: { reviewTarget: { type: "SPECIFIC_USER", userId: "" } } }
    const graph = base(output, review)
    expect(messagesFor(graph, "saida")).toEqual(expect.arrayContaining(["Escolha onde entregar o conteúdo.", "Escolha a pessoa que vai receber o conteúdo."]))
    expect(messagesFor(graph, "revisao")).toContain("Escolha a pessoa.")
  })

  it("WF-07: Output, Revisão e Escalonar com conteúdo de etapa removida são bloqueados", () => {
    const removed = "nodeOutputs.apagado.structuredResult.resumo"
    const output: FlowNode = { id: "saida", type: "output", label: "Saída", position, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["NOTIFICATION"], source: removed } }
    const review: FlowNode = { id: "revisao", type: "human_review", label: "Revisão", position, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource: removed } }
    const escalate: FlowNode = { id: "escala", type: "action", label: "Escalar", position, config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "MANAGER" }, surfaces: ["NOTIFICATION"], contentSource: removed } }
    const graph = base(output, review, escalate)
    expect(messagesFor(graph, "saida")).toContain("O conteúdo escolhido vem de uma etapa que não existe mais — escolha outro.")
    expect(messagesFor(graph, "revisao")).toContain("O conteúdo a revisar vem de uma etapa que não existe mais — escolha outro.")
    expect(messagesFor(graph, "escala")).toContain("O conteúdo escalonado vem de uma etapa que não existe mais — escolha outro.")
  })

  it("WF-07: Condição (simples e em grupo) com origem de etapa removida é bloqueada; origem existente não", () => {
    const simple: FlowNode = { id: "c1", type: "condition", label: "Simples", position, config: { comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null, sourcePath: "nodeOutputs.apagado.ok" } }
    const grouped: FlowNode = {
      id: "c2",
      type: "condition",
      label: "Em grupo",
      position,
      config: { comparator: "EQUALS", thresholdBoolean: null, thresholdNumeric: null, group: { operator: "ALL", rules: [{ comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null, sourcePath: "nodeOutputs.apagado.ok" }] } },
    }
    const kept: FlowNode = { id: "c3", type: "condition", label: "Ok", position, config: { comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null, sourcePath: "nodeOutputs.trigger.ok" } }
    const graph = base(simple, grouped, kept)
    expect(messagesFor(graph, "c1").join()).toContain("etapa que não existe mais")
    expect(messagesFor(graph, "c2").join()).toContain("etapa que não existe mais")
    expect(messagesFor(graph, "c3").join()).not.toContain("etapa que não existe mais")
  })

  it("WF-25: mensagens citam a etapa pelo nome da paleta e não mostram enum cru", () => {
    const issues = validateWorkflowGraph(
      {
        nodes: [
          { id: "trigger", type: "trigger", label: "Início", position, config: {} },
          { id: "agente", type: "action", label: "Análise", position, config: { actionType: "CALL_AGENT", agentId: "a1", scheduledDataSource: { kind: "INDICATORS", window: "LAST_7_DAYS" } } },
          { id: "end", type: "end", label: "Fim", position, config: {} },
        ],
        edges: [
          { id: "1", source: "trigger", sourceHandle: "always", target: "agente" },
          { id: "2", source: "agente", sourceHandle: "always", target: "agente" },
        ],
      } as FlowGraph,
      trigger,
    )
    const cycle = issues.find((issue) => issue.code === "WORKFLOW_PAID_CYCLE_WITHOUT_WAIT")
    expect(cycle?.message).toContain('"Aguardar"')
    expect(cycle?.message).not.toContain("Espera")
  })
})
