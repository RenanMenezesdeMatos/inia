import type { Database } from "../../../infrastructure/database/pool.js"
import { reactivateWaitingEnrollment } from "../../workflows/application/reactivate-enrollment.js"
import type { ArtifactIdentity, ArtifactRecord, ReliableFeedbackStore, ReliableReviewRecord } from "../application/ports.js"

type ArtifactRow = {
  id: string; organization_id: string; artifact_key: string; enrollment_id: string | null; workflow_id: string | null; workflow_version_id: string | null; node_id: string; source_node_id: string
  source_type: ArtifactRecord["sourceType"]; domain: ArtifactRecord["domain"]; collaborator_id: string; interaction_id: string | null; indicator_measurement_id: string | null; contract_version: string; prv_closing_key: string | null
  status: ArtifactRecord["status"]; disposition: ArtifactRecord["disposition"]; policy_version: string | null; artifact: ArtifactRecord["artifact"]; qa_resolved_at: Date | null; created_at: Date; completed_at: Date | null; claimed_until: Date | null
}
type ReviewRow = {
  id: string; organization_id: string; artifact_id: string; item_index: number; section: "STRENGTH" | "OPPORTUNITY"; item_kind: string; subject_label: string; review_item: ReliableReviewRecord["reviewItem"]
  wording_source: "WRITER" | "FALLBACK"; writer_violations: string[]; proposed_wording: ReliableReviewRecord["proposedWording"]; review_required_by: string[]; review_status: ReliableReviewRecord["reviewStatus"]
  final_wording: ReliableReviewRecord["finalWording"]; reason_category: ReliableReviewRecord["reasonCategory"]; reviewer_comment: string | null; edit_warnings: string[]; reviewed_by: string | null; reviewed_at: Date | null; created_at: Date
}

const toArtifact = (row: ArtifactRow): ArtifactRecord => ({
  id: row.id, organizationId: row.organization_id, artifactKey: row.artifact_key, enrollmentId: row.enrollment_id, workflowId: row.workflow_id, workflowVersionId: row.workflow_version_id, nodeId: row.node_id,
  sourceNodeId: row.source_node_id, sourceType: row.source_type, domain: row.domain, collaboratorId: row.collaborator_id, interactionId: row.interaction_id, indicatorMeasurementId: row.indicator_measurement_id,
  contractVersion: row.contract_version, prvClosingKey: row.prv_closing_key ?? null, status: row.status, disposition: row.disposition, policyVersion: row.policy_version, artifact: row.artifact, qaResolvedAt: row.qa_resolved_at, createdAt: row.created_at, completedAt: row.completed_at,
})
const toReview = (row: ReviewRow): ReliableReviewRecord => ({
  id: row.id, organizationId: row.organization_id, artifactId: row.artifact_id, itemIndex: row.item_index, section: row.section, itemKind: row.item_kind, subjectLabel: row.subject_label, reviewItem: row.review_item,
  wordingSource: row.wording_source, writerViolations: row.writer_violations, proposedWording: row.proposed_wording, reviewRequiredBy: row.review_required_by, reviewStatus: row.review_status,
  finalWording: row.final_wording, reasonCategory: row.reason_category, reviewerComment: row.reviewer_comment, editWarnings: row.edit_warnings, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, createdAt: row.created_at,
})

/** Leitura de UMA revisão (usada também pela fila do QA de feedback, que só tem `query`). */
export async function findReliableReview(db: Pick<Database, "query">, organizationId: string, reviewId: string): Promise<ReliableReviewRecord | null> {
  const result = await db.query<ReviewRow>(`select * from reliable_feedback_item_reviews where organization_id = $1 and id = $2`, [organizationId, reviewId])
  return result.rows[0] ? toReview(result.rows[0]) : null
}

/**
 * V1.7.1e — o artefato de uma revisão com TODAS as revisões dele (prévia do feedback completo no QA). Só leitura, escopada à
 * organização; o escopo do avaliador já foi decidido por quem chama (a revisão pedida está no escopo dele).
 */
export async function findReliableAnalysis(db: Pick<Database, "query">, organizationId: string, artifactId: string): Promise<{ artifactId: string; artifact: NonNullable<ArtifactRecord["artifact"]>; reviews: ReliableReviewRecord[] } | null> {
  const artifact = await db.query<Pick<ArtifactRow, "id" | "artifact">>(`select id, artifact from reliable_feedback_artifacts where organization_id = $1 and id = $2 and status = 'COMPLETED'`, [organizationId, artifactId])
  const row = artifact.rows[0]
  if (!row?.artifact) return null
  const reviews = await db.query<ReviewRow>(`select * from reliable_feedback_item_reviews where organization_id = $1 and artifact_id = $2 order by item_index`, [organizationId, artifactId])
  return { artifactId: row.id, artifact: row.artifact, reviews: reviews.rows.map(toReview) }
}

const IDENTITY_COLUMNS = `organization_id, artifact_key, enrollment_id, workflow_id, workflow_version_id, node_id, source_node_id, source_type, domain, collaborator_id, interaction_id, indicator_measurement_id, contract_version, prv_closing_key`
const identityParams = (identity: ArtifactIdentity) => [identity.organizationId, identity.artifactKey, identity.enrollmentId, identity.workflowId, identity.workflowVersionId, identity.nodeId, identity.sourceNodeId, identity.sourceType, identity.domain, identity.collaboratorId, identity.interactionId, identity.indicatorMeasurementId, identity.contractVersion, identity.prvClosingKey ?? null]

/**
 * Persistência do feedback confiável (migration 083). A posse da geração é UMA instrução (`insert … on conflict do update …
 * where`, como o registro de gerações da V1.5.10): concluído nunca é regerado; lease ativa de outro = IN_PROGRESS. O
 * artefato e as revisões entram numa transação só. A decisão de QA grava a avaliação E, quando nada fica pendente, fecha o
 * QA do artefato e reativa a matrícula — na MESMA transação (nunca "avaliado mas o Workflow não voltou").
 */
export function createPostgresReliableFeedbackStore(db: Database): ReliableFeedbackStore {
  const loadReviews = async (client: Pick<Database, "query">, organizationId: string, artifactId: string) =>
    (await client.query<ReviewRow>(`select * from reliable_feedback_item_reviews where organization_id = $1 and artifact_id = $2 order by item_index`, [organizationId, artifactId])).rows.map(toReview)

  return {
    async claim(identity, now, leaseSeconds) {
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000)
      const owned = await db.query<ArtifactRow>(
        `insert into reliable_feedback_artifacts as a (${IDENTITY_COLUMNS}, status, claimed_until, attempts, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDING',$15,1,$16,$16)
         on conflict (organization_id, artifact_key) do update
           set status = 'PENDING', claimed_until = $15, attempts = a.attempts + 1, last_error = null, updated_at = $16
           where a.status = 'FAILED' or (a.status = 'PENDING' and a.claimed_until < $16)
         returning a.*`,
        [...identityParams(identity), leaseUntil, now],
      )
      if (owned.rows[0]) return { kind: "CLAIMED", artifactId: owned.rows[0].id }
      const current = await db.query<ArtifactRow>(`select * from reliable_feedback_artifacts where organization_id = $1 and artifact_key = $2`, [identity.organizationId, identity.artifactKey])
      const row = current.rows[0]!
      return row.status === "COMPLETED" ? { kind: "COMPLETED", record: toArtifact(row) } : { kind: "IN_PROGRESS" }
    },

    async complete(organizationId, artifactId, data, now) {
      const client = await db.connect()
      try {
        await client.query("begin")
        const updated = await client.query<ArtifactRow>(
          `update reliable_feedback_artifacts
           set status = 'COMPLETED', disposition = $3, policy_version = $4, normalized_input = $5::jsonb, canonical_context = $6::jsonb, artifact = $7::jsonb,
               writer_input = $8::jsonb, writer_raw_output = $9::jsonb, writer_error = $10, writer_provenance = $11::jsonb, claimed_until = null, completed_at = $12, updated_at = $12
           where organization_id = $1 and id = $2 and status = 'PENDING'
           returning *`,
          [organizationId, artifactId, data.disposition, data.policyVersion, JSON.stringify(data.normalizedInput), JSON.stringify(data.canonicalContext), JSON.stringify(data.artifact), JSON.stringify(data.writerInput ?? null), JSON.stringify(data.writerRawOutput ?? null), data.writerError, JSON.stringify(data.writerProvenance), now],
        )
        const row = updated.rows[0]
        if (!row) throw new Error("posse da geração do feedback perdida (lease expirada) — nada gravado")
        for (const review of data.reviews) {
          await client.query(
            `insert into reliable_feedback_item_reviews (organization_id, artifact_id, item_index, section, item_kind, subject_label, review_item, wording_source, writer_violations, proposed_wording, review_required_by, created_at)
             values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11,$12)`,
            [organizationId, artifactId, review.itemIndex, review.section, review.itemKind, review.subjectLabel, JSON.stringify(review.reviewItem), review.wordingSource, review.writerViolations, JSON.stringify(review.proposedWording), review.reviewRequiredBy, now],
          )
        }
        // V1.6.1 — observações verificadas (evidência de pares): um status por atendimento × prática; a reavaliação mais recente
        // vence. Só atendimento DA organização e DO colaborador (o insert … select não grava nada fora disso).
        for (const observation of data.observations ?? []) {
          await client.query(
            // V1.7.1m — comportamento canônico (chave BEHAVIOR:…) + linhagem de TODAS as fontes que o sustentam. V1.7.1n — etapa de origem.
            // Checkpoint Registry — identidade lógica e versão da regra (só da própria organização).
            `insert into process_checkpoint_observations as o (organization_id, person_id, interaction_id, practice_key, document_id, document_version, requirement, status, occurred_at, source_artifact_id, created_at, updated_at, completeness, sub_items, analytics_status, analytics_reasons, canonical_behavior, source_lineages, checkpoint_ref, checkpoint_definition_id, checkpoint_version_id, display_context)
             select $1, $2, i.id, $4, d.id, $6, $7, $8, i.started_at, $9, $10, $10, $11, $12::jsonb, $13, $14::text[], $15, $16::jsonb, $17,
                    (select cd.id from checkpoint_definitions cd where cd.id = $18::uuid and cd.organization_id = $1), (select cv.id from checkpoint_versions cv where cv.id = $19::uuid and cv.organization_id = $1), $20::jsonb
             from interactions i join knowledge_documents d on d.id = $5 and d.organization_id = $1
             where i.id = $3 and i.organization_id = $1 and i.operator_id = $2
             on conflict (interaction_id, practice_key) do update set status = excluded.status, document_version = excluded.document_version, requirement = excluded.requirement, source_artifact_id = excluded.source_artifact_id, updated_at = excluded.updated_at, completeness = excluded.completeness, sub_items = excluded.sub_items, analytics_status = excluded.analytics_status, analytics_reasons = excluded.analytics_reasons, canonical_behavior = excluded.canonical_behavior, source_lineages = excluded.source_lineages, checkpoint_ref = excluded.checkpoint_ref, checkpoint_definition_id = excluded.checkpoint_definition_id, checkpoint_version_id = excluded.checkpoint_version_id, display_context = coalesce(excluded.display_context, o.display_context)`,
            [organizationId, observation.personId, observation.interactionId, observation.practiceKey, observation.documentId, observation.documentVersion, observation.requirement, observation.status, artifactId, now, observation.completeness ?? null, observation.subItems ? JSON.stringify(observation.subItems) : null, observation.analyticsStatus ?? "NEEDS_REVIEW", observation.analyticsReasons ?? [], observation.canonicalBehavior ?? null, observation.sourceLineages ? JSON.stringify(observation.sourceLineages) : null, observation.checkpointRef ?? null, observation.checkpointDefinitionId ?? null, observation.checkpointVersionId ?? null, observation.displayContext ? JSON.stringify(observation.displayContext) : null],
          )
        }
        // INDICATOR DIAGNOSIS V1/V2 — a verdade diagnóstica (fechamento do PRV ou diagnóstico direto de um indicador): UMA por chave (mesmo fechamento + mesmas estratégias + mesma
        // lógica). Conflito = outra execução já diagnosticou este fechamento: a transação inteira falha (nada duplicado é publicado).
        if (data.prvDiagnosis) {
          const diagnosis = data.prvDiagnosis
          await client.query(
            `insert into prv_closing_diagnoses (organization_id, person_id, reference_period, idempotency_key, logic_version, strategy_versions, closing, diagnosis, source_artifact_id, enrollment_id, generated_at, created_at, source_kind)
             select $1, p.id, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13
             from people p where p.id = $2 and p.organization_id = $1`,
            [organizationId, diagnosis.personId, diagnosis.referencePeriod, diagnosis.idempotencyKey, diagnosis.logicVersion, JSON.stringify(diagnosis.strategyVersions), JSON.stringify(diagnosis.closing), JSON.stringify(diagnosis.diagnosis), artifactId, diagnosis.enrollmentId, diagnosis.generatedAt, now, diagnosis.sourceKind ?? "PRV_CLOSING"],
          )
        }
        await client.query("commit")
        return toArtifact(row)
      } catch (error) {
        await client.query("rollback")
        throw error
      } finally {
        client.release()
      }
    },

    async fail(organizationId, artifactId, error, now) {
      await db.query(
        `update reliable_feedback_artifacts set status = 'FAILED', last_error = $3, claimed_until = null, updated_at = $4 where organization_id = $1 and id = $2 and status = 'PENDING'`,
        [organizationId, artifactId, error.slice(0, 300), now],
      )
    },

    async get(organizationId, artifactId) {
      const result = await db.query<ArtifactRow>(`select * from reliable_feedback_artifacts where organization_id = $1 and id = $2`, [organizationId, artifactId])
      return result.rows[0] ? toArtifact(result.rows[0]) : null
    },

    listReviews: (organizationId, artifactId) => loadReviews(db, organizationId, artifactId),

    getReview: (organizationId, reviewId) => findReliableReview(db, organizationId, reviewId),

    async decideReview(organizationId, reviewId, decision, resolve) {
      const client = await db.connect()
      try {
        await client.query("begin")
        const written = await client.query<{ artifact_id: string }>(
          `update reliable_feedback_item_reviews
           set review_status = $3, final_wording = $4::jsonb, reason_category = $5, reviewer_comment = $6, edit_warnings = $7, reviewed_by = $8, reviewed_at = $9
           where organization_id = $1 and id = $2 and review_status = 'PENDING_REVIEW'
             and not exists (select 1 from reliable_feedback_artifacts sa where sa.id = artifact_id and sa.superseded_at is not null)
           returning artifact_id`,
          [organizationId, reviewId, decision.status, decision.finalWording ? JSON.stringify(decision.finalWording) : null, decision.reasonCategory, decision.comment, decision.editWarnings, decision.reviewedBy, decision.reviewedAt],
        )
        const artifactId = written.rows[0]?.artifact_id
        if (!artifactId) {
          await client.query("rollback")
          return { written: false }
        }
        // O artefato é travado: duas decisões concorrentes de itens diferentes fecham o QA exatamente uma vez.
        const artifact = (await client.query<ArtifactRow>(`select * from reliable_feedback_artifacts where organization_id = $1 and id = $2 for update`, [organizationId, artifactId])).rows[0]!
        const reviews = await loadReviews(client, organizationId, artifactId)
        let resolution: { disposition: ArtifactRecord["disposition"] & string; reactivated: boolean } | null = null
        if (!reviews.some((review) => review.reviewStatus === "PENDING_REVIEW") && artifact.qa_resolved_at === null && artifact.artifact) {
          const disposition = resolve(artifact.artifact, reviews)
          await client.query(`update reliable_feedback_artifacts set disposition = $3, qa_resolved_at = $4, updated_at = $4 where organization_id = $1 and id = $2`, [organizationId, artifactId, disposition, decision.reviewedAt])
          const reactivated = artifact.enrollment_id
            ? await reactivateWaitingEnrollment(client, { organizationId, enrollmentId: artifact.enrollment_id, nodeId: artifact.node_id, reason: "reliable_feedback_qa_resolved", payload: { artifactId, disposition } })
            : false
          resolution = { disposition, reactivated }
        }
        await client.query("commit")
        return { written: true, resolution }
      } catch (error) {
        await client.query("rollback")
        throw error
      } finally {
        client.release()
      }
    },
  }
}
