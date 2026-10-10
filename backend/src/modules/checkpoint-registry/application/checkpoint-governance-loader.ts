import type { Database } from "../../../infrastructure/database/pool.js"
type Queryable = Pick<Database, "query">
import { CHECKPOINT_GOVERNANCE_VERSION, type CheckpointGovernanceSnapshot } from "../../reliable-feedback/domain/checkpoint-catalog.js"
import { isInCheckpointScope, type CheckpointScope, type CheckpointScopeContext } from "../domain/checkpoint-scope.js"

/**
 * CHECKPOINT REGISTRY → RUNTIME: o que vale para os documentos apresentados ao especialista, na versão publicada deles. Poucas
 * consultas fixas por execução (nunca uma por etapa). Documento não governado = nada aqui (catálogo estrutural de sempre);
 * governado sem extração da versão publicada = `pendingExtraction` (também catálogo estrutural — nunca "nenhuma etapa").
 */
export async function loadCheckpointGovernance(
  db: Queryable,
  organizationId: string,
  documents: readonly { id: string; version: number }[],
  subject: { agentId?: string | null; personId?: string | null } = {},
): Promise<CheckpointGovernanceSnapshot | null> {
  if (documents.length === 0) return null
  const ids = documents.map((document) => document.id)
  const governedRows = ((await db.query<{ knowledge_document_id: string }>(`select knowledge_document_id from checkpoint_governed_documents where organization_id = $1 and knowledge_document_id = any($2::uuid[])`, [organizationId, ids])).rows ?? []).filter((row) => typeof row.knowledge_document_id === "string" && ids.includes(row.knowledge_document_id))
  if (governedRows.length === 0) return null
  const versionOf = new Map(documents.map((document) => [document.id, document.version]))
  const governedIds = governedRows.map((row) => row.knowledge_document_id)
  const extracted = new Set((await db.query<{ knowledge_document_id: string; knowledge_version: number }>(
    `select knowledge_document_id, knowledge_version from checkpoint_change_sets where organization_id = $1 and knowledge_document_id = any($2::uuid[])`,
    [organizationId, governedIds],
  )).rows.filter((row) => versionOf.get(row.knowledge_document_id) === row.knowledge_version).map((row) => row.knowledge_document_id))
  const governed = governedIds.filter((id) => extracted.has(id)).map((id) => ({ documentId: id, knowledgeVersion: versionOf.get(id)! }))
  const pendingExtraction = governedIds.filter((id) => !extracted.has(id))
  const context = await scopeContextOf(db, organizationId, subject)
  const rows = governed.length === 0 ? [] : (await db.query<{ checkpoint_ref: string; knowledge_document_id: string; definition_id: string; version_id: string; definition_version: number; knowledge_version: number; name: string; criticality: string; feedback_enabled: boolean; analytics_enabled: boolean; highlight: boolean; scopes: CheckpointScope[] }>(
    `select v.checkpoint_ref, v.knowledge_document_id, v.definition_id, v.id version_id, v.definition_version, v.knowledge_version,
            coalesce(d.operational_label, v.name) name, d.criticality, d.feedback_enabled, d.analytics_enabled, d.highlight,
            coalesce((select json_agg(json_build_object('scopeType', s.scope_type, 'businessDomainId', s.business_domain_id, 'teamId', s.team_id, 'subteamId', s.subteam_id))
                      from checkpoint_scopes s where s.definition_id = d.id), '[]'::json) scopes
       from checkpoint_versions v
       join checkpoint_definitions d on d.id = v.definition_id
      where v.organization_id = $1 and v.status = 'ACTIVE' and d.operational_status = 'ACTIVE' and v.checkpoint_ref is not null
        and (v.knowledge_document_id, v.knowledge_version) in (select * from unnest($2::uuid[], $3::int[]))`,
    [organizationId, governed.map((entry) => entry.documentId), governed.map((entry) => entry.knowledgeVersion)],
  )).rows
  return {
    version: CHECKPOINT_GOVERNANCE_VERSION,
    governed,
    active: rows.filter((row) => isInCheckpointScope(row.scopes, context)).map((row) => ({
      ref: row.checkpoint_ref, documentId: row.knowledge_document_id, definitionId: row.definition_id, versionId: row.version_id, definitionVersion: row.definition_version,
      knowledgeVersion: row.knowledge_version, name: row.name, criticality: row.criticality, feedbackEnabled: row.feedback_enabled, analyticsEnabled: row.analytics_enabled, highlight: row.highlight,
    })),
    pendingExtraction,
    scopeEvaluated: context.known,
  }
}

async function scopeContextOf(db: Queryable, organizationId: string, subject: { agentId?: string | null; personId?: string | null }): Promise<CheckpointScopeContext> {
  const person = subject.personId ? (await db.query<{ team_id: string | null; subteam_id: string | null }>(`select team_id, subteam_id from people where id = $1 and organization_id = $2`, [subject.personId, organizationId])).rows[0] ?? null : null
  const agent = subject.agentId ? (await db.query<{ business_domain_id: string | null }>(`select business_domain_id from agents where id = $1 and organization_id = $2`, [subject.agentId, organizationId])).rows[0] ?? null : null
  return { businessDomainId: agent?.business_domain_id ?? null, teamId: person?.team_id ?? null, subteamId: person?.subteam_id ?? null, known: person !== null }
}
