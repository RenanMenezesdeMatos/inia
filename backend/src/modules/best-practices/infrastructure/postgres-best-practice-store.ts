import type { Database } from "../../../infrastructure/database/pool.js"
import { BEST_PRACTICE_CODING_PROMPT_VERSION } from "../domain/versions.js"
import { reuseKeyOf, type BestPracticeStore, type KnownPattern, type ModelMode, type PatternScope, type PatternWrite, type ReusableCoding } from "../application/ports.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"

/** Codificação reaproveitável = leitura definitiva (presente conferido, ausente, não se aplica ou "não dá para decidir" do próprio modelo). */
const REUSABLE_CODING_SQL = `(c.status in ('PRESENT', 'ABSENT', 'NOT_APPLICABLE') or c.unclear_reason = 'MODEL_UNCLEAR') and (c.status <> 'PRESENT' or c.quote_verified)`

/** Resumo por contexto sustentado (o que a lista, a recomendação e o feedback mostram sem abrir a versão). */
export const supportedContextsOf = (write: Pick<PatternWrite, "contexts">) =>
  write.contexts
    .filter((context) => context.assessment.outcome === "SUPPORTED")
    .map((context) => ({
      cellKey: context.cellKey,
      reason: context.reason,
      subReason: context.subReason,
      level: context.level,
      label: context.label,
      strength: context.assessment.strength,
      topRatePercent: context.assessment.top.operatorRatePercent,
      referenceRatePercent: context.assessment.reference.operatorRatePercent,
      topOperators: context.assessment.top.operatorsApplicable,
      referenceOperators: context.assessment.reference.operatorsApplicable,
      topCalls: context.assessment.top.callsApplicable,
      referenceCalls: context.assessment.reference.callsApplicable,
    }))

export function createPostgresBestPracticeStore(db: Database): BestPracticeStore {
  return {
    async knownPatterns(scope: PatternScope): Promise<KnownPattern[]> {
      const rows = (await db.query<{ id: string; name: string; description: string; observable_definition: string; applies_when: string | null; not_applicable_when: string | null; guidance: string; suggested_phrasing: string | null; how_it_helps: string | null; phrasing_contexts: string[] | null; review_status: KnownPattern["reviewStatus"]; obligation_status: KnownPattern["obligationStatus"]; obligation_confirmed_by_review: boolean }>(
        `select p.id, p.name, p.description, p.observable_definition, p.applies_when, p.not_applicable_when, p.guidance, p.suggested_phrasing, p.how_it_helps, p.review_status, p.obligation_status, p.obligation_confirmed_by_review,
                case when p.suggested_phrasing is distinct from v.proposed->>'suggestedPhrasing' or jsonb_typeof(v.proposed->'phrasingContexts') <> 'array' then null else array(select jsonb_array_elements_text(v.proposed->'phrasingContexts')) end phrasing_contexts
           from best_practice_patterns p left join best_practice_pattern_versions v on v.id = p.current_version_id
          where p.organization_id = $1 and p.data_origin = $2 and p.synthetic_dataset_id is not distinct from $3 and p.indicator_definition_id is not distinct from $4 and p.channel_flag_id is not distinct from $7 and p.team_id is not distinct from $5 and p.subteam_id is not distinct from $6
          order by p.created_at, p.id`,
        [scope.organizationId, scope.origin, scope.syntheticDatasetId, scope.indicatorDefinitionId, scope.teamId, scope.subteamId, scope.channelFlagId],
      )).rows
      return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, observableDefinition: row.observable_definition, appliesWhen: row.applies_when, notApplicableWhen: row.not_applicable_when, guidance: row.guidance, suggestedPhrasing: row.suggested_phrasing, phrasingContexts: row.phrasing_contexts, howItHelps: row.how_it_helps, reviewStatus: row.review_status, obligationStatus: row.obligation_status, obligationConfirmedByReview: row.obligation_confirmed_by_review }))
    },

    async reusableCodings(organizationId: string, analysisId: string, modelMode: ModelMode, keys) {
      if (keys.length === 0) return new Map<string, ReusableCoding>()
      const rows = (await db.query<{ call_ref: string; definition_hash: string; transcript_checksum: string; status: ReusableCoding["status"]; turn_ref: string | null; quote: string | null; quote_verified: boolean; unclear_reason: string | null; analysis_id: string }>(
        `select distinct on (c.call_ref, c.definition_hash, c.transcript_checksum) c.call_ref, c.definition_hash, c.transcript_checksum, c.status, c.turn_ref, c.quote, c.quote_verified, c.unclear_reason, c.analysis_id
           from best_practice_call_codings c
           join best_practice_analyses a on a.id = c.analysis_id and a.organization_id = c.organization_id
           join unnest($4::text[], $5::text[], $6::text[]) k(call_ref, definition_hash, transcript_checksum) on k.call_ref = c.call_ref and k.definition_hash = c.definition_hash and k.transcript_checksum = c.transcript_checksum
          where c.organization_id = $1 and c.analysis_id <> $2 and a.status = 'COMPLETED' and a.model_mode = $3 and a.provenance->>'codingPromptVersion' = $7 and ${REUSABLE_CODING_SQL}
          order by c.call_ref, c.definition_hash, c.transcript_checksum, c.created_at desc`,
        [organizationId, analysisId, modelMode, keys.map((key) => key.callRef), keys.map((key) => key.definitionHash), keys.map((key) => key.transcriptChecksum), BEST_PRACTICE_CODING_PROMPT_VERSION],
      )).rows
      return new Map(rows.map((row) => [reuseKeyOf({ callRef: row.call_ref, definitionHash: row.definition_hash, transcriptChecksum: row.transcript_checksum }), { status: row.status, turnRef: row.turn_ref, quote: row.quote, quoteVerified: row.quote_verified, unclearReason: row.unclear_reason, analysisId: row.analysis_id }]))
    },

    async saveAnalysis(scope, analysisId, write, now, complete) {
      return inTransaction(db, async (client) => {
        const codings = write.codings
        if (codings.length > 0) {
          await client.query(
            `insert into best_practice_call_codings (organization_id, analysis_id, candidate_key, definition_hash, call_ref, interaction_id, person_id, operator_ref, group_kind, cell_key, status, turn_ref, quote, quote_verified, unclear_reason, transcript_checksum, reused_from_analysis_id, created_at)
             select $1, $2, * , $17 from unnest($3::text[], $4::text[], $5::text[], $6::uuid[], $7::uuid[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::boolean[], $15::text[], $16::text[], $18::uuid[])
             on conflict (analysis_id, candidate_key, call_ref) do nothing`,
            [scope.organizationId, analysisId, codings.map((c) => c.candidateKey), codings.map((c) => c.definitionHash), codings.map((c) => c.callRef), codings.map((c) => c.interactionId), codings.map((c) => c.personId), codings.map((c) => c.operatorRef), codings.map((c) => c.group), codings.map((c) => c.cellKey), codings.map((c) => c.status), codings.map((c) => c.turnRef), codings.map((c) => c.quote), codings.map((c) => c.quoteVerified), codings.map((c) => c.unclearReason), codings.map((c) => c.transcriptChecksum), now, codings.map((c) => c.reusedFromAnalysisId)],
          )
        }
        const created: string[] = []
        const updated: string[] = []
        for (const pattern of write.patterns) {
          const candidate = pattern.candidate
          const supportedContexts = JSON.stringify(supportedContextsOf(pattern))
          let patternId = pattern.patternId
          if (!patternId) {
            patternId = (await client.query<{ id: string }>(
              `insert into best_practice_patterns (organization_id, data_origin, synthetic_dataset_id, indicator_definition_id, channel_flag_id, team_id, subteam_id, name, description, observable_definition, guidance, suggested_phrasing, applies_when, not_applicable_when, review_status, obligation_status, current_strength, supported_contexts, created_by_analysis_id, created_at, updated_at, how_it_helps)
               values ($1, $2, $3, $4, $19, $5, $18, $6, $7, $8, $9, $10, $11, $12, 'PENDING_REVIEW', $13, $14, $15, $16, $17, $17, $20) returning id`,
              [scope.organizationId, scope.origin, scope.syntheticDatasetId, scope.indicatorDefinitionId, scope.teamId, candidate.name, candidate.description, candidate.observableDefinition, candidate.guidance, candidate.suggestedPhrasing, candidate.appliesWhen, candidate.notApplicableWhen, pattern.obligationStatus, pattern.strength, supportedContexts, analysisId, now, scope.subteamId, scope.channelFlagId, candidate.howItHelps ?? null],
            )).rows[0]!.id
            created.push(patternId)
          } else {
            await client.query(
              `update best_practice_patterns
                  set obligation_status = $3, obligation_confirmed_by_review = case when $4 then false else obligation_confirmed_by_review end, current_strength = $5, supported_contexts = $6, updated_at = $7
                where id = $1 and organization_id = $2`,
              [patternId, scope.organizationId, pattern.obligationStatus, pattern.resetObligationConfirmation, pattern.strength, supportedContexts, now],
            )
            updated.push(patternId)
          }
          const proposed = { name: candidate.name, description: candidate.description, observableDefinition: candidate.observableDefinition, appliesWhen: candidate.appliesWhen, notApplicableWhen: candidate.notApplicableWhen, guidance: candidate.guidance, suggestedPhrasing: candidate.suggestedPhrasing, howItHelps: candidate.howItHelps ?? null, origin: candidate.origin, hypothesisRef: candidate.hypothesisRef, exampleRefs: candidate.exampleRefs, phrasingContexts: candidate.phrasingContexts ?? null }
          const versionId = (await client.query<{ id: string }>(
            `insert into best_practice_pattern_versions (organization_id, pattern_id, analysis_id, version, candidate_key, definition_hash, proposed, contexts, strength, obligation_check, limitations, period_start, period_end, reference_periods, calls_analyzed, operators_analyzed, created_at)
             values ($1, $2, $3, (select coalesce(max(version), 0) + 1 from best_practice_pattern_versions where pattern_id = $2), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
            [scope.organizationId, patternId, analysisId, candidate.key, candidate.definitionHash, JSON.stringify(proposed), JSON.stringify(pattern.contexts), pattern.strength, JSON.stringify(pattern.obligation ?? { checked: false, reason: "Sem associação sustentada nesta análise: a verificação de obrigação não foi feita." }), pattern.limitations, write.period.start, write.period.end, write.referencePeriods, pattern.callsAnalyzed, pattern.operatorsAnalyzed, now],
          )).rows[0]!.id
          await client.query(`update best_practice_patterns set current_version_id = $2 where id = $1`, [patternId, versionId])
          if (pattern.evidence.length > 0) {
            const evidence = pattern.evidence
            await client.query(
              `insert into best_practice_evidence (organization_id, pattern_version_id, call_ref, interaction_id, person_id, operator_label, group_kind, cell_key, reason, sub_reason, occurred_at, turn_ref, excerpt, position)
               select $1, $2, * from unnest($3::text[], $4::uuid[], $5::uuid[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::timestamptz[], $12::text[], $13::text[], $14::int[])`,
              [scope.organizationId, versionId, evidence.map((e) => e.callRef), evidence.map((e) => e.interactionId), evidence.map((e) => e.personId), evidence.map((e) => e.operatorLabel), evidence.map((e) => e.group), evidence.map((e) => e.cellKey), evidence.map((e) => e.reason), evidence.map((e) => e.subReason), evidence.map((e) => e.occurredAt), evidence.map((e) => e.turnRef), evidence.map((e) => e.excerpt), evidence.map((_, index) => index + 1)],
            )
          }
          await client.query(
            `insert into best_practice_pattern_reviews (organization_id, pattern_id, action, from_status, to_status, reason, analysis_id, created_at)
             select $1, $2, 'ANALYSIS_UPDATE', review_status, review_status, $3, $4, $5 from best_practice_patterns where id = $2`,
            [scope.organizationId, patternId, pattern.updateNote, analysisId, now],
          )
        }
        const completion = complete({ created, updated })
        const finished = await client.query(
          `update best_practice_analyses set status = 'COMPLETED', outcome = $3, report = $4, provenance = $5, finished_at = $6, claimed_until = null, error_code = null, error_message = null
            where id = $1 and organization_id = $2 and status = 'RUNNING'`,
          [analysisId, scope.organizationId, completion.outcome, JSON.stringify(completion.report), JSON.stringify(completion.provenance), now],
        )
        // A posse venceu e outra execução assumiu: desfaz esta gravação inteira (a outra conclui).
        if (finished.rowCount !== 1) throw new Error("BEST_PRACTICE_ANALYSIS_LEASE_LOST")
        return { created, updated, completion }
      })
    },
  }
}
