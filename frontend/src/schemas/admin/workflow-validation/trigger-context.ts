import { nodeBranches, resolveNodeContexts } from "../workflow-graph.schema"
import { triggerDataOrigin } from "../workflow.schema"
import type { ValidationContext } from "./types"

// Família GATILHO E CONTEXTO: forma do grafo, gatilhos Agenda/Manual e o que a origem de dados de cada gatilho permite
// (fonte de dados do "Chamar agente", transcrição, interação do gatilho). Espelho do backend: workflows/application/publish-validation/trigger-context.ts.

/** Exatamente um nó Gatilho e ao menos um nó Fim. */
export function validateGraphShape(context: ValidationContext): void {
  const { graph, triggerNodes, issues } = context
  if (triggerNodes.length !== 1) {
    issues.push({ nodeId: triggerNodes[0]?.id ?? "", code: "WORKFLOW_INVALID_GRAPH", message: "O workflow precisa ter exatamente um nó Gatilho." })
  }
  if (!graph.nodes.some((node) => node.type === "end")) {
    issues.push({ nodeId: "", code: "WORKFLOW_INVALID_GRAPH", message: "O workflow precisa ter ao menos um nó Fim." })
  }
}

/**
 * Toda saída de um nó alcançável a partir do Gatilho precisa estar ligada — no motor, saída sem aresta encerra a execução como falha.
 * Nó solto no canvas não é cobrado. Espelho de `validateBranchEdges` (backend): só com a forma do grafo válida, por último.
 */
export function validateBranchEdges(context: ValidationContext): void {
  const { graph, triggerNodes, issues } = context
  if (triggerNodes.length !== 1 || !graph.nodes.some((node) => node.type === "end")) return
  const reachable = new Set<string>()
  const pending = triggerNodes.map((node) => node.id)
  while (pending.length > 0) {
    const id = pending.pop()!
    if (reachable.has(id)) continue
    reachable.add(id)
    for (const edge of graph.edges) if (edge.source === id) pending.push(edge.target)
  }
  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) continue
    for (const branch of nodeBranches(node)) {
      if (graph.edges.some((edge) => edge.source === node.id && edge.sourceHandle === branch.id)) continue
      issues.push({ nodeId: node.id, code: "WORKFLOW_MISSING_BRANCH_EDGE", message: `Ligue a saída "${branch.label}" de "${node.label}" ao próximo passo (ou a um nó Fim).` })
    }
  }
}

/** Gatilho por Agenda (calendário ou relativo ao expediente). */
export function validateScheduleTrigger(context: ValidationContext): void {
  const { trigger, triggerNodes, issues } = context
  // Trigger "Por agenda" (evolução da Agenda, calendário e relativo ao expediente) — espelha
  // `validateScheduleTrigger` do publish no backend. A maioria dos casos ("diário sem horário",
  // "semanal sem dia") já é bloqueada pelo próprio formulário (isTriggerComplete,
  // trigger-fields.tsx) antes de chegar aqui.
  if (trigger.kind === "schedule") {
    const triggerNodeId = triggerNodes[0]?.id ?? ""
    if (trigger.mode === "RELATIVE_TO_SHIFT") {
      const relative = trigger.relative
      if (!relative) {
        issues.push({ nodeId: triggerNodeId, code: "WORKFLOW_INVALID_TRIGGER", message: "Escolha o momento do expediente." })
      } else if ((relative.anchor === "START" || relative.anchor === "END") && relative.offsetMinutes === undefined) {
        issues.push({
          nodeId: triggerNodeId,
          code: "WORKFLOW_INVALID_TRIGGER",
          message: relative.anchor === "START" ? "Defina quantos minutos após o início." : "Defina quantos minutos antes do fim.",
        })
      } else if (relative.anchor === "PERCENTAGE" && relative.percentage === undefined) {
        issues.push({ nodeId: triggerNodeId, code: "WORKFLOW_INVALID_TRIGGER", message: "Defina o percentual da jornada." })
      }
    } else {
      const times = trigger.times ?? []
      if (times.length === 0) {
        issues.push({ nodeId: triggerNodeId, code: "WORKFLOW_INVALID_TRIGGER", message: "Adicione pelo menos um horário." })
      } else if (new Set(times).size !== times.length) {
        issues.push({ nodeId: triggerNodeId, code: "WORKFLOW_INVALID_TRIGGER", message: "Horários repetidos não são permitidos." })
      }
      if (trigger.frequency?.type === "MONTHLY" && trigger.frequency.mode === "DAY_OF_MONTH" && trigger.frequency.day === undefined) {
        issues.push({ nodeId: triggerNodeId, code: "WORKFLOW_INVALID_TRIGGER", message: "Escolha o dia do mês." })
      }
    }
  }
}

/** Gatilho Manual: nunca Consolidado; com medição, o indicador escolhido. */
export function validateManualTrigger(context: ValidationContext): void {
  const { trigger, isConsolidatedMode, triggerNodes, issues } = context
  // Manual: um colaborador escolhido por disparo — nunca Consolidado; com medição, o indicador é obrigatório (espelha o publish).
  if (trigger.kind === "manual") {
    const triggerNodeId = triggerNodes[0]?.id ?? ""
    if (isConsolidatedMode) issues.push({ nodeId: triggerNodeId, code: "WORKFLOW_MANUAL_TRIGGER_CONSOLIDATED", message: "O gatilho Manual executa para um colaborador escolhido a cada disparo — troque o Alvo da avaliação para Individual." })
    if (trigger.context === "INDICATOR_MEASUREMENT" && !trigger.indicatorCode) issues.push({ nodeId: triggerNodeId, code: "WORKFLOW_INVALID_TRIGGER", message: "Escolha o indicador cuja medição será selecionada a cada execução manual." })
  }
}

/** Estrutura Consolidada só com Agenda de calendário (o Manual tem a regra própria, acima) — espelha `validateDraftConfigurationModes`. */
export function validateConsolidatedTrigger(context: ValidationContext): void {
  const { trigger, isConsolidatedMode, triggerNodes, issues } = context
  if (!isConsolidatedMode || trigger.kind === "manual") return
  if (trigger.kind === "schedule" && trigger.mode !== "RELATIVE_TO_SHIFT") return
  issues.push({
    nodeId: triggerNodes[0]?.id ?? "",
    code: "WORKFLOW_CONSOLIDATED_MODE_INVALID_TRIGGER",
    message: "A Estrutura Consolidada só é válida para Agenda de calendário — troque o Alvo da avaliação para Individual.",
  })
}

/** Agenda e Manual por colaborador não trazem interação nem medição: o "Chamar agente" define a fonte de dados. */
export function validateScheduleDataSources(context: ValidationContext): void {
  const { graph, trigger, isConsolidatedMode, issues } = context
  if (triggerDataOrigin(trigger) === "schedule") {
    // Achado real (auditoria de Escopo Administrativo/Unidade de Análise): esta regra rejeitava
    // TODO Condition node com gatilho por agenda — verdade quando escrita (visual builder recém
    // criado, Agenda sem nenhum jeito de fornecer Condition ainda), mas a evolução do Trigger
    // Por agenda (histórico, performance, grupo, sourcePath, contexto de jornada em
    // nodeOutputs.trigger) já suporta Condition plenamente há várias tarefas — o backend nunca
    // teve essa restrição. Ficou travando o botão Publicar de workflows reais (calendário e
    // relativo ao expediente) que já funcionam de ponta a ponta. Mantém só a checagem que
    // continua real: Ação "Chamar agente" precisa da fonte de dados quando o gatilho é agenda.
    const scheduleContexts = isConsolidatedMode ? resolveNodeContexts(graph) : null
    for (const node of graph.nodes) {
      // O Agent de síntese pós-JOIN não lê fonte própria: recebe o resultado consolidado (espelha o publish).
      if (scheduleContexts?.get(node.id) === "CONSOLIDATED_RESULT") continue
      if (node.type === "action" && node.config.actionType === "CALL_AGENT" && !node.config.scheduledDataSource) {
        issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_ACTION", message: trigger.kind === "manual" ? "Defina a fonte de dados desta ação — o gatilho Manual por colaborador não traz interação nem medição." : "Defina a fonte de dados desta ação — o gatilho é por agenda." })
      }
    }
  }
}

/** "Interação que disparou o Workflow" só existe com Flag (ou Manual com interação) no modo Individual. */
export function validateInteractionFeedbackSource(context: ValidationContext): void {
  const { graph, trigger, isConsolidatedMode, issues } = context
  // V1.5.10 — "Interação que disparou o Workflow" só existe com gatilho por Flag no modo Individual (espelha o publish:
  // WORKFLOW_INTERACTION_FEEDBACK_NO_INTERACTION). Módulo desligado é checado pelo dry-run do backend.
  for (const node of graph.nodes) {
    if (node.type !== "action" || node.config.actionType !== "GENERATE_INTERACTION_FEEDBACK") continue
    if (node.config.interactionSource.kind === "TRIGGER_INTERACTION" && (triggerDataOrigin(trigger) !== "channel_flag" || isConsolidatedMode)) {
      issues.push({ nodeId: node.id, code: "WORKFLOW_INTERACTION_FEEDBACK_NO_INTERACTION", message: `"Interação que disparou o Workflow" só existe com gatilho por Flag de canal (ou Manual com interação) no modo Individual. Troque a origem para "Interações do colaborador no período" ou use um desses gatilhos.` })
    }
  }
}

/** Conformidade e Avaliação de processo exigem a transcrição: Flag ou Manual com interação. */
export function validateTranscriptRequirements(context: ValidationContext): void {
  const { graph, trigger, issues } = context
  // Conformidade de processo compara procedimento oficial × transcrição — só existe transcrição
  // com gatilho por Flag de canal (mesma regra do backend, workflow-router.ts).
  if (triggerDataOrigin(trigger) !== "channel_flag") {
    for (const node of graph.nodes) {
      if (node.type === "action" && node.config.actionType === "CALL_AGENT" && node.config.outputContract === "PROCESS_AUDIT") {
        issues.push({ nodeId: node.id, code: "WORKFLOW_PROCESS_AUDIT_REQUIRES_FLAG", message: "\"Conformidade de processo\" exige uma transcrição de chamada — só disponível com gatilho por Flag de canal ou Manual com interação." })
      }
      if ((node.type === "action" && node.config.actionType === "CALL_AGENT" && node.config.outputContract === "PROCESS_ASSESSMENT") || (node.type === "orchestrator" && node.config.specialistOutputContract === "PROCESS_ASSESSMENT")) {
        issues.push({ nodeId: node.id, code: "WORKFLOW_PROCESS_ASSESSMENT_REQUIRES_FLAG", message: "\"Avaliação de processo\" exige uma transcrição de chamada — só disponível com gatilho por Flag de canal ou Manual com interação." })
      }
    }
  }
}
