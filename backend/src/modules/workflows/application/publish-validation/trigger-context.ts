import { interactionFeedbackModuleEnabled } from "../../../interaction-feedback/application/pipeline-wiring.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { resolveNodeContexts } from "../../domain/graph-schema.js"
import type { TriggerConfig } from "../../domain/trigger-config-schema.js"
import type { PublishGraphContext, PublishTriggerContext } from "./context.js"

// Família GATILHO E CONTEXTO: forma do grafo, gatilhos Agenda/Manual e o que a origem de dados de cada gatilho permite
// (fonte de dados do "Chamar agente", transcrição, interação do gatilho). Espelho no editor: workflow-validation/trigger-context.ts.

/**
 * Checagens semânticas do Trigger "Por agenda" que o schema não cobre (a maioria dos casos —
 * "diário sem horário", "semanal sem dia" — já é bloqueada pelos `.min(1)` do schema antes de
 * chegar aqui; o frontend nunca deixa o formulário chegar nesse estado, mesmo padrão de
 * `isTriggerComplete`). Mensagem sempre amigável, nunca erro técnico de schema (Parte 28).
 */
export function validateScheduleTrigger(trigger: TriggerConfig): void {
  if (trigger.kind !== "schedule") return

  if (trigger.mode === "RELATIVE_TO_SHIFT") {
    const relative = trigger.relative
    if (!relative) {
      throw new DomainError("Escolha o momento do expediente.", "WORKFLOW_INVALID_TRIGGER", 422)
    }
    if ((relative.anchor === "START" || relative.anchor === "END") && relative.offsetMinutes === undefined) {
      throw new DomainError(
        relative.anchor === "START" ? "Defina quantos minutos após o início." : "Defina quantos minutos antes do fim.",
        "WORKFLOW_INVALID_TRIGGER",
        422,
      )
    }
    if (relative.anchor === "PERCENTAGE" && relative.percentage === undefined) {
      throw new DomainError("Defina o percentual da jornada.", "WORKFLOW_INVALID_TRIGGER", 422)
    }
    return
  }

  // CALENDAR (explícito ou ausente = legado).
  if (!trigger.times || trigger.times.length === 0) {
    throw new DomainError("Adicione pelo menos um horário.", "WORKFLOW_INVALID_TRIGGER", 422)
  }
  if (new Set(trigger.times).size !== trigger.times.length) {
    throw new DomainError("Horários repetidos não são permitidos.", "WORKFLOW_INVALID_TRIGGER", 422)
  }
  if (trigger.frequency?.type === "MONTHLY" && trigger.frequency.mode === "DAY_OF_MONTH" && trigger.frequency.day === undefined) {
    throw new DomainError("Escolha o dia do mês.", "WORKFLOW_INVALID_TRIGGER", 422)
  }
}

/**
 * Checagens semânticas do gatilho Manual que o schema não cobre: o contexto "Medição de indicador" precisa dizer DE QUAL
 * indicador (é ele que os nós de diagnóstico/Condition e a seleção da medição no disparo usam). Os outros contextos não
 * guardam indicador.
 */
export function validateManualTrigger(trigger: TriggerConfig): void {
  if (trigger.kind !== "manual") return
  if (trigger.context === "INDICATOR_MEASUREMENT" && !trigger.indicatorCode) {
    throw new DomainError("Escolha o indicador cuja medição será selecionada a cada execução manual.", "WORKFLOW_INVALID_TRIGGER", 422)
  }
}

/** O Manual não guarda indicador fora do contexto "Medição de indicador" (nada de configuração morta no gatilho). */
export function normalizeManualTrigger(trigger: TriggerConfig): TriggerConfig {
  if (trigger.kind !== "manual" || trigger.context === "INDICATOR_MEASUREMENT") return trigger
  return { kind: "manual", context: trigger.context }
}

/** Exatamente um nó Gatilho e ao menos um nó Fim. */
export function validateGraphShape(context: PublishGraphContext): void {
  const { graph, triggerNodes } = context
  if (triggerNodes.length !== 1) {
    throw new DomainError("O workflow precisa ter exatamente um nó Gatilho.", "WORKFLOW_INVALID_GRAPH", 422)
  }
  if (!graph.nodes.some((node) => node.type === "end")) {
    throw new DomainError("O workflow precisa ter ao menos um nó Fim.", "WORKFLOW_INVALID_GRAPH", 422)
  }
}

/** Gatilho Manual: indicador quando é por medição; nunca Consolidado. */
export function validateManualTriggerMode(context: PublishGraphContext): void {
  const { row } = context
  // Gatilho Manual: um colaborador escolhido por disparo — nunca uma Estrutura Consolidada (que seria "todo mundo").
  validateManualTrigger(row.triggerConfig)
  if (row.triggerConfig.kind === "manual" && row.consolidatedStructure) {
    throw new DomainError(
      "O gatilho Manual executa para UM colaborador escolhido a cada disparo — troque o Alvo da avaliação para Individual.",
      "WORKFLOW_MANUAL_TRIGGER_CONSOLIDATED",
      422,
    )
  }
}

/** "Gerar feedback de atendimento": módulo ligado e interação garantida pelo gatilho. */
export function validateInteractionFeedbackSource(context: PublishTriggerContext): void {
  const { row, graph, origin } = context
  // V1.5.10 — "Gerar feedback de atendimento": o módulo precisa estar ligado NESTE ambiente (a mesma flag que monta as rotas
  // de QA/entrega) e o caminho até o nó precisa GARANTIR uma interação válida — nunca descobrir isso só em runtime.
  // Colaborador/organização/contexto individual já são garantidos pela matriz de contexto acima (modo Consolidado) e pelas
  // três origens de matrícula do modo Individual (Flag/Indicador/Agenda sempre carregam um colaborador).
  for (const node of graph.nodes) {
    if (node.type !== "action" || node.config.actionType !== "GENERATE_INTERACTION_FEEDBACK") continue
    if (!interactionFeedbackModuleEnabled()) {
      throw new DomainError(
        `O nó "${node.label}" gera feedback de atendimento, mas esse módulo está desligado neste ambiente. Remova o nó ou habilite o módulo antes de publicar.`,
        "WORKFLOW_INTERACTION_FEEDBACK_DISABLED",
        422,
        { nodeId: node.id },
      )
    }
    if (node.config.interactionSource.kind === "TRIGGER_INTERACTION" && (origin !== "channel_flag" || row.consolidatedStructure)) {
      throw new DomainError(
        `O nó "${node.label}" usa "Interação que disparou o Workflow", que só existe com gatilho por Flag de canal (ou Manual com interação) no modo Individual. Troque a origem para "Interações do colaborador no período" ou use um desses gatilhos.`,
        "WORKFLOW_INTERACTION_FEEDBACK_NO_INTERACTION",
        422,
        { nodeId: node.id },
      )
    }
  }
}

/** Conformidade e Avaliação de processo exigem a transcrição: Flag ou Manual com interação. */
export function validateTranscriptRequirements(context: PublishTriggerContext): void {
  const { graph, origin } = context
  // Conformidade de processo (PROCESS_AUDIT) compara procedimento oficial × transcrição — só
  // existe transcrição quando a execução carrega uma interação: Flag de canal ou Manual com interação (ver run-agent.ts).
  if (origin !== "channel_flag") {
    const auditNode = graph.nodes.find((node) => node.type === "action" && node.config.actionType === "CALL_AGENT" && node.config.outputContract === "PROCESS_AUDIT")
    if (auditNode) {
      throw new DomainError(
        `O nó "${auditNode.label}" usa o formato "Conformidade de processo", que exige uma transcrição de chamada — só disponível com gatilho por Flag de canal ou Manual com interação.`,
        "WORKFLOW_PROCESS_AUDIT_REQUIRES_FLAG",
        422,
      )
    }
    // V1.6.0 — avaliação de processo também compara transcrição × base: só com Flag.
    const assessmentNode = graph.nodes.find((node) =>
      (node.type === "action" && node.config.actionType === "CALL_AGENT" && node.config.outputContract === "PROCESS_ASSESSMENT") ||
      (node.type === "orchestrator" && node.config.specialistOutputContract === "PROCESS_ASSESSMENT"))
    if (assessmentNode) {
      throw new DomainError(
        `O nó "${assessmentNode.label}" usa o formato "Avaliação de processo", que exige uma transcrição de chamada — só disponível com gatilho por Flag de canal ou Manual com interação.`,
        "WORKFLOW_PROCESS_ASSESSMENT_REQUIRES_FLAG",
        422,
      )
    }
  }
}

/** Agenda e Manual por colaborador não trazem interação nem medição: o "Chamar agente" define a fonte de dados. */
export async function validateScheduleDataSources(context: PublishTriggerContext): Promise<void> {
  const { db, organizationId, graph, trigger, origin } = context
  if (origin === "schedule") {
    const scheduleContexts = resolveNodeContexts(graph)
    for (const node of graph.nodes) {
      if (node.type !== "action" || node.config.actionType !== "CALL_AGENT") continue
      // O Agent de síntese pós-JOIN não lê fonte de dados própria: recebe o resultado consolidado.
      if (scheduleContexts.get(node.id) === "CONSOLIDATED_RESULT") continue
      const source = node.config.scheduledDataSource
      if (!source) {
        throw new DomainError(
          trigger.kind === "manual"
            ? `O nó de ação "${node.label}" precisa definir a fonte de dados (indicador ou monitoria): o gatilho Manual por colaborador não traz interação nem medição.`
            : `O nó de ação "${node.label}" precisa definir a fonte de dados (indicador ou monitoria) pois o gatilho é por agenda.`,
          "WORKFLOW_INVALID_ACTION",
          422,
        )
      }
      if (source.kind === "INDICATOR" && source.indicatorCode) {
        const indicator = await db.query(`select id from indicator_definitions where code = $1 and organization_id = $2`, [
          source.indicatorCode,
          organizationId,
        ])
        if (!indicator.rows[0]) throw new DomainError(`Indicador "${source.indicatorCode}" não encontrado.`, "INDICATOR_NOT_FOUND", 404)
      }
    }
  }
}
