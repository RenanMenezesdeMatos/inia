import type { Database } from "../../../infrastructure/database/pool.js"
import { createIndicatorFeedback } from "../../feedbacks/application/create-indicator-feedback.js"
import { createMonitoringFeedback } from "../../feedbacks/application/create-monitoring-feedback.js"
import { createOrchestratorFeedback } from "../../feedbacks/application/create-orchestrator-feedback.js"
import { AGENT_LLM_MODEL } from "../../agents/infrastructure/gemini-agent-client.js"
import type { AvatarInteractionMode } from "../domain/output-schema.js"
import { dispatchAlert, type AlertInput } from "./dispatch-alert.js"
import type { ToolInvocationTrace } from "../../investigation/domain/tool-trace.js"
import { productionInteractionFeedbackEffects, type InteractionFeedbackEffects } from "../../interaction-feedback/application/workflow-interaction-feedback-effects.js"
import { productionReliableFeedbackEffects, type ReliableFeedbackEffects } from "../../reliable-feedback/application/reliable-feedback-wiring.js"
import { productionConversationalEffects, type ConversationalEffects } from "../../conversational-delivery/application/conversational-effects.js"
import { productionFeedbackEngineEffects, type FeedbackEngineEffects } from "../../feedback-engine/application/engine-wiring.js"
import { productionInterventionEffects, type InterventionEffects } from "../../interventions/application/workflow-intervention-effects.js"

/**
 * Boundary de side effects do motor de workflow — o ÚNICO lugar por onde um node consegue
 * produzir efeito fora do Execution Context. Os executores (Output, Escalonar, Human Review,
 * Actions, Agent) nunca inserem em `alerts`/`workflow_outputs`/`feedbacks`/`agent_runs`/
 * `org_config_values` diretamente: chamam `context.effects.*`, e é o sink escolhido por quem
 * montou o ProcessContext que decide o que isso significa.
 *
 * - `productionEffects` (abaixo): exatamente as gravações de sempre, só movidas pra trás desta
 *   interface — nenhuma mudança de comportamento em produção.
 * - `SimulationEffectSink` (qa-lab/application/simulation-effect-sink.ts): não grava nada,
 *   registra "o que teria acontecido" no trace do QA Run e devolve ids sintéticos.
 *
 * O objetivo é justamente NÃO espalhar `if (simulation)` pelos executores: a diferença entre
 * PRODUCTION e QA_SIMULATION mora num único ponto de composição.
 */
export type FeedbackPublication =
  | { kind: "monitoring"; input: Parameters<typeof createMonitoringFeedback>[1] }
  | { kind: "indicator"; input: Parameters<typeof createIndicatorFeedback>[1] }
  | { kind: "orchestrator"; input: Parameters<typeof createOrchestratorFeedback>[1] }

export type ConfigValueWrite = {
  organizationId: string
  scopeType: string
  teamId: string | null
  subteamId: string | null
  configKey: string
  valueType: "BOOLEAN" | "NUMERIC" | "TEXT"
  value: boolean | number | string
}

export type AgentRunSource = "MANUAL_TEST" | "WORKFLOW" | "QA_SIMULATION"

/** Persistência de `agent_runs` — abstraída porque `usageCount` de um Agent conta essa tabela:
 * uma execução de QA não pode aparecer ali (Parte 47 do pedido do QA Lab). */
export type AgentRunRecorder = {
  start(db: Database, input: { organizationId: string; agentId: string; source: AgentRunSource; inputContext: string; model?: string | null }): Promise<string>
  /** `toolTrace` = ferramentas de investigação usadas (investigation/domain/tool-trace.ts) — só
   * quando o Agent investigou; fica em `agent_runs.tool_trace` (nunca prompt/cadeia de raciocínio). */
  complete(db: Database, runId: string, outputText: string, toolTrace?: ToolInvocationTrace[] | undefined): Promise<void>
  /** V1.7.1c — `outputText` = a resposta de aplicação que o modelo devolveu e foi REJEITADA pelo contrato (diagnóstico; só no
   * caminho administrativo). Nunca prompt nem raciocínio do provedor. */
  fail(db: Database, runId: string, message: string, outputText?: string | null): Promise<void>
}

export type WorkflowEffectSink = {
  dispatchAlert(db: Database, input: AlertInput): Promise<void>
  dispatchWorkflowOutputRows(
    db: Database,
    context: { organizationId: string; enrollmentId: string; nodeId: string },
    config: { interactionMode?: AvatarInteractionMode | undefined },
    surface: string,
    recipientIds: string[],
    content: unknown,
  ): Promise<void>
  publishFeedback(db: Database, publication: FeedbackPublication): Promise<{ caseId: string; feedbackId: string }>
  setConfigValue(db: Database, input: ConfigValueWrite): Promise<void>
  /** O caso mais recente que esta execução já produziu — usado pra anexar alerta/escalonamento
   * posterior ao mesmo caso. Faz parte do sink porque "o caso" pode ter sido criado de verdade
   * (produção) ou só simulado (QA) — cada sink sabe onde procurar. */
  findRecentCaseId(db: Database, enrollmentId: string): Promise<string | null>
  agentRuns: AgentRunRecorder
  /** V1.5.10 — "Gerar feedback de atendimento": seleção persistida + geração idempotente (QA Lab: sem gravar nada). */
  interactionFeedback: InteractionFeedbackEffects
  /** V1.5.12 — "Gerar feedback" (artefato confiável idempotente) + publicação idempotente dele pelo Output (QA Lab: nada gravado). */
  reliableFeedback: ReliableFeedbackEffects
  /** Workflow Outputs V1 — CHAT (conversa nova da INIA) e AVATAR (convite de voz; a fala só começa no aceite). QA Lab: nada gravado. */
  conversational: ConversationalEffects
  /** MOTOR DE FEEDBACK — análise de chamada, investigação de indicador, geração e publicação da mensagem (memória gravada na
   * análise; nenhuma espera por QA). QA Lab: mesma lógica com memória em RAM. */
  feedbackEngine: FeedbackEngineEffects
  /** "Avaliar política de acompanhamento": grava avaliação, caso, relatório e intervenções numa transação (QA Lab: nada gravado). */
  interventions: InterventionEffects
}

/** Teto da resposta rejeitada guardada para diagnóstico (a resposta de um especialista cabe inteira; nada de payload sem limite). */
export const REJECTED_OUTPUT_MAX_CHARS = 60_000

export const productionAgentRuns: AgentRunRecorder = {
  async start(db, input) {
    const created = await db.query<{ id: string }>(
      `insert into agent_runs(organization_id, agent_id, source, input_context, model, status)
       values ($1,$2,$3,$4,$5,'PENDING') returning id`,
      [input.organizationId, input.agentId, input.source, input.inputContext, input.model ?? AGENT_LLM_MODEL],
    )
    return created.rows[0]!.id
  },
  async complete(db, runId, outputText, toolTrace) {
    await db.query(`update agent_runs set output_text = $1, status = 'COMPLETED', completed_at = now(), tool_trace = $3 where id = $2`, [outputText, runId, toolTrace && toolTrace.length > 0 ? JSON.stringify(toolTrace) : null])
  },
  async fail(db, runId, message, outputText) {
    await db.query(`update agent_runs set status = 'FAILED', error_message = $1, completed_at = now(), output_text = coalesce($3, output_text) where id = $2`, [message, runId, outputText ? outputText.slice(0, REJECTED_OUTPUT_MAX_CHARS) : null])
  },
}

export const productionEffects: WorkflowEffectSink = {
  dispatchAlert,

  // Registro sem consumidor (INBOX/CUSTOM_SURFACE, e o Escalonar em Chat/Avatar): idempotente pela mesma chave de entrega.
  async dispatchWorkflowOutputRows(db, context, config, surface, recipientIds, content) {
    for (const recipientId of recipientIds) {
      await db.query(
        `insert into workflow_outputs(organization_id, enrollment_id, node_id, recipient_id, surface, interaction_mode, content)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (enrollment_id, node_id, surface, recipient_id) do nothing`,
        [context.organizationId, context.enrollmentId, context.nodeId, recipientId, surface, config.interactionMode ?? "PROMPT", JSON.stringify(content ?? null)],
      )
    }
  },

  async publishFeedback(db, publication) {
    switch (publication.kind) {
      case "monitoring":
        return createMonitoringFeedback(db, publication.input)
      case "indicator":
        return createIndicatorFeedback(db, publication.input)
      case "orchestrator":
        return createOrchestratorFeedback(db, publication.input)
    }
  },

  async setConfigValue(db, input) {
    await db.query(
      `insert into org_config_values(organization_id, scope_type, team_id, subteam_id, config_key, value_type, value_boolean, value_numeric, value_text)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (
         organization_id, scope_type,
         coalesce(team_id, '00000000-0000-0000-0000-000000000000'),
         coalesce(subteam_id, '00000000-0000-0000-0000-000000000000'),
         config_key
       )
       do update set
         value_type = excluded.value_type,
         value_boolean = excluded.value_boolean,
         value_numeric = excluded.value_numeric,
         value_text = excluded.value_text,
         updated_at = now()`,
      [
        input.organizationId,
        input.scopeType,
        input.teamId,
        input.subteamId,
        input.configKey,
        input.valueType,
        input.valueType === "BOOLEAN" ? input.value : null,
        input.valueType === "NUMERIC" ? input.value : null,
        input.valueType === "TEXT" ? input.value : null,
      ],
    )
  },

  async findRecentCaseId(db, enrollmentId) {
    const row = await db.query<{ case_id: string | null }>(
      `select payload->>'caseId' as case_id
       from workflow_enrollment_events
       where enrollment_id = $1 and payload ? 'caseId'
       order by created_at desc
       limit 1`,
      [enrollmentId],
    )
    return row.rows[0]?.case_id ?? null
  },

  agentRuns: productionAgentRuns,

  interactionFeedback: productionInteractionFeedbackEffects,

  reliableFeedback: productionReliableFeedbackEffects,

  conversational: productionConversationalEffects,

  feedbackEngine: productionFeedbackEngineEffects,

  interventions: productionInterventionEffects,
}
