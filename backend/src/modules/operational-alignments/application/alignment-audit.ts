import type { Database } from "../../../infrastructure/database/pool.js"
import type { AlignmentResolution } from "../domain/operational-alignment.js"

type Queryable = Pick<Database, "query">

/**
 * RASTRO DE AUDITORIA dos alinhamentos operacionais (migration 212) — guardado, sem tela. Eventos do ciclo de vida com quem fez e quando
 * (`operational_alignment_events`) e qual versão a IA leu (`operational_alignment_usages`). Só inserção.
 */
export type AlignmentEventType = "CREATED" | "DRAFT_SAVED" | "DRAFT_DISCARDED" | "PUBLISHED" | "SUPERSEDED" | "STARTED" | "EXPIRED" | "ENDED" | "CANCELLED" | "DELETED" | "RESTORED" | "REPROCESSED"

export async function recordAlignmentEvent(db: Queryable, event: { organizationId: string; alignmentId: string; versionId?: string | null; version?: number | null; type: AlignmentEventType; actorPersonId: string | null; details?: Record<string, unknown>; occurredAt?: Date }) {
  await db.query(
    `insert into operational_alignment_events (organization_id, alignment_id, version_id, version, event_type, actor_person_id, occurred_at, details) values ($1, $2, $3, $4, $5, $6, coalesce($7, now()), $8)`,
    [event.organizationId, event.alignmentId, event.versionId ?? null, event.version ?? null, event.type, event.actorPersonId, event.occurredAt ?? null, JSON.stringify(event.details ?? {})],
  )
}

/** O que mudou entre duas imagens de rascunho: campos alterados e processos incluídos/excluídos (ids). */
export function alignmentChangesOf(before: { fields: Record<string, unknown>; processes: readonly string[] } | null, after: { fields: Record<string, unknown>; processes: readonly string[] }) {
  if (!before) return { changedFields: Object.keys(after.fields), processesAdded: [...after.processes], processesRemoved: [] as string[] }
  const changedFields = Object.keys(after.fields).filter((key) => JSON.stringify(before.fields[key] ?? null) !== JSON.stringify(after.fields[key] ?? null))
  return {
    changedFields,
    processesAdded: after.processes.filter((id) => !before.processes.includes(id)),
    processesRemoved: before.processes.filter((id) => !after.processes.includes(id)),
    before: Object.fromEntries(changedFields.map((key) => [key, before.fields[key] ?? null])),
    after: Object.fromEntries(changedFields.map((key) => [key, after.fields[key] ?? null])),
  }
}

export type AlignmentUsage = { surface: "CONVERSATION" | "AGENT" | "MONITORING"; personId: string | null; agentId?: string | null; interactionId?: string | null }

/**
 * QUAL VERSÃO A IA LEU: uma linha por alinhamento aplicado nesta montagem de instruções/análise. Nunca atrasa nem derruba a resposta
 * (não é aguardado; falha só vira aviso no log) e é recusado sem efeito no QA Lab (banco somente leitura antes do Postgres).
 */
export function recordAlignmentUsage(db: Queryable, organizationId: string, resolution: AlignmentResolution, usage: AlignmentUsage): void {
  if (resolution.applied.length === 0 || !resolution.referenceDate) return
  const rows = resolution.applied
  void db
    .query(
      `insert into operational_alignment_usages (organization_id, alignment_id, version_id, surface, person_id, agent_id, interaction_id, reference_date)
       select $1, alignment_id, version_id, $4, $5, $6, $7, $8 from unnest($2::uuid[], $3::uuid[]) as u(alignment_id, version_id)`,
      [organizationId, rows.map((row) => row.alignmentId), rows.map((row) => row.versionId), usage.surface, usage.personId, usage.agentId ?? null, usage.interactionId ?? null, resolution.referenceDate],
    )
    .catch((error: unknown) => {
      if ((error as { code?: string })?.code === "QA_WRITE_BLOCKED") return
      console.warn(JSON.stringify({ event: "operational_alignment_usage_not_recorded", name: (error as Error)?.name, code: (error as { code?: string })?.code ?? null }))
    })
}

/**
 * Job `operational-alignments-lifecycle`: grava, uma vez por versão, quando ela COMEÇOU a valer e quando EXPIROU pelo relógio (o
 * instante gravado é o da vigência, não o do job). Encerramento antecipado e cancelamento já foram gravados por quem os fez; versão
 * substituída antes de começar não "começa".
 *
 * Sino "alinhamento em vigor" (QA-02): o aviso sai ANTES do evento `STARTED`. Se o envio falhar (ou o processo cair no meio), o evento
 * das versões ainda dentro da janela do aviso NÃO é gravado, e a próxima passada tenta de novo — o aviso é idempotente pela chave.
 * Versão que começou há mais que a janela não avisa mais; o evento dela é gravado de qualquer forma (o rastro nunca fica preso).
 * O evento é gravado só para as versões lidas (e avisadas) nesta passada, pela lista de ids — nunca reaplicando o filtro (DC-03).
 */
export const ALIGNMENT_STARTED_NOTICE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000

export async function runAlignmentLifecycle(db: Queryable, now: Date = new Date(), notifyStarted: (versionIds: string[], now: Date) => Promise<unknown> = async () => undefined): Promise<{ started: number; expired: number }> {
  const startedFilter = `v.status in ('PUBLISHED', 'SUPERSEDED') and v.effective_from <= $1 and v.effective_until > v.effective_from`
  const pending = (await db.query<{ version_id: string; effective_from: Date }>(
    `select v.id version_id, v.effective_from from operational_alignment_versions v
     where ${startedFilter}
       and not exists (select 1 from operational_alignment_events e where e.version_id = v.id and e.event_type = 'STARTED')`,
    [now],
  )).rows
  let retryLater: string[] = []
  if (pending.length > 0) {
    await notifyStarted(pending.map((row) => row.version_id), now).catch((error: unknown) => {
      console.error("Falha no aviso de alinhamento em vigor (nova tentativa na próxima passada):", error)
      retryLater = pending.filter((row) => now.getTime() - new Date(row.effective_from).getTime() <= ALIGNMENT_STARTED_NOTICE_WINDOW_MS).map((row) => row.version_id)
    })
  }
  const started = await db.query(
    `insert into operational_alignment_events (organization_id, alignment_id, version_id, version, event_type, actor_person_id, occurred_at, details)
     select v.organization_id, v.alignment_id, v.id, v.version, 'STARTED', null, v.effective_from, jsonb_build_object('startsOn', v.starts_on, 'timeZone', v.time_zone)
     from operational_alignment_versions v
     where ${startedFilter} and v.id = any($2::uuid[])
     on conflict do nothing`,
    // Só as versões LIDAS nesta passada e já avisadas (DC-03): versão publicada durante o envio não ganha `STARTED` sem sino — ela
    // entra em `pending` na passada seguinte.
    [now, pending.map((row) => row.version_id).filter((id) => !retryLater.includes(id))],
  )
  const expired = await db.query(
    `insert into operational_alignment_events (organization_id, alignment_id, version_id, version, event_type, actor_person_id, occurred_at, details)
     select v.organization_id, v.alignment_id, v.id, v.version, 'EXPIRED', null, v.effective_until,
            jsonb_build_object('endsOn', v.ends_on, 'timeZone', v.time_zone, 'reason', case when v.ended_at is not null then 'ENDED_EARLY' when v.status = 'SUPERSEDED' then 'SUPERSEDED' else 'END_DATE' end)
     from operational_alignment_versions v
     where v.status in ('PUBLISHED', 'SUPERSEDED') and v.effective_until <= $1 and v.effective_until > v.effective_from
     on conflict do nothing`,
    [now],
  )
  return { started: started.rowCount ?? 0, expired: expired.rowCount ?? 0 }
}
