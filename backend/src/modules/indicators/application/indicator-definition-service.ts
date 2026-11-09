import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import {
  SEMANTIC_FIELD_LABELS,
  changedSemanticFields,
  indicatorDefinitionInputSchema,
  indicatorDefinitionPatchSchema,
  validateIndicatorDefinition,
  type IndicatorDefinitionInput,
  type IndicatorDefinitionRecord,
} from "../domain/indicator-definition.js"
import { describeDependencies, describeDeletionBlockers, loadIndicatorDeletionBlockers, loadIndicatorDependencies, type IndicatorDependencies } from "./indicator-dependencies.js"

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

export async function findIndicatorDefinition(db: Pick<Database, "query">, organizationId: string, id: string): Promise<IndicatorDefinitionRecord | null> {
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
 * medição operacional é BLOQUEADA aqui quando há histórico (medições, metas, fechamentos ou
 * Workflows), com o motivo na mensagem. Unidade, direção e estratégia mudam só pela correção
 * controlada (`indicator-correction-service.ts`): prévia, motivo, confirmação e auditoria. Nome,
 * glossário, amostra/cobertura padrão, ligar medição operacional, fechamento oficial e status são
 * sempre seguros.
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
      // Unidade, direção e estratégia têm caminho próprio, com prévia do impacto. Código e desligar a medição não têm: cargas e Workflows citam o indicador.
      const correctable = !disablingOperational && !semanticChanges.includes("code")
      const guidance = correctable
        ? `Use "Corrigir unidade, direção ou cálculo", que mostra o impacto antes de salvar.`
        : "Essa mudança quebraria as cargas e os Workflows que citam o indicador — crie um novo indicador com a semântica desejada e desative este."
      throw new DomainError(
        `Não é possível alterar ${fields.join(", ")} de "${current.name}" por aqui: o indicador já tem histórico (${describeDependencies(dependencies)}). ${guidance}`,
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

/**
 * Exclusão lógica (migration 177). Medições, metas, fechamentos, regras e glossário continuam guardados, saem dos painéis e o código fica livre para outro indicador: é a saída para um indicador
 * cadastrado errado. Só barra o que depende dele agora: Workflow que cita o código, política de acompanhamento ou execução em andamento. Volta pela Central de Dados, desativado.
 */
export async function deleteIndicatorDefinition(db: Database, organizationId: string, id: string, actorPersonId: string | null = null): Promise<IndicatorDependencies | null> {
  const current = await findIndicatorDefinition(db, organizationId, id)
  if (!current) return null
  const dependencies = await loadIndicatorDependencies(db, organizationId, current)
  const blockers = await loadIndicatorDeletionBlockers(db, organizationId, current)
  const reasons = [dependencies.workflows.length > 0 ? `${dependencies.workflows.length} Workflow(s): ${dependencies.workflows.map((workflow) => workflow.name).slice(0, 3).join(", ")}${dependencies.workflows.length > 3 ? "…" : ""}` : "", describeDeletionBlockers(blockers)].filter(Boolean).join("; ")
  if (reasons) throw new DomainError(`"${current.name}" é usado agora (${reasons}) e não pode ser excluído. Tire-o de lá ou aguarde as execuções terminarem, ou desative-o.`, "INDICATOR_HAS_DEPENDENTS", 409, { dependencies: { ...dependencies, ...blockers } })
  await inTransaction(db, async (client) => {
    // Era o que a chave fazia ao apagar: a flag deixa de apontar para um indicador que não existe mais nas telas.
    await client.query(`update channel_flags_all set related_indicator_definition_id = null where related_indicator_definition_id = $1 and organization_id = $2`, [id, organizationId])
    await client.query(`update indicator_definitions_all set active = false, deleted_at = now(), deleted_by_person_id = $3 where id = $1 and organization_id = $2`, [id, organizationId, actorPersonId])
    await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'INDICATOR_DELETED', 'indicator_definition', $3, $4)`, [organizationId, actorPersonId, id, JSON.stringify({ code: current.code, name: current.name })])
  })
  return dependencies
}
