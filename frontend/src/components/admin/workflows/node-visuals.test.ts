import { describe, expect, it } from "vitest"
import { describeNodeConfig, describeSetVariableBadge, type NodeDescribeContext } from "./node-visuals"
import type { FlowNode } from "@/schemas/admin/workflow-graph.schema"

const baseContext: NodeDescribeContext = { triggerLabel: "Nota URA" }
const position = { x: 0, y: 0 }

function conditionNode(config: Extract<FlowNode, { type: "condition" }>["config"]): FlowNode {
  return { id: "cond-1", type: "condition", label: "Condição", position, config }
}

describe("describeNodeConfig — trigger (evolução do Trigger por agenda)", () => {
  const triggerNode: FlowNode = { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} }

  it("flag de canal usa o fraseado 'Quando X chega/atualiza'", () => {
    const context: NodeDescribeContext = { triggerLabel: "Nota URA", triggerKind: "channel_flag" }
    expect(describeNodeConfig(triggerNode, context)).toBe('Quando "Nota URA" chega/atualiza')
  })

  it("Agenda mostra a frase de recorrência direto, nunca 'Quando X chega/atualiza' (Parte 12/13 do pedido)", () => {
    const context: NodeDescribeContext = { triggerLabel: "Todos os dias às 09:00", triggerKind: "schedule" }
    expect(describeNodeConfig(triggerNode, context)).toBe("Todos os dias às 09:00")
  })

  it("Agenda com dias da semana também nunca expõe UUID/cron técnico", () => {
    const context: NodeDescribeContext = { triggerLabel: "Seg, Qua e Sex às 09:00", triggerKind: "schedule" }
    expect(describeNodeConfig(triggerNode, context)).toBe("Seg, Qua e Sex às 09:00")
  })
})

describe("describeNodeConfig — condition: histórico (Parte 2/38)", () => {
  it("resume COUNT como quantidade de ocorrências, nunca como comparador cru", () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "Nota URA", comparator: "LT", indicatorThreshold: 3, period: { kind: "ROLLING_DAYS", days: 7 } },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("3 ou mais Nota URA é menor que 3 nos últimos 7 dias")
  })

  it("resume AVERAGE com janela móvel", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 3.3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "Nota URA", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 } },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Média de Nota URA nos últimos 30 dias é menor que 3.3")
  })

  it("resume MAXIMUM com período de calendário", () => {
    const node = conditionNode({
      comparator: "GT",
      thresholdNumeric: 900,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "MAXIMUM", period: { kind: "CALENDAR", unit: "MONTH" } },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Máximo de TMA no último mês é maior que 900")
  })

  it("resume Atingimento do indicador, nunca confundido com Valor bruto", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 100,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "Monitoria de Qualidade",
        aggregation: "AVERAGE",
        source: "INDICATOR_ACHIEVEMENT",
        period: { kind: "CALENDAR", unit: "MONTH" },
      },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Média do atingimento de Monitoria de Qualidade no último mês é menor que 100")
  })

  it("resume Atingimento consolidado do PRV sem citar 'indicador' (o PRV não tem um)", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 80,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", period: { kind: "CALENDAR", unit: "MONTH" } },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Média do atingimento do PRV no último mês é menor que 80")
  })

  it("resume Comparação temporal percentual — aumentou pelo menos X%", () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 10,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "TMA",
        aggregation: "AVERAGE",
        period: { kind: "ROLLING_DAYS", days: 7 },
        compareTo: { kind: "PREVIOUS_PERIOD", changeMode: "PERCENT" },
      },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Média de TMA nos últimos 7 dias aumentou pelo menos 10%")
  })

  it("resume Comparação temporal percentual — diminuiu pelo menos X%", () => {
    const node = conditionNode({
      comparator: "LTE",
      thresholdNumeric: -10,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "TMA",
        aggregation: "AVERAGE",
        period: { kind: "ROLLING_DAYS", days: 7 },
        compareTo: { kind: "PREVIOUS_PERIOD", changeMode: "PERCENT" },
      },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Média de TMA nos últimos 7 dias diminuiu pelo menos 10%")
  })

  it("resume Últimos N meses fechados pra Valor bruto (correção pontual de PERÍODO) — nunca 'fechamentos', nunca aproxima por dias", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 3.3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "Nota URA", aggregation: "AVERAGE", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Média de Nota URA nos últimos 3 meses fechados é menor que 3.3")
  })

  it("resume Últimos N fechamentos pra Atingimento (regressão — nomenclatura de snapshot real, distinta de Valor bruto)", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 90,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "Qualidade",
        aggregation: "AVERAGE",
        source: "INDICATOR_ACHIEVEMENT",
        period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
      },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Média do atingimento de Qualidade nos últimos 3 fechamentos mensais é menor que 90")
  })

  it("resume Atingimento de PRV em modo Individual sem sufixo de estrutura", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 80,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
    })
    expect(describeNodeConfig(node, { ...baseContext, isConsolidatedMode: false })).toBe("Média do atingimento do PRV nos últimos 3 fechamentos mensais é menor que 80")
  })

  it("resume Atingimento de PRV em modo Consolidado com o sufixo 'da estrutura' (Parte 6 do pedido — nunca soa como PRV oficial)", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 80,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
    })
    expect(describeNodeConfig(node, { ...baseContext, isConsolidatedMode: true })).toBe("Média do atingimento do PRV da estrutura nos últimos 3 fechamentos mensais é menor que 80")
  })

  it("resume Atingimento do indicador em modo Consolidado com o mesmo sufixo, por consistência", () => {
    const node = conditionNode({
      comparator: "LT",
      thresholdNumeric: 90,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "Qualidade",
        aggregation: "AVERAGE",
        source: "INDICATOR_ACHIEVEMENT",
        period: { kind: "CALENDAR", unit: "MONTH" },
      },
    })
    expect(describeNodeConfig(node, { ...baseContext, isConsolidatedMode: true })).toBe("Média do atingimento de Qualidade da estrutura no último mês é menor que 90")
  })
})

describe("describeNodeConfig — condition: performance (Parte 8)", () => {
  it("resume quartil do PRV", () => {
    const node = conditionNode({
      comparator: "EQUALS",
      thresholdText: "Q4",
      performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Quartil do PRV é igual a Q4")
  })

  it("resume quartil do indicador com o código do indicador", () => {
    const node = conditionNode({
      comparator: "EQUALS",
      thresholdText: "Q4",
      performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "Nota URA" },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Quartil do indicador (Nota URA) é igual a Q4")
  })

  it("resume Recorrência de Quartil (Parte 7/8/10/24) — 'Q4 em 3 ou mais dos últimos 3 fechamentos'", () => {
    const node = conditionNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE", recurrence: { periods: 3, matchQuartile: "Q4" } },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Q4 em 3 ou mais dos últimos 3 fechamentos")
  })
})

describe("describeNodeConfig — condition: group AND/OR (Parte 3)", () => {
  it("junta as regras com E quando o operador é ALL", () => {
    const node = conditionNode({
      comparator: "EQUALS",
      group: {
        operator: "ALL",
        rules: [
          { comparator: "EQUALS", thresholdBoolean: true, sourcePath: "variables.var-1" },
          { comparator: "GT", thresholdNumeric: 10 },
        ],
      },
    })
    const context: NodeDescribeContext = { ...baseContext, getVariable: () => ({ label: "Caso crítico", type: "BOOLEAN" }) }
    expect(describeNodeConfig(node, context)).toBe("Caso crítico é igual a Verdadeiro E Nota URA é maior que 10")
  })

  it("junta as regras com OU quando o operador é ANY", () => {
    const node = conditionNode({
      comparator: "EQUALS",
      group: {
        operator: "ANY",
        rules: [
          { comparator: "GT", thresholdNumeric: 1 },
          { comparator: "LT", thresholdNumeric: 2 },
        ],
      },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Nota URA é maior que 1 OU Nota URA é menor que 2")
  })
})

describe("describeNodeConfig — human_review (Parte 4)", () => {
  function humanReviewNode(config: Extract<FlowNode, { type: "human_review" }>["config"]): FlowNode {
    return { id: "hr-1", type: "human_review", label: "Revisão", position, config }
  }

  it("resume revisão pelo cargo do operador", () => {
    const node = humanReviewNode({ reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } })
    expect(describeNodeConfig(node, baseContext)).toBe("Revisão do Supervisor do operador")
  })

  it("resume revisão relativa ao revisor anterior, usando o label amigável do node", () => {
    const node = humanReviewNode({ reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "hr-0" } })
    const context: NodeDescribeContext = { ...baseContext, getNodeLabel: (id) => (id === "hr-0" ? "1ª revisão" : undefined) }
    expect(describeNodeConfig(node, context)).toBe('Revisão do Gerente de quem decidiu em "1ª revisão"')
  })

  it("cai no id técnico só quando o label do node anterior não é resolvível", () => {
    const node = humanReviewNode({ reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "hr-0" } })
    expect(describeNodeConfig(node, baseContext)).toBe('Revisão do Gerente de quem decidiu em "revisão anterior"')
  })

  it("resume revisão de pessoa específica sem expor o userId", () => {
    const node = humanReviewNode({ reviewTarget: { type: "SPECIFIC_USER", userId: "user-1" } })
    expect(describeNodeConfig(node, baseContext)).toBe("Revisão de pessoa específica")
  })
})

describe("describeNodeConfig — action: Escalonar (evolução do Escalonamento — Destino/Conteúdo/Surface reaproveitados)", () => {
  function escalateNode(config: Extract<FlowNode, { type: "action" }>["config"]): FlowNode {
    return { id: "esc-1", type: "action", label: "Escalonar", position, config }
  }

  it("resume escalonamento pelo cargo do operador, com superfícies e nunca UUID (Parte 23)", () => {
    const node = escalateNode({ actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "MANAGER" }, surfaces: ["INBOX", "NOTIFICATION"] })
    expect(describeNodeConfig(node, baseContext)).toBe("Escalonar → Gerente do operador · Pendências + Notificação")
  })

  it("resume escalonamento relativo ao revisor anterior, usando o label amigável do node", () => {
    const node = escalateNode({
      actionType: "ESCALATE",
      target: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "SENIOR_MANAGER", previousReviewNodeId: "hr-0" },
      surfaces: ["NOTIFICATION"],
    })
    const context: NodeDescribeContext = { ...baseContext, getNodeLabel: (id) => (id === "hr-0" ? "Confirmação do supervisor" : undefined) }
    expect(describeNodeConfig(node, context)).toBe('Escalonar → Gerente sênior de quem decidiu em "Confirmação do supervisor" · Notificação')
  })

  it("resume escalonamento de pessoa específica sem expor o userId", () => {
    const node = escalateNode({ actionType: "ESCALATE", target: { type: "SPECIFIC_USER", userId: "user-1" }, surfaces: ["NOTIFICATION"] })
    expect(describeNodeConfig(node, baseContext)).toBe("Escalonar → pessoa específica · Notificação")
  })

  it("inclui o Motivo na descrição quando definido", () => {
    const node = escalateNode({
      actionType: "ESCALATE",
      target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" },
      surfaces: ["INBOX"],
      reason: "Reincidência crítica de qualidade",
    })
    expect(describeNodeConfig(node, baseContext)).toBe('Escalonar → Supervisor do operador · Pendências — "Reincidência crítica de qualidade"')
  })
})

describe("describeNodeConfig — action: Definir variável (evolução de Variáveis do Workflow)", () => {
  function setVariableNode(config: Extract<FlowNode, { type: "action" }>["config"]): FlowNode {
    return { id: "action-1", type: "action", label: "Definir variável", position, config }
  }

  it("resume valor fixo — comportamento de sempre", () => {
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "var-1", value: 5 })
    const context: NodeDescribeContext = { ...baseContext, getVariable: () => ({ label: "Contagem de alertas", type: "NUMERIC" }) }
    expect(describeNodeConfig(node, context)).toBe("Contagem de alertas = 5")
  })

  it("resume valor fixo booleano", () => {
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "var-1", value: true })
    const context: NodeDescribeContext = { ...baseContext, getVariable: () => ({ label: "Rechamada", type: "BOOLEAN" }) }
    expect(describeNodeConfig(node, context)).toBe("Rechamada = Verdadeiro")
  })

  it("resume origem dinâmica = valor do gatilho", () => {
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "nodeOutputs.trigger" })
    const context: NodeDescribeContext = { ...baseContext, triggerLabel: "nota_ura", getVariable: () => ({ label: "Nota recebida", type: "NUMERIC" }) }
    expect(describeNodeConfig(node, context)).toBe('Nota recebida ← Valor do gatilho ("nota_ura")')
  })

  it("resume origem dinâmica = campo de Structured Output de um nó anterior, com o resolvedor amigável já existente (nunca JSON path)", () => {
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "nodeOutputs.orch.structuredResult.diagnosis.risk" })
    const context: NodeDescribeContext = {
      ...baseContext,
      getVariable: () => ({ label: "Pontuação de risco", type: "NUMERIC" }),
      getStructuredFieldLabel: (nodeId, fieldPath) => (nodeId === "orch" && fieldPath === "diagnosis.risk" ? "Diagnóstico › Risco" : undefined),
    }
    expect(describeNodeConfig(node, context)).toBe("Pontuação de risco ← Diagnóstico › Risco")
  })

  it("cai no label amigável do node quando o campo específico não é resolvível (schema desconhecido)", () => {
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "nodeOutputs.agent" })
    const context: NodeDescribeContext = {
      ...baseContext,
      getVariable: () => ({ label: "Feedback final", type: "TEXT" }),
      getNodeLabel: (nodeId) => (nodeId === "agent" ? "Agente de Feedback" : undefined),
    }
    expect(describeNodeConfig(node, context)).toBe("Feedback final ← Agente de Feedback")
  })

  it("resume origem dinâmica = outra variável do workflow", () => {
    const node = setVariableNode({ actionType: "SET_VARIABLE", variableId: "var-b", sourcePath: "variables.var-a" })
    const context: NodeDescribeContext = {
      ...baseContext,
      getVariable: (id) => (id === "var-b" ? { label: "Score final", type: "NUMERIC" } : id === "var-a" ? { label: "Pontuação de risco", type: "NUMERIC" } : undefined),
    }
    expect(describeNodeConfig(node, context)).toBe("Score final ← Pontuação de risco")
  })
})

describe("describeSetVariableBadge (Parte 16-22 — linguagem visual Fixo/Dinâmico)", () => {
  it("retorna FIXED quando não há sourcePath", () => {
    const node: FlowNode = { id: "a", type: "action", label: "Ação", position, config: { actionType: "SET_VARIABLE", variableId: "var-1", value: 5 } }
    expect(describeSetVariableBadge(node)).toBe("FIXED")
  })

  it("retorna DYNAMIC quando há sourcePath", () => {
    const node: FlowNode = { id: "a", type: "action", label: "Ação", position, config: { actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "nodeOutputs.trigger" } }
    expect(describeSetVariableBadge(node)).toBe("DYNAMIC")
  })

  it("retorna null pra qualquer outro tipo de node ou Action", () => {
    const escalate: FlowNode = {
      id: "a",
      type: "action",
      label: "Ação",
      position,
      config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["NOTIFICATION"] },
    }
    const end: FlowNode = { id: "e", type: "end", label: "Fim", position, config: {} }
    expect(describeSetVariableBadge(escalate)).toBeNull()
    expect(describeSetVariableBadge(end)).toBeNull()
  })
})

describe("describeNodeConfig — select_employees / apply_individually (EMPLOYEE_COLLECTION)", () => {
  function selectEmployeesNode(criterion?: object): FlowNode {
    return { id: "select-1", type: "select_employees", label: "Selecionar colaboradores", position, config: criterion ? { criterion: criterion as never } : {} }
  }

  it("reaproveita o MESMO resumo que uma Condition de histórico mostraria, nunca um formulário inteiro no card", () => {
    const node = selectEmployeesNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "Qualidade", comparator: "LT", indicatorThreshold: 3, period: { kind: "ROLLING_DAYS", days: 7 } },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("3 ou mais Qualidade é menor que 3 nos últimos 7 dias")
  })

  it("reaproveita o resumo de Performance (Quartil) — exemplo do pedido: Q4 em 3 dos últimos 3 fechamentos", () => {
    const node = selectEmployeesNode({
      comparator: "GTE",
      thresholdNumeric: 3,
      performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE", recurrence: { periods: 3, matchQuartile: "Q4" } },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Q4 em 3 ou mais dos últimos 3 fechamentos")
  })

  it("sem critério configurado, nunca inventa um resumo — mostra que falta configurar", () => {
    expect(describeNodeConfig(selectEmployeesNode(), baseContext)).toBe("Selecionar colaboradores — sem critério")
  })

  it("'Aplicar individualmente' não tem configuração própria — texto fixo de comportamento", () => {
    const node: FlowNode = { id: "apply-1", type: "apply_individually", label: "Aplicar individualmente", position, config: {} }
    expect(describeNodeConfig(node, baseContext)).toBe("1 execução por colaborador da coleção")
  })

  it("'Consolidar resultados' não tem configuração própria — texto fixo de comportamento (fan-in/JOIN)", () => {
    const node: FlowNode = { id: "join-1", type: "consolidate_results", label: "Consolidar resultados", position, config: {} }
    expect(describeNodeConfig(node, baseContext)).toBe('Aguarda as execuções de "Aplicar individualmente"')
  })

  it("modo RANKING: resumo curto com quantidade, posição, indicador/agregação e período — nunca o formulário inteiro (evolução de Ranking)", () => {
    const node: FlowNode = {
      id: "select-1",
      type: "select_employees",
      label: "Selecionar colaboradores",
      position,
      config: {
        selectionMode: "RANKING",
        ranking: { source: "MEASUREMENT", indicatorCode: "Qualidade", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 90 }, selection: "WORST", count: 5 },
      },
    }
    expect(describeNodeConfig(node, baseContext)).toBe("5 piores · Média de Qualidade · nos últimos 90 dias")
  })

  it("quartil operacional aparece nomeado como OPERACIONAL, com janela e agregação — nunca confundível com o quartil oficial", () => {
    const node: FlowNode = {
      id: "select",
      type: "select_employees",
      label: "Selecionar colaboradores",
      position: { x: 0, y: 0 },
      config: {
        selectionMode: "RANKING",
        ranking: { source: "MEASUREMENT", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 }, selection: "OPERATIONAL_QUARTILE", operationalQuartile: "Q4" },
      },
    }
    expect(describeNodeConfig(node, baseContext)).toBe("Q4 operacional · Média ponderada de TMA · nos últimos 7 dias")
  })

  it("modo RANKING sem configuração de ranking — nunca inventa um resumo", () => {
    const node: FlowNode = { id: "select-1", type: "select_employees", label: "Selecionar colaboradores", position, config: { selectionMode: "RANKING" } }
    expect(describeNodeConfig(node, baseContext)).toBe("Selecionar colaboradores — ranking incompleto")
  })

  it("modo RANKING CHANGE: resumo mostra 'vs período anterior' (evolução de Evolução/Grupo, Parte 55)", () => {
    const node: FlowNode = {
      id: "select-1",
      type: "select_employees",
      label: "Selecionar colaboradores",
      position,
      config: {
        selectionMode: "RANKING",
        ranking: { source: "MEASUREMENT", indicatorCode: "Qualidade", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 }, rankingBasis: "CHANGE", selection: "DECLINED", count: 2 },
      },
    }
    expect(describeNodeConfig(node, baseContext)).toBe("2 maiores quedas · Média de Qualidade · nos últimos 30 dias vs período anterior")
  })

  it("modo RANKING com partitionBy: resumo mostra '· por Grupo'/'· por Subgrupo' — nunca escondido (Parte 27/57)", () => {
    const byTeam: FlowNode = {
      id: "select-1",
      type: "select_employees",
      label: "Selecionar colaboradores",
      position,
      config: {
        selectionMode: "RANKING",
        ranking: { source: "MEASUREMENT", indicatorCode: "Qualidade", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 90 }, selection: "WORST", count: 3, partitionBy: "TEAM" },
      },
    }
    expect(describeNodeConfig(byTeam, baseContext)).toBe("3 piores · Média de Qualidade · nos últimos 90 dias · por Grupo")

    const bySubteam: FlowNode = {
      ...byTeam,
      config: { selectionMode: "RANKING", ranking: { ...(byTeam.config as { ranking: object }).ranking, partitionBy: "SUBTEAM" } as never },
    }
    expect(describeNodeConfig(bySubteam, baseContext)).toBe("3 piores · Média de Qualidade · nos últimos 90 dias · por Subgrupo")
  })

  it("partitionBy NONE explícito não deixa um sufixo pendurado no resumo", () => {
    const node: FlowNode = {
      id: "select-1",
      type: "select_employees",
      label: "Selecionar colaboradores",
      position,
      config: {
        selectionMode: "RANKING",
        ranking: { source: "MEASUREMENT", indicatorCode: "Qualidade", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 90 }, selection: "WORST", count: 3, partitionBy: "NONE" },
      },
    }
    expect(describeNodeConfig(node, baseContext)).toBe("3 piores · Média de Qualidade · nos últimos 90 dias")
  })
})

describe("describeNodeConfig — condition: quartil operacional (hardening operacional × oficial)", () => {
  it("nomeia o quartil OPERACIONAL com a janela — nunca confundível com 'Quartil do indicador' (oficial)", () => {
    const node = conditionNode({
      comparator: "EQUALS",
      thresholdNumeric: null,
      thresholdText: "Q4",
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", source: "OPERATIONAL_QUARTILE", period: { kind: "ROLLING_DAYS", days: 7 } },
    })
    expect(describeNodeConfig(node, baseContext)).toBe("Quartil operacional de TMA nos últimos 7 dias é Q4")
    const negated = conditionNode({ ...node.config, comparator: "NOT_EQUALS" } as Extract<FlowNode, { type: "condition" }>["config"])
    expect(describeNodeConfig(negated, baseContext)).toBe("Quartil operacional de TMA nos últimos 7 dias não é Q4")
  })
})
