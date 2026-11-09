import { z } from "zod"

import { manualRunBlockerSchema } from "./workflow-manual-run.schema"

/**
 * Nova tentativa de uma execução bloqueada (agente inativo ou acesso não autorizado — PEN-073 a PEN-075) — espelho de
 * `GET/POST /admin/workflows/:id/enrollments/:enrollmentId/retry` (backend workflows/application/workflow-retry.ts).
 * A prévia mostra o que SERÁ usado (versão publicada e vigente do Workflow, a versão VIGENTE de cada agente — inclusive os de
 * cada Orquestrador —, destinos, aprovações) e leva a impressão digital que a confirmação devolve; se algo mudou, o servidor
 * recusa e manda a prévia nova. Agentes não ficam fixados (revisão de 03/11/2026): na chamada, a vigente é conferida de novo.
 */

const retryAgentRoleSchema = z.enum(["ORCHESTRATOR_AGENT", "SPECIALIST"])
export const RETRY_AGENT_ROLE_LABELS: Record<z.infer<typeof retryAgentRoleSchema>, string> = { ORCHESTRATOR_AGENT: "Agente orquestrador", SPECIALIST: "Especialista" }

const versionRefSchema = z.object({ id: z.string(), number: z.number() })

export const workflowRetryPreviewSchema = z.object({
  enrollmentId: z.string(),
  workflowId: z.string(),
  workflowName: z.string(),
  workflowActive: z.boolean(),
  blockers: z.array(manualRunBlockerSchema),
  /** Versão publicada e vigente que a nova tentativa usará — null quando o Workflow não tem versão publicada. */
  workflowVersion: versionRefSchema.nullable(),
  originalVersion: versionRefSchema,
  blockedNode: z.object({ id: z.string().nullable(), label: z.string().nullable(), agentName: z.string().nullable(), cause: z.string().nullable().optional().catch(null) }),
  agents: z.array(
    z.object({
      nodeId: z.string(),
      nodeLabel: z.string(),
      agentId: z.string(),
      agentName: z.string().nullable(),
      agentVersionId: z.string().nullable(),
      agentVersionNumber: z.number().nullable(),
      active: z.boolean().nullable(),
    }),
  ),
  orchestrators: z.array(
    z.object({
      nodeId: z.string(),
      nodeLabel: z.string(),
      orchestratorId: z.string(),
      orchestratorName: z.string().nullable(),
      orchestratorVersionId: z.string().nullable(),
      orchestratorVersionNumber: z.number().nullable(),
      /** Agentes desta etapa (o orquestrador e os especialistas da versão do Orquestrador), cada um na versão VIGENTE de agora. */
      agents: z
        .array(
          z.object({
            agentId: z.string(),
            agentName: z.string().nullable(),
            role: retryAgentRoleSchema.catch("SPECIALIST"),
            agentVersionId: z.string().nullable(),
            agentVersionNumber: z.number().nullable(),
            active: z.boolean().nullable(),
          }),
        )
        .catch([]),
    }),
  ),
  destinations: z.array(z.object({ nodeId: z.string(), nodeLabel: z.string(), description: z.string() })),
  approvals: z.array(z.object({ nodeId: z.string(), nodeLabel: z.string(), description: z.string() })),
  /**
   * BLOCKED_STEP = mesma versão: continua da etapa bloqueada com os resultados anteriores; TRIGGER = versão nova: recomeça e
   * reavalia tudo; AFTER_FAN_OUT = execução de UM colaborador de "Selecionar colaboradores" numa versão nova: recomeça no nó
   * seguinte ao envio, como uma execução de colaborador nasce.
   */
  startsAt: z.enum(["BLOCKED_STEP", "TRIGGER", "AFTER_FAN_OUT"]),
  /**
   * Execução de um colaborador de "Selecionar colaboradores": a tentativa fica ligada à mesma execução principal; o resultado dela
   * entra no consolidado só quando `joinsConsolidation` (a principal ainda aguarda em "Consolidar resultados"). null = não é.
   */
  fanOut: z.object({ parentEnrollmentId: z.string(), parentStatus: z.string(), joinsConsolidation: z.boolean() }).nullable().catch(null),
  fingerprint: z.string(),
})
export type WorkflowRetryPreview = z.infer<typeof workflowRetryPreviewSchema>

export const workflowRetryResultSchema = z.object({ enrollmentId: z.string(), preview: workflowRetryPreviewSchema })
export type WorkflowRetryResult = z.infer<typeof workflowRetryResultSchema>

/** O servidor conferiu de novo e algo mudou desde a prévia: nada rodou, a tela mostra a prévia nova e pede outro clique. */
export const WORKFLOW_RETRY_RECONFIRM = "WORKFLOW_RETRY_RECONFIRM"

/**
 * Recusas que o diálogo da nova tentativa mostra no próprio corpo (nunca como toast): as da nova tentativa e os
 * impedimentos do "Executar agora" que a confirmação reaproveita (Workflow sem versão publicada, agente/orquestrador
 * indisponível, agente não publicado ou cuja versão vigente não está autorizada para o Workflow).
 */
export const WORKFLOW_RETRY_HANDLED_CODES = [
  WORKFLOW_RETRY_RECONFIRM,
  "WORKFLOW_RETRY_WORKFLOW_INACTIVE",
  "WORKFLOW_RETRY_IN_PROGRESS",
  "WORKFLOW_RETRY_NOT_BLOCKED",
  "WORKFLOW_RETRY_FAN_OUT_MISSING",
  "WORKFLOW_RETRY_REVIEWER_MISSING",
  "WORKFLOW_RETRY_CONTENT_MISSING",
  "WORKFLOW_RETRY_RECORD_CANCELLED",
  "WORKFLOW_MANUAL_RUN_NOT_PUBLISHED",
  "WORKFLOW_AGENT_INACTIVE",
  "WORKFLOW_AGENT_NOT_FOUND",
  "WORKFLOW_AGENT_NOT_PUBLISHED",
  "WORKFLOW_AGENT_NOT_AUTHORIZED",
  "WORKFLOW_ORCHESTRATOR_INACTIVE",
  "WORKFLOW_ORCHESTRATOR_NOT_FOUND",
  "WORKFLOW_ORCHESTRATOR_INVALID_INVOCATION",
]

export type WorkflowRetryRefusal = { code: string; message: string; preview: WorkflowRetryPreview | null }

/** Recusa tratada pelo diálogo (código + mensagem + prévia atualizada quando o servidor a mandou); null para qualquer outro erro. */
export function workflowRetryRefusalFrom(error: unknown): WorkflowRetryRefusal | null {
  const candidate = error as { code?: unknown; message?: unknown; details?: { preview?: unknown } } | null
  if (!candidate || typeof candidate.code !== "string" || !WORKFLOW_RETRY_HANDLED_CODES.includes(candidate.code)) return null
  const parsed = workflowRetryPreviewSchema.safeParse(candidate.details?.preview)
  return { code: candidate.code, message: typeof candidate.message === "string" ? candidate.message : "", preview: parsed.success ? parsed.data : null }
}

/**
 * "Ver histórico desta execução" (PEN-071): só as execuções de agente desta execução do Workflow — com o agente
 * identificado mesmo inativo e a versão usada. Nunca o cadastro, outras execuções do agente nem as alterações dele.
 */
export const workflowExecutionAgentRecordSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  agentActive: z.boolean(),
  status: z.string(),
  source: z.string().nullable().catch(null),
  createdAt: z.coerce.string(),
  completedAt: z.string().nullable().catch(null),
  outputText: z.string().nullable().catch(null),
  errorMessage: z.string().nullable().catch(null),
  agentVersionNumber: z.number().nullable().catch(null),
  nodeId: z.string().nullable().catch(null),
})
export type WorkflowExecutionAgentRecord = z.infer<typeof workflowExecutionAgentRecordSchema>

export const AGENT_RECORD_STATUS_LABELS: Record<string, string> = { PENDING: "Em andamento", COMPLETED: "Concluída", FAILED: "Falhou" }
