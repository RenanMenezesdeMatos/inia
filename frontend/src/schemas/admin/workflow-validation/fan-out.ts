import { findNode, resolveNodeContexts, type FlowEdge, type FlowGraph, type FlowNode } from "../workflow-graph.schema"
import type { ValidationContext, ValidationIssue } from "./types"
import { validateDataCondition } from "./conditions"

// Família FAN-OUT/JOIN (modo Consolidado): nós individual-only × contexto, nós de coleção, ranking e convergência.
// Espelho do backend: workflows/application/publish-validation/fan-out.ts.

/** Todo "Aplicar individualmente" alcançado andando pra trás a partir de um "Consolidar
 * resultados" — espelha findAllFanOutOrigins do backend (workflow-router.ts): coleta TODOS os
 * encontrados (não só o mais próximo), pra detectar origem ambígua, parando (não atravessando)
 * qualquer OUTRO "consolidate_results" no caminho. */
function findAllFanOutOrigins(graph: FlowGraph, joinNodeId: string): Set<string> {
  const incomingBySource = new Map<string, FlowEdge[]>()
  for (const edge of graph.edges) {
    const list = incomingBySource.get(edge.target) ?? []
    list.push(edge)
    incomingBySource.set(edge.target, list)
  }
  const origins = new Set<string>()
  const visited = new Set<string>()
  let frontier = [joinNodeId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const nodeId of frontier) {
      if (visited.has(nodeId)) continue
      visited.add(nodeId)
      for (const edge of incomingBySource.get(nodeId) ?? []) {
        const sourceNode = findNode(graph, edge.source)
        if (sourceNode?.type === "apply_individually") {
          origins.add(sourceNode.id)
          continue
        }
        if (sourceNode?.type === "consolidate_results" && sourceNode.id !== joinNodeId) continue
        next.push(edge.source)
      }
    }
    frontier = next
  }
  return origins
}

/**
 * Convergência do fan-out (fan-in/JOIN) — espelha validateFanOutConvergence do backend
 * (workflow-router.ts): valida que a topologia entre um "Aplicar individualmente" e um
 * "Consolidar resultados" está bem formada, pra nunca publicar um Workflow onde o fan-in ficaria
 * esperando pra sempre (deadlock) ou pareado de forma ambígua.
 */
function validateFanOutConvergence(graph: FlowGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const outgoingBySource = new Map<string, FlowEdge[]>()
  for (const edge of graph.edges) {
    const list = outgoingBySource.get(edge.source) ?? []
    list.push(edge)
    outgoingBySource.set(edge.source, list)
  }

  const joinNodes = graph.nodes.filter((node): node is Extract<FlowNode, { type: "consolidate_results" }> => node.type === "consolidate_results")
  const applyToJoins = new Map<string, Set<string>>()
  for (const joinNode of joinNodes) {
    const origins = findAllFanOutOrigins(graph, joinNode.id)
    if (origins.size === 0) {
      issues.push({ nodeId: joinNode.id, code: "WORKFLOW_CONSOLIDATE_RESULTS_MISSING_ORIGIN", message: `"${joinNode.label}" ("Consolidar resultados") precisa estar associado a um "Aplicar individualmente".` })
      continue
    }
    if (origins.size > 1) {
      issues.push({ nodeId: joinNode.id, code: "WORKFLOW_CONSOLIDATE_RESULTS_AMBIGUOUS_ORIGIN", message: `"${joinNode.label}" ("Consolidar resultados") é alcançado por mais de um "Aplicar individualmente" diferente — a origem ficou ambígua.` })
      continue
    }
    const applyId = [...origins][0]!
    const set = applyToJoins.get(applyId) ?? new Set<string>()
    set.add(joinNode.id)
    applyToJoins.set(applyId, set)
  }

  for (const [applyId, joins] of applyToJoins) {
    if (joins.size > 1) {
      const applyNode = findNode(graph, applyId)
      issues.push({ nodeId: applyId, code: "WORKFLOW_APPLY_INDIVIDUALLY_MULTIPLE_JOINS", message: `"${applyNode?.label ?? applyId}" ("Aplicar individualmente") alcança mais de um "Consolidar resultados" diferente — só um Join é permitido por fan-out.` })
    }
  }

  for (const applyNode of graph.nodes) {
    if (applyNode.type !== "apply_individually") continue
    const pairedJoinId = [...(applyToJoins.get(applyNode.id) ?? [])][0]
    if (!pairedJoinId) continue // sem Join — comportamento legado, sempre válido
    const edge = outgoingBySource.get(applyNode.id)?.[0]
    if (!edge) continue
    const visited = new Set<string>([applyNode.id])
    let frontier = [edge.target]
    while (frontier.length > 0) {
      const next: string[] = []
      for (const nodeId of frontier) {
        if (visited.has(nodeId)) continue
        visited.add(nodeId)
        if (nodeId === pairedJoinId) continue
        const outgoing = outgoingBySource.get(nodeId) ?? []
        if (outgoing.length === 0) {
          issues.push({ nodeId: applyNode.id, code: "WORKFLOW_FAN_OUT_PATH_ESCAPES_JOIN", message: `Nem todos os caminhos individuais de "${applyNode.label}" ("Aplicar individualmente") chegam ao mesmo "Consolidar resultados" — algum caminho termina antes de consolidar.` })
          continue
        }
        for (const out of outgoing) next.push(out.target)
      }
      frontier = next
    }
  }
  return issues
}

/** Modo Consolidado: nós que exigem um colaborador × contexto inferido do grafo, nós de coleção, ranking e convergência do fan-out. */
export function validateConsolidatedGraph(context: ValidationContext): void {
  const { graph, isConsolidatedMode, issues } = context
  // "Matriz de compatibilidade": nós que só fazem sentido com um colaborador individual como
  // sujeito (nunca uma Estrutura Consolidada inteira ou uma Coleção) — espelha
  // `findIndividualOnlyConflict`/`findEmployeeCollectionConflict` do publish no backend
  // (workflow-router.ts). Contexto de cada node é inferido da posição no grafo
  // (`resolveNodeContexts`, EMPLOYEE_COLLECTION), nunca configurado à mão: "O próprio operador"
  // (Output), Performance do colaborador (Condition), Revisão humana, Orquestrador e Chamar
  // agente/Escalonar (Action) só são válidos quando o contexto de entrada é EMPLOYEE (depois de
  // "Aplicar individualmente") — em STRUCTURE/EMPLOYEE_COLLECTION continuam bloqueados.
  if (isConsolidatedMode) {
    const nodeContexts = resolveNodeContexts(graph)
    for (const node of graph.nodes) {
      const individualContext = nodeContexts.get(node.id) ?? "STRUCTURE"
      if (individualContext === "EMPLOYEE") continue
      // Orchestrator é a ÚNICA exceção que também aceita CONSOLIDATED_RESULT (depois de
      // "Consolidar resultados" — fan-in/JOIN): sintetiza um resultado consolidado de N
      // colaboradores, nunca a pessoa-âncora fingindo representar todos.
      if (node.type === "orchestrator" && individualContext === "CONSOLIDATED_RESULT") continue
      // "Chamar agente" depois de "Consolidar resultados" = Agent de síntese (evolução 2026-09-16):
      // aceito no grafo; se o agente aceita o resultado consolidado, quem confere é o dry-run do
      // backend (WORKFLOW_AGENT_NOT_CONSOLIDATED) — nenhuma regra de banco copiada pra cá.
      if (node.type === "action" && node.config.actionType === "CALL_AGENT" && individualContext === "CONSOLIDATED_RESULT") continue
      // Mesmas mensagens do backend (validate-workflow-for-publish.ts, findIndividualOnlyConflict):
      // depois de "Consolidar resultados" a linguagem é "fluxo consolidado / não há operador
      // atual", nunca "adicione Aplicar individualmente" (que já existe antes do Join).
      const afterJoin = individualContext === "CONSOLIDATED_RESULT"
      if (node.type === "condition" && node.config.performanceQuery) {
        issues.push({
          nodeId: node.id,
          code: "WORKFLOW_PERFORMANCE_QUERY_INVALID_MODE",
          message: afterJoin
            ? `A condição "${node.label}" usa Performance do colaborador depois de "Consolidar resultados" — ali não há um colaborador individual, só o resultado consolidado. Mova a condição para dentro do caminho individual ou compare um campo do resultado do Orquestrador.`
            : `O nó "${node.label}" usa Performance do colaborador, que não é uma Condition válida quando o Workflow analisa uma estrutura consolidada — troque para Histórico do indicador, adicione "Aplicar individualmente" antes deste nó, ou remova-o.`,
        })
      }
      // Quartil operacional classifica UM colaborador dentro da população — igual a Performance
      // do colaborador, só existe com um operador individual como sujeito (espelha o publish).
      if (node.type === "condition" && node.config.historicalQuery?.source === "OPERATIONAL_QUARTILE") {
        issues.push({
          nodeId: node.id,
          code: "WORKFLOW_OPERATIONAL_QUARTILE_INVALID_MODE",
          message: afterJoin
            ? `A condição "${node.label}" usa Quartil operacional depois de "Consolidar resultados" — ali não há um colaborador individual, só o resultado consolidado.`
            : `O nó "${node.label}" usa Quartil operacional, que classifica UM colaborador dentro da população — em um Workflow consolidado use-o como critério de "Selecionar colaboradores" ou adicione "Aplicar individualmente" antes deste nó.`,
        })
      }
      if (node.type === "output" && node.config.target.type === "CURRENT_OPERATOR") {
        issues.push({
          nodeId: node.id,
          code: "WORKFLOW_OUTPUT_TARGET_INVALID_MODE",
          message: afterJoin
            ? `O Output "${node.label}" está em um fluxo consolidado (depois de "Consolidar resultados") e não possui um operador individual atual. Escolha um destinatário de gestão — Supervisor, Gerente, um cargo específico ou uma pessoa — ou mova o Output para antes de "Consolidar resultados" se ele é para cada operador.`
            : `O nó "${node.label}" usa "O próprio operador" como destinatário, que exige um colaborador individual como alvo — troque o destinatário, adicione "Aplicar individualmente" antes deste nó, ou remova-o.`,
        })
      }
      if (node.type === "human_review") {
        issues.push({
          nodeId: node.id,
          code: "WORKFLOW_HUMAN_REVIEW_INVALID_MODE",
          message: afterJoin
            ? `A revisão humana "${node.label}" está depois de "Consolidar resultados" — não há um colaborador individual para revisar. Mova a revisão para o caminho individual (entre "Aplicar individualmente" e "Consolidar resultados").`
            : `Revisão humana exige um colaborador individual como contexto. Adicione "Aplicar individualmente" antes do nó "${node.label}".`,
        })
      }
      if (node.type === "intervention_policy") {
        issues.push({
          nodeId: node.id,
          code: "WORKFLOW_INTERVENTION_POLICY_INVALID_MODE",
          message: afterJoin
            ? `O nó "${node.label}" avalia uma política de acompanhamento depois de "Consolidar resultados" — ali não há um colaborador individual. Mova o nó para o caminho individual.`
            : `O nó "${node.label}" avalia uma política de acompanhamento, que exige um colaborador individual como contexto. Adicione "Aplicar individualmente" antes deste nó.`,
        })
      }
      if (node.type === "orchestrator") {
        issues.push({ nodeId: node.id, code: "WORKFLOW_ORCHESTRATOR_INVALID_MODE", message: `O nó "${node.label}" usa o Orquestrador, que exige um colaborador individual como contexto. Adicione "Aplicar individualmente" antes deste nó.` })
      }
      if (node.type === "action" && node.config.actionType === "GENERATE_FEEDBACK") {
        issues.push({ nodeId: node.id, code: "WORKFLOW_ACTION_INVALID_MODE", message: `O nó "${node.label}" gera feedback de um colaborador sobre uma interação ou medição — não existe nesse ponto de um Workflow consolidado.` })
      }
      if (node.type === "action" && node.config.actionType === "GENERATE_INTERACTION_FEEDBACK") {
        issues.push({
          nodeId: node.id,
          code: "WORKFLOW_ACTION_INVALID_MODE",
          message: afterJoin
            ? `O nó "${node.label}" gera feedback de atendimento depois de "Consolidar resultados" — ali não há um colaborador individual nem uma interação. Mova o nó para o caminho individual (entre "Aplicar individualmente" e "Consolidar resultados").`
            : `O nó "${node.label}" gera feedback de atendimento, que exige um colaborador individual como contexto. Adicione "Aplicar individualmente" antes deste nó.`,
        })
      }
      if (node.type === "action" && (node.config.actionType === "CALL_AGENT" || node.config.actionType === "ESCALATE")) {
        const actionLabel = node.config.actionType === "CALL_AGENT" ? "Chamar agente" : "Escalonar"
        issues.push({
          nodeId: node.id,
          code: "WORKFLOW_ACTION_INVALID_MODE",
          message: afterJoin
            ? node.config.actionType === "CALL_AGENT"
              ? `O nó "${node.label}" chama um agente depois de "Consolidar resultados" — um agente analisa um colaborador por vez. Para sintetizar o resultado consolidado use um Orquestrador; para analisar cada pessoa, mova o nó para antes de "Consolidar resultados".`
              : `O nó "${node.label}" escalona depois de "Consolidar resultados" — não há um operador individual para escalonar. Use um Output com destinatário de gestão, ou mova o Escalonar para o caminho individual.`
            : `O nó "${node.label}" usa ${actionLabel}, que exige um colaborador individual como contexto. Adicione "Aplicar individualmente" antes deste nó.`,
        })
      }
    }

    // Compatibilidade dos 2 nodes de EMPLOYEE_COLLECTION: "Selecionar colaboradores" precisa de
    // uma população (Estrutura ou uma coleção anterior, nunca um colaborador já individual);
    // "Aplicar individualmente" precisa exatamente de uma coleção.
    for (const node of graph.nodes) {
      const context = nodeContexts.get(node.id) ?? "STRUCTURE"
      if (node.type === "select_employees") {
        if (context === "EMPLOYEE") {
          issues.push({
            nodeId: node.id,
            code: "WORKFLOW_SELECT_EMPLOYEES_INVALID_MODE",
            message: `O nó "${node.label}" ("Selecionar colaboradores") exige uma estrutura ou uma coleção como contexto — não pode vir depois de "Aplicar individualmente".`,
          })
        }
        // Ausente = "CONDITION" (backward compatibility — dado publicado antes da evolução de
        // Ranking nunca tem `selectionMode`, continua exigindo só `criterion`, como sempre).
        if ((node.config.selectionMode ?? "CONDITION") === "CONDITION" && !node.config.criterion) {
          issues.push({ nodeId: node.id, code: "WORKFLOW_SELECT_EMPLOYEES_MISSING_CRITERION", message: `O nó "${node.label}" ("Selecionar colaboradores") precisa de um critério de seleção configurado.` })
        }
        if (node.config.selectionMode === "RANKING" && !node.config.ranking) {
          issues.push({ nodeId: node.id, code: "WORKFLOW_SELECT_EMPLOYEES_MISSING_RANKING", message: `O nó "${node.label}" ("Selecionar colaboradores") precisa de uma configuração de ranking.` })
        }
        if (node.config.selectionMode === "RANKING" && node.config.ranking) {
          const ranking = node.config.ranking
          const source = ranking.source ?? "MEASUREMENT"
          if (source !== "PRV_ACHIEVEMENT" && !ranking.indicatorCode) {
            issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" precisa de um indicador.` })
          }
          if (!ranking.aggregation) {
            issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" precisa de uma agregação (Média, Mínimo ou Máximo).` })
          }
          if (!ranking.period) {
            issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" precisa de um período.` })
          }
          if (!ranking.selection) {
            issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" precisa de uma direção de seleção.` })
          }
          const basis = ranking.rankingBasis ?? "VALUE"
          if (ranking.selection) {
            const isChangeSelection = ranking.selection === "IMPROVED" || ranking.selection === "DECLINED"
            const isQuartileSelection = ranking.selection === "OPERATIONAL_QUARTILE"
            if (isQuartileSelection && source !== "MEASUREMENT") {
              issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" usa Quartil operacional, que só está disponível para Valor do indicador (medição operacional).` })
            }
            if (isQuartileSelection && ranking.period?.kind === "CLOSURES") {
              issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" usa Quartil operacional, que precisa de uma janela de período (dias, semana, mês) — não de Últimos N fechamentos.` })
            }
            if (isQuartileSelection && !ranking.operationalQuartile) {
              issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" precisa do quartil operacional a selecionar (Q1..Q4).` })
            }
            if (basis === "VALUE" && isChangeSelection) {
              issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" usa uma direção de seleção inválida para ranking por Valor — use Maiores, Menores, Melhores ou Piores.` })
            }
            if (basis === "CHANGE" && !isChangeSelection) {
              issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" usa uma direção de seleção inválida para ranking por Evolução — use Maiores evoluções ou Maiores quedas.` })
            }
          }
          // "Últimos N fechamentos" não tem período anterior equivalente resolvível corretamente
          // — nunca oferecido/aceito pra Evolução/Queda (mesma regra do backend).
          if (basis === "CHANGE" && ranking.period?.kind === "CLOSURES") {
            issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" usa Evolução/Queda, que não está disponível para "Últimos N fechamentos".` })
          }
          if (ranking.selection !== "OPERATIONAL_QUARTILE" && (!ranking.count || ranking.count <= 0)) {
            issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" precisa de uma quantidade maior que zero.` })
          }
          if (source !== "MEASUREMENT" && (ranking.aggregation === "WEIGHTED_AVERAGE" || ranking.aggregation === "SUM" || ranking.aggregation === "LATEST")) {
            issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" usa uma agregação operacional com uma fonte oficial — Atingimento/PRV só aceitam Média, Mínimo ou Máximo.` })
          }
          if (ranking.minimumCoverage !== undefined && source !== "MEASUREMENT") {
            issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_SELECTION_RANKING", message: `A configuração de ranking do nó "${node.label}" usa Cobertura mínima, que só está disponível para Valor do indicador (medição operacional).` })
          }
        }
      }
      if (node.type === "apply_individually" && context !== "EMPLOYEE_COLLECTION") {
        issues.push({
          nodeId: node.id,
          code: "WORKFLOW_APPLY_INDIVIDUALLY_INVALID_MODE",
          message: `O nó "${node.label}" ("Aplicar individualmente") exige uma coleção de colaboradores — adicione "Selecionar colaboradores" antes dele.`,
        })
      }
      // "Consolidar resultados" (fan-in/JOIN) exige a mesma entrada que Human Review/Orchestrator
      // individual exigem — EMPLOYEE — porque é onde cada execução FILHA do fan-out chega antes
      // de ser consolidada.
      if (node.type === "consolidate_results" && context !== "EMPLOYEE") {
        issues.push({
          nodeId: node.id,
          code: "WORKFLOW_CONSOLIDATE_RESULTS_INVALID_MODE",
          message: `O nó "${node.label}" ("Consolidar resultados") exige um colaborador individual como contexto de entrada — ele espera pelas execuções nascidas de "Aplicar individualmente".`,
        })
      }
    }

    issues.push(...validateFanOutConvergence(graph))
  } else {
    // "Selecionar colaboradores"/"Aplicar individualmente"/"Consolidar resultados" só existem dentro de uma Estrutura
    // Consolidada — nunca num Workflow Individual (Flag/Indicador/Agenda relativa ao expediente). Espelha o publish.
    for (const node of graph.nodes) {
      if (node.type !== "select_employees" && node.type !== "apply_individually" && node.type !== "consolidate_results") continue
      issues.push({ nodeId: node.id, code: "WORKFLOW_EMPLOYEE_COLLECTION_INVALID_MODE", message: `O nó "${node.label}" só é válido quando o Workflow analisa uma Estrutura Consolidada.` })
    }
  }

  // Critério de "Selecionar colaboradores": as MESMAS regras de negócio da Condition de dados (validateSelectionCriteria
  // no publish) — em qualquer modo, sempre que houver um critério.
  for (const node of graph.nodes) {
    if (node.type !== "select_employees" || !node.config.criterion) continue
    validateDataCondition(`O critério de seleção do nó "${node.label}"`, node.config.criterion, node.id, "WORKFLOW_INVALID_SELECTION_CRITERION", issues)
  }
}
