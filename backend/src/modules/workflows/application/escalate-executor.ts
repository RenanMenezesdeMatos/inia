import { ApplicationInvariantError } from "../../../shared/domain/execution-failure.js"
import { MISSING_CONTENT_MESSAGES, missingContentCauseOf } from "../domain/execution-block.js"
import { isAbsentContent } from "./execution-context.js"
import type { ActionConfig } from "../domain/graph-schema.js"
import type { WorkflowEffectSink } from "./effect-sink.js"
import { resolveEnrollmentOperatorId, type EnrollmentSubjectContext } from "./enrollment-subject.js"
import { describeOutputContent, resolveSource } from "./output-executor.js"
import { resolveHierarchicalTargetIds } from "./human-review-executor.js"

export type EscalateActionConfig = Extract<ActionConfig, { actionType: "ESCALATE" }>

export type EscalateExecutionContext = EnrollmentSubjectContext & {
  organizationId: string
  enrollmentId: string
  nodeId: string
  /** Execution Context acumulado até agora — de onde `config.contentSource` lê o conteúdo a
   * escalonar, mesma convenção de Condition/Output/Human Review. */
  nodeOutputs: Record<string, unknown>
  /** Workflow Variables: a tela oferece variável como origem do conteúdo (WF-41). */
  variables?: Record<string, unknown>
  effects: WorkflowEffectSink
}

export type EscalateExecutionResult = {
  nodeOutput: {
    target: EscalateActionConfig["target"]
    recipientCount: number
    surfaces: EscalateActionConfig["surfaces"]
    reason: string | undefined
    operatorName: string
    caseId: string | null
  }
}

/**
 * "Encaminhar/elevar responsabilidade" — nunca "aguardar decisão" (isso continua sendo só o
 * Human Review, ver human-review-executor.ts). Resolve o `target` (mesmo `HierarchicalTarget` e
 * mesmo resolvedor do Human Review, `resolveHierarchicalTargetIds`), o conteúdo (mesmo
 * `resolveSource` do Output) e despacha em cada `surface` pedida reaproveitando a MESMA
 * infraestrutura de delivery do Output: `dispatchAlert` pra FOLLOW_UP/NOTIFICATION (mesmo
 * primitivo que Output e Human Review já usam, cada um com seu próprio título/descrição) e
 * `dispatchWorkflowOutputRows` (ambos via `context.effects`, ver effect-sink.ts) pras demais superfícies. Não
 * duplica nenhuma lógica de publicação — só compõe o que já existe.
 */
export async function executeEscalation(config: EscalateActionConfig, context: EscalateExecutionContext): Promise<EscalateExecutionResult> {
  const operatorId = await resolveEnrollmentOperatorId(context)
  if (!operatorId) throw new Error("Não foi possível identificar o operador para escalonar.")

  // O escalonamento é sobre o colaborador: ele nunca é o destinatário (achado C16 da 4ª auditoria).
  const recipientIds = (await resolveHierarchicalTargetIds(context, operatorId, config.target)).filter((id) => id !== operatorId)
  // Nunca falha silenciosamente (Parte 25 do pedido) — o ESCALATE antigo retornava sem efeito
  // quando ninguém era encontrado na cadeia; agora lança erro controlado, que o motor já sabe
  // tratar (retry com backoff, depois `dead`, com o motivo registrado em
  // workflow_enrollment_events — mesmo mecanismo de qualquer outra falha de node).
  if (recipientIds.length === 0) {
    throw new Error(
      "Não foi possível encontrar um destinatário para o Target configurado — verifique a hierarquia (reports_to) a partir do operador desta ocorrência.",
    )
  }

  const [caseId, operatorRow] = await Promise.all([
    context.effects.findRecentCaseId(context.db, context.enrollmentId),
    context.db.query<{ name: string }>(`select name from people where id = $1`, [operatorId]),
  ])
  const operatorName = operatorRow.rows[0]?.name ?? "um operador"
  const content = config.contentSource ? resolveSource(context.nodeOutputs, config.contentSource, context.variables) : undefined
  // Conteúdo configurado e ausente nunca escala sem ele (D2): a versão é fixa, então repetir não resolve.
  if (config.contentSource && isAbsentContent(content)) {
    throw new ApplicationInvariantError(`O conteúdo escalonado não está disponível: ${MISSING_CONTENT_MESSAGES[missingContentCauseOf(config.contentSource)]}. Nada foi escalonado.`, "WORKFLOW_CONTENT_MISSING")
  }

  for (const surface of config.surfaces) {
    if (surface === "FOLLOW_UP" || surface === "NOTIFICATION") {
      // Não reaproveita `dispatchOutputAlert` (texto fixo, específico do Output) — chama o
      // mesmo primitivo compartilhado (`dispatchAlert`) direto, com título/descrição próprios do
      // Escalonamento (incluindo o Motivo), no mesmo padrão que `dispatchOutputAlert` e
      // `notifyHumanReviewPending` já fazem cada um no seu arquivo.
      for (const recipientId of recipientIds) {
        await context.effects.dispatchAlert(context.db, {
          organizationId: context.organizationId,
          caseId,
          recipientId,
          title: `Escalonamento: ${operatorName}`,
          // Motivo + o CONTEÚDO escalonado (síntese/feedback analisado — ver describeOutputContent):
          // quem recebe a responsabilidade precisa ler o que foi analisado, não só saber que existe.
          description: [
            `O workflow escalonou uma ocorrência de ${operatorName}.`,
            config.reason ? `Motivo: ${config.reason}` : null,
            content !== undefined ? describeOutputContent(content) : null,
          ]
            .filter((part): part is string => Boolean(part))
            .join("\n\n"),
          severity: "HIGH",
          alertType: "WORKFLOW_ESCALATION",
          dedupeKey: `workflow_escalation:${context.enrollmentId}:${context.nodeId}:${surface}:${recipientId}`,
        })
      }
      continue
    }

    await context.effects.dispatchWorkflowOutputRows(context.db, context, config, surface, recipientIds, content)
  }

  return { nodeOutput: { target: config.target, recipientCount: recipientIds.length, surfaces: config.surfaces, reason: config.reason, operatorName, caseId } }
}
