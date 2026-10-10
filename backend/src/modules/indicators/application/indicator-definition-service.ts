import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import {
  SEMANTIC_FIELD_LABELS,
  changedSemanticFields,
  indicatorDefinitionInputSchema,
  indicatorDefinitionPatchSchema,
  validateIndicatorDefinition,
  type IndicatorDefinitionInput,
  type IndicatorDefinitionRecord,
} from "../domain/indicator-definition.js"
import { describeDependencies, loadIndicatorDependencies, type IndicatorDependencies } from "./indicator-dependencies.js"

/**
 * Contrato ÚNICO de criação/edição/exclusão de definições de indicador — usado pela rota admin e
 * pelas provas arquiteturais (um indicador novo entra pelo mesmo caminho do produto, nunca por
 * constante TypeScript). Aqui moram as regras que o formulário não pode garantir sozinho:
 * coerência semântica (domain) e proteção do histórico (dependencies).
 */
const DEFINITION_COLUMNS = `id, code, name, unit, desired_direction "desiredDirection", daily_supported "dailySupported",
  operational_aggregation "operationalAggregation", minimum_sample_size "minimumSampleSize",
  minimum_coverage::float "minimumCoverage", official_closure_supported "officialClosureSupported", proves_work_activity "provesWorkActivity",
  unjustified_absence_policy "unjustifiedAbsencePolicy", availability_policy "availabilityPolicy", icon_key "iconKey", active`

type DefinitionRow = Omit<IndicatorDefinitionRecord, "minimumCoverage"> & { minimumCoverage: number | null }

function toRecord(row: DefinitionRow): IndicatorDefinitionRecord {
  return { ...row, minimumCoverage: row.minimumCoverage === null ? null : Number(row.minimumCoverage) }
}

export async function findIndicatorDefinition(db: Database, organizationId: string, id: string): Promise<IndicatorDefinitionRecord | null> {
  const result = await db.query<DefinitionRow>(`select ${DEFINITION_COLUMNS} from indicator_definitions where id = $1 and organization_id = $2`, [id, organizationId])
  return result.rows[0] ? toRecord(result.rows[0]) : null
}

export async function findIndicatorDefinitionByCode(db: Database, organizationId: string, code: string): Promise<IndicatorDefinitionRecord | null> {
  const result = await db.query<DefinitionRow>(`select ${DEFINITION_COLUMNS} from indicator_definitions where code = $1 and organization_id = $2`, [code, organizationId])
  return result.rows[0] ? toRecord(result.rows[0]) : null
}

function rethrowUniqueViolation(error: unknown): never {
  if ((error as { code?: string }).code === "23505") throw new DomainError("Já existe um indicador com esse código.", "INDICATOR_CODE_TAKEN", 409)
  throw error
}

export async function createIndicatorDefinition(db: Database, organizationId: string, rawInput: unknown): Promise<IndicatorDefinitionRecord> {
  const input = validateIndicatorDefinition(indicatorDefinitionInputSchema.parse(rawInput))
  try {
    const result = await db.query<DefinitionRow>(
      `insert into indicator_definitions
         (organization_id, code, name, unit, desired_direction, daily_supported, operational_aggregation, minimum_sample_size, minimum_coverage, official_closure_supported, active, proves_work_activity, unjustified_absence_policy, availability_policy, icon_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       returning ${DEFINITION_COLUMNS}`,
      [organizationId, input.code, input.name, input.unit, input.desiredDirection, input.dailySupported, input.operationalAggregation, input.minimumSampleSize, input.minimumCoverage, input.officialClosureSupported, input.active, input.provesWorkActivity, input.unjustifiedAbsencePolicy, input.availabilityPolicy ? JSON.stringify(input.availabilityPolicy) : null, input.iconKey],
    )
    return toRecord(result.rows[0]!)
  } catch (error) {
    rethrowUniqueViolation(error)
  }
}

export type UpdateIndicatorDefinitionResult = { definition: IndicatorDefinitionRecord }

/**
 * PATCH parcial: campos ausentes mantêm o valor atual; o resultado completo passa pela mesma
 * validação da criação. Alteração SEMÂNTICA (código, unidade, direção, estratégia) ou desligar a
 * medição operacional é BLOQUEADA quando há histórico (medições, metas, fechamentos ou
 * Workflows) — estratégia "A. bloquear" do pedido, com o motivo na mensagem. Nome, glossário,
 * amostra/cobertura padrão, ligar medição operacional, fechamento oficial e status são sempre
 * seguros.
 */
export async function updateIndicatorDefinition(db: Database, organizationId: string, id: string, rawPatch: unknown): Promise<UpdateIndicatorDefinitionResult> {
  const current = await findIndicatorDefinition(db, organizationId, id)
  if (!current) throw new DomainError("Indicador não encontrado.", "INDICATOR_NOT_FOUND", 404)
  const patch = indicatorDefinitionPatchSchema.parse(rawPatch)
  const merged: IndicatorDefinitionInput = {
    code: patch.code ?? current.code,
    name: patch.name ?? current.name,
    unit: patch.unit ?? current.unit,
    desiredDirection: patch.desiredDirection ?? current.desiredDirection,
    dailySupported: patch.dailySupported ?? current.dailySupported,
    operationalAggregation: patch.operationalAggregation ?? current.operationalAggregation,
    minimumSampleSize: patch.minimumSampleSize === undefined ? current.minimumSampleSize : patch.minimumSampleSize,
    minimumCoverage: patch.minimumCoverage === undefined ? current.minimumCoverage : patch.minimumCoverage,
    officialClosureSupported: patch.officialClosureSupported ?? current.officialClosureSupported,
    provesWorkActivity: patch.provesWorkActivity ?? current.provesWorkActivity,
    unjustifiedAbsencePolicy: patch.unjustifiedAbsencePolicy ?? current.unjustifiedAbsencePolicy,
    availabilityPolicy: patch.availabilityPolicy === undefined ? current.availabilityPolicy : patch.availabilityPolicy,
    iconKey: patch.iconKey === undefined ? current.iconKey : patch.iconKey,
    active: patch.active ?? current.active,
  }
  // Desligar a medição operacional de um indicador operacional invalida amostra/cobertura padrão
  // (e a prova de atividade) — limpa em vez de rejeitar (o admin está mudando a capacidade, não os detalhes).
  if (!merged.dailySupported && current.dailySupported) {
    merged.minimumSampleSize = null
    merged.minimumCoverage = null
    merged.provesWorkActivity = false
    merged.unjustifiedAbsencePolicy = "NO_SAMPLE"
    merged.availabilityPolicy = null
  }
  const next = validateIndicatorDefinition(merged)

  const semanticChanges = changedSemanticFields(current, next)
  const disablingOperational = current.dailySupported && !next.dailySupported
  if (semanticChanges.length > 0 || disablingOperational) {
    const dependencies = await loadIndicatorDependencies(db, organizationId, current)
    if (dependencies.hasHistory) {
      const fields = [...semanticChanges.map((field) => SEMANTIC_FIELD_LABELS[field]), ...(disablingOperational ? [SEMANTIC_FIELD_LABELS.dailySupported] : [])]
      throw new DomainError(
        `Não é possível alterar ${fields.join(", ")} de "${current.name}": o indicador já tem histórico (${describeDependencies(dependencies)}). Essa mudança invalidaria o histórico e as configurações existentes — crie um novo indicador com a semântica desejada e desative este.`,
        "INDICATOR_SEMANTIC_LOCKED",
        409,
        { fields: [...semanticChanges, ...(disablingOperational ? ["dailySupported"] : [])], dependencies },
      )
    }
  }

  try {
    const result = await db.query<DefinitionRow>(
      `update indicator_definitions set
         code = $1, name = $2, unit = $3, desired_direction = $4, daily_supported = $5, operational_aggregation = $6,
         minimum_sample_size = $7, minimum_coverage = $8, official_closure_supported = $9, active = $10, proves_work_activity = $13,
         unjustified_absence_policy = $14, availability_policy = $15, icon_key = $16
       where id = $11 and organization_id = $12
       returning ${DEFINITION_COLUMNS}`,
      [next.code, next.name, next.unit, next.desiredDirection, next.dailySupported, next.operationalAggregation, next.minimumSampleSize, next.minimumCoverage, next.officialClosureSupported, next.active, id, organizationId, next.provesWorkActivity, next.unjustifiedAbsencePolicy, next.availabilityPolicy ? JSON.stringify(next.availabilityPolicy) : null, next.iconKey],
    )
    return { definition: toRecord(result.rows[0]!) }
  } catch (error) {
    rethrowUniqueViolation(error)
  }
}

/** Exclusão só sem histórico algum — com histórico o caminho é desativar (status ≠ capacidade). */
export async function deleteIndicatorDefinition(db: Database, organizationId: string, id: string): Promise<IndicatorDependencies | null> {
  const current = await findIndicatorDefinition(db, organizationId, id)
  if (!current) return null
  const dependencies = await loadIndicatorDependencies(db, organizationId, current)
  if (dependencies.hasHistory) {
    throw new DomainError(`"${current.name}" tem histórico (${describeDependencies(dependencies)}) e não pode ser excluído. Desative-o em vez disso.`, "INDICATOR_HAS_DEPENDENTS", 409, { dependencies })
  }
  const client = await db.connect()
  try {
    await client.query("begin")
    await client.query(`delete from indicator_calculation_rules where indicator_definition_id = $1 and organization_id = $2`, [id, organizationId])
    await client.query(`delete from indicator_glossary where indicator_definition_id = $1 and organization_id = $2`, [id, organizationId])
    await client.query(`delete from indicator_definitions where id = $1 and organization_id = $2`, [id, organizationId])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
  return dependencies
}
