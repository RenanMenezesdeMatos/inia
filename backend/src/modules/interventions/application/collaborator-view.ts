import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { interventionTypeDefinitionSchema } from "../domain/intervention-type.js"
import { recordInterventionEvent } from "./apply-evaluation.js"
import { resolveOverdueIfSettled } from "./overdue-reminders.js"

/**
 * O LADO DO COLABORADOR — o acompanhamento que ele faz JUNTO com quem o lidera: o que foi combinado, os passos (de quem é cada
 * um e o prazo) e os PRÓPRIOS passos para marcar como feitos. Só existe quando o formato está marcado como "visível ao
 * colaborador" e a intervenção está em execução; a avaliação de continuidade nunca aparece.
 *
 * O que NUNCA sai daqui: o motivo e a análise que fundamentaram a abertura, o relatório, as evidências, as leituras e anotações
 * de quem conduz e o histórico. O colaborador não age sobre a intervenção (aceitar, concluir, cancelar continuam de quem
 * conduz): ele só marca o passo que é dele — e isso fica registrado no histórico, em nome dele.
 */
export type MyFollowUpStep = { id: string; kind: "TASK" | "CHECKPOINT" | "ACTIVITY"; title: string; description: string; mine: boolean; ownerName: string | null; dueAt: string | null; done: boolean; overdue: boolean }
export type MyFollowUp = { id: string; typeName: string; description: string; responsibleName: string; startedAt: string; dueAt: string; objective: string | null; revision: number; steps: MyFollowUpStep[] }

type Row = { id: string; case_id: string; status: string; revision: number; due_at: string; started_at: Date | null; created_at: Date; responsible_name: string; plan: { objective?: string; measurableObjective?: { target?: string } }; definition: unknown }

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const notFound = () => new DomainError("Acompanhamento não encontrado.", "INTERVENTION_NOT_FOUND", 404)

/** Em execução, não sensível, do próprio colaborador — e de um formato visível a ele (decidido pela versão do tipo da intervenção). */
/**
 * `forStep` (marcar um passo): trava a linha da intervenção — o mesmo `for update of i` dos comandos de quem conduz — e devolve
 * também a concluída/cancelada, para a recusa ter resposta própria (POL-04). A lista do colaborador continua só com as em execução.
 */
async function loadMine(db: Pick<Database, "query">, organizationId: string, personId: string, interventionId?: string, forStep = false): Promise<(Row & { typeName: string; description: string })[]> {
  const rows = await db.query<Row>(
    `select i.id, i.case_id, i.status, i.revision, i.due_at::text, i.started_at, i.created_at, r.name responsible_name, i.plan, v.definition
       from interventions i
       join people r on r.id = i.responsible_id
       join intervention_type_versions v on v.id = i.type_version_id
      where i.organization_id = $1 and i.person_id = $2 and i.status = any($4::text[]) and not i.sensitive and ($3::uuid is null or i.id = $3)
      order by i.due_at, i.created_at${forStep ? " for update of i" : ""}`,
    [organizationId, personId, interventionId ?? null, forStep ? ["IN_PROGRESS", "COMPLETED", "CANCELLED"] : ["IN_PROGRESS"]],
  )
  return rows.rows.flatMap((row) => {
    const parsed = interventionTypeDefinitionSchema.safeParse(row.definition)
    return parsed.success && parsed.data.collaboratorVisible ? [{ ...row, typeName: parsed.data.name, description: parsed.data.description }] : []
  })
}

export async function listMyFollowUps(db: Database, viewer: { organizationId: string; personId: string }, now: Date = new Date()): Promise<MyFollowUp[]> {
  const rows = await loadMine(db, viewer.organizationId, viewer.personId)
  if (rows.length === 0) return []
  const today = localDateOf(now, await resolveOrganizationTimezone(db, viewer.organizationId))
  const items = await db.query<{ id: string; intervention_id: string; kind: MyFollowUpStep["kind"]; title: string; description: string; owner_id: string | null; owner_name: string | null; due_at: string | null; status: string }>(
    `select it.id, it.intervention_id, it.kind, it.title, it.description, it.owner_id, o.name owner_name, it.due_at::text, it.status
       from intervention_items it left join people o on o.id = it.owner_id
      where it.intervention_id = any($1::uuid[]) and it.status <> 'SKIPPED' order by it.position`,
    [rows.map((row) => row.id)],
  )
  return rows.map((row) => ({
    id: row.id,
    typeName: row.typeName,
    description: row.description,
    responsibleName: row.responsible_name,
    startedAt: (row.started_at ?? row.created_at).toISOString(),
    dueAt: row.due_at,
    objective: row.plan?.objective?.trim() || row.plan?.measurableObjective?.target?.trim() || null,
    revision: row.revision,
    steps: items.rows
      .filter((item) => item.intervention_id === row.id)
      .map((item) => ({ id: item.id, kind: item.kind, title: item.title, description: item.description, mine: item.owner_id === viewer.personId, ownerName: item.owner_id === viewer.personId ? null : item.owner_name, dueAt: item.due_at, done: item.status === "DONE", overdue: item.status === "PENDING" && item.due_at !== null && item.due_at < today })),
  }))
}

/** O colaborador marca (ou desmarca) um passo que é DELE. Passo de quem conduz, checkpoint e qualquer outra coisa: recusado. */
export async function markMyStep(db: Database, viewer: { organizationId: string; personId: string }, interventionId: string, itemId: string, input: { done: boolean; note?: string | undefined }): Promise<MyFollowUp> {
  if (!isUuid(interventionId) || !isUuid(itemId)) throw notFound()
  const note = String(input.note ?? "").trim().slice(0, 2000)
  await inTransaction(db, async (tx) => {
    // A intervenção é travada ANTES de qualquer leitura do passo: concluir/cancelar (de quem conduz) e marcar o passo nunca se cruzam.
    const row = (await loadMine(tx, viewer.organizationId, viewer.personId, interventionId, true))[0]
    if (!row) throw notFound()
    if (row.status !== "IN_PROGRESS") throw new DomainError("Este acompanhamento já foi encerrado: os passos não mudam mais.", "INTERVENTION_NOT_IN_PROGRESS", 409)
    const item = (await tx.query<{ id: string; kind: string; title: string; owner_id: string | null; status: string; completed_by: string | null }>(`select id, kind, title, owner_id, status, completed_by from intervention_items where id = $1 and intervention_id = $2 for update`, [itemId, row.id])).rows[0]
    if (!item) throw notFound()
    if (item.owner_id !== viewer.personId || item.kind === "CHECKPOINT") throw new DomainError("Este passo é de quem conduz o acompanhamento.", "INTERVENTION_STEP_NOT_YOURS", 403)
    const status = input.done ? "DONE" : "PENDING"
    if (item.status === status) return
    if (item.status === "SKIPPED") throw new DomainError("Este passo foi dispensado por quem conduz.", "INTERVENTION_STEP_SKIPPED", 409)
    // Desmarcar apaga o registro do passo: quando quem o concluiu foi quem conduz (com a anotação dele), só ele reabre.
    if (!input.done && item.completed_by !== null && item.completed_by !== viewer.personId) throw new DomainError("Este passo foi concluído por quem conduz o acompanhamento: só ele pode reabri-lo.", "INTERVENTION_STEP_DONE_BY_LEADER", 409)
    await tx.query(`update intervention_items set status = $2, result = $3, completed_at = case when $2 = 'PENDING' then null else now() end, completed_by = case when $2 = 'PENDING' then null else $4::uuid end, updated_at = now() where id = $1`, [item.id, status, input.done ? JSON.stringify({ note: note || null, reading: null, byCollaborator: true }) : null, viewer.personId])
    await tx.query(`update interventions set revision = revision + 1, updated_at = now() where id = $1`, [row.id])
    await resolveOverdueIfSettled(tx, viewer.organizationId, row.id, localDateOf(new Date(), await resolveOrganizationTimezone(tx, viewer.organizationId)))
    await recordInterventionEvent(tx, { organizationId: viewer.organizationId, interventionId: row.id, caseId: row.case_id, eventType: "ITEM_UPDATED", actorKind: "HUMAN", actorId: viewer.personId, fromStatus: "IN_PROGRESS", toStatus: "IN_PROGRESS", payload: { itemId: item.id, kind: item.kind, title: item.title, status, byCollaborator: true } })
  })
  const updated = (await listMyFollowUps(db, viewer)).find((item) => item.id === interventionId)
  if (!updated) throw notFound()
  return updated
}
