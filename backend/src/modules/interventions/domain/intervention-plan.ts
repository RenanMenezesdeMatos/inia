import { z } from "zod"
import { effectiveCapabilities } from "./capabilities.js"
import type { ConfigIssue, InterventionTypeDefinition } from "./intervention-type.js"

/**
 * CONTEÚDO da intervenção conforme as capacidades do tipo. Tarefas, checkpoints e atividades são linhas próprias
 * (`intervention_items`, com dono, prazo e estado); aqui fica o que é texto do plano. Cada campo é escrito por uma pessoa — o
 * rascunho da IA fica separado (`ai_draft`) até alguém aceitá-lo.
 */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const interventionPlanSchema = z
  .object({
    /** TRAINING e ACTION_PLAN. */
    objective: z.string().trim().max(1000).optional(),
    /** ACTION_PLAN — o texto do líder; os FATOS da situação inicial ficam em `initial_situation`, gravados pelo sistema. */
    initialSituation: z.string().trim().max(2000).optional(),
    measurableObjective: z.object({ indicatorCode: z.string().trim().max(40).nullable(), target: z.string().trim().min(1).max(300), by: date }).strict().optional(),
    support: z.string().trim().max(1000).optional(),
    closureCriterion: z.string().trim().max(1000).optional(),
    /** TRAINING — competências e conteúdos aprovados (documentos PUBLICADOS da base, conferidos pelo backend). */
    competencyKeys: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    contents: z.array(z.object({ documentId: z.string().uuid(), title: z.string().trim().max(200) }).strict()).max(20).optional(),
    learningAssessment: z.object({ method: z.string().trim().min(1).max(500), passCriterion: z.string().trim().min(1).max(500) }).strict().optional(),
    /** GUIDANCE — o que foi orientado e as referências. */
    guidance: z.object({ summary: z.string().trim().min(1).max(3000), documentIds: z.array(z.string().uuid()).max(10) }).strict().optional(),
    /** OBSERVATION — foco e até quando. */
    observation: z.object({ focus: z.string().trim().min(1).max(1000), until: date }).strict().optional(),
    /** LEADERSHIP_REVIEW / DATA_REVIEW — parecer registrado. */
    review: z.object({ finding: z.string().trim().min(1).max(3000) }).strict().optional(),
    /** CONTINUITY_REVIEW — justificativa de quem SOLICITA a avaliação (obrigatória; a decisão é de outra pessoa). */
    continuityRequest: z.object({ justification: z.string().trim().min(30).max(3000) }).strict().optional(),
    /** RECOGNITION — o que foi reconhecido. */
    recognition: z.object({ message: z.string().trim().min(1).max(2000) }).strict().optional(),
  })
  .strict()
export type InterventionPlan = z.infer<typeof interventionPlanSchema>

export type PlanItemCounts = { tasks: number; tasksWithOwnerAndDue: number; checkpoints: number; activities: number }

/**
 * O plano está pronto para sair de "Proposta"? (aceitar = ir para aprovação ou execução). Treinamento: objetivo, conteúdos,
 * atividades, prazo e avaliação de aprendizagem. Plano de ação: situação inicial, objetivo mensurável, tarefas com responsável e
 * prazo, apoio, checkpoints e critério de encerramento. Evidências mínimas do tipo, sempre.
 */
export function planReadinessIssues(definition: InterventionTypeDefinition, plan: InterventionPlan, counts: PlanItemCounts, evidenceCount: number): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const has = new Set(effectiveCapabilities(definition.capabilities))
  const need = (ok: boolean, path: string, code: string, message: string) => {
    if (!ok) issues.push({ path, code, message })
  }
  if (evidenceCount < definition.evidence.minimumItems) issues.push({ path: "evidence", code: "INTERVENTION_EVIDENCE_REQUIRED", message: `Este tipo exige pelo menos ${definition.evidence.minimumItems} evidência(s) verificável(is); há ${evidenceCount}.` })
  if (has.has("TRAINING")) {
    need(Boolean(plan.objective), "plan.objective", "TRAINING_OBJECTIVE_REQUIRED", "Treinamento: defina o objetivo.")
    need((plan.contents?.length ?? 0) > 0, "plan.contents", "TRAINING_CONTENTS_REQUIRED", "Treinamento: escolha pelo menos um conteúdo aprovado da base.")
    need(counts.activities > 0, "items", "TRAINING_ACTIVITIES_REQUIRED", "Treinamento: inclua pelo menos uma atividade.")
    need(Boolean(plan.learningAssessment), "plan.learningAssessment", "TRAINING_ASSESSMENT_REQUIRED", "Treinamento: defina como a aprendizagem será avaliada.")
  }
  if (has.has("ACTION_PLAN")) {
    need(Boolean(plan.initialSituation), "plan.initialSituation", "ACTION_PLAN_INITIAL_SITUATION_REQUIRED", "Plano de ação: descreva a situação inicial.")
    need(Boolean(plan.measurableObjective), "plan.measurableObjective", "ACTION_PLAN_OBJECTIVE_REQUIRED", "Plano de ação: defina um objetivo mensurável (meta e data).")
    need(Boolean(plan.support), "plan.support", "ACTION_PLAN_SUPPORT_REQUIRED", "Plano de ação: descreva o apoio necessário (ou \"nenhum\").")
    need(Boolean(plan.closureCriterion), "plan.closureCriterion", "ACTION_PLAN_CLOSURE_REQUIRED", "Plano de ação: defina o critério de encerramento.")
    need(counts.checkpoints > 0, "items", "ACTION_PLAN_CHECKPOINTS_REQUIRED", "Plano de ação: inclua pelo menos um checkpoint.")
  }
  if (has.has("TASKS")) {
    need(counts.tasks > 0, "items", "TASKS_REQUIRED", "Inclua pelo menos uma tarefa.")
    need(counts.tasksWithOwnerAndDue === counts.tasks, "items", "TASKS_OWNER_DUE_REQUIRED", "Toda tarefa precisa de responsável e prazo.")
  }
  if (has.has("CHECKPOINTS") && !has.has("ACTION_PLAN")) need(counts.checkpoints > 0, "items", "CHECKPOINTS_REQUIRED", "Inclua pelo menos um checkpoint.")
  if (has.has("CONTINUITY_REVIEW")) need(Boolean(plan.continuityRequest), "plan.continuityRequest", "CONTINUITY_REVIEW_JUSTIFICATION_REQUIRED", "Escreva a justificativa da solicitação (pelo menos 30 caracteres). A decisão será de uma pessoa autorizada.")
  if (has.has("OBSERVATION")) need(Boolean(plan.observation), "plan.observation", "OBSERVATION_FOCUS_REQUIRED", "Observação: defina o foco e até quando.")
  return issues
}
