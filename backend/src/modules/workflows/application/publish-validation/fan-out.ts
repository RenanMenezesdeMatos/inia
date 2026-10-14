import { DomainError } from "../../../../shared/domain/domain-error.js"
import { findNode, resolveNodeContexts, type EmployeeRankingConfig, type FlowEdge, type FlowGraph, type FlowNode } from "../../domain/graph-schema.js"
import { outputTargetRole } from "../../domain/output-schema.js"
import { postgresHierarchyReader, requireStructureRecipient } from "../organizational-recipient.js"
import type { PublishGraphContext } from "./context.js"
import { validateDataConditionConfig } from "./conditions.js"

// Família FAN-OUT/JOIN (modo Consolidado): nós individual-only × contexto, nós de coleção, convergência, destinatários
// de gestão pela estrutura, critério e ranking de "Selecionar colaboradores". Espelho no editor: workflow-validation/fan-out.ts.

const VALUE_SELECTIONS = new Set(["HIGHEST", "LOWEST", "BEST", "WORST", "OPERATIONAL_QUARTILE"])

const CHANGE_SELECTIONS = new Set(["IMPROVED", "DECLINED"])

/**
 * Validação de forma/presença de "Selecionar colaboradores" em modo Ranking (evolução de Ranking,
 * Parte 58/91 do pedido original; Parte 69/76 desta evolução) — SÍNCRONA (só checa presença/
 * formato, nunca DB) porque essa parte não depende de consulta nenhuma; a checagem de direção
 * oficial (Melhores/Piores, Evolução/Queda) precisa de DB e fica no publish (async), logo abaixo.
 * `aggregation` não tem mais checagem de "combinação proibida" do que a Condition tem — COUNT já
 * nem é um valor possível no tipo (employeeRankingAggregationSchema exclui — zod já rejeita um
 * payload manual com "COUNT" antes de chegar aqui, ver PUT /draft, Parte 80 original).
 * `rankingBasis` ausente = "VALUE" (Parte 2/75 desta evolução — backward compatibility);
 * `partitionBy` ausente = "NONE" já é aceito pelo próprio schema (`.optional()`), nada a validar
 * aqui além do enum que o zod já garante.
 */
function validateEmployeeRankingConfig(subject: string, ranking: EmployeeRankingConfig, errorCode: string): void {
  const basis = ranking.rankingBasis ?? "VALUE"
  const source = ranking.source ?? "MEASUREMENT"
  if (source !== "PRV_ACHIEVEMENT" && !ranking.indicatorCode) {
    throw new DomainError(`${subject} precisa de um indicador.`, errorCode, 422)
  }
  if (!ranking.aggregation) {
    throw new DomainError(`${subject} precisa de uma agregação (Média, Mínimo ou Máximo).`, errorCode, 422)
  }
  if (!ranking.period) {
    throw new DomainError(`${subject} precisa de um período.`, errorCode, 422)
  }
  if (!ranking.selection) {
    throw new DomainError(`${subject} precisa de uma direção de seleção.`, errorCode, 422)
  }
  if (basis === "VALUE" && !VALUE_SELECTIONS.has(ranking.selection)) {
    throw new DomainError(`${subject} usa uma direção de seleção inválida para ranking por Valor — use Maiores, Menores, Melhores ou Piores.`, errorCode, 422)
  }
  if (basis === "CHANGE" && !CHANGE_SELECTIONS.has(ranking.selection)) {
    throw new DomainError(`${subject} usa uma direção de seleção inválida para ranking por Evolução — use Maiores evoluções ou Maiores quedas.`, errorCode, 422)
  }
  // "Últimos N fechamentos" não tem período anterior equivalente resolvível corretamente (Parte
  // 7 do pedido de Evolução/Queda) — nunca oferecido/aceito pra CHANGE.
  if (basis === "CHANGE" && ranking.period.kind === "CLOSURES") {
    throw new DomainError(`${subject} usa Evolução/Queda, que não está disponível para "Últimos N fechamentos" — escolha um período com comparação ao período anterior suportada.`, errorCode, 422)
  }
  if (ranking.selection === "OPERATIONAL_QUARTILE") {
    // Quartil operacional é calculado sobre MEDIÇÕES numa janela — nunca sobre fechamentos
    // oficiais (que já trazem o quartil oficial da fonte) e nunca sem o quartil-alvo.
    if (source !== "MEASUREMENT") {
      throw new DomainError(`${subject} usa Quartil operacional, que só está disponível para Valor do indicador (medição operacional) — para Atingimento/PRV use o quartil oficial do fechamento (Condition de performance).`, errorCode, 422)
    }
    if (ranking.period.kind === "CLOSURES") {
      throw new DomainError(`${subject} usa Quartil operacional, que precisa de uma janela de período (dias, semana, mês) — não de Últimos N fechamentos.`, errorCode, 422)
    }
    if (!ranking.operationalQuartile) {
      throw new DomainError(`${subject} precisa do quartil operacional a selecionar (Q1..Q4).`, errorCode, 422)
    }
    return
  }
  if (source !== "MEASUREMENT" && (ranking.aggregation === "WEIGHTED_AVERAGE" || ranking.aggregation === "SUM" || ranking.aggregation === "LATEST")) {
    throw new DomainError(`${subject} usa uma agregação operacional com uma fonte oficial — Atingimento/PRV só aceitam Média, Mínimo ou Máximo.`, errorCode, 422)
  }
  if (ranking.minimumCoverage !== undefined && source !== "MEASUREMENT") {
    throw new DomainError(`${subject} usa Cobertura mínima, que só está disponível para Valor do indicador (medição operacional).`, errorCode, 422)
  }
  if (!ranking.count || ranking.count <= 0) {
    throw new DomainError(`${subject} precisa de uma quantidade maior que zero.`, errorCode, 422)
  }
}

export type IndividualOnlyConflict = { nodeId: string; nodeLabel: string; code: string; message: string }

/**
 * "Matriz de compatibilidade" central: nós que só fazem sentido com um colaborador individual
 * como sujeito, nunca com uma Estrutura Consolidada inteira ou uma Coleção — reaproveitada tanto
 * ao trocar o Alvo da avaliação pra Consolidado (bloqueia ANTES da troca) quanto no publish
 * (bloqueia um rascunho manipulado direto, mesmo padrão de "backend nunca confia só no
 * frontend" já usado nesta rota).
 *
 * Contexto de cada node é inferido da posição no grafo via `resolveNodeContexts` (Parte 29/30 do
 * pedido de EMPLOYEE_COLLECTION) — nunca configurado à mão: `condition` com `performanceQuery`,
 * `output` com "O próprio operador", `human_review`, `orchestrator` e `action` de Chamar
 * agente/Escalonar (todos resolvem hoje via `resolveEnrollmentOperatorId`, um único operador,
 * NUNCA aceitam lista — ver auditoria em condition-evaluator.ts/orchestrator-executor.ts) só são
 * válidos quando o contexto de entrada é EMPLOYEE (depois de "Aplicar individualmente") — em
 * STRUCTURE/EMPLOYEE_COLLECTION continuam bloqueados, exatamente como sempre foram.
 * `SET_CONFIG_VALUE`/`SET_VARIABLE` nunca dependem de subject, sempre passam.
 *
 * `orchestrator` é a ÚNICA exceção que também aceita contexto CONSOLIDATED_RESULT (depois de
 * "Consolidar resultados" — fan-in/JOIN): é o único node que ganhou suporte explícito a sintetizar
 * um resultado consolidado de N colaboradores (Parte 8/9/23 do pedido de fan-in/JOIN), nunca a
 * pessoa-âncora fingindo representar todos (ver executeOrchestratorConsolidated,
 * orchestrator-executor.ts). Todos os outros nodes desta lista continuam EMPLOYEE-only — não foi
 * pedido suporte a Collection/resultado consolidado pra eles.
 */
export function findIndividualOnlyConflict(graph: FlowGraph): IndividualOnlyConflict | null {
  const contexts = resolveNodeContexts(graph)
  for (const node of graph.nodes) {
    const context = contexts.get(node.id) ?? "STRUCTURE"
    if (context === "EMPLOYEE") continue
    if (node.type === "orchestrator" && context === "CONSOLIDATED_RESULT") continue
    // "Chamar agente" depois de "Consolidar resultados" = Agent de síntese (evolução 2026-09-16):
    // aceito no grafo; SE o agente aceita o resultado consolidado é checado no banco (publish).
    if (node.type === "action" && node.config.actionType === "CALL_AGENT" && context === "CONSOLIDATED_RESULT") continue
    // Depois de "Consolidar resultados" o contexto é o RESULTADO CONSOLIDADO de N colaboradores —
    // mensagem própria (linguagem de negócio, nunca só o código técnico): o admin precisa saber
    // que não existe "operador atual" ali, não que "falta Aplicar individualmente".
    const afterJoin = context === "CONSOLIDATED_RESULT"
    if (node.type === "condition" && node.config.performanceQuery) {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_PERFORMANCE_QUERY_INVALID_MODE",
        message: afterJoin
          ? `A condição "${node.label}" usa Performance do colaborador depois de "Consolidar resultados" — ali não há um colaborador individual, só o resultado consolidado. Mova a condição para dentro do caminho individual ou compare um campo do resultado do Orquestrador.`
          : `O nó "${node.label}" usa Performance do colaborador, que não é uma Condition válida quando o Workflow analisa uma estrutura consolidada — troque para Histórico do indicador, adicione "Aplicar individualmente" antes deste nó, ou remova-o.`,
      }
    }
    // Quartil operacional é a posição de UM colaborador dentro da população — igual a Performance
    // do colaborador, só existe com um operador individual como sujeito (depois de "Aplicar
    // individualmente" no modo Consolidado; ou como critério de "Selecionar colaboradores").
    if (node.type === "condition" && node.config.historicalQuery?.source === "OPERATIONAL_QUARTILE") {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_OPERATIONAL_QUARTILE_INVALID_MODE",
        message: afterJoin
          ? `A condição "${node.label}" usa Quartil operacional depois de "Consolidar resultados" — ali não há um colaborador individual, só o resultado consolidado.`
          : `O nó "${node.label}" usa Quartil operacional, que classifica UM colaborador dentro da população — em um Workflow consolidado use-o como critério de "Selecionar colaboradores" ou adicione "Aplicar individualmente" antes deste nó.`,
      }
    }
    if (node.type === "output" && node.config.target.type === "CURRENT_OPERATOR") {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_OUTPUT_TARGET_INVALID_MODE",
        message: afterJoin
          ? `O Output "${node.label}" está em um fluxo consolidado (depois de "Consolidar resultados") e não possui um operador individual atual. Escolha um destinatário de gestão — Supervisor, Gerente, um cargo específico ou uma pessoa — ou mova o Output para antes de "Consolidar resultados" se ele é para cada operador.`
          : `O nó "${node.label}" usa "O próprio operador" como destinatário, que exige um colaborador individual como alvo — troque o destinatário, adicione "Aplicar individualmente" antes deste nó, ou remova-o.`,
      }
    }
    if (node.type === "human_review") {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_HUMAN_REVIEW_INVALID_MODE",
        message: afterJoin
          ? `A revisão humana "${node.label}" está depois de "Consolidar resultados" — não há um colaborador individual para revisar. Mova a revisão para o caminho individual (entre "Aplicar individualmente" e "Consolidar resultados").`
          : `Revisão humana exige um colaborador individual como contexto. Adicione "Aplicar individualmente" antes do nó "${node.label}".`,
      }
    }
    // Política de acompanhamento avalia UM colaborador (fatos, histórico, intervenções dele) — nunca uma estrutura.
    if (node.type === "intervention_policy") {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_INTERVENTION_POLICY_INVALID_MODE",
        message: afterJoin
          ? `O nó "${node.label}" avalia uma política de acompanhamento depois de "Consolidar resultados" — ali não há um colaborador individual. Mova o nó para o caminho individual.`
          : `O nó "${node.label}" avalia uma política de acompanhamento, que exige um colaborador individual como contexto. Adicione "Aplicar individualmente" antes deste nó.`,
      }
    }
    if (node.type === "orchestrator") {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_ORCHESTRATOR_INVALID_MODE",
        message: `O nó "${node.label}" usa o Orquestrador, que exige um colaborador individual como contexto. Adicione "Aplicar individualmente" antes deste nó.`,
      }
    }
    // V1.5.12: "Gerar feedback" (confiável) é o feedback de UM colaborador sobre UMA interação/medição — nunca de uma
    // estrutura, de uma coleção ou de um resultado consolidado.
    if (node.type === "action" && node.config.actionType === "GENERATE_FEEDBACK") {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_ACTION_INVALID_MODE",
        message: `O nó "${node.label}" gera feedback de um colaborador sobre uma interação ou medição — não existe nesse ponto de um Workflow consolidado.`,
      }
    }
    // V1.5.10: "Gerar feedback de atendimento" é o feedback de UMA interação de UM colaborador — nunca de uma estrutura,
    // de uma coleção ou de um resultado consolidado.
    if (node.type === "action" && node.config.actionType === "GENERATE_INTERACTION_FEEDBACK") {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_ACTION_INVALID_MODE",
        message: afterJoin
          ? `O nó "${node.label}" gera feedback de atendimento depois de "Consolidar resultados" — ali não há um colaborador individual nem uma interação. Mova o nó para o caminho individual (entre "Aplicar individualmente" e "Consolidar resultados").`
          : `O nó "${node.label}" gera feedback de atendimento, que exige um colaborador individual como contexto. Adicione "Aplicar individualmente" antes deste nó.`,
      }
    }
    if (node.type === "action" && (node.config.actionType === "CALL_AGENT" || node.config.actionType === "ESCALATE")) {
      const actionLabel = node.config.actionType === "CALL_AGENT" ? "Chamar agente" : "Escalonar"
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_ACTION_INVALID_MODE",
        message: afterJoin
          ? node.config.actionType === "CALL_AGENT"
            ? `O nó "${node.label}" chama um agente depois de "Consolidar resultados" — só um Agent de síntese roda aqui; para analisar cada pessoa, mova o nó para antes de "Consolidar resultados".`
            : `O nó "${node.label}" escalona depois de "Consolidar resultados" — não há um operador individual para escalonar. Use um Output com destinatário de gestão, ou mova o Escalonar para o caminho individual.`
          : `O nó "${node.label}" usa ${actionLabel}, que exige um colaborador individual como contexto. Adicione "Aplicar individualmente" antes deste nó.`,
      }
    }
  }
  return null
}

/**
 * Compatibilidade dos 2 nodes novos (Parte 30/41 do pedido) — "Selecionar colaboradores" precisa
 * de uma população (Estrutura ou uma coleção anterior, nunca um colaborador já individual);
 * "Aplicar individualmente" precisa exatamente de uma coleção (nunca a Estrutura direto, nunca
 * um colaborador já individual). Só roda em modo Consolidado (só ali esses nodes fazem sentido —
 * validado à parte, ver publish).
 */
export function findEmployeeCollectionConflict(graph: FlowGraph): IndividualOnlyConflict | null {
  const contexts = resolveNodeContexts(graph)
  for (const node of graph.nodes) {
    const context = contexts.get(node.id) ?? "STRUCTURE"
    if (node.type === "select_employees" && context === "EMPLOYEE") {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_SELECT_EMPLOYEES_INVALID_MODE",
        message: `O nó "${node.label}" ("Selecionar colaboradores") exige uma estrutura ou uma coleção como contexto — não pode vir depois de "Aplicar individualmente".`,
      }
    }
    if (node.type === "apply_individually" && context !== "EMPLOYEE_COLLECTION") {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_APPLY_INDIVIDUALLY_INVALID_MODE",
        message: `O nó "${node.label}" ("Aplicar individualmente") exige uma coleção de colaboradores — adicione "Selecionar colaboradores" antes dele.`,
      }
    }
    // Ausente = "CONDITION" (Parte 64 da evolução de Ranking) — dado publicado antes desta
    // evolução nunca tem `selectionMode`, continua exigindo só `criterion`, exatamente como antes.
    if (node.type === "select_employees" && (node.config.selectionMode ?? "CONDITION") === "CONDITION" && !node.config.criterion) {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_SELECT_EMPLOYEES_MISSING_CRITERION",
        message: `O nó "${node.label}" ("Selecionar colaboradores") precisa de um critério de seleção configurado.`,
      }
    }
    if (node.type === "select_employees" && node.config.selectionMode === "RANKING" && !node.config.ranking) {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_SELECT_EMPLOYEES_MISSING_RANKING",
        message: `O nó "${node.label}" ("Selecionar colaboradores") precisa de uma configuração de ranking.`,
      }
    }
    // "Consolidar resultados" (fan-in/JOIN) exige a mesma entrada que Human Review/Orchestrator
    // individual exigem — EMPLOYEE — porque é onde cada execução FILHA do fan-out chega antes de
    // ser consolidada (ver findPairedJoinNode/findPrecedingFanOutNode, graph-schema.ts).
    if (node.type === "consolidate_results" && context !== "EMPLOYEE") {
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        code: "WORKFLOW_CONSOLIDATE_RESULTS_INVALID_MODE",
        message: `O nó "${node.label}" ("Consolidar resultados") exige um colaborador individual como contexto de entrada — ele espera pelas execuções nascidas de "Aplicar individualmente".`,
      }
    }
  }
  return null
}

/**
 * Convergência do fan-out (fan-in/JOIN — Parte 32-37/78-83 do pedido): valida que a topologia
 * entre um "Aplicar individualmente" e um "Consolidar resultados" está bem formada, pra nunca
 * publicar um Workflow onde o fan-in ficaria esperando pra sempre (deadlock) ou pareado de forma
 * ambígua. Roda só em modo Consolidado, depois de `findEmployeeCollectionConflict` (que já garante
 * que os 2 nodes de EMPLOYEE_COLLECTION estão no contexto certo).
 */
export function validateFanOutConvergence(graph: FlowGraph): IndividualOnlyConflict | null {
  const outgoingBySource = new Map<string, FlowEdge[]>()
  for (const edge of graph.edges) {
    const list = outgoingBySource.get(edge.source) ?? []
    list.push(edge)
    outgoingBySource.set(edge.source, list)
  }

  // Pareamento: pra cada "Consolidar resultados", quem é o "Aplicar individualmente" de origem —
  // ausente = sem origem (bloqueia); mais de um Apply alcançando o mesmo Join = ambíguo (bloqueia).
  const joinNodes = graph.nodes.filter((node): node is Extract<FlowNode, { type: "consolidate_results" }> => node.type === "consolidate_results")
  const applyToJoins = new Map<string, Set<string>>()
  for (const joinNode of joinNodes) {
    const origins = findAllFanOutOrigins(graph, joinNode.id)
    if (origins.size === 0) {
      return {
        nodeId: joinNode.id,
        nodeLabel: joinNode.label,
        code: "WORKFLOW_CONSOLIDATE_RESULTS_MISSING_ORIGIN",
        message: `"${joinNode.label}" ("Consolidar resultados") precisa estar associado a um "Aplicar individualmente".`,
      }
    }
    if (origins.size > 1) {
      return {
        nodeId: joinNode.id,
        nodeLabel: joinNode.label,
        code: "WORKFLOW_CONSOLIDATE_RESULTS_AMBIGUOUS_ORIGIN",
        message: `"${joinNode.label}" ("Consolidar resultados") é alcançado por mais de um "Aplicar individualmente" diferente — a origem ficou ambígua.`,
      }
    }
    const applyId = [...origins][0]!
    const set = applyToJoins.get(applyId) ?? new Set<string>()
    set.add(joinNode.id)
    applyToJoins.set(applyId, set)
  }

  // No máximo um Join por Apply (Parte 37/82).
  for (const [applyId, joins] of applyToJoins) {
    if (joins.size > 1) {
      const applyNode = findNode(graph, applyId)
      return {
        nodeId: applyId,
        nodeLabel: applyNode?.label ?? applyId,
        code: "WORKFLOW_APPLY_INDIVIDUALLY_MULTIPLE_JOINS",
        message: `"${applyNode?.label ?? applyId}" ("Aplicar individualmente") alcança mais de um "Consolidar resultados" diferente — só um Join é permitido por fan-out.`,
      }
    }
  }

  // Convergência: todo caminho a partir de um Apply pareado precisa chegar ao SEU Join antes de
  // qualquer node terminal (`end`, ou qualquer node sem saída) — nunca "escapar" sem consolidar
  // (Parte 33/34/78), deixando o fan-in esperando pra sempre. Branches (Condition true/false)
  // convergindo no mesmo Join são válidos (Parte 32/79).
  for (const applyNode of graph.nodes) {
    if (applyNode.type !== "apply_individually") continue
    // Por aqui, qualquer entrada remanescente já tem no máximo 1 Join (size > 1 já teria
    // retornado erro no loop acima) — `undefined` = sem Join pareado, comportamento legado
    // intacto (Parte 35/36), sempre válido.
    const pairedJoinId = [...(applyToJoins.get(applyNode.id) ?? [])][0]
    if (!pairedJoinId) continue
    const edge = outgoingBySource.get(applyNode.id)?.[0]
    if (!edge) continue
    const visited = new Set<string>([applyNode.id])
    let frontier = [edge.target]
    while (frontier.length > 0) {
      const next: string[] = []
      for (const nodeId of frontier) {
        if (visited.has(nodeId)) continue
        visited.add(nodeId)
        if (nodeId === pairedJoinId) continue // convergiu — não expande além do Join
        const outgoing = outgoingBySource.get(nodeId) ?? []
        if (outgoing.length === 0) {
          return {
            nodeId: applyNode.id,
            nodeLabel: applyNode.label,
            code: "WORKFLOW_FAN_OUT_PATH_ESCAPES_JOIN",
            message: `Nem todos os caminhos individuais de "${applyNode.label}" ("Aplicar individualmente") chegam ao mesmo "Consolidar resultados" — algum caminho termina antes de consolidar.`,
          }
        }
        for (const out of outgoing) next.push(out.target)
      }
      frontier = next
    }
  }
  return null
}

/** Todo "Aplicar individualmente" alcançado andando pra trás a partir de um "Consolidar
 * resultados" — mesmo padrão de `findPrecedingFanOutNode` (graph-schema.ts), mas coletando TODOS
 * os encontrados (não só o mais próximo) pra detectar origem ambígua, e parando (não atravessando)
 * qualquer OUTRO "consolidate_results" no caminho (fan-outs sequenciais nunca se misturam). */
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

/** Lança `DomainError` (422, com `details.nodeId`) pra um conflito da matriz de contexto/fan-out —
 * mesmo formato de erro em todos os pontos que checam a matriz (analysis-config e publish). */
export function throwConflict(conflict: IndividualOnlyConflict): never {
  throw new DomainError(conflict.message, conflict.code, 422, { nodeId: conflict.nodeId })
}

/** Modo Consolidado: matriz de contexto, nós de coleção, convergência e destinatários de gestão pela estrutura; no modo Individual, nenhum nó de coleção. */
export async function validateConsolidatedStructure(context: PublishGraphContext): Promise<void> {
  const { db, row, options, graph } = context
  // Performance do colaborador (Condition), "O próprio operador" (Output), Revisão humana,
  // Orquestrador e Ação de Chamar agente/Escalonar são individual-only — não têm definição
  // segura pra uma estrutura agregada ou uma coleção, nunca inventada (ver node-handlers.ts/
  // orchestrator-executor.ts) — só válidos depois de "Aplicar individualmente" (contexto
  // EMPLOYEE). O frontend já não oferece essas opções fora desse contexto, mas o backend
  // valida de novo, mesmo pra um payload de rascunho manipulado direto.
  if (row.consolidatedStructure) {
    const conflict = findIndividualOnlyConflict(graph) ?? findEmployeeCollectionConflict(graph) ?? validateFanOutConvergence(graph)
    if (conflict) throwConflict(conflict)
    // Destinatário de gestão FORA do caminho individual (contexto STRUCTURE ou CONSOLIDATED_RESULT)
    // precisa resolver pra EXATAMENTE uma pessoa com a estrutura configurada hoje — Grupo com 2
    // Gerentes e Output "Gerente" não publica (WORKFLOW_OUTPUT_RECIPIENT_AMBIGUOUS); estrutura sem
    // ninguém no cargo também não (…_NOT_FOUND). O runtime resolve DE NOVO na hora de entregar
    // (a hierarquia pode mudar depois da publicação) — ver output-executor.ts.
    const hierarchy = options.hierarchy ?? postgresHierarchyReader(db)
    const contexts = resolveNodeContexts(graph)
    for (const node of graph.nodes) {
      if (node.type !== "output") continue
      if ((contexts.get(node.id) ?? "STRUCTURE") === "EMPLOYEE") continue
      const role = outputTargetRole(node.config.target)
      if (!role) continue
      await requireStructureRecipient(hierarchy, row.consolidatedStructure, role, node.id)
    }
  } else {
    // "Selecionar colaboradores"/"Aplicar individualmente"/"Consolidar resultados"
    // (EMPLOYEE_COLLECTION + fan-in/JOIN) só existem dentro de uma Estrutura Consolidada — nunca
    // um Workflow Individual (Flag/Indicador/Agenda relativa ao expediente).
    const collectionNode = graph.nodes.find((node) => node.type === "select_employees" || node.type === "apply_individually" || node.type === "consolidate_results")
    if (collectionNode) {
      throw new DomainError(
        `O nó "${collectionNode.label}" só é válido quando o Workflow analisa uma Estrutura Consolidada.`,
        "WORKFLOW_EMPLOYEE_COLLECTION_INVALID_MODE",
        422,
      )
    }
  }
}

/** Critério de "Selecionar colaboradores": as mesmas regras de negócio da Condition de dados. */
export function validateSelectionCriteria(context: PublishGraphContext): void {
  const { graph } = context
  // "Selecionar colaboradores" (EMPLOYEE_COLLECTION) — critério validado pela MESMA função de
  // negócio de uma Condition (validateDataConditionConfig acima), nunca uma 2ª implementação.
  // Ausência de criterion já é bloqueada por findEmployeeCollectionConflict (chamado antes
  // desta função) com WORKFLOW_SELECT_EMPLOYEES_MISSING_CRITERION — aqui só valida o CONTEÚDO
  // de um criterion já presente. Antes desta rodada, um criterion semanticamente quebrado (ex.:
  // PRV_ACHIEVEMENT + Quantidade de ocorrências) publicava sem erro e só falhava depois, em
  // runtime (condition-evaluator.ts) — bug de hardening corrigido aqui.
  for (const node of graph.nodes) {
    if (node.type !== "select_employees" || !node.config.criterion) continue
    validateDataConditionConfig(`O critério de seleção do nó "${node.label}"`, node.config.criterion, "WORKFLOW_INVALID_SELECTION_CRITERION")
  }
}

/** Ranking de "Selecionar colaboradores": forma e direção oficial do indicador. */
export async function validateRankings(context: PublishGraphContext): Promise<void> {
  const { db, organizationId, graph } = context
  for (const node of graph.nodes) {
    if (node.type !== "select_employees" || node.config.selectionMode !== "RANKING" || !node.config.ranking) continue
    const ranking = node.config.ranking
    validateEmployeeRankingConfig(`A configuração de ranking do nó "${node.label}"`, ranking, "WORKFLOW_INVALID_SELECTION_RANKING")
    const basis = ranking.rankingBasis ?? "VALUE"
    const needsDirection = basis === "CHANGE" || ranking.selection === "BEST" || ranking.selection === "WORST" || ranking.selection === "OPERATIONAL_QUARTILE"
    if (needsDirection && (ranking.source ?? "MEASUREMENT") === "MEASUREMENT") {
      const indicator = await db.query<{ desired_direction: string }>(`select desired_direction from indicator_definitions where code = $1 and organization_id = $2`, [
        ranking.indicatorCode,
        organizationId,
      ])
      if (!indicator.rows[0]) throw new DomainError(`Indicador "${ranking.indicatorCode}" não encontrado.`, "INDICATOR_NOT_FOUND", 404)
      if (indicator.rows[0].desired_direction === "TARGET") {
        throw new DomainError(
          basis === "CHANGE"
            ? `O nó "${node.label}" usa Evolução/Queda para um indicador sem direção de desempenho oficial definida (meta por faixa/alvo — "TARGET"). Evolução e queda exigem uma direção HIGHER ou LOWER.`
            : ranking.selection === "OPERATIONAL_QUARTILE"
              ? `O nó "${node.label}" usa Quartil operacional para um indicador sem direção de desempenho oficial definida (meta por faixa/alvo — "TARGET"). Sem direção HIGHER/LOWER não há regra de classificação em quartis.`
              : `O nó "${node.label}" usa "Melhores"/"Piores" para um indicador sem direção de desempenho oficial definida (meta por faixa/alvo) — use "Maiores valores"/"Menores valores" em vez disso.`,
          "WORKFLOW_SELECTION_RANKING_DIRECTION_UNAVAILABLE",
          422,
        )
      }
    }
  }
}
