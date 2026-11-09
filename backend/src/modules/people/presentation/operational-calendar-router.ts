import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { buildHolidayCatalogCoverage } from "../application/holiday-catalog-coverage.js"
import { resolveWorkScheduleHorizon } from "../application/work-schedule-service.js"
import { BRAZILIAN_CAPITALS, BRAZILIAN_STATE_CODES } from "../domain/brazilian-capitals.js"
import { HOLIDAY_FALLBACK_POLICIES } from "../domain/work-schedule.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * Calendário operacional — feriados da organização (`/api/v1/admin/operational-calendar/holidays`,
 * só ADMIN). Configuração administrativa pequena, não um dataset da Central.
 *
 * Regra (people/domain/work-schedule.ts): feriado cadastrado NÃO significa que ninguém trabalha —
 * só atua como folga no fallback legado seg–sex de quem não tem escala explícita. Escala explícita
 * vence feriado (call center opera em feriado quando a escala diz).
 */

export const HOLIDAY_SCOPES = ["ORGANIZATION", "NATIONAL", "STATE", "CITY"] as const

const holidayFieldsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().trim().min(2).max(120),
  scope: z.enum(HOLIDAY_SCOPES),
  active: z.boolean(),
})

const createHolidaySchema = holidayFieldsSchema.extend({
  scope: holidayFieldsSchema.shape.scope.default("ORGANIZATION"),
  active: holidayFieldsSchema.shape.active.default(true),
})

// Sem `.default`: o Zod 4 aplica o padrão mesmo dentro de `.partial()`, e o `coalesce` do PATCH gravaria o padrão por cima do
// valor atual. O interruptor da tela envia só `active`, e isso trocava a abrangência do feriado.
const updateHolidaySchema = holidayFieldsSchema.partial()

const SELECT = `select id, holiday_date::text "date", name, scope, active, created_at "createdAt", updated_at "updatedAt" from organization_holidays where organization_id = $1`

const settingsSchema = z.object({
  holidayFallbackPolicy: z.enum(HOLIDAY_FALLBACK_POLICIES).optional(),
  scheduleHorizonWarningDays: z.number().int().min(1).max(90).optional(),
})

const catalogQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  capital: z.string().optional(),
  state: z.string().length(2).optional(),
  scope: z.enum(["NATIONAL", "STATE", "MUNICIPAL_CAPITAL"]).optional(),
})

export function createOperationalCalendarRouter(db: Database) {
  const router = Router()

  /** Reference data: as 27 capitais (código, nome, UF, IBGE) — sem CRUD. */
  router.get("/capitals", (_request, response) => {
    response.json({ data: { capitals: BRAZILIAN_CAPITALS, states: BRAZILIAN_STATE_CODES } })
  })

  /** Política de feriado no fallback + limite de aviso do horizonte da escala. */
  router.get("/settings", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const result = await db.query<{ holidayFallbackPolicy: string; scheduleHorizonWarningDays: number }>(`select holiday_fallback_policy "holidayFallbackPolicy", schedule_horizon_warning_days "scheduleHorizonWarningDays" from organizations where id = $1`, [organizationId])
    const timeZone = await resolveOrganizationTimezone(db, organizationId)
    const horizon = await resolveWorkScheduleHorizon(db, organizationId, localDateOf(new Date(), timeZone))
    response.json({ data: { ...result.rows[0], horizon } })
  })

  router.patch("/settings", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = settingsSchema.parse(request.body)
    const result = await db.query<{ holidayFallbackPolicy: string; scheduleHorizonWarningDays: number }>(
      `update organizations set holiday_fallback_policy = coalesce($2, holiday_fallback_policy), schedule_horizon_warning_days = coalesce($3, schedule_horizon_warning_days)
        where id = $1 returning holiday_fallback_policy "holidayFallbackPolicy", schedule_horizon_warning_days "scheduleHorizonWarningDays"`,
      [organizationId, input.holidayFallbackPolicy ?? null, input.scheduleHorizonWarningDays ?? null],
    )
    const timeZone = await resolveOrganizationTimezone(db, organizationId)
    const horizon = await resolveWorkScheduleHorizon(db, organizationId, localDateOf(new Date(), timeZone))
    response.json({ data: { ...result.rows[0], horizon } })
  })

  /**
   * Catálogo-base de feriados (read-only, controlado pelo sistema): filtros por ano, capital, UF e
   * escopo. Com `capital`, devolve o que SE APLICA àquela capital (nacional + UF derivada + municipal).
   */
  /** Cobertura verificada do catálogo-base por ano + registro explícito de lacunas/pendências de verificação. */
  router.get("/catalog/coverage", async (_request, response) => {
    response.json({ data: await buildHolidayCatalogCoverage(db) })
  })

  router.get("/catalog", async (request, response) => {
    const query = catalogQuerySchema.parse(request.query)
    const capital = query.capital ? BRAZILIAN_CAPITALS.find((entry) => entry.code === query.capital) : null
    if (query.capital && !capital) return response.status(400).json({ error: { code: "CAPITAL_UNKNOWN", message: "Capital fora do catálogo das 27 capitais." } })
    const result = await db.query(
      `select id, holiday_date::text "date", name, scope, country_code "countryCode", state_code "stateCode", capital_code "capitalCode",
              source_name "sourceName", source_reference "sourceReference", legal_reference "legalReference", verification, active
         from holiday_catalog
        where active
          and ($1::int is null or extract(year from holiday_date) = $1)
          and ($2::text is null or scope = $2)
          and ($3::text is null or scope = 'NATIONAL' or (scope = 'STATE' and state_code = $3) or (scope = 'MUNICIPAL_CAPITAL' and capital_code = $4))
          and ($5::text is null or scope = 'NATIONAL' or (scope = 'STATE' and state_code = $5) or (scope = 'MUNICIPAL_CAPITAL' and capital_code in (select code from brazilian_capitals where state_code = $5)))
        order by holiday_date, scope, name`,
      [query.year ?? null, query.scope ?? null, capital?.stateCode ?? null, capital?.code ?? null, !capital && query.state ? query.state.toUpperCase() : null],
    )
    response.json({ data: result.rows })
  })

  router.get("/holidays", async (request, response) => {
    const result = await db.query(`${SELECT} order by holiday_date`, [sessionUser(request).organizationId])
    response.json({ data: result.rows })
  })

  router.post("/holidays", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = createHolidaySchema.parse(request.body)
    const result = await db.query(
      `insert into organization_holidays_all (organization_id, holiday_date, name, scope, active) values ($1, $2, $3, $4, $5)
       on conflict (organization_id, holiday_date, name) where deleted_at is null do update set scope = excluded.scope, active = excluded.active, updated_at = now()
       returning id, holiday_date::text "date", name, scope, active, created_at "createdAt", updated_at "updatedAt"`,
      [organizationId, input.date, input.name, input.scope, input.active],
    )
    response.status(201).json({ data: result.rows[0] })
  })

  router.patch("/holidays/:id", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = updateHolidaySchema.parse(request.body)
    const result = await db.query(
      `update organization_holidays set holiday_date = coalesce($3::date, holiday_date), name = coalesce($4, name), scope = coalesce($5, scope), active = coalesce($6, active), updated_at = now()
       where id = $2 and organization_id = $1
       returning id, holiday_date::text "date", name, scope, active, created_at "createdAt", updated_at "updatedAt"`,
      [organizationId, request.params.id, input.date ?? null, input.name ?? null, input.scope ?? null, input.active ?? null],
    )
    if (!result.rows[0]) return response.status(404).json({ error: { code: "HOLIDAY_NOT_FOUND", message: "Feriado não encontrado." } })
    response.json({ data: result.rows[0] })
  })

  router.delete("/holidays/:id", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    // Exclusão lógica (migration 177): sai do calendário e do cálculo, e volta pela Central de Dados, desligado.
    const result = await db.query(`update organization_holidays_all set active = false, deleted_at = now(), deleted_by_person_id = $3, updated_at = now() where id = $2 and organization_id = $1 and deleted_at is null`, [organizationId, request.params.id, sessionUser(request).personId ?? null])
    if (!result.rowCount) return response.status(404).json({ error: { code: "HOLIDAY_NOT_FOUND", message: "Feriado não encontrado." } })
    response.status(204).end()
  })

  return router
}
