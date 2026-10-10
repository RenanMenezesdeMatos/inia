import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { canonicalComparison, INDICATOR_CANONICAL_CONTEXT_CONTRACT, type IndicatorCanonicalContext, type IndicatorDirection, type TargetSource } from "../domain/indicator-canonical-context.js"

/**
 * Leitura ÚNICA do contexto canônico de UMA medição de indicador (V1.5.12a): valor e período da medição (tabela oficial
 * `indicator_measurements`), definição do catálogo (nome/unidade/direção) e meta vigente da pessoa na data final LOCAL do
 * período (pessoa > Subgrupo > Grupo). Usada por "Chamar agente" (o que o Agent lê) e pelo feedback confiável (o que a
 * validação aceita) — nunca duas leituras. Escopada: medição e pessoa da organização; com `collaboratorId`, a medição
 * precisa ser dele. Divergência = null (quem chama decide falhar fechado).
 */
export async function loadIndicatorCanonicalContext(
  db: Pick<Database, "query">,
  input: { organizationId: string; measurementId: string; collaboratorId?: string | null; now?: Date },
): Promise<IndicatorCanonicalContext | null> {
  const { organizationId, measurementId } = input
  const measurement = (await db.query<{ id: string; subject_id: string; value: string; period_start: Date; period_end: Date; granularity: string | null; indicator_id: string; code: string; name: string; unit: string; desired_direction: IndicatorDirection }>(
    `select m.id, m.subject_id, m.value, m.period_start, m.period_end, m.granularity, i.id indicator_id, i.code, i.name, i.unit, i.desired_direction
     from indicator_measurements m
     join indicator_definitions i on i.id = m.indicator_definition_id and i.organization_id = $2
     join people p on p.id = m.subject_id and p.organization_id = $2
     where m.id = $1 and m.subject_type = 'PERSON'`,
    [measurementId, organizationId],
  )).rows[0]
  if (!measurement) return null
  if (input.collaboratorId && measurement.subject_id !== input.collaboratorId) return null
  const subjectId = measurement.subject_id
  // Datas LOCAIS da organização (o fim do intervalo é exclusivo quando cai à meia-noite: 00:00 do dia seguinte = o próprio dia).
  const timeZone = await resolveOrganizationTimezone(db as Database, organizationId)
  const periodStart = localDateOf(new Date(measurement.period_start), timeZone)
  const endCandidate = localDateOf(new Date(new Date(measurement.period_end).getTime() - 1), timeZone)
  const periodEnd = endCandidate < periodStart ? periodStart : endCandidate
  const person = (await db.query<{ team_id: string | null; subteam_id: string | null }>(`select team_id, subteam_id from people where id = $1 and organization_id = $2`, [subjectId, organizationId])).rows[0]
  const candidates: { type: TargetSource; id: string | null }[] = [{ type: "PERSON", id: subjectId }, { type: "SUBTEAM", id: person?.subteam_id ?? null }, { type: "TEAM", id: person?.team_id ?? null }]
  let target: { value: number; source: TargetSource; goalId: string } | null = null
  for (const candidate of candidates) {
    if (!candidate.id) continue
    const goal = (await db.query<{ id: string; target_value: string }>(
      `select id, target_value from goals
       where organization_id = $1 and indicator_definition_id = $2 and subject_type = $3 and subject_id = $4
         and valid_from <= $5::date and (valid_until is null or valid_until >= $5::date)
       order by valid_from desc limit 1`,
      [organizationId, measurement.indicator_id, candidate.type, candidate.id, periodEnd],
    )).rows[0]
    if (goal) {
      target = { value: Number(goal.target_value), source: candidate.type, goalId: goal.id }
      break
    }
  }
  const value = Number(measurement.value)
  return {
    contract: INDICATOR_CANONICAL_CONTEXT_CONTRACT,
    indicator: { id: measurement.indicator_id, code: measurement.code, name: measurement.name, unit: measurement.unit, direction: measurement.desired_direction },
    measurement: { id: measurement.id, subjectId, value, periodStart, periodEnd, periodEndAt: new Date(measurement.period_end).toISOString(), granularity: measurement.granularity },
    target,
    ...canonicalComparison(value, target?.value ?? null, measurement.desired_direction),
    provenance: { source: "indicator_measurements+goals", loadedAt: (input.now ?? new Date()).toISOString() },
  }
}
