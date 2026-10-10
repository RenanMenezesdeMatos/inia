import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { StructuralCheckpointExtractor, type CheckpointCandidate, type CheckpointExtractor } from "../domain/checkpoint-extraction.js"
import { CHECKPOINT_RECONCILIATION_VERSION, reconcileCheckpoints, statusAfterReconciliation, type CheckpointChangeKind, type RegistryEntry, type ReconciliationItem } from "../domain/checkpoint-reconciliation.js"

type Queryable = Pick<Database, "query">
export type RegistryActor = { organizationId: string; personId: string | null }

/**
 * CHECKPOINT REGISTRY — serviço único (a rota administrativa, o gancho de publicação da base e as provas usam o mesmo).
 *
 *   sync        publicação de uma versão da base → extração → reconciliação com o registry → DELTA (idempotente por versão).
 *   governança  o administrador aprova, rejeita, resolve ambiguidade, confirma remoção, configura (rótulo, criticidade, feedback,
 *               analytics, destaque, ativo) e associa escopos — NUNCA edita a regra oficial (literal/etapa só da base).
 *   histórico   nada é apagado: versão substituída vira SUPERSEDED com fim de vigência; regra que sumiu da base ganha uma linha
 *               REMOVED na versão nova; toda ação vai para `audit_logs`.
 */
const REVIEWABLE: readonly string[] = ["PROPOSED", "NEEDS_REVIEW"]

async function audit(db: Queryable, actor: RegistryActor, action: string, entityType: "checkpoint_definition" | "checkpoint_version" | "checkpoint_change_set" | "knowledge_document", entityId: string, payload: Record<string, unknown>): Promise<void> {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, $4, $5, $6)`, [actor.organizationId, actor.personId, action, entityType, entityId, JSON.stringify(payload)])
}

/** Com o POOL, conexão dedicada (begin/commit); com um CLIENT já em transação (provas/QA), savepoint — nunca um commit de fora. */
async function inTransaction<T>(db: Database, work: (client: Queryable) => Promise<T>): Promise<T> {
  if (typeof (db as unknown as { release?: unknown }).release === "function") {
    await db.query("savepoint checkpoint_registry_tx")
    try {
      const result = await work(db)
      await db.query("release savepoint checkpoint_registry_tx")
      return result
    } catch (error) {
      await db.query("rollback to savepoint checkpoint_registry_tx").catch(() => undefined)
      throw error
    }
  }
  const client = await db.connect()
  try {
    await client.query("begin")
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

type VersionRow = {
  id: string; definition_id: string; definition_version: number; knowledge_version: number; status: string; checkpoint_ref: string | null; kind: CheckpointCandidate["kind"]; segment_role: CheckpointCandidate["segmentRole"]
  section_heading: string | null; chunk_index: number | null; lead_in: string | null; list_position: number | null; source_literal: string; requirement: string; name: string; applicability: string | null
  expected_evidence_kind: CheckpointCandidate["expectedEvidenceKind"]; canonical_behavior: string | null; effective_from: Date | null
}
const entryOf = (row: VersionRow): RegistryEntry => ({
  definitionId: row.definition_id, versionId: row.id, definitionVersion: row.definition_version, status: row.status as RegistryEntry["status"], checkpointRef: row.checkpoint_ref, kind: row.kind, segmentRole: row.segment_role,
  sectionHeading: row.section_heading, listPosition: row.list_position, sourceLiteral: row.source_literal, requirement: row.requirement, applicability: row.applicability, canonicalBehavior: row.canonical_behavior,
})

export type SyncResult = { status: "NOT_PUBLISHED" } | { status: "SYNCED" | "ALREADY_SYNCED"; changeSetId: string; knowledgeVersion: number; counts: Record<CheckpointChangeKind, number> }

/** Publicação → extração → reconciliação → delta. Idempotente: a mesma versão da base nunca é processada duas vezes. */
export async function syncCheckpointRegistry(db: Database, actor: RegistryActor, documentId: string, extractor: CheckpointExtractor = new StructuralCheckpointExtractor(), now: () => Date = () => new Date()): Promise<SyncResult> {
  const published = (await db.query<{ version: number; content: string; title: string }>(
    `select v.version, v.content, d.title from knowledge_versions v join knowledge_documents d on d.id = v.document_id
      where v.document_id = $1 and d.organization_id = $2 and d.deleted_at is null and v.status = 'PUBLISHED' order by v.version desc limit 1`,
    [documentId, actor.organizationId],
  )).rows[0]
  if (!published) return { status: "NOT_PUBLISHED" }
  const existing = (await db.query<{ id: string; counts: Record<CheckpointChangeKind, number> }>(`select id, counts from checkpoint_change_sets where knowledge_document_id = $1 and knowledge_version = $2`, [documentId, published.version])).rows[0]
  if (existing) return { status: "ALREADY_SYNCED", changeSetId: existing.id, knowledgeVersion: published.version, counts: existing.counts }
  const candidates = await extractor.extract({ organizationId: actor.organizationId, documentId, documentTitle: published.title, version: published.version, content: published.content })
  return inTransaction(db, async (client) => {
    // Regras CORRENTES = a linha mais recente de cada definição deste documento, de versões anteriores da base (removidas saem).
    const rows = (await client.query<VersionRow>(
      `select distinct on (definition_id) * from checkpoint_versions
        where organization_id = $1 and knowledge_document_id = $2 and knowledge_version < $3
        order by definition_id, knowledge_version desc`,
      [actor.organizationId, documentId, published.version],
    )).rows.filter((row) => row.status !== "REMOVED" && row.status !== "SUPERSEDED")
    const previousVersion = (await client.query<{ version: number | null }>(`select max(knowledge_version) version from checkpoint_change_sets where knowledge_document_id = $1 and knowledge_version < $2`, [documentId, published.version])).rows[0]?.version ?? null
    const changeSet = reconcileCheckpoints(rows.map(entryOf), candidates)
    const at = now()
    const created = (await client.query<{ id: string }>(
      `insert into checkpoint_change_sets (organization_id, knowledge_document_id, knowledge_version, previous_knowledge_version, extractor_version, reconciliation_version, counts, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (knowledge_document_id, knowledge_version) do nothing returning id`,
      [actor.organizationId, documentId, published.version, previousVersion, extractor.version, CHECKPOINT_RECONCILIATION_VERSION, JSON.stringify(changeSet.counts), at],
    )).rows[0]
    // Outra publicação concorrente já processou esta versão: nada escrito duas vezes.
    if (!created) {
      const again = (await client.query<{ id: string; counts: Record<CheckpointChangeKind, number> }>(`select id, counts from checkpoint_change_sets where knowledge_document_id = $1 and knowledge_version = $2`, [documentId, published.version])).rows[0]!
      return { status: "ALREADY_SYNCED" as const, changeSetId: again.id, knowledgeVersion: published.version, counts: again.counts }
    }
    const rowById = new Map(rows.map((row) => [row.id, row]))
    for (const item of changeSet.items) await persistItem(client, actor, documentId, published.version, created.id, extractor.version, item, rowById, at)
    await audit(client, actor, "CHECKPOINT_REGISTRY_SYNCED", "checkpoint_change_set", created.id, { documentId, knowledgeVersion: published.version, previousKnowledgeVersion: previousVersion, counts: changeSet.counts })
    return { status: "SYNCED" as const, changeSetId: created.id, knowledgeVersion: published.version, counts: changeSet.counts }
  })
}

async function insertVersion(client: Queryable, input: { organizationId: string; definitionId: string; changeSetId: string; previousVersionId: string | null; documentId: string; knowledgeVersion: number; definitionVersion: number; candidate: CheckpointCandidate | null; removedFrom: VersionRow | null; changeKind: CheckpointChangeKind; changeDetail: Record<string, unknown>; status: string; effectiveFrom: Date | null; extractorVersion: string }): Promise<string> {
  const source = input.candidate
    ? { ref: input.candidate.checkpointRef, kind: input.candidate.kind, role: input.candidate.segmentRole, heading: input.candidate.sectionHeading, chunk: input.candidate.chunkIndex, leadIn: input.candidate.leadIn, position: input.candidate.listPosition, literal: input.candidate.sourceLiteral, requirement: input.candidate.requirement, name: input.candidate.name, applicability: input.candidate.applicability, evidence: input.candidate.expectedEvidenceKind, behavior: input.candidate.canonicalBehavior }
    : { ref: null, kind: input.removedFrom!.kind, role: input.removedFrom!.segment_role, heading: input.removedFrom!.section_heading, chunk: input.removedFrom!.chunk_index, leadIn: input.removedFrom!.lead_in, position: input.removedFrom!.list_position, literal: input.removedFrom!.source_literal, requirement: input.removedFrom!.requirement, name: input.removedFrom!.name, applicability: input.removedFrom!.applicability, evidence: input.removedFrom!.expected_evidence_kind, behavior: input.removedFrom!.canonical_behavior }
  return (await client.query<{ id: string }>(
    `insert into checkpoint_versions (organization_id, definition_id, change_set_id, previous_version_id, knowledge_document_id, knowledge_version, definition_version, checkpoint_ref, kind, segment_role,
       section_heading, chunk_index, lead_in, list_position, source_literal, requirement, name, applicability, expected_evidence_kind, canonical_behavior, change_kind, change_detail, status, effective_from, extractor_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) returning id`,
    [input.organizationId, input.definitionId, input.changeSetId, input.previousVersionId, input.documentId, input.knowledgeVersion, input.definitionVersion, source.ref, source.kind, source.role,
      source.heading, source.chunk, source.leadIn, source.position, source.literal, source.requirement, source.name, source.applicability, source.evidence, source.behavior, input.changeKind, JSON.stringify(input.changeDetail), input.status, input.effectiveFrom, input.extractorVersion],
  )).rows[0]!.id
}

/** A versão anterior deixa de valer para a versão nova da base (nunca é apagada). */
async function supersede(client: Queryable, versionId: string, at: Date): Promise<void> {
  await client.query(`update checkpoint_versions set status = 'SUPERSEDED', effective_until = case when effective_from is null then null else greatest(effective_from, $2) end, updated_at = $2 where id = $1`, [versionId, at])
}

async function persistItem(client: Queryable, actor: RegistryActor, documentId: string, knowledgeVersion: number, changeSetId: string, extractorVersion: string, item: ReconciliationItem, rowById: ReadonlyMap<string, VersionRow>, at: Date): Promise<void> {
  const base = { organizationId: actor.organizationId, changeSetId, documentId, knowledgeVersion, extractorVersion }
  if (item.kind === "REMOVED") {
    const previous = rowById.get(item.previous.versionId)!
    await insertVersion(client, { ...base, definitionId: previous.definition_id, previousVersionId: previous.id, definitionVersion: previous.definition_version, candidate: null, removedFrom: previous, changeKind: "REMOVED", changeDetail: { previousStatus: previous.status }, status: "REMOVED", effectiveFrom: null })
    await supersede(client, previous.id, at)
    return
  }
  const status = statusAfterReconciliation(item)
  if (item.kind === "NEW" || item.kind === "AMBIGUOUS") {
    const definitionId = (await client.query<{ id: string }>(`insert into checkpoint_definitions (organization_id, knowledge_document_id, canonical_behavior, created_at, updated_at) values ($1, $2, $3, $4, $4) returning id`, [actor.organizationId, documentId, item.candidate.canonicalBehavior, at])).rows[0]!.id
    const detail = item.kind === "AMBIGUOUS" ? { candidates: item.matches.map((match) => ({ definitionId: match.previous.definitionId, versionId: match.previous.versionId, similarity: match.similarity, basis: match.basis })) } : {}
    await insertVersion(client, { ...base, definitionId, previousVersionId: null, definitionVersion: 1, candidate: item.candidate, removedFrom: null, changeKind: item.kind, changeDetail: detail, status, effectiveFrom: status === "ACTIVE" ? at : null })
    return
  }
  const previous = rowById.get(item.match.previous.versionId)!
  const definitionVersion = previous.definition_version + (item.kind === "UNCHANGED" ? 0 : 1)
  await insertVersion(client, { ...base, definitionId: previous.definition_id, previousVersionId: previous.id, definitionVersion, candidate: item.candidate, removedFrom: null, changeKind: item.kind, changeDetail: { similarity: item.match.similarity, basis: item.match.basis, materialChanges: item.materialChanges, previousStatus: previous.status }, status, effectiveFrom: status === "ACTIVE" ? at : null })
  await supersede(client, previous.id, at)
}

// ---------------------------------------------------------------------------------------------------------------------
// Governança administrativa
// ---------------------------------------------------------------------------------------------------------------------

async function versionFor(db: Queryable, organizationId: string, versionId: string): Promise<VersionRow & { change_kind: string; change_detail: Record<string, unknown>; change_set_id: string }> {
  const row = (await db.query<VersionRow & { change_kind: string; change_detail: Record<string, unknown>; change_set_id: string }>(`select * from checkpoint_versions where id = $1 and organization_id = $2`, [versionId, organizationId])).rows[0]
  if (!row) throw new DomainError("Checkpoint não encontrado.", "CHECKPOINT_NOT_FOUND", 404)
  return row
}

export async function approveCheckpointVersion(db: Database, actor: RegistryActor, versionId: string, note: string | null = null, now: () => Date = () => new Date()): Promise<void> {
  await inTransaction(db, async (client) => {
    const version = await versionFor(client, actor.organizationId, versionId)
    if (!REVIEWABLE.includes(version.status)) throw new DomainError("Só um checkpoint proposto ou em revisão pode ser aprovado.", "CHECKPOINT_NOT_REVIEWABLE", 409)
    const at = now()
    await client.query(`update checkpoint_versions set status = 'ACTIVE', effective_from = $2, reviewed_by = $3, reviewed_at = $2, review_note = $4, updated_at = $2 where id = $1`, [versionId, at, actor.personId, note])
    await audit(client, actor, "CHECKPOINT_VERSION_APPROVED", "checkpoint_version", versionId, { definitionId: version.definition_id, from: version.status, to: "ACTIVE", changeKind: version.change_kind, knowledgeVersion: version.knowledge_version, note })
  })
}

export async function rejectCheckpointVersion(db: Database, actor: RegistryActor, versionId: string, note: string, now: () => Date = () => new Date()): Promise<void> {
  if (note.trim().length < 3) throw new DomainError("Informe o motivo da rejeição.", "CHECKPOINT_REJECTION_REASON_REQUIRED", 422)
  await inTransaction(db, async (client) => {
    const version = await versionFor(client, actor.organizationId, versionId)
    if (!REVIEWABLE.includes(version.status)) throw new DomainError("Só um checkpoint proposto ou em revisão pode ser rejeitado.", "CHECKPOINT_NOT_REVIEWABLE", 409)
    const at = now()
    await client.query(`update checkpoint_versions set status = 'REJECTED', reviewed_by = $3, reviewed_at = $2, review_note = $4, updated_at = $2 where id = $1`, [versionId, at, actor.personId, note.trim()])
    await audit(client, actor, "CHECKPOINT_VERSION_REJECTED", "checkpoint_version", versionId, { definitionId: version.definition_id, from: version.status, to: "REJECTED", changeKind: version.change_kind, note: note.trim() })
  })
}

/** Todos os PROPOSTOS de uma extração (primeira governança de um documento) — o delta seguinte é revisado item a item. */
export async function approveProposedInChangeSet(db: Database, actor: RegistryActor, changeSetId: string, now: () => Date = () => new Date()): Promise<{ approved: number }> {
  return inTransaction(db, async (client) => {
    const at = now()
    const updated = await client.query<{ id: string }>(`update checkpoint_versions set status = 'ACTIVE', effective_from = $3, reviewed_by = $4, reviewed_at = $3, updated_at = $3 where change_set_id = $1 and organization_id = $2 and status = 'PROPOSED' returning id`, [changeSetId, actor.organizationId, at, actor.personId])
    await audit(client, actor, "CHECKPOINT_CHANGE_SET_PROPOSED_APPROVED", "checkpoint_change_set", changeSetId, { approved: updated.rows.length, versionIds: updated.rows.map((row) => row.id) })
    return { approved: updated.rows.length }
  })
}

/** AMBÍGUO → o administrador diz de qual regra lógica o candidato é continuação (vira nova versão dela, ainda em revisão). */
export async function linkAmbiguousCheckpoint(db: Database, actor: RegistryActor, versionId: string, definitionId: string, now: () => Date = () => new Date()): Promise<void> {
  await inTransaction(db, async (client) => {
    const version = await versionFor(client, actor.organizationId, versionId)
    const candidates = ((version.change_detail?.candidates as { definitionId: string }[] | undefined) ?? []).map((entry) => entry.definitionId)
    if (version.change_kind !== "AMBIGUOUS" || version.status !== "NEEDS_REVIEW") throw new DomainError("Só um checkpoint ambíguo em revisão pode ser vinculado.", "CHECKPOINT_NOT_AMBIGUOUS", 409)
    if (!candidates.includes(definitionId)) throw new DomainError("Essa regra não está entre as correspondências possíveis.", "CHECKPOINT_LINK_NOT_CANDIDATE", 422)
    const previous = (await client.query<VersionRow>(`select * from checkpoint_versions where definition_id = $1 and knowledge_version < $2 order by knowledge_version desc limit 1`, [definitionId, version.knowledge_version])).rows[0]
    if (!previous) throw new DomainError("A regra escolhida não tem versão anterior.", "CHECKPOINT_LINK_NOT_CANDIDATE", 422)
    const provisional = version.definition_id
    const at = now()
    await client.query(`update checkpoint_versions set definition_id = $2, previous_version_id = $3, definition_version = $4, change_kind = 'MODIFIED', change_detail = change_detail || $5::jsonb, updated_at = $6 where id = $1`, [versionId, definitionId, previous.id, previous.definition_version + 1, JSON.stringify({ resolvedFromAmbiguity: { provisionalDefinitionId: provisional, by: actor.personId } }), at])
    if (previous.status !== "SUPERSEDED" && previous.status !== "REMOVED") await supersede(client, previous.id, at)
    // A definição PROVISÓRIA nasceu só para o candidato ambíguo (nunca avaliou nada): sem versões, sai.
    await client.query(`delete from checkpoint_definitions d where d.id = $1 and not exists (select 1 from checkpoint_versions v where v.definition_id = d.id) and not exists (select 1 from process_checkpoint_observations o where o.checkpoint_definition_id = d.id)`, [provisional])
    await audit(client, actor, "CHECKPOINT_AMBIGUITY_RESOLVED", "checkpoint_version", versionId, { linkedDefinitionId: definitionId, provisionalDefinitionId: provisional, previousVersionId: previous.id })
  })
}

/** REMOVIDO da base: o administrador confirma que viu (a regra já não vale na versão nova; o histórico continua). */
export async function acknowledgeRemovedCheckpoint(db: Database, actor: RegistryActor, versionId: string, now: () => Date = () => new Date()): Promise<void> {
  await inTransaction(db, async (client) => {
    const version = await versionFor(client, actor.organizationId, versionId)
    if (version.status !== "REMOVED") throw new DomainError("Só um checkpoint removido da base pode ter a remoção confirmada.", "CHECKPOINT_NOT_REMOVED", 409)
    const at = now()
    await client.query(`update checkpoint_versions set reviewed_by = $2, reviewed_at = $3, updated_at = $3 where id = $1`, [versionId, actor.personId, at])
    await audit(client, actor, "CHECKPOINT_REMOVAL_ACKNOWLEDGED", "checkpoint_version", versionId, { definitionId: version.definition_id, knowledgeVersion: version.knowledge_version })
  })
}

/** Configuração OPERACIONAL — a regra oficial não é campo aqui (esquema estrito: `requirement`/`sourceLiteral` são recusados). */
export const definitionConfigSchema = z.object({
  operationalLabel: z.string().trim().min(2).max(120).nullable().optional(),
  criticality: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(),
  feedbackEnabled: z.boolean().optional(),
  analyticsEnabled: z.boolean().optional(),
  highlight: z.boolean().optional(),
  operationalStatus: z.enum(["ACTIVE", "INACTIVE"]).optional(),
}).strict()

export async function updateCheckpointDefinition(db: Database, actor: RegistryActor, definitionId: string, rawInput: unknown, now: () => Date = () => new Date()): Promise<void> {
  const parsed = definitionConfigSchema.safeParse(rawInput)
  if (!parsed.success) throw new DomainError("A regra oficial vem da Base de Conhecimento e não pode ser editada aqui. Só a configuração operacional é alterável.", "CHECKPOINT_OFFICIAL_RULE_READ_ONLY", 422)
  const input = parsed.data
  await inTransaction(db, async (client) => {
    const before = (await client.query<Record<string, unknown>>(`select operational_label, criticality, feedback_enabled, analytics_enabled, highlight, operational_status from checkpoint_definitions where id = $1 and organization_id = $2`, [definitionId, actor.organizationId])).rows[0]
    if (!before) throw new DomainError("Checkpoint não encontrado.", "CHECKPOINT_NOT_FOUND", 404)
    await client.query(
      `update checkpoint_definitions set operational_label = case when $3 then $4 else operational_label end, criticality = coalesce($5, criticality), feedback_enabled = coalesce($6, feedback_enabled),
         analytics_enabled = coalesce($7, analytics_enabled), highlight = coalesce($8, highlight), operational_status = coalesce($9, operational_status), updated_at = $10
       where id = $1 and organization_id = $2`,
      [definitionId, actor.organizationId, input.operationalLabel !== undefined, input.operationalLabel ?? null, input.criticality ?? null, input.feedbackEnabled ?? null, input.analyticsEnabled ?? null, input.highlight ?? null, input.operationalStatus ?? null, now()],
    )
    await audit(client, actor, "CHECKPOINT_DEFINITION_CONFIGURED", "checkpoint_definition", definitionId, { before, changes: input })
  })
}

export const scopesSchema = z.object({ scopes: z.array(z.object({ scopeType: z.enum(["BUSINESS_DOMAIN", "TEAM", "SUBTEAM"]), businessDomainId: z.string().uuid().nullable().optional(), teamId: z.string().uuid().nullable().optional(), subteamId: z.string().uuid().nullable().optional() }).strict()).max(50) }).strict()

/** Escopo = associação (a regra lógica nunca é duplicada por equipe). Lista vazia = vale onde a base vale. */
export async function setCheckpointScopes(db: Database, actor: RegistryActor, definitionId: string, rawInput: unknown): Promise<void> {
  const { scopes } = scopesSchema.parse(rawInput)
  for (const scope of scopes) {
    const valid = (scope.scopeType === "BUSINESS_DOMAIN" && scope.businessDomainId) || (scope.scopeType === "TEAM" && scope.teamId && !scope.subteamId) || (scope.scopeType === "SUBTEAM" && scope.subteamId)
    if (!valid) throw new DomainError("Escopo incompleto.", "CHECKPOINT_SCOPE_INVALID", 422)
  }
  await inTransaction(db, async (client) => {
    const exists = (await client.query(`select 1 from checkpoint_definitions where id = $1 and organization_id = $2`, [definitionId, actor.organizationId])).rows[0]
    if (!exists) throw new DomainError("Checkpoint não encontrado.", "CHECKPOINT_NOT_FOUND", 404)
    const before = (await client.query(`select scope_type, business_domain_id, team_id, subteam_id from checkpoint_scopes where definition_id = $1`, [definitionId])).rows
    await client.query(`delete from checkpoint_scopes where definition_id = $1`, [definitionId])
    for (const scope of scopes) {
      await client.query(`insert into checkpoint_scopes (organization_id, definition_id, scope_type, business_domain_id, team_id, subteam_id) values ($1, $2, $3, $4, $5, $6)`, [actor.organizationId, definitionId, scope.scopeType, scope.businessDomainId ?? null, scope.teamId ?? null, scope.subteamId ?? null])
    }
    await audit(client, actor, "CHECKPOINT_SCOPES_UPDATED", "checkpoint_definition", definitionId, { before, after: scopes })
  })
}

/** Governança do documento: ligada, a monitoria usa só as versões ATIVAS do registry; desligada, o catálogo estrutural de sempre. */
export async function setDocumentGovernance(db: Database, actor: RegistryActor, documentId: string, enabled: boolean, now: () => Date = () => new Date()): Promise<void> {
  await inTransaction(db, async (client) => {
    const document = (await client.query(`select 1 from knowledge_documents where id = $1 and organization_id = $2 and deleted_at is null`, [documentId, actor.organizationId])).rows[0]
    if (!document) throw new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)
    if (enabled) await client.query(`insert into checkpoint_governed_documents (knowledge_document_id, organization_id, enabled_by, enabled_at) values ($1, $2, $3, $4) on conflict (knowledge_document_id) do nothing`, [documentId, actor.organizationId, actor.personId, now()])
    else await client.query(`delete from checkpoint_governed_documents where knowledge_document_id = $1 and organization_id = $2`, [documentId, actor.organizationId])
    await audit(client, actor, enabled ? "CHECKPOINT_GOVERNANCE_ENABLED" : "CHECKPOINT_GOVERNANCE_DISABLED", "knowledge_document", documentId, {})
  })
}
