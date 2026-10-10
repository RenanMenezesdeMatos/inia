import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"

type Queryable = Pick<Database, "query">

/** Leituras da tela "Checkpoints da operação" (organização da sessão; nada de outra organização vaza). */
export async function listRegistryDocuments(db: Queryable, organizationId: string) {
  return (await db.query(
    `select d.id, d.title,
            pv.version "publishedVersion",
            (gd.knowledge_document_id is not null) governed,
            cs.id "changeSetId", cs.knowledge_version "extractedVersion", cs.counts, cs.created_at "extractedAt",
            coalesce((select count(*) from checkpoint_versions v where v.knowledge_document_id = d.id and v.knowledge_version = cs.knowledge_version and v.status = 'ACTIVE'), 0)::int active,
            coalesce((select count(*) from checkpoint_versions v where v.knowledge_document_id = d.id and v.knowledge_version = cs.knowledge_version and v.status in ('PROPOSED', 'NEEDS_REVIEW')), 0)::int "pendingReview",
            coalesce((select count(*) from checkpoint_versions v where v.knowledge_document_id = d.id and v.knowledge_version = cs.knowledge_version and v.status = 'REMOVED' and v.reviewed_at is null), 0)::int "removedUnacknowledged"
       from knowledge_documents d
       left join lateral (select version from knowledge_versions where document_id = d.id and status = 'PUBLISHED' order by version desc limit 1) pv on true
       left join lateral (select * from checkpoint_change_sets c where c.knowledge_document_id = d.id order by c.knowledge_version desc limit 1) cs on true
       left join checkpoint_governed_documents gd on gd.knowledge_document_id = d.id
      where d.organization_id = $1 and d.deleted_at is null and pv.version is not null
      order by d.title`,
    [organizationId],
  )).rows
}

/** Checkpoints da versão EXTRAÍDA mais recente de um documento (o delta desta versão + o que continua valendo). */
export async function loadDocumentRegistry(db: Queryable, organizationId: string, documentId: string) {
  const document = (await db.query<{ id: string; title: string; governed: boolean }>(
    `select d.id, d.title, exists (select 1 from checkpoint_governed_documents g where g.knowledge_document_id = d.id) governed from knowledge_documents d where d.id = $1 and d.organization_id = $2 and d.deleted_at is null`,
    [documentId, organizationId],
  )).rows[0]
  if (!document) throw new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)
  const changeSets = (await db.query(`select id, knowledge_version "knowledgeVersion", previous_knowledge_version "previousKnowledgeVersion", counts, created_at "createdAt", extractor_version "extractorVersion" from checkpoint_change_sets where knowledge_document_id = $1 and organization_id = $2 order by knowledge_version desc`, [documentId, organizationId])).rows
  const latest = changeSets[0] as { knowledgeVersion: number } | undefined
  const checkpoints = latest ? (await db.query(
    `select v.id "versionId", v.definition_id "definitionId", v.definition_version "definitionVersion", v.knowledge_version "knowledgeVersion", v.checkpoint_ref "checkpointRef",
            coalesce(d.operational_label, v.name) name, v.name "extractedName", v.requirement, v.source_literal "sourceLiteral", v.section_heading "sectionHeading", v.kind, v.segment_role "segmentRole",
            v.applicability, v.expected_evidence_kind "expectedEvidenceKind", v.canonical_behavior "canonicalBehavior", v.change_kind "changeKind", v.change_detail "changeDetail", v.status,
            v.reviewed_at "reviewedAt", d.criticality, d.feedback_enabled "feedbackEnabled", d.analytics_enabled "analyticsEnabled", d.highlight, d.operational_status "operationalStatus",
            (select count(*) from checkpoint_scopes s where s.definition_id = d.id)::int "scopeCount"
       from checkpoint_versions v join checkpoint_definitions d on d.id = v.definition_id
      where v.knowledge_document_id = $1 and v.organization_id = $2 and v.knowledge_version = $3
      order by case v.status when 'NEEDS_REVIEW' then 0 when 'PROPOSED' then 1 when 'REMOVED' then 2 else 3 end, v.section_heading nulls last, v.list_position nulls last, v.created_at`,
    [documentId, organizationId, latest.knowledgeVersion],
  )).rows : []
  return { document, changeSets, checkpoints }
}

/** Detalhe de uma definição lógica: todas as versões (histórico da regra através da base), escopos e auditoria. */
export async function loadCheckpointDefinition(db: Queryable, organizationId: string, definitionId: string) {
  const definition = (await db.query(
    `select d.id, d.knowledge_document_id "documentId", k.title "documentTitle", d.canonical_behavior "canonicalBehavior", d.operational_label "operationalLabel", d.criticality,
            d.feedback_enabled "feedbackEnabled", d.analytics_enabled "analyticsEnabled", d.highlight, d.operational_status "operationalStatus", d.created_at "createdAt", d.updated_at "updatedAt"
       from checkpoint_definitions d join knowledge_documents k on k.id = d.knowledge_document_id where d.id = $1 and d.organization_id = $2`,
    [definitionId, organizationId],
  )).rows[0]
  if (!definition) throw new DomainError("Checkpoint não encontrado.", "CHECKPOINT_NOT_FOUND", 404)
  const versions = (await db.query(
    `select v.id, v.knowledge_version "knowledgeVersion", v.definition_version "definitionVersion", v.checkpoint_ref "checkpointRef", v.name, v.requirement, v.source_literal "sourceLiteral",
            v.section_heading "sectionHeading", v.lead_in "leadIn", v.kind, v.segment_role "segmentRole", v.applicability, v.expected_evidence_kind "expectedEvidenceKind", v.canonical_behavior "canonicalBehavior",
            v.change_kind "changeKind", v.change_detail "changeDetail", v.status, v.effective_from "effectiveFrom", v.effective_until "effectiveUntil", v.reviewed_at "reviewedAt", v.review_note "reviewNote",
            p.name "reviewedByName", v.created_at "createdAt"
       from checkpoint_versions v left join people p on p.id = v.reviewed_by
      where v.definition_id = $1 and v.organization_id = $2 order by v.knowledge_version desc, v.created_at desc`,
    [definitionId, organizationId],
  )).rows
  const scopes = (await db.query(
    `select s.id, s.scope_type "scopeType", s.business_domain_id "businessDomainId", b.name "businessDomainName", s.team_id "teamId", t.name "teamName", s.subteam_id "subteamId", st.name "subteamName"
       from checkpoint_scopes s left join business_domains b on b.id = s.business_domain_id left join teams t on t.id = s.team_id left join subteams st on st.id = s.subteam_id
      where s.definition_id = $1 order by s.created_at`,
    [definitionId],
  )).rows
  const versionIds = versions.map((version) => (version as { id: string }).id)
  const auditTrail = (await db.query(
    `select a.action, a.created_at "createdAt", p.name "actorName", a.payload from audit_logs a left join people p on p.id = a.actor_id
      where a.organization_id = $1 and ((a.entity_type = 'checkpoint_definition' and a.entity_id = $2) or (a.entity_type = 'checkpoint_version' and a.entity_id = any($3::uuid[])))
      order by a.created_at desc limit 50`,
    [organizationId, definitionId, versionIds],
  )).rows
  return { definition, versions, scopes, audit: auditTrail }
}

/** Opções de escopo (domínios, Grupos, Subgrupos) da organização. */
export async function loadScopeOptions(db: Queryable, organizationId: string) {
  const [domains, teams, subteams] = await Promise.all([
    db.query(`select id, name from business_domains where organization_id = $1 and active order by name`, [organizationId]),
    db.query(`select id, name from teams where organization_id = $1 order by name`, [organizationId]),
    db.query(`select st.id, st.name, st.team_id "teamId" from subteams st join teams t on t.id = st.team_id where t.organization_id = $1 order by st.name`, [organizationId]),
  ])
  return { businessDomains: domains.rows, teams: teams.rows, subteams: subteams.rows }
}
