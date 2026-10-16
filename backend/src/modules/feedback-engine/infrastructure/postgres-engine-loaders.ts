import { createHash } from "node:crypto"
import { canonicalSubjectSql } from "../../interactions/domain/interaction-subject.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { CandidateDocument } from "../domain/document-selection.js"
import { normalizeCapabilities, type InvestigationCapability } from "../../investigation/domain/capabilities.js"

/**
 * LEITURAS do motor (só leitura, escopadas à organização). Nenhuma leitura cruza organização: id de outra organização = ausente.
 */
type Queryable = Pick<Database, "query">

export type InteractionForAnalysis = {
  id: string
  organizationId: string
  operatorId: string
  operatorName: string
  startedAt: Date
  endedAt: Date | null
  reason: string | null
  /** Submotivo (145): presente só quando a fonte informou — o assunto preferencial da `SUBJECT_RESOLUTION_V2`. */
  subReason?: string | null
  channel: string | null
  subjectCanonical: { code: string; name: string } | null
  flags: { name: string; value: string }[]
  transcript: { content: string; checksum: string } | null
  teamId: string | null
  subteamId: string | null
  supervisorId: string | null
  timeZone: string
}

export async function loadInteractionForAnalysis(db: Queryable, organizationId: string, interactionId: string): Promise<InteractionForAnalysis | null> {
  const row = (await db.query<{ id: string; operator_id: string; operator_name: string; started_at: Date; ended_at: Date | null; reason: string | null; sub_reason: string | null; channel: string | null; subject_code: string | null; team_id: string | null; subteam_id: string | null; reports_to_id: string | null }>(
    `select i.id, i.operator_id, p.name operator_name, i.started_at, i.ended_at, i.reason, i.sub_reason, i.channel, ${canonicalSubjectSql("i")} subject_code, p.team_id, p.subteam_id, p.reports_to_id
     from interactions i join people p on p.id = i.operator_id and p.organization_id = i.organization_id
     where i.id = $1 and i.organization_id = $2`,
    [interactionId, organizationId],
  )).rows[0]
  if (!row) return null
  const subject = row.subject_code ? (await db.query<{ name: string }>(`select name from interaction_subject_definitions where organization_id = $1 and code = $2`, [organizationId, row.subject_code])).rows[0] : undefined
  const flags = (await db.query<{ flag_name: string; value_boolean: boolean | null; value_numeric: string | null }>(
    `select c.flag_name, f.value_boolean, f.value_numeric from interaction_flags f join channel_flags c on c.id = f.channel_flag_id
     where f.interaction_id = $1 and f.organization_id = $2 order by c.flag_name`,
    [interactionId, organizationId],
  )).rows
  const transcript = (await db.query<{ content: string }>(`select content from transcripts where interaction_id = $1 order by version desc limit 1`, [interactionId])).rows[0]
  return {
    id: row.id,
    organizationId,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    startedAt: new Date(row.started_at),
    endedAt: row.ended_at ? new Date(row.ended_at) : null,
    reason: row.reason,
    ...(row.sub_reason?.trim() ? { subReason: row.sub_reason } : {}),
    channel: row.channel,
    subjectCanonical: row.subject_code && subject ? { code: row.subject_code, name: subject.name } : null,
    flags: flags.map((flag) => ({ name: flag.flag_name, value: flag.value_boolean !== null ? (flag.value_boolean ? "sim" : "não") : flag.value_numeric ?? "" })),
    transcript: transcript && transcript.content.trim().length > 0 ? { content: transcript.content, checksum: createHash("sha256").update(transcript.content).digest("hex").slice(0, 16) } : null,
    teamId: row.team_id,
    subteamId: row.subteam_id,
    supervisorId: row.reports_to_id,
    timeZone: await resolveOrganizationTimezone(db as Database, organizationId),
  }
}

/** `investigationCapabilities` = "Ferramentas de investigação" do Agent (vazio = nenhuma configurada; ver investigation-toolbox.ts). */
export type AgentProfile = { id: string; name: string; objective: string | null; contextPrompt: string | null; updatedAt: Date; businessDomainId: string | null; investigationCapabilities?: InvestigationCapability[] }
export async function loadAgentProfile(db: Queryable, organizationId: string, agentId: string): Promise<AgentProfile | null> {
  const row = (await db.query<{ id: string; name: string; objective: string | null; context_prompt: string | null; updated_at: Date; business_domain_id: string | null; investigation_capabilities: string[] | null }>(
    `select id, name, objective, context_prompt, updated_at, business_domain_id, investigation_capabilities from agents where id = $1 and organization_id = $2`,
    [agentId, organizationId],
  )).rows[0]
  return row ? { id: row.id, name: row.name, objective: row.objective, contextPrompt: row.context_prompt, updatedAt: new Date(row.updated_at), businessDomainId: row.business_domain_id, investigationCapabilities: normalizeCapabilities(row.investigation_capabilities ?? []) } : null
}

/**
 * Bases autorizadas para o especialista na versão VIGENTE na data da chamada (publicada com vigência/criação ≤ data). Sem versão
 * vigente naquela data, a atual — com a perspectiva explícita (CURRENT_RULE_REEVALUATION).
 */
export async function loadAgentDocumentsAt(db: Queryable, organizationId: string, agentId: string, at: Date): Promise<CandidateDocument[]> {
  const rows = (await db.query<{ id: string; title: string; in_force_version: number | null; in_force_content: string | null; in_force_hash: string | null; latest_version: number | null; latest_content: string | null; latest_hash: string | null }>(
    `select kd.id, kd.title,
            f.version in_force_version, f.content in_force_content, f.content_hash in_force_hash,
            l.version latest_version, l.content latest_content, l.content_hash latest_hash
     from agent_knowledge_documents akd
     join knowledge_documents kd on kd.id = akd.knowledge_document_id and kd.organization_id = $2 and kd.deleted_at is null
     left join lateral (select version, content, content_hash from knowledge_versions where document_id = kd.id and status = 'PUBLISHED' and coalesce(effective_from, created_at) <= $3 order by version desc limit 1) f on true
     left join lateral (select version, content, content_hash from knowledge_versions where document_id = kd.id and status = 'PUBLISHED' order by version desc limit 1) l on true
     where akd.agent_id = $1
     order by kd.title`,
    [agentId, organizationId, at],
  )).rows
  return rows.flatMap((row): CandidateDocument[] => {
    if (row.in_force_version !== null && row.in_force_content !== null) return [{ documentId: row.id, title: row.title, version: row.in_force_version, content: row.in_force_content, contentHash: row.in_force_hash ?? "", perspective: "RULE_IN_FORCE_AT_CALL" }]
    if (row.latest_version !== null && row.latest_content !== null) return [{ documentId: row.id, title: row.title, version: row.latest_version, content: row.latest_content, contentHash: row.latest_hash ?? "", perspective: "CURRENT_RULE_REEVALUATION" }]
    return []
  })
}

/** Versão publicada imediatamente anterior de um documento (para reconciliar a identidade dos critérios). */
export async function loadPreviousPublishedVersion(db: Queryable, organizationId: string, documentId: string, version: number): Promise<{ version: number; content: string } | null> {
  const row = (await db.query<{ version: number; content: string }>(
    `select v.version, v.content from knowledge_versions v join knowledge_documents d on d.id = v.document_id and d.organization_id = $1
     where v.document_id = $2 and v.status = 'PUBLISHED' and v.version < $3 order by v.version desc limit 1`,
    [organizationId, documentId, version],
  )).rows[0]
  return row ?? null
}

export async function loadDocumentTitles(db: Queryable, organizationId: string, documentIds: readonly string[]): Promise<Map<string, string>> {
  if (documentIds.length === 0) return new Map()
  const rows = (await db.query<{ id: string; title: string }>(`select id, title from knowledge_documents where organization_id = $1 and id = any($2::uuid[])`, [organizationId, [...documentIds]])).rows
  return new Map(rows.map((row) => [row.id, row.title]))
}
