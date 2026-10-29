import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import {
  diagnosticStrategyConfigSchema,
  emptyStrategyConfig,
  strategyCapabilities,
  validateStrategyForPublish,
  type DiagnosticStrategyConfig,
  type StrategyCapabilityCatalog,
  type StrategyIssue,
} from "../domain/diagnostic-strategy.js"
import { strategyActiveAt, versionInForceAt } from "../domain/strategy-at-birth.js"
import { transactionRunner } from "../../../shared/infrastructure/database/transaction.js"

/**
 * V1.6.2 — SERVIÇO DA ESTRATÉGIA DE DIAGNÓSTICO (único ponto de escrita/leitura das tabelas da migration 086). Toda leitura e
 * escrita é escopada à organização da SESSÃO (nunca constante). Rascunho é editável e nunca executado; publicar valida a
 * combinação inteira (a mesma função pura da tela) e torna a versão imutável; editar uma publicada cria o próximo rascunho.
 */
type Queryable = Pick<Database, "query">
export type StrategyStatus = "NOT_CONFIGURED" | "DRAFT" | "PUBLISHED" | "INACTIVE"
export type StrategyVersionView = { id: string; version: number; status: "DRAFT" | "PUBLISHED" | "SUPERSEDED"; config: DiagnosticStrategyConfig; createdAt: string; createdByName: string | null; publishedAt: string | null; publishedByName: string | null }
export type StrategyOverview = {
  indicator: { id: string; code: string; name: string; unit: string; active: boolean }
  status: StrategyStatus
  active: boolean
  published: StrategyVersionView | null
  draft: StrategyVersionView | null
  history: { id: string; version: number; status: string; publishedAt: string | null; publishedByName: string | null }[]
  draftIssues: StrategyIssue[]
  capabilities: StrategyCapabilityCatalog
  domains: { id: string; name: string; active: boolean }[]
  /** Ponto de partida de um NOVO rascunho (a vigente, ou tudo desligado): a tela edita localmente e só grava ao salvar. */
  newDraftTemplate: DiagnosticStrategyConfig
}

/** Expressão SQL do status (listagem de indicadores): `i` = indicator_definitions. */
export const strategyStatusSql = (indicatorAlias = "i") => `(
  select case
    when s.id is null then 'NOT_CONFIGURED'
    when not s.active then 'INACTIVE'
    when exists (select 1 from indicator_diagnostic_strategy_versions v where v.strategy_id = s.id and v.status = 'PUBLISHED') then 'PUBLISHED'
    when exists (select 1 from indicator_diagnostic_strategy_versions v where v.strategy_id = s.id and v.status = 'DRAFT') then 'DRAFT'
    else 'NOT_CONFIGURED' end
  from (select 1) one left join indicator_diagnostic_strategies s on s.indicator_definition_id = ${indicatorAlias}.id and s.organization_id = ${indicatorAlias}.organization_id
)`

/** Há um rascunho à espera de publicação sobre uma versão já publicada (o status continua "Configurado" — a vigente não muda). */
export const strategyDraftPendingSql = (indicatorAlias = "i") => `exists (
  select 1 from indicator_diagnostic_strategies s
  where s.indicator_definition_id = ${indicatorAlias}.id and s.organization_id = ${indicatorAlias}.organization_id
    and exists (select 1 from indicator_diagnostic_strategy_versions v where v.strategy_id = s.id and v.status = 'PUBLISHED')
    and exists (select 1 from indicator_diagnostic_strategy_versions v where v.strategy_id = s.id and v.status = 'DRAFT')
)`

async function loadIndicator(db: Queryable, organizationId: string, indicatorId: string) {
  const row = (await db.query<{ id: string; code: string; name: string; unit: string; active: boolean }>(`select id, code, name, unit, active from indicator_definitions where id = $1 and organization_id = $2`, [indicatorId, organizationId])).rows[0]
  if (!row) throw new DomainError("Indicador não encontrado.", "INDICATOR_NOT_FOUND", 404)
  return row
}

type VersionRow = { id: string; version: number; status: "DRAFT" | "PUBLISHED" | "SUPERSEDED"; config: unknown; created_at: Date; created_by_name: string | null; published_at: Date | null; published_by_name: string | null }
const VERSION_SELECT = `select v.id, v.version, v.status, v.config, v.created_at, cp.name created_by_name, v.published_at, pp.name published_by_name
  from indicator_diagnostic_strategy_versions v
  left join user_accounts cu on cu.id = v.created_by left join people cp on cp.id = cu.person_id
  left join user_accounts pu on pu.id = v.published_by left join people pp on pp.id = pu.person_id`

/** Configuração gravada → tipada. Uma versão que não passa no schema atual é tratada como inexistente (nunca "consertada"). */
function parseConfig(value: unknown): DiagnosticStrategyConfig | null {
  const parsed = diagnosticStrategyConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
function toView(row: VersionRow): StrategyVersionView | null {
  const config = parseConfig(row.config)
  if (!config) return null
  return { id: row.id, version: row.version, status: row.status, config, createdAt: row.created_at.toISOString(), createdByName: row.created_by_name, publishedAt: row.published_at?.toISOString() ?? null, publishedByName: row.published_by_name }
}

async function domainsOf(db: Queryable, organizationId: string, ids: readonly string[]) {
  const rows = ids.length > 0 ? (await db.query<{ id: string; active: boolean }>(`select id, active from business_domains where organization_id = $1 and id = any($2::uuid[])`, [organizationId, [...ids]])).rows : []
  return ids.map((id) => ({ id, exists: rows.some((row) => row.id === id), active: rows.find((row) => row.id === id)?.active ?? false }))
}

export async function validateStrategyConfig(db: Queryable, organizationId: string, indicatorUnit: string, config: DiagnosticStrategyConfig): Promise<StrategyIssue[]> {
  // V2 — o sinal da população precisa ser uma flag do catálogo de canal da organização (booleana, ativa).
  const flags = config.populationSignal ? (await db.query<{ flag_name: string; value_type: string; active: boolean }>(`select flag_name, value_type, active from channel_flags where organization_id = $1 and flag_name = $2`, [organizationId, config.populationSignal.flagName])).rows.map((row) => ({ name: row.flag_name, valueType: row.value_type, active: row.active })) : []
  return validateStrategyForPublish(config, { indicatorUnit, domains: await domainsOf(db, organizationId, config.allowedBusinessDomainIds), flags })
}

export async function loadStrategyOverview(db: Queryable, organizationId: string, indicatorId: string): Promise<StrategyOverview> {
  const indicator = await loadIndicator(db, organizationId, indicatorId)
  const header = (await db.query<{ id: string; active: boolean }>(`select id, active from indicator_diagnostic_strategies where organization_id = $1 and indicator_definition_id = $2`, [organizationId, indicatorId])).rows[0] ?? null
  const versions = header ? (await db.query<VersionRow>(`${VERSION_SELECT} where v.strategy_id = $1 and v.organization_id = $2 order by v.version desc`, [header.id, organizationId])).rows : []
  const published = versions.find((row) => row.status === "PUBLISHED")
  const draft = versions.find((row) => row.status === "DRAFT")
  const publishedView = published ? toView(published) : null
  const draftView = draft ? toView(draft) : null
  const status: StrategyStatus = !header ? "NOT_CONFIGURED" : !header.active ? "INACTIVE" : publishedView ? "PUBLISHED" : draftView ? "DRAFT" : "NOT_CONFIGURED"
  const domains = (await db.query<{ id: string; name: string; active: boolean }>(`select id, name, active from business_domains where organization_id = $1 order by name`, [organizationId])).rows
  return {
    indicator,
    status,
    active: header?.active ?? true,
    published: publishedView,
    draft: draftView,
    history: versions.filter((row) => row.status !== "DRAFT").map((row) => ({ id: row.id, version: row.version, status: row.status, publishedAt: row.published_at?.toISOString() ?? null, publishedByName: row.published_by_name })),
    draftIssues: draftView ? await validateStrategyConfig(db, organizationId, indicator.unit, draftView.config) : [],
    capabilities: strategyCapabilities({ unit: indicator.unit }, { populationSignal: (draftView ?? publishedView)?.config.populationSignal ?? null }),
    domains,
    newDraftTemplate: publishedView?.config ?? emptyStrategyConfig(),
  }
}

function parseDraftInput(value: unknown): DiagnosticStrategyConfig {
  const parsed = diagnosticStrategyConfigSchema.safeParse(value)
  if (!parsed.success) throw new DomainError("Configuração da estratégia inválida.", "STRATEGY_INVALID", 422, { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) })
  return parsed.data
}

async function audit(db: Queryable, organizationId: string, actorPersonId: string, action: string, entityId: string, payload: Record<string, unknown>) {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'indicator_diagnostic_strategy', $4, $5)`, [organizationId, actorPersonId, action, entityId, JSON.stringify(payload)])
}

/**
 * Transação da escrita: com o POOL, uma conexão dedicada (begin/commit); com um CLIENT já dentro de uma transação (provas,
 * QA), um savepoint — nunca um commit que vazaria a transação de fora.
 */
const inTransaction = transactionRunner("indicator_strategy_tx")

export type StrategyActor = { userAccountId: string; personId: string }

/**
 * Salva o RASCUNHO (cria o cabeçalho e/ou a próxima versão quando não há rascunho). Sem `config` = começa da versão publicada
 * (editar uma publicada) ou, sem publicada, de tudo desligado. Nunca toca a versão publicada.
 */
export async function saveStrategyDraft(db: Database, organizationId: string, indicatorId: string, input: { config?: unknown }, actor: StrategyActor): Promise<StrategyOverview> {
  const indicator = await loadIndicator(db, organizationId, indicatorId)
  await inTransaction(db, async (client) => {
    const header = (await client.query<{ id: string }>(
      `insert into indicator_diagnostic_strategies (organization_id, indicator_definition_id, created_by) values ($1, $2, $3)
       on conflict (organization_id, indicator_definition_id) do update set updated_at = now() returning id`,
      [organizationId, indicator.id, actor.userAccountId],
    )).rows[0]!
    await client.query(`select id from indicator_diagnostic_strategies where id = $1 for update`, [header.id])
    const draft = (await client.query<{ id: string }>(`select id from indicator_diagnostic_strategy_versions where strategy_id = $1 and status = 'DRAFT'`, [header.id])).rows[0]
    const published = (await client.query<{ config: unknown }>(`select config from indicator_diagnostic_strategy_versions where strategy_id = $1 and status = 'PUBLISHED'`, [header.id])).rows[0]
    const config = input.config !== undefined ? parseDraftInput(input.config) : parseConfig(published?.config) ?? emptyStrategyConfig()
    if (draft) {
      await client.query(`update indicator_diagnostic_strategy_versions set config = $2, updated_at = now() where id = $1 and status = 'DRAFT'`, [draft.id, JSON.stringify(config)])
    } else {
      const next = (await client.query<{ next: number }>(`select coalesce(max(version), 0) + 1 next from indicator_diagnostic_strategy_versions where strategy_id = $1`, [header.id])).rows[0]!.next
      await client.query(`insert into indicator_diagnostic_strategy_versions (organization_id, strategy_id, version, status, config, created_by) values ($1, $2, $3, 'DRAFT', $4, $5)`, [organizationId, header.id, next, JSON.stringify(config), actor.userAccountId])
    }
  })
  return loadStrategyOverview(db, organizationId, indicatorId)
}

/** Publica o rascunho: valida a combinação inteira; a vigente vira histórico (SUPERSEDED); o rascunho vira a nova vigente. */
export async function publishStrategyDraft(db: Database, organizationId: string, indicatorId: string, actor: StrategyActor): Promise<StrategyOverview> {
  const indicator = await loadIndicator(db, organizationId, indicatorId)
  await inTransaction(db, async (client) => {
    const header = (await client.query<{ id: string }>(`select id from indicator_diagnostic_strategies where organization_id = $1 and indicator_definition_id = $2 for update`, [organizationId, indicator.id])).rows[0]
    const draft = header ? (await client.query<{ id: string; version: number; config: unknown }>(`select id, version, config from indicator_diagnostic_strategy_versions where strategy_id = $1 and status = 'DRAFT'`, [header.id])).rows[0] : undefined
    if (!header || !draft) throw new DomainError("Não há rascunho para publicar.", "STRATEGY_DRAFT_NOT_FOUND", 409)
    const config = parseConfig(draft.config)
    if (!config) throw new DomainError("Configuração da estratégia inválida.", "STRATEGY_INVALID", 422)
    const issues = await validateStrategyConfig(client, organizationId, indicator.unit, config)
    if (issues.length > 0) throw new DomainError(issues[0]!.message, "STRATEGY_INVALID_FOR_PUBLISH", 422, { issues })
    await client.query(`update indicator_diagnostic_strategy_versions set status = 'SUPERSEDED', updated_at = now() where strategy_id = $1 and status = 'PUBLISHED'`, [header.id])
    await client.query(`update indicator_diagnostic_strategy_versions set status = 'PUBLISHED', published_at = now(), published_by = $2, updated_at = now() where id = $1 and status = 'DRAFT'`, [draft.id, actor.userAccountId])
    await client.query(`update indicator_diagnostic_strategies set updated_at = now() where id = $1`, [header.id])
    await audit(client, organizationId, actor.personId, "INDICATOR_DIAGNOSTIC_STRATEGY_PUBLISHED", draft.id, { indicatorId: indicator.id, version: draft.version })
  })
  return loadStrategyOverview(db, organizationId, indicatorId)
}

export async function discardStrategyDraft(db: Database, organizationId: string, indicatorId: string, actor: StrategyActor): Promise<StrategyOverview> {
  await loadIndicator(db, organizationId, indicatorId)
  await inTransaction(db, async (tx) => {
    const discarded = (await tx.query<{ id: string; version: number; strategy_id: string }>(
      `delete from indicator_diagnostic_strategy_versions v using indicator_diagnostic_strategies s
       where v.strategy_id = s.id and s.organization_id = $1 and s.indicator_definition_id = $2 and v.status = 'DRAFT'
       returning v.id, v.version, v.strategy_id`,
      [organizationId, indicatorId],
    )).rows[0]
    // Só o que identifica o descarte (nunca a configuração): quem, qual indicador, qual versão.
    if (discarded) await audit(tx, organizationId, actor.personId, "INDICATOR_DIAGNOSTIC_STRATEGY_DRAFT_DISCARDED", discarded.id, { indicatorId, strategyId: discarded.strategy_id, version: discarded.version })
  })
  return loadStrategyOverview(db, organizationId, indicatorId)
}

const ACTIVATION_ACTIONS = { ACTIVATED: "INDICATOR_DIAGNOSTIC_STRATEGY_ACTIVATED", DEACTIVATED: "INDICATOR_DIAGNOSTIC_STRATEGY_DEACTIVATED" } as const

/**
 * Ativa/desativa (nunca apaga versões). Inativa = as próximas execuções não recebem estratégia (feedback factual). Mudança e evento
 * de auditoria na MESMA transação: o evento é o histórico de ativação que a execução nascida antes usa (`STRATEGY_AT_BIRTH_V1`).
 */
export async function setStrategyActive(db: Database, organizationId: string, indicatorId: string, active: boolean, actor: StrategyActor): Promise<StrategyOverview> {
  await loadIndicator(db, organizationId, indicatorId)
  await inTransaction(db, async (tx) => {
    const header = (await tx.query<{ id: string }>(`update indicator_diagnostic_strategies set active = $3, updated_at = now() where organization_id = $1 and indicator_definition_id = $2 returning id`, [organizationId, indicatorId, active])).rows[0]
    if (!header) throw new DomainError("Este indicador ainda não tem estratégia de diagnóstico.", "STRATEGY_NOT_FOUND", 404)
    await audit(tx, organizationId, actor.personId, active ? ACTIVATION_ACTIONS.ACTIVATED : ACTIVATION_ACTIONS.DEACTIVATED, header.id, { indicatorId })
  })
  return loadStrategyOverview(db, organizationId, indicatorId)
}

// ---------------------------------------------------------------------------------------------
// LEITURA PARA O RUNTIME
// ---------------------------------------------------------------------------------------------

export type ResolvedStrategy = { id: string; version: number; config: DiagnosticStrategyConfig }

/** Versão EFETIVA de um indicador (cabeçalho ativo + versão publicada) — por id ou código. null = sem estratégia. */
export async function loadEffectiveStrategy(db: Queryable, organizationId: string, indicator: { id?: string; code?: string }): Promise<ResolvedStrategy | null> {
  const row = (await db.query<{ id: string; version: number; config: unknown }>(
    `select v.id, v.version, v.config from indicator_diagnostic_strategy_versions v
     join indicator_diagnostic_strategies s on s.id = v.strategy_id and s.active
     join indicator_definitions i on i.id = s.indicator_definition_id and i.organization_id = s.organization_id
     where s.organization_id = $1 and v.status = 'PUBLISHED' and (i.id = $2::uuid or i.code = $3)`,
    [organizationId, indicator.id ?? null, indicator.code ?? null],
  )).rows[0]
  const config = row ? parseConfig(row.config) : null
  return row && config ? { id: row.id, version: row.version, config } : null
}

/** Uma versão PUBLICADA (vigente ou histórica) da organização, para o indicador dado — o que uma execução presa usa. */
export async function loadStrategyVersion(db: Queryable, organizationId: string, versionId: string, indicatorId: string): Promise<ResolvedStrategy | null> {
  const row = (await db.query<{ id: string; version: number; config: unknown }>(
    `select v.id, v.version, v.config from indicator_diagnostic_strategy_versions v join indicator_diagnostic_strategies s on s.id = v.strategy_id
     where v.id = $1 and v.organization_id = $2 and s.indicator_definition_id = $3 and v.status in ('PUBLISHED', 'SUPERSEDED')`,
    [versionId, organizationId, indicatorId],
  )).rows[0]
  const config = row ? parseConfig(row.config) : null
  return row && config ? { id: row.id, version: row.version, config } : null
}

/**
 * A versão que estava em vigor para o indicador num instante (`STRATEGY_AT_BIRTH_V1`, regra pura em `strategy-at-birth.ts`): a de
 * publicação mais recente até ele, se a estratégia estava ativa então. O histórico de ativação só é lido quando o cabeçalho mudou
 * depois do instante (toda mudança de ativação atualiza `updated_at`); senão o estado atual é o daquele instante.
 */
export async function loadStrategyInForceAt(db: Queryable, organizationId: string, indicatorId: string, at: Date): Promise<ResolvedStrategy | null> {
  const header = (await db.query<{ id: string; active: boolean; updated_at: Date }>(`select id, active, updated_at from indicator_diagnostic_strategies where organization_id = $1 and indicator_definition_id = $2`, [organizationId, indicatorId])).rows[0]
  if (!header) return null
  const versions = (await db.query<{ id: string; version: number; config: unknown; published_at: Date | null }>(
    `select id, version, config, published_at from indicator_diagnostic_strategy_versions where strategy_id = $1 and organization_id = $2 and status in ('PUBLISHED', 'SUPERSEDED')`,
    [header.id, organizationId],
  )).rows
  const inForce = versionInForceAt(versions.map((row) => ({ ...row, publishedAt: row.published_at })), at)
  if (!inForce) return null
  const events = header.updated_at.getTime() > at.getTime()
    ? (await db.query<{ action: string; created_at: Date }>(
      `select action, created_at from audit_logs where organization_id = $1 and entity_type = 'indicator_diagnostic_strategy' and entity_id = $2 and action = any($3::text[])`,
      [organizationId, header.id, Object.values(ACTIVATION_ACTIONS)],
    )).rows.map((row) => ({ active: row.action === ACTIVATION_ACTIONS.ACTIVATED, at: row.created_at }))
    : []
  if (!strategyActiveAt({ currentActive: header.active, events, at })) return null
  const config = parseConfig(inForce.config)
  return config ? { id: inForce.id, version: inForce.version, config } : null
}

/**
 * Nascimento de uma execução: o instante (o da matrícula RAIZ — o disparo; filhos de fan-out seguem o pai, como seguem a versão do
 * Workflow) e o pino gravado, com o indicador da medição que o gravou. null = não é uma matrícula desta organização.
 */
async function loadEnrollmentBirth(db: Queryable, organizationId: string, enrollmentId: string): Promise<{ bornAt: Date; pinnedVersionId: string | null; measurementIndicatorId: string | null } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(enrollmentId)) return null
  const row = (await db.query<{ born_at: Date; pinned: string | null; measurement_indicator: string | null }>(
    `with recursive chain as (
       select id, parent_enrollment_id, created_at, 0 depth from workflow_enrollments where id = $1 and organization_id = $2
       union all
       select p.id, p.parent_enrollment_id, p.created_at, c.depth + 1 from workflow_enrollments p
       join chain c on p.id = c.parent_enrollment_id where p.organization_id = $2 and c.depth < 8
     )
     select (select created_at from chain order by depth desc limit 1) born_at, e.indicator_diagnostic_strategy_version_id pinned, m.indicator_definition_id measurement_indicator
     from workflow_enrollments e left join indicator_measurements m on m.id = e.indicator_measurement_id and m.organization_id = e.organization_id
     where e.id = $1 and e.organization_id = $2`,
    [enrollmentId, organizationId],
  )).rows[0]
  return row ? { bornAt: row.born_at, pinnedVersionId: row.pinned, measurementIndicatorId: row.measurement_indicator } : null
}

/**
 * A estratégia de uma execução — a regra da V1.6.2 (a versão em vigor no NASCIMENTO fica fixa até o fim), por indicador:
 *   - matrícula nascida de uma medição DESTE indicador (gatilho por Indicador, execução manual por medição) = o pino gravado nela
 *     (null = não havia estratégia efetiva naquele instante);
 *   - qualquer outra matrícula (Agenda, execução manual por colaborador, filhos de fan-out — e outro indicador que uma execução por
 *     Indicador diagnostique) = a versão em vigor no instante em que o disparo nasceu (`loadStrategyInForceAt`). Matrícula anterior
 *     à V1.6.2 continua sem estratégia (não havia versão publicada) e uma versão publicada DEPOIS nunca entra "ao vivo";
 *   - sem matrícula gravada (QA Lab/simulação/avaliação) = a versão efetiva agora (simula o que aconteceria hoje).
 */
export async function resolveExecutionStrategy(db: Queryable, organizationId: string, input: { enrollmentId: string | null; indicatorId: string }): Promise<ResolvedStrategy | null> {
  const birth = input.enrollmentId ? await loadEnrollmentBirth(db, organizationId, input.enrollmentId) : null
  if (!birth) return loadEffectiveStrategy(db, organizationId, { id: input.indicatorId })
  if (birth.measurementIndicatorId === input.indicatorId) return birth.pinnedVersionId ? loadStrategyVersion(db, organizationId, birth.pinnedVersionId, input.indicatorId) : null
  return loadStrategyInForceAt(db, organizationId, input.indicatorId, birth.bornAt)
}
