import type { Database } from "../../../infrastructure/database/pool.js"
import { fingerprintOf, type DatasetFingerprint, type DatasetStamp } from "../domain/dataset-fingerprint.js"
import { computeDiagnosticDatasetFingerprint } from "../../../infrastructure/database/demo-mass/diagnostic-dataset.js"
import { DIAGNOSTIC_SUBGROUP } from "../../../infrastructure/database/demo-mass/structure-generator.js"

/**
 * Carrega o fingerprint da massa (contagens estruturais + escopo do sujeito). Uma consulta por tabela,
 * todas COUNT — nunca conteúdo. Falha de leitura → null (o run continua; compatibilidade UNKNOWN).
 */
export async function loadDatasetFingerprint(db: Database, input: { organizationId: string; operatorId?: string | null; period?: { start: string; end: string } | null; now?: Date }): Promise<DatasetFingerprint | null> {
  try {
    const count = async (sql: string, params: unknown[]) => Number((await db.query<{ count: string }>(sql, params)).rows[0]?.count ?? 0)
    const organizationId = input.organizationId
    const components = {
      people: await count(`select count(*) from people where organization_id = $1 and active`, [organizationId]),
      interactions: await count(`select count(*) from interactions where organization_id = $1`, [organizationId]),
      transcripts: await count(`select count(*) from transcripts t join interactions i on i.id = t.interaction_id where i.organization_id = $1`, [organizationId]),
      measurements: await count(`select count(*) from indicator_measurements where organization_id = $1`, [organizationId]),
      indicatorDefinitions: await count(`select count(*) from indicator_definitions where organization_id = $1`, [organizationId]),
      knowledgeDocuments: await count(`select count(*) from knowledge_documents where organization_id = $1 and deleted_at is null`, [organizationId]),
      ...(input.operatorId
        ? {
            subject: {
              interactions: await count(`select count(*) from interactions where organization_id = $1 and operator_id = $2${input.period ? " and started_at >= $3 and started_at < $4" : ""}`, input.period ? [organizationId, input.operatorId, input.period.start, input.period.end] : [organizationId, input.operatorId]),
              transcripts: await count(`select count(*) from transcripts t join interactions i on i.id = t.interaction_id where i.organization_id = $1 and i.operator_id = $2${input.period ? " and i.started_at >= $3 and i.started_at < $4" : ""}`, input.period ? [organizationId, input.operatorId, input.period.start, input.period.end] : [organizationId, input.operatorId]),
              measurements: await count(`select count(*) from indicator_measurements where organization_id = $1 and subject_id = $2${input.period ? " and period_start >= $3 and period_start < $4" : ""}`, input.period ? [organizationId, input.operatorId, input.period.start, input.period.end] : [organizationId, input.operatorId]),
              periodStart: input.period?.start ?? null,
              periodEnd: input.period?.end ?? null,
            },
          }
        : {}),
      // Sujeito no Subgrupo de diagnóstico → versão + fingerprint de conteúdo do dataset (só QA/benchmark; nunca população).
      ...(await diagnosticDatasetStamp(db, organizationId, input.operatorId ?? null)),
    }
    return fingerprintOf(components, input.now ?? new Date())
  } catch (error) {
    console.warn(JSON.stringify({ event: "dataset_fingerprint_failed", message: error instanceof Error ? error.message : String(error) }))
    return null
  }
}

/** `{ dataset }` quando o colaborador do run pertence ao Subgrupo de diagnóstico; `{}` (não aplicável) caso contrário. */
async function diagnosticDatasetStamp(db: Database, organizationId: string, operatorId: string | null): Promise<{ dataset?: DatasetStamp }> {
  if (!operatorId) return {}
  const member = await db.query<{ n: string }>(`select count(*)::text n from people p join subteams st on st.id = p.subteam_id where p.id = $1 and p.organization_id = $2 and st.name = $3`, [operatorId, organizationId, DIAGNOSTIC_SUBGROUP.name])
  if (Number(member.rows[0]?.n ?? 0) === 0) return {}
  const fingerprint = await computeDiagnosticDatasetFingerprint(db, organizationId)
  return { dataset: { version: fingerprint.version, fingerprint: fingerprint.fingerprint } }
}
