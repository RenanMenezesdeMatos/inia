import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { effectiveCapabilities } from "../domain/capabilities.js"
import type { IntelligenceReport } from "../domain/intelligence-report.js"
import type { InterventionPlan } from "../domain/intervention-plan.js"
import { recordInterventionEvent } from "./apply-evaluation.js"
import { getInterventionDetail, type InterventionDetail, type Viewer } from "./intervention-service.js"
import { gatewayNarrativeWriter, type NarrativeWriter } from "./report-narrative.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"

/**
 * RASCUNHO pela IA de um treinamento ou plano de ação — a IA PROPÕE a partir de fatos, diagnóstico e conteúdos APROVADOS
 * (todos com marcador); o código confere cada marcador e guarda a proposta SEPARADA do plano (`ai_draft`), distinguindo:
 * FATOS (copiados pelo código do relatório), FONTES (o que foi oferecido) e CONTEÚDO PROPOSTO (o que a IA escreveu). Nada
 * entra no plano até o responsável aplicar; depois disso valem as aprovações do tipo, como para qualquer plano.
 * Treinamento SEM diagnóstico sustentado ligado a uma competência = "investigar primeiro": a IA nem é chamada.
 */
export const AI_DRAFT_CONTRACT = "INTERVENTION_AI_DRAFT_V1"

const refs = z.array(z.string().regex(/^[FDCK]\d{1,3}$/)).min(1).max(10)
const trainingDraftSchema = z
  .object({
    objective: z.object({ text: z.string().trim().min(10).max(800), refs }).strict(),
    contents: z.array(z.object({ content: z.string().regex(/^C\d{1,3}$/), why: z.string().trim().min(5).max(400) }).strict()).min(1).max(10),
    activities: z.array(z.object({ title: z.string().trim().min(3).max(200), description: z.string().trim().max(800), refs }).strict()).min(1).max(10),
    learningAssessment: z.object({ method: z.string().trim().min(5).max(500), passCriterion: z.string().trim().min(5).max(500) }).strict(),
  })
  .strict()
const actionPlanDraftSchema = z
  .object({
    initialSituation: z.object({ text: z.string().trim().min(10).max(1500), refs }).strict(),
    measurableObjective: z.object({ target: z.string().trim().min(5).max(300), dueInDays: z.number().int().min(1).max(365) }).strict(),
    tasks: z.array(z.object({ title: z.string().trim().min(3).max(200), description: z.string().trim().max(800), owner: z.enum(["COLLABORATOR", "RESPONSIBLE"]), dueInDays: z.number().int().min(1).max(365), refs }).strict()).min(1).max(10),
    support: z.string().trim().min(3).max(800),
    checkpoints: z.array(z.object({ title: z.string().trim().min(3).max(200), dueInDays: z.number().int().min(1).max(365) }).strict()).min(1).max(6),
    closureCriterion: z.string().trim().min(5).max(800),
  })
  .strict()

type Source = { handle: string; kind: "FACT" | "DIAGNOSIS" | "CONTENT" | "ACTIVITY"; label: string; ref: string | null }
export type AiDraftState =
  | { contract: typeof AI_DRAFT_CONTRACT; status: "PROPOSED" | "APPLIED"; kind: "TRAINING" | "ACTION_PLAN"; generatedAt: string; requestedBy: string; facts: string[]; sources: Source[]; proposal: unknown; appliedAt?: string }
  | { contract: typeof AI_DRAFT_CONTRACT; status: "FAILED"; kind: "TRAINING" | "ACTION_PLAN"; generatedAt: string; requestedBy: string; error: string }
  | { contract: typeof AI_DRAFT_CONTRACT; status: "INVESTIGATION_NEEDED"; kind: "TRAINING"; generatedAt: string; requestedBy: string; message: string }


const SYSTEM = {
  TRAINING: [
    "Você propõe uma trilha de treinamento para um líder aplicar com um colaborador, em português do Brasil.",
    "Use SOMENTE os marcadores fornecidos: F = fato, D = diagnóstico sustentado, C = conteúdo APROVADO da base, K = atividade cadastrada na competência.",
    "Escolha conteúdos só entre os C fornecidos. Cada atividade e o objetivo citam os marcadores que os justificam. Nunca invente causa, fato ou conteúdo.",
    'Responda só com JSON: {"objective":{"text":"...","refs":["D1"]},"contents":[{"content":"C1","why":"..."}],"activities":[{"title":"...","description":"...","refs":["C1","K1"]}],"learningAssessment":{"method":"...","passCriterion":"..."}}.',
  ].join("\n"),
  ACTION_PLAN: [
    "Você propõe um plano de ação para um líder conduzir com um colaborador, em português do Brasil.",
    "Use SOMENTE os marcadores fornecidos: F = fato, D = diagnóstico sustentado, C = conteúdo aprovado da base. Sem diagnóstico, não atribua causa: trate o objetivo como verificação e acompanhamento.",
    "O objetivo é mensurável (meta e prazo em dias). Tarefas têm dono (COLLABORATOR ou RESPONSIBLE), prazo em dias e citam marcadores.",
    'Responda só com JSON: {"initialSituation":{"text":"...","refs":["F1"]},"measurableObjective":{"target":"...","dueInDays":30},"tasks":[{"title":"...","description":"...","owner":"COLLABORATOR","dueInDays":7,"refs":["F1"]}],"support":"...","checkpoints":[{"title":"...","dueInDays":15}],"closureCriterion":"..."}.',
  ].join("\n"),
}

async function sourcesFor(db: Database, organizationId: string, detail: InterventionDetail, kind: "TRAINING" | "ACTION_PLAN"): Promise<{ facts: string[]; sources: Source[] }> {
  const report: IntelligenceReport | null = detail.report?.structured ?? null
  const sources: Source[] = []
  const facts = (report?.facts ?? []).filter((fact) => fact.status === "MET").map((fact) => fact.statement)
  ;(report?.facts ?? []).forEach((fact, index) => sources.push({ handle: `F${index + 1}`, kind: "FACT", label: fact.statement, ref: null }))
  ;(report?.diagnosis ?? []).forEach((diagnosis, index) => sources.push({ handle: `D${index + 1}`, kind: "DIAGNOSIS", label: `${diagnosis.indicatorCode} (${diagnosis.period}): ${diagnosis.patterns.map((pattern) => pattern.title).join("; ")}`, ref: diagnosis.ref }))
  ;(detail.plan.contents ?? []).forEach((content, index) => sources.push({ handle: `C${index + 1}`, kind: "CONTENT", label: content.title, ref: content.documentId }))
  if (kind === "TRAINING" && (detail.plan.competencyKeys?.length ?? 0) > 0) {
    const activities = (await db.query<{ title: string; description: string }>(
      `select a->>'title' title, coalesce(a->>'description', '') description from competencies c, jsonb_array_elements(c.activities) a where c.organization_id = $1 and c.key = any($2::text[]) and c.active`,
      [organizationId, detail.plan.competencyKeys],
    )).rows
    activities.forEach((activity, index) => sources.push({ handle: `K${index + 1}`, kind: "ACTIVITY", label: `${activity.title}${activity.description ? ` — ${activity.description}` : ""}`, ref: null }))
  }
  return { facts, sources }
}

function verify(proposal: unknown, kind: "TRAINING" | "ACTION_PLAN", sources: readonly Source[]): { ok: true; value: unknown } | { ok: false; error: string } {
  const parsed = (kind === "TRAINING" ? trainingDraftSchema : actionPlanDraftSchema).safeParse(proposal)
  if (!parsed.success) return { ok: false, error: `A proposta da IA não segue o contrato: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}` }
  const handles = new Set(sources.map((source) => source.handle))
  const cited = JSON.stringify(parsed.data).match(/"[FDCK]\d{1,3}"/g)?.map((value) => value.slice(1, -1)) ?? []
  const unknown = cited.filter((handle) => !handles.has(handle))
  if (unknown.length > 0) return { ok: false, error: `A proposta cita marcadores que não foram oferecidos: ${[...new Set(unknown)].join(", ")}.` }
  return { ok: true, value: parsed.data }
}

export async function draftInterventionWithAi(db: Database, viewer: Viewer, interventionId: string, writer: NarrativeWriter = gatewayNarrativeWriter): Promise<InterventionDetail> {
  const detail = await getInterventionDetail(db, viewer, interventionId)
  if (!detail.availableActions.includes("DRAFT_WITH_AI")) throw new DomainError("Rascunho pela IA não está disponível para esta intervenção agora.", "INTERVENTION_AI_DRAFT_UNAVAILABLE", 409)
  const capabilities = new Set(detail.type.capabilities.map((capability) => capability.key))
  const kind: "TRAINING" | "ACTION_PLAN" | null = capabilities.has("TRAINING") ? "TRAINING" : capabilities.has("ACTION_PLAN") ? "ACTION_PLAN" : null
  if (!kind) throw new DomainError("Rascunho pela IA só existe para treinamento ou plano de ação.", "INTERVENTION_AI_DRAFT_UNSUPPORTED", 422)
  const base = { contract: AI_DRAFT_CONTRACT as typeof AI_DRAFT_CONTRACT, kind, generatedAt: new Date().toISOString(), requestedBy: viewer.personId }
  let state: AiDraftState
  const { facts, sources } = await sourcesFor(db, viewer.organizationId, detail, kind)
  const hasDiagnosis = sources.some((source) => source.kind === "DIAGNOSIS")
  const hasContents = sources.some((source) => source.kind === "CONTENT")
  if (kind === "TRAINING" && (!hasDiagnosis || !hasContents)) {
    // Indicador abaixo da meta, sozinho, não diz o que treinar: sem diagnóstico sustentado ligado a competência e conteúdo aprovado, não há rascunho.
    state = { ...base, kind: "TRAINING", status: "INVESTIGATION_NEEDED", message: !hasDiagnosis ? "Não há diagnóstico sustentado para este colaborador: investigue a causa antes de definir um treinamento." : "O diagnóstico não está ligado a nenhuma competência com conteúdo aprovado na base: vincule a competência na administração." }
  } else {
    try {
      const raw = await writer({ organizationId: viewer.organizationId, system: SYSTEM[kind], user: JSON.stringify({ colaborador: detail.person.name, intervencao: detail.type.name, fatos: sources }), stage: "INTERVENTION_DRAFT" })
      let json: unknown
      try {
        json = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""))
      } catch {
        json = null
      }
      const verified = verify(json, kind, sources)
      state = verified.ok ? { ...base, status: "PROPOSED", facts, sources, proposal: verified.value } : { ...base, status: "FAILED", error: verified.error }
    } catch (error) {
      state = { ...base, status: "FAILED", error: `Falha ao gerar o rascunho: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000) }
    }
  }
  await inTransaction(db, async (tx) => {
    const updated = await tx.query(`update interventions set ai_draft = $3, revision = revision + 1, updated_at = now() where id = $1 and organization_id = $2 and revision = $4`, [detail.id, viewer.organizationId, JSON.stringify(state), detail.revision])
    if (updated.rowCount === 0) throw new DomainError("A intervenção mudou desde que você abriu. Atualize e tente de novo.", "INTERVENTION_CONCURRENT_CHANGE", 409)
    await recordInterventionEvent(tx, { organizationId: viewer.organizationId, interventionId: detail.id, caseId: detail.caseId, eventType: "AI_DRAFT_REQUESTED", actorKind: "HUMAN", actorId: viewer.personId, fromStatus: detail.status, toStatus: detail.status, payload: { kind, status: state.status } })
  })
  return getInterventionDetail(db, viewer, interventionId)
}

const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/** Aplica a proposta ao plano (o responsável decide). A partir daqui segue a máquina de estados e as aprovações do tipo. */
export async function applyAiDraft(db: Database, viewer: Viewer, interventionId: string, expectedRevision?: number): Promise<InterventionDetail> {
  const detail = await getInterventionDetail(db, viewer, interventionId)
  if (!detail.availableActions.includes("EDIT")) throw new DomainError("O plano não pode ser alterado agora.", "INTERVENTION_PLAN_LOCKED", 409)
  const draft = detail.aiDraft as AiDraftState | null
  if (!draft || draft.status !== "PROPOSED") throw new DomainError("Não há rascunho pronto para aplicar.", "INTERVENTION_AI_DRAFT_NOT_READY", 409)
  if (expectedRevision !== undefined && expectedRevision !== detail.revision) throw new DomainError("A intervenção mudou desde que você abriu. Atualize e tente de novo.", "INTERVENTION_CONCURRENT_CHANGE", 409)
  const contentOf = (handle: string) => draft.sources.find((source) => source.handle === handle && source.kind === "CONTENT")
  let plan: InterventionPlan = { ...detail.plan }
  const items: { kind: "TASK" | "CHECKPOINT" | "ACTIVITY"; title: string; description: string; ownerId: string | null; dueAt: string | null }[] = []
  if (draft.kind === "TRAINING") {
    const proposal = draft.proposal as z.infer<typeof trainingDraftSchema>
    plan = { ...plan, objective: proposal.objective.text, contents: proposal.contents.flatMap((item) => { const source = contentOf(item.content); return source?.ref ? [{ documentId: source.ref, title: source.label }] : [] }), learningAssessment: proposal.learningAssessment }
    for (const activity of proposal.activities) items.push({ kind: "ACTIVITY", title: activity.title, description: activity.description, ownerId: detail.person.id, dueAt: detail.dueAt })
  } else {
    const proposal = draft.proposal as z.infer<typeof actionPlanDraftSchema>
    plan = { ...plan, initialSituation: proposal.initialSituation.text, measurableObjective: { indicatorCode: detail.indicatorCode, target: proposal.measurableObjective.target, by: addDays(proposal.measurableObjective.dueInDays) }, support: proposal.support, closureCriterion: proposal.closureCriterion }
    for (const task of proposal.tasks) items.push({ kind: "TASK", title: task.title, description: task.description, ownerId: task.owner === "COLLABORATOR" ? detail.person.id : detail.responsible.id, dueAt: addDays(task.dueInDays) })
    for (const checkpoint of proposal.checkpoints) items.push({ kind: "CHECKPOINT", title: checkpoint.title, description: "", ownerId: detail.responsible.id, dueAt: addDays(checkpoint.dueInDays) })
  }
  const capabilities = new Set(effectiveCapabilities(detail.type.capabilities.map((capability) => capability.key) as never))
  await inTransaction(db, async (tx) => {
    const updated = await tx.query(`update interventions set plan = $3, ai_draft = $4, revision = revision + 1, updated_at = now() where id = $1 and organization_id = $2 and revision = $5`, [detail.id, viewer.organizationId, JSON.stringify(plan), JSON.stringify({ ...draft, status: "APPLIED", appliedAt: new Date().toISOString() }), detail.revision])
    if (updated.rowCount === 0) throw new DomainError("A intervenção mudou desde que você abriu. Atualize e tente de novo.", "INTERVENTION_CONCURRENT_CHANGE", 409)
    const start = detail.items.length
    for (const [index, item] of items.entries()) {
      if ((item.kind === "TASK" && !capabilities.has("TASKS")) || (item.kind === "CHECKPOINT" && !capabilities.has("CHECKPOINTS"))) continue
      await tx.query(`insert into intervention_items (organization_id, intervention_id, kind, title, description, owner_id, due_at, position) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [viewer.organizationId, detail.id, item.kind, item.title, item.description, item.ownerId, item.dueAt, start + index])
    }
    await recordInterventionEvent(tx, { organizationId: viewer.organizationId, interventionId: detail.id, caseId: detail.caseId, eventType: "AI_DRAFT_APPLIED", actorKind: "HUMAN", actorId: viewer.personId, fromStatus: detail.status, toStatus: detail.status, payload: { kind: draft.kind, items: items.length } })
  })
  return getInterventionDetail(db, viewer, interventionId)
}
