import type { Database } from "../../../infrastructure/database/pool.js"
import type { OperationalAggregationKind } from "../../indicators/domain/operational-aggregation.js"

/**
 * Resolução referencial EM LOTE — uma query por tipo de referência por carga, nunca uma consulta
 * por linha. Referência inexistente vira quarentena (DATA_*_NOT_FOUND); a Central NUNCA cria
 * pessoa, indicador, grupo ou interação implicitamente.
 */
type Queryable = Pick<Database, "query">

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))]
}

export type EmployeeRef = { id: string; matricula: string; teamId: string | null; subteamId: string | null; role: string; active: boolean }

export async function resolveEmployees(db: Queryable, organizationId: string, matriculas: readonly (string | null | undefined)[]): Promise<Map<string, EmployeeRef>> {
  const keys = unique(matriculas)
  if (keys.length === 0) return new Map()
  const result = await db.query<EmployeeRef>(
    `select id, matricula, team_id "teamId", subteam_id "subteamId", role, active from people where organization_id = $1 and matricula = any($2::text[])`,
    [organizationId, keys],
  )
  return new Map(result.rows.map((row) => [row.matricula, row]))
}

export type IndicatorRef = {
  id: string
  code: string
  unit: string
  direction: string
  aggregation: OperationalAggregationKind
  dailySupported: boolean
  officialClosureSupported: boolean
  active: boolean
}

export async function resolveIndicators(db: Queryable, organizationId: string, codes: readonly (string | null | undefined)[]): Promise<Map<string, IndicatorRef>> {
  const keys = unique(codes.map((code) => code?.trim().toUpperCase()))
  if (keys.length === 0) return new Map()
  const result = await db.query<IndicatorRef>(
    `select id, code, unit, desired_direction direction, operational_aggregation aggregation, daily_supported "dailySupported",
            official_closure_supported "officialClosureSupported", active
     from indicator_definitions where organization_id = $1 and code = any($2::text[])`,
    [organizationId, keys],
  )
  return new Map(result.rows.map((row) => [row.code, row]))
}

export type TeamRef = { id: string; externalCode: string; name: string; operationId: string }

export async function resolveTeams(db: Queryable, organizationId: string, codes: readonly (string | null | undefined)[]): Promise<Map<string, TeamRef>> {
  const keys = unique(codes)
  if (keys.length === 0) return new Map()
  const result = await db.query<TeamRef>(`select id, external_code "externalCode", name, operation_id "operationId" from teams where organization_id = $1 and external_code = any($2::text[])`, [organizationId, keys])
  return new Map(result.rows.map((row) => [row.externalCode, row]))
}

export type SubteamRef = { id: string; externalCode: string; name: string; teamId: string }

export async function resolveSubteams(db: Queryable, organizationId: string, codes: readonly (string | null | undefined)[]): Promise<Map<string, SubteamRef>> {
  const keys = unique(codes)
  if (keys.length === 0) return new Map()
  const result = await db.query<SubteamRef>(`select id, external_code "externalCode", name, team_id "teamId" from subteams where organization_id = $1 and external_code = any($2::text[])`, [organizationId, keys])
  return new Map(result.rows.map((row) => [row.externalCode, row]))
}

export type InteractionRef = { id: string; externalId: string; operatorId: string; channel: string }

export async function resolveInteractions(db: Queryable, organizationId: string, externalIds: readonly (string | null | undefined)[]): Promise<Map<string, InteractionRef>> {
  const keys = unique(externalIds)
  if (keys.length === 0) return new Map()
  const result = await db.query<InteractionRef>(`select id, external_id "externalId", operator_id "operatorId", channel from interactions where organization_id = $1 and external_id = any($2::text[])`, [organizationId, keys])
  return new Map(result.rows.map((row) => [row.externalId, row]))
}

export type ChannelFlagRef = { id: string; channel: string; flagName: string; valueType: "BOOLEAN" | "NUMERIC" }

/** Catálogo de flags ativas dos canais pedidos: canal → nome → flag. */
export async function resolveChannelFlags(db: Queryable, organizationId: string, channels: readonly (string | null | undefined)[]): Promise<Map<string, Map<string, ChannelFlagRef>>> {
  const keys = unique(channels)
  if (keys.length === 0) return new Map()
  const result = await db.query<ChannelFlagRef>(`select id, channel, flag_name "flagName", value_type "valueType" from channel_flags where organization_id = $1 and channel = any($2::text[]) and active`, [organizationId, keys])
  const byChannel = new Map<string, Map<string, ChannelFlagRef>>()
  for (const row of result.rows) {
    if (!byChannel.has(row.channel)) byChannel.set(row.channel, new Map())
    byChannel.get(row.channel)!.set(row.flagName, row)
  }
  return byChannel
}

export type OperationRef = { id: string; name: string }

export async function resolveOperations(db: Queryable, organizationId: string): Promise<{ byName: Map<string, OperationRef>; defaultOperation: OperationRef | null }> {
  const result = await db.query<OperationRef>(`select id, name from operations where organization_id = $1 order by created_at`, [organizationId])
  return { byName: new Map(result.rows.map((row) => [row.name, row])), defaultOperation: result.rows[0] ?? null }
}
