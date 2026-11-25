import type { Database } from "../../../infrastructure/database/pool.js"
import { coveringStatusPeriodSql } from "../../people/application/employment-status-service.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"

/** Quem está de FÉRIAS hoje, entre as pessoas pedidas — assinatura do port injetado no builder da estrutura. */
export type PeopleOnVacationLoader = (organizationId: string, personIds: string[], now: Date) => Promise<Set<string>>

/**
 * Férias na data local da organização, pelo MESMO fragmento SQL da projeção diária e das métricas da estrutura (o período que cobre a
 * data; `VACATION` é o código legado). Só devolve férias: nenhuma outra situação sai daqui — INSS, maternidade e paternidade nunca
 * aparecem por pessoa no organograma. Duas consultas fixas (fuso e lote), qualquer que seja o número de pessoas.
 */
export async function loadPeopleOnVacation(db: Database, organizationId: string, personIds: string[], now: Date): Promise<Set<string>> {
  if (personIds.length === 0) return new Set()
  const today = localDateOf(now, await resolveOrganizationTimezone(db, organizationId))
  const result = await db.query<{ id: string }>(
    `select p.id from people p
      where p.organization_id = $1 and p.active and p.id = any($2::uuid[])
        and ${coveringStatusPeriodSql("p", "$3")} in ('FERIAS', 'VACATION')`,
    [organizationId, personIds, today],
  )
  return new Set(result.rows.map((row) => row.id))
}
