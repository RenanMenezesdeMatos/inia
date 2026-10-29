import { randomUUID } from "node:crypto"
import { deliveredIndicatorPeriodsSql, deliveredMonitoringOfSql, engineMessageHiddenSql } from "./delivery-guards-sql.js"
import type pg from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { VerifiedCallAnalysis } from "../domain/call-analysis.js"
import { criterionKeyOf, extractionRevisionOf, obligationCriterionKeyOf, reconcileCriteria, type CriterionIdentity, type PersistedCriterion } from "../domain/criteria-identity.js"
import type { IndicatorInvestigation, MemoryRow } from "../domain/indicator-investigation.js"
import type { MemoryCriterionRow } from "../domain/memory-queries.js"
import type { ProductApplicabilityRecord } from "../domain/product-applicability.js"
import type { MemoryArgument } from "../domain/indicator-investigation.js"
import { segmentKeySql } from "./postgres-indicator-data.js"
import { CRITERIA_EXTRACTION_VERSION } from "../domain/versions.js"
import { LEGACY_REVIEW_UNAVAILABLE, stageResponsesOf, type StageResponses } from "../domain/analysis-recovery.js"
import type { AnalysisClaim, AnalysisIdentity, AnalysisRunRecord, CallSnapshot, FeedbackMemoryStore, FeedbackMessageStore, MessageRecord, StoredCallAssessment } from "../application/ports.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"

/**
 * MEMÓRIA OPERACIONAL no Postgres (migration 102).
 *
 * POSSE: uma instrução (`insert … on conflict do update … where`) — concluída = reutilizada; lease ativa de outro = em andamento;
 * falha = retomável. SUPERSESSÃO sem sobrescrever: dentro de um lock por chamada, a leitura nova só vira VIGENTE se não houver
 * vigente mais nova (`as_of`); a anterior fica no histórico marcada (`superseded_by`). Por critério, a mesma regra: uma execução
 * antiga que termina depois nunca apaga uma leitura mais nova, e reprocessar nunca dobra a contagem (um vigente por chamada ×
 * critério).
 */
type Client = Pick<pg.PoolClient, "query">
type RunRow = { id: string; organization_id: string; kind: AnalysisIdentity["kind"]; analysis_key: string; person_id: string; interaction_id: string | null; indicator_definition_id: string | null; period_start: string | null; period_end: string | null; agent_id: string | null; trigger: AnalysisIdentity["trigger"]; status: AnalysisRunRecord["status"]; outcome: AnalysisRunRecord["outcome"]; outcome_reasons: string[]; logic_version: string; provenance: Record<string, unknown>; result: unknown; metrics: Record<string, unknown>; as_of: Date; completed_at: Date | null }

/** O que fica em `call_criterion_assessments.verification`: proposta × confirmação (com os motivos e o que a revisão disse). */
export const verificationRecordOf = (criterion: VerifiedCallAnalysis["criteria"][number]) => ({
  lineKey: criterion.lineKey,
  // `PRACTICE_IDENTITY_V1`: as linhas da obrigação, em ordem — a prática dela é a da primeira linha que pede conduta (a abertura de
  // uma lista não pede conduta; o item sim).
  ...(criterion.sources && criterion.sources.length > 0 ? { sourceLineKeys: criterion.sources.map((source) => source.lineKey) } : {}),
  lineHandle: criterion.lineHandle,
  leadIn: criterion.leadIn,
  origin: criterion.origin,
  declaredStatus: criterion.declaredStatus,
  proposedStatus: criterion.proposedStatus,
  confirmation: criterion.confirmation,
  confirmationReasons: criterion.confirmationReasons,
  review: criterion.review ? { verdict: criterion.review.verdict, issues: criterion.review.issues, listReading: criterion.review.listReading, focus: criterion.review.focus, note: criterion.review.note, conditionEvidence: criterion.review.conditionEvidence, counterEvidence: criterion.review.counterEvidence, ...(criterion.review.actPlace ? { actPlace: criterion.review.actPlace, judgedPart: criterion.review.judgedPart ?? null, outsidePart: criterion.review.outsidePart ?? null } : {}) } : null,
  downgrades: criterion.downgrades,
  rejectedEvidence: criterion.rejectedEvidence.length,
  declaredActionTense: criterion.declaredActionTense,
  // V7 — leitura semântica e o que a evidência sustentou (aplicabilidade, onde acontece, execução declarada/intencionada).
  requiredAction: criterion.requiredAction ?? null,
  condition: criterion.condition ?? null,
  applicabilityEvidence: criterion.applicabilityEvidence ?? [],
  evidenceNeeded: criterion.evidenceNeeded ?? null,
  // `CONDUCT_OCCURRENCE_V1` — a mesma conduta julgada por outra(s) regra(s) desta chamada (cobertura por regra × ocorrência real).
  occurrence: criterion.occurrence ?? null,
  // V13 — obrigação mista (o status vale para a parte da conversa; a parte em sistema fica registrada) e divergência análise × revisão.
  judgedPart: criterion.judgedPart ?? null,
  operationalPart: criterion.operationalPart ?? null,
  divergence: criterion.divergence ?? null,
  argumentItem: criterion.argument ? { scriptId: criterion.argument.scriptId, version: criterion.argument.version, itemKey: criterion.argument.itemKey, field: criterion.argument.field, modality: criterion.argument.modality, groupMode: criterion.argument.groupMode, condition: criterion.argument.condition } : null,
  // `PRODUCT_APPLICABILITY_V1` — solicitação, produtos da regra e o efeito (independente, estabelecida, de outro produto, suspensa).
  ...(criterion.productApplicability ? { productApplicability: criterion.productApplicability } : {}),
})

const toRun = (row: RunRow): AnalysisRunRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  kind: row.kind,
  analysisKey: row.analysis_key,
  personId: row.person_id,
  interactionId: row.interaction_id,
  indicatorDefinitionId: row.indicator_definition_id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  agentId: row.agent_id,
  trigger: row.trigger,
  logicVersion: row.logic_version,
  asOf: new Date(row.as_of),
  status: row.status,
  outcome: row.outcome,
  outcomeReasons: row.outcome_reasons ?? [],
  provenance: row.provenance ?? {},
  result: row.result,
  metrics: row.metrics ?? {},
  completedAt: row.completed_at ? new Date(row.completed_at) : null,
})


/**
 * PRÁTICA de uma linha de `call_criterion_assessments` (`PRACTICE_IDENTITY_V1`): a da PRIMEIRA linha da obrigação — âncora e, depois,
 * as linhas de origem em ordem — que tem prática (pede conduta); por último, a obrigação de várias linhas organizada como regra
 * COMPOSTA (a chave inteira, com '#'). Sem nenhuma, nenhuma linha (a consulta usa a identidade da linha).
 */
export const practiceOfRowSql = (alias: string) => `select pm.practice_key
  from unnest(array[split_part(${alias}.verification->>'lineKey', '#', 1)] || coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(${alias}.verification->'sourceLineKeys') = 'array' then ${alias}.verification->'sourceLineKeys' else '[]'::jsonb end)), '{}'::text[])
              || case when ${alias}.verification->>'lineKey' like '%#%' then array[${alias}.verification->>'lineKey'] else '{}'::text[] end) with ordinality k(line_key, ord)
  join knowledge_practice_members pm on pm.organization_id = ${alias}.organization_id and pm.line_key = k.line_key and pm.practice_key is not null
  order by k.ord limit 1`

/**
 * Status EFETIVO de uma linha de critério para qualquer contagem: acerto/desvio só quando CONFIRMADO pela revisão
 * (`verification.confirmation`). Leitura antiga (sem confirmação registrada) e hipótese não confirmada = inconclusiva.
 */
export const effectiveCriterionStatusSql = (alias: string) => `case when ${alias}.status in ('MET','NOT_MET','PARTIAL') and coalesce(${alias}.verification->>'confirmation', '') <> 'CONFIRMED' then 'NOT_OBSERVABLE' else ${alias}.status end`
/**
 * Leitura gravada antes da correção da recuperação como "concluída" sem revisão (`REVIEW_UNAVAILABLE`): é PENDÊNCIA técnica, não
 * conclusão — fica fora de toda agregação (nem acerto, nem desvio, nem inconclusiva) até a revisão ser retomada e a substituir.
 */
export const reviewSettledSql = (alias: string) => `not exists (select 1 from feedback_analysis_runs pr where pr.id = ${alias}.analysis_run_id and '${LEGACY_REVIEW_UNAVAILABLE}' = any(pr.outcome_reasons))`

const RUN_COLUMNS = "organization_id, kind, analysis_key, person_id, interaction_id, indicator_definition_id, period_start, period_end, agent_id, trigger, status, logic_version, as_of, claimed_until, attempts, started_at, created_at"

export function createPostgresFeedbackMemoryStore(db: Database): FeedbackMemoryStore & FeedbackMessageStore & { markDelivered(organizationId: string, messageId: string, at: Date): Promise<void> } {
  const completeRun = (client: Client, organizationId: string, runId: string, input: { outcome: string; outcomeReasons: string[]; result: unknown; provenance: Record<string, unknown>; metrics: Record<string, unknown> }, now: Date) =>
    client.query(
      `update feedback_analysis_runs set status = 'COMPLETED', outcome = $3, outcome_reasons = $4, result = $5, provenance = $6, metrics = $7, completed_at = $8, claimed_until = null, error = null
       where id = $1 and organization_id = $2`,
      [runId, organizationId, input.outcome, input.outcomeReasons, JSON.stringify(input.result), JSON.stringify(input.provenance), JSON.stringify(input.metrics), now],
    )

  const loadPersisted = async (client: Pick<Database, "query">, organizationId: string, documentId: string, version: number): Promise<PersistedCriterion[] | null> => {
    const rows = (await client.query<{ line_key: string; criterion_key: string; section_heading: string | null; text: string; position: number }>(
      `select line_key, criterion_key, section_heading, text, position from knowledge_criteria where organization_id = $1 and document_id = $2 and document_version = $3 and extraction_version = $4 order by position`,
      [organizationId, documentId, version, CRITERIA_EXTRACTION_VERSION],
    )).rows
    return rows.length > 0 ? rows.map((row) => ({ lineKey: row.line_key, criterionKey: row.criterion_key, heading: row.section_heading, text: row.text, position: row.position })) : null
  }
  const persistCriteria = async (organizationId: string, documentId: string, version: number, lines: readonly { lineKey: string; heading: string | null; text: string; position: number }[], identities: readonly CriterionIdentity[], reconciledWith: number | null) => {
    await inTransaction(db, async (client) => {
      for (const [index, line] of lines.entries()) {
        const identity = identities[index]!
        await client.query(
          `insert into knowledge_criteria (organization_id, document_id, document_version, line_key, criterion_key, section_heading, text, position, identity_basis, previous_criterion_key, extraction_version)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (organization_id, document_id, document_version, line_key) do nothing`,
          [organizationId, documentId, version, line.lineKey, identity.criterionKey, line.heading, line.text, line.position, identity.basis, identity.previousCriterionKey, CRITERIA_EXTRACTION_VERSION],
        )
      }
      const counts = identities.reduce<Record<string, number>>((acc, identity) => ({ ...acc, [identity.basis]: (acc[identity.basis] ?? 0) + 1 }), {})
      // Vínculo + MOTIVO de cada mudança entre versões (a série antiga não se mistura com a regra nova).
      const changes = identities.filter((identity) => identity.basis === "MODIFIED" || identity.basis === "SOURCE_SPECIFIC" || identity.basis === "EQUIVALENT_PREVIOUS").map((identity) => ({ lineKey: identity.lineKey, criterionKey: identity.criterionKey, basis: identity.basis, previousCriterionKey: identity.previousCriterionKey, reasons: identity.changeReasons ?? [] }))
      // Mesma versão da base já extraída por outra LÓGICA: correspondência com proveniência (nunca união das identidades).
      const older = (await client.query<{ extraction_version: string; line_key: string; criterion_key: string; section_heading: string | null; text: string; position: number }>(
        `select extraction_version, line_key, criterion_key, section_heading, text, position from knowledge_criteria
         where organization_id = $1 and document_id = $2 and document_version = $3 and extraction_version <> $4 order by created_at desc, position`,
        [organizationId, documentId, version, CRITERIA_EXTRACTION_VERSION],
      )).rows
      const from = older[0]?.extraction_version ?? null
      const extractionRevision = from
        ? extractionRevisionOf({ from, to: CRITERIA_EXTRACTION_VERSION, previous: older.filter((row) => row.extraction_version === from).map((row) => ({ lineKey: row.line_key, criterionKey: row.criterion_key, heading: row.section_heading, text: row.text, position: row.position })), current: lines, identities })
        : null
      const summary = { ...counts, changes, ...(extractionRevision ? { extractionRevision } : {}) }
      await client.query(
        `insert into knowledge_criteria_extractions (organization_id, document_id, document_version, extraction_version, reconciled_with_version, summary) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
        [organizationId, documentId, version, CRITERIA_EXTRACTION_VERSION, reconciledWith, JSON.stringify(summary)],
      )
    })
  }

  return {
    async claimAnalysis(identity, now, leaseSeconds): Promise<AnalysisClaim> {
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000)
      const owned = await db.query<{ id: string }>(
        `insert into feedback_analysis_runs as r (${RUN_COLUMNS})
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'RUNNING',$11,$12,$13,1,$14,$14)
         on conflict (organization_id, analysis_key) do update
           set status = 'RUNNING', claimed_until = $13, attempts = r.attempts + 1, error = null, trigger = excluded.trigger, as_of = excluded.as_of, started_at = excluded.started_at
           where r.status = 'FAILED' or (r.status = 'RUNNING' and r.claimed_until < $14)
         returning r.id`,
        [identity.organizationId, identity.kind, identity.analysisKey, identity.personId, identity.interactionId, identity.indicatorDefinitionId, identity.periodStart, identity.periodEnd, identity.agentId, JSON.stringify(identity.trigger), identity.logicVersion, identity.asOf, leaseUntil, now],
      )
      if (owned.rows[0]) return { kind: "CLAIMED", runId: owned.rows[0].id }
      const row = (await db.query<RunRow>(`select * from feedback_analysis_runs where organization_id = $1 and analysis_key = $2`, [identity.organizationId, identity.analysisKey])).rows[0]!
      return row.status === "COMPLETED" ? { kind: "COMPLETED", run: toRun(row) } : { kind: "IN_PROGRESS" }
    },

    async completeCallAnalysis(organizationId, runId, data, now) {
      return inTransaction(db, async (client) => {
        const snapshot = data.snapshot
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`call-memory:${snapshot.interactionId}`])
        const analysis = data.analysis
        await completeRun(client, organizationId, runId, { outcome: analysis.outcome, outcomeReasons: analysis.outcomeReasons, result: analysis, provenance: data.provenance, metrics: data.metrics }, now)
        const run = (await client.query<{ as_of: Date }>(`select as_of from feedback_analysis_runs where id = $1`, [runId])).rows[0]!
        const asOf = new Date(run.as_of)
        const procedureId = analysis.scenario.procedureDocumentId
        const procedureVersion = procedureId ? data.documentVersions.get(procedureId) ?? null : null
        const newer = (await client.query<{ id: string }>(
          `select id from call_assessments where interaction_id = $1 and coalesce(procedure_document_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid) and is_current and as_of > $3 limit 1`,
          [snapshot.interactionId, procedureId, asOf],
        )).rows[0]
        const assessmentId = randomUUID()
        const current = !newer
        // Supersessão em dois passos: a leitura anterior deixa de ser a vigente ANTES do insert (índice único da vigente) e só
        // aponta para a nova DEPOIS que ela existe (chave estrangeira).
        let superseded: string[] = []
        if (current) {
          superseded = (await client.query<{ id: string }>(
            `update call_assessments set is_current = false, superseded_at = $4, supersede_reason = 'REANALYZED'
             where interaction_id = $1 and coalesce(procedure_document_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid) and is_current and as_of <= $3
             returning id`,
            [snapshot.interactionId, procedureId, asOf, now],
          )).rows.map((row) => row.id)
          if (superseded.length > 0) await client.query(`update call_criterion_assessments set is_current = false, superseded_at = $2 where call_assessment_id = any($1::uuid[]) and is_current`, [superseded, now])
        }
        await client.query(
          `insert into call_assessments (id, organization_id, analysis_run_id, interaction_id, person_id, occurred_at, local_date, time_zone, subject_raw, subject_canonical, channel, team_id, subteam_id, supervisor_id, structure_basis, selection_reason, transcript_status, transcript_checksum, procedure_document_id, procedure_document_version, rule_perspective, scenario, path_assessment, coverage, outcome, limitations, as_of, is_current, created_at, argument_scripts, product_identification)
           values ($1,$2,$3,$4,$5,$6,($6::timestamptz at time zone $7)::date,$7,$8,$9,$10,$11,$12,$13,'CURRENT_AT_ANALYSIS',$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
          [assessmentId, organizationId, runId, snapshot.interactionId, snapshot.personId, snapshot.occurredAt, snapshot.timeZone, snapshot.subjectRaw, snapshot.subjectCanonical, snapshot.channel, snapshot.teamId, snapshot.subteamId, snapshot.supervisorId, snapshot.selectionReason, analysis.transcriptStatus, snapshot.transcriptChecksum, procedureId, procedureVersion?.version ?? null, procedureVersion?.perspective ?? null, JSON.stringify(analysis.scenario), analysis.scenario.pathAssessment, JSON.stringify(analysis.coverage), analysis.outcome, analysis.limitations, asOf, current, now, JSON.stringify((analysis.argumentScripts ?? []).map((script) => ({ scriptId: script.scriptId, name: script.name, version: script.version, applicability: script.applicability, declaredApplicability: script.declaredApplicability, situation: script.situation, evidence: script.evidence, rationale: script.rationale, downgrade: script.downgrade }))), analysis.productApplicability ? JSON.stringify(analysis.productApplicability) : null],
        )
        if (superseded.length > 0) await client.query(`update call_assessments set superseded_by = $2 where id = any($1::uuid[])`, [superseded, assessmentId])
        for (const criterion of analysis.criteria) {
          // Parte de regra composta: identidade derivada da linha-mãe + texto da parte (mesma família KC/AG da linha).
          const parent = criterion.obligation ? data.identities.get(criterion.obligation.parentLineKey) ?? { lineKey: criterion.obligation.parentLineKey, criterionKey: criterion.argument?.criterionKey ?? criterionKeyOf(criterion.obligation.parentLineKey), basis: "FIRST_SEEN" as const, previousCriterionKey: null } : null
          // Obrigação completa que junta várias linhas (`OBLIGATIONS_V1`): identidade própria, derivada das linhas que a formam.
          const identity = criterion.identityKey
            ? { lineKey: criterion.lineKey, criterionKey: criterion.identityKey, basis: "FIRST_SEEN" as const, previousCriterionKey: null }
            : parent && criterion.obligation
            ? { lineKey: criterion.lineKey, criterionKey: obligationCriterionKeyOf(parent.criterionKey, criterion.obligation.part), basis: parent.basis, previousCriterionKey: null }
            : data.identities.get(criterion.lineKey) ?? { lineKey: criterion.lineKey, criterionKey: criterion.argument?.criterionKey ?? criterionKeyOf(criterion.lineKey), basis: "FIRST_SEEN" as const, previousCriterionKey: null }
          const rowId = randomUUID()
          let rowCurrent = current
          let replacedRows: string[] = []
          if (current) {
            const blocking = (await client.query(`select 1 from call_criterion_assessments where interaction_id = $1 and criterion_key = $2 and is_current and as_of > $3 limit 1`, [snapshot.interactionId, identity.criterionKey, asOf])).rowCount
            if (blocking) rowCurrent = false
            else replacedRows = (await client.query<{ id: string }>(`update call_criterion_assessments set is_current = false, superseded_at = $3 where interaction_id = $1 and criterion_key = $2 and is_current returning id`, [snapshot.interactionId, identity.criterionKey, now])).rows.map((row) => row.id)
          }
          const version = data.documentVersions.get(criterion.documentId)?.version ?? procedureVersion?.version ?? 0
          const argument = criterion.argument ?? null
          await client.query(
            `insert into call_criterion_assessments (id, organization_id, call_assessment_id, analysis_run_id, interaction_id, person_id, occurred_at, local_date, subject_raw, subject_canonical, team_id, subteam_id, criterion_key, identity_basis, document_id, document_version, section_heading, criterion_text, on_path, status, evidence_kind, evidence, opportunity_turn, rationale, expected, guidance, why_it_matters, materiality, verification, rule_conflict, limitations, as_of, is_current, created_at,
                                                    source_kind, argument_script_id, argument_script_version, applicability, observability, execution_claim, parent_criterion_key, obligation, scope, occurrence_key, occurrence_basis)
             values ($1,$2,$3,$4,$5,$6,$7,($7::timestamptz at time zone $8)::date,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45)`,
            [rowId, organizationId, assessmentId, runId, snapshot.interactionId, snapshot.personId, snapshot.occurredAt, snapshot.timeZone, snapshot.subjectRaw, snapshot.subjectCanonical, snapshot.teamId, snapshot.subteamId, identity.criterionKey, identity.basis, argument ? null : criterion.documentId, argument ? argument.version : version, criterion.heading, criterion.text, criterion.onPath, criterion.status, criterion.evidenceKind, JSON.stringify(criterion.evidence), criterion.opportunityTurn, criterion.rationale, criterion.obligation?.lineText ?? criterion.text, criterion.guidance ? JSON.stringify(criterion.guidance) : null, criterion.whyItMatters, criterion.materiality, JSON.stringify(verificationRecordOf(criterion)), criterion.ruleConflict, criterion.downgrades, asOf, rowCurrent, now,
              argument ? "ARGUMENT_SCRIPT" : "KNOWLEDGE_DOCUMENT", argument?.scriptId ?? null, argument?.version ?? null, criterion.applicability ?? null, criterion.observability ?? null, criterion.executionClaim ?? null, parent?.criterionKey ?? null, criterion.obligation ? JSON.stringify(criterion.obligation) : null,
              argument ? JSON.stringify({ scriptScope: argument.scope, label: argument.scopeLabel, collaboratorTeamId: snapshot.teamId, collaboratorSubteamId: snapshot.subteamId }) : null,
              // Ocorrência de conduta (`CONDUCT_OCCURRENCE_V1`): só quando a revisão podia ligar regras; senão null = não determinável.
              criterion.occurrence?.key ?? null, criterion.occurrence?.basis ?? null],
          )
          if (replacedRows.length > 0) await client.query(`update call_criterion_assessments set superseded_by = $2 where id = any($1::uuid[])`, [replacedRows, rowId])
        }
        return { callAssessmentId: assessmentId, current }
      })
    },

    async completeIndicatorInvestigation(organizationId, runId, data, now) {
      return inTransaction(db, async (client) => {
        const investigation = data.investigation
        const official = investigation.official
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`indicator-memory:${runId}`])
        await completeRun(client, organizationId, runId, { outcome: investigation.conclusion === "INSUFFICIENT_DATA" ? "INSUFFICIENT_EVIDENCE" : investigation.conclusion === "CHANGE_LOCATED_NO_CAUSE" || investigation.conclusion === "CHANGE_LOCATED_NOT_EXAMINED" || investigation.conclusion === "MIX_EFFECT" ? "PARTIAL" : "USABLE", outcomeReasons: [investigation.conclusion], result: investigation, provenance: data.provenance, metrics: data.metrics }, now)
        // Interrompida pelo orçamento: fica no histórico (e serve à mensagem desta execução), mas a chave é liberada.
        if (data.reusable === false) await client.query(`update feedback_analysis_runs set analysis_key = analysis_key || ':INCOMPLETE:' || id::text where id = $1 and organization_id = $2`, [runId, organizationId])
        const run = (await client.query<{ as_of: Date; person_id: string }>(`select as_of, person_id from feedback_analysis_runs where id = $1`, [runId])).rows[0]!
        const asOf = new Date(run.as_of)
        const id = randomUUID()
        const scope = [run.person_id, official.indicatorId, official.sourceKind, official.periodStart, official.periodEnd]
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`indicator-investigation:${scope.join("|")}`])
        const newer = (await client.query(`select 1 from indicator_investigations where person_id = $1 and indicator_definition_id = $2 and source_kind = $3 and period_start = $4 and period_end = $5 and is_current and as_of > $6 limit 1`, [...scope, asOf])).rowCount
        const current = !newer
        const replaced = current ? (await client.query<{ id: string }>(`update indicator_investigations set is_current = false, superseded_at = $6 where person_id = $1 and indicator_definition_id = $2 and source_kind = $3 and period_start = $4 and period_end = $5 and is_current returning id`, [...scope, now])).rows.map((row) => row.id) : []
        await client.query(
          `insert into indicator_investigations (id, organization_id, analysis_run_id, person_id, indicator_definition_id, indicator_code, source_kind, source_ref, period_start, period_end, reference_period, team_id, subteam_id, official, localization, evidence, reference_group, questions, conclusion, limitations, as_of, is_current, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
          [id, organizationId, runId, run.person_id, official.indicatorId, official.code, official.sourceKind, official.sourceRef, official.periodStart, official.periodEnd, official.referencePeriod, investigation.teamId, investigation.subteamId, JSON.stringify(official), JSON.stringify(investigation.localization), JSON.stringify(investigation.evidence), JSON.stringify(investigation.reference), JSON.stringify(investigation.questions), investigation.conclusion, investigation.limitations, asOf, current, now],
        )
        if (replaced.length > 0) await client.query(`update indicator_investigations set superseded_by = $2 where id = any($1::uuid[])`, [replaced, id])
        return { investigationId: id, current }
      })
    },

    async completeInsufficient(organizationId, runId, outcome, now) {
      await completeRun(db, organizationId, runId, { outcome: "INSUFFICIENT_EVIDENCE", outcomeReasons: outcome.outcomeReasons, result: outcome.result, provenance: outcome.provenance, metrics: outcome.metrics }, now)
    },

    async failAnalysis(organizationId, runId, error, now) {
      await db.query(`update feedback_analysis_runs set status = 'FAILED', error = $3, completed_at = $4, claimed_until = null where id = $1 and organization_id = $2 and status = 'RUNNING'`, [runId, organizationId, error, now])
    },

    async suspendCallAnalysis(organizationId, runId, data, now) {
      await db.query(
        `update feedback_analysis_runs set status = 'FAILED', error = $3, result = $4, provenance = $5, metrics = $6, completed_at = $7, claimed_until = null
         where id = $1 and organization_id = $2 and status = 'RUNNING'`,
        [runId, organizationId, data.error.slice(0, 2_000), JSON.stringify({ checkpoint: data.checkpoint }), JSON.stringify(data.provenance), JSON.stringify(data.metrics), now],
      )
    },

    async findStageResponses(organizationId, query): Promise<StageResponses[]> {
      const rows = (await db.query<{ id: string; status: StageResponses["status"]; provenance: unknown; at: Date }>(
        `select id, status, provenance, coalesce(completed_at, started_at) at from feedback_analysis_runs
         where organization_id = $1 and kind = 'CALL_ANALYSIS' and interaction_id = $2 and provenance ? 'modelResponses'
           and (provenance->>'proposalKey' = $3 or analysis_key = any($4::text[]))
         order by coalesce(completed_at, started_at) desc limit 10`,
        [organizationId, query.interactionId, query.proposalKey, [...query.legacyAnalysisKeys]],
      )).rows
      return rows.map((row) => ({ runId: row.id, status: row.status, ...stageResponsesOf(row.provenance), at: new Date(row.at) })).filter((entry) => entry.analysis || entry.review)
    },

    async pendingReviewInteractions(organizationId, interactionIds) {
      if (interactionIds.length === 0) return new Set()
      const rows = (await db.query<{ interaction_id: string }>(
        `select distinct r.interaction_id from feedback_analysis_runs r
         where r.organization_id = $1 and r.kind = 'CALL_ANALYSIS' and r.interaction_id = any($2::uuid[]) and r.status = 'FAILED' and r.result ? 'checkpoint'
           and not exists (select 1 from call_assessments a where a.interaction_id = r.interaction_id and a.is_current and a.as_of >= r.as_of and ${reviewSettledSql("a")})
         union
         select distinct a.interaction_id from call_assessments a
         where a.organization_id = $1 and a.interaction_id = any($2::uuid[]) and a.is_current and not ${reviewSettledSql("a")}`,
        [organizationId, [...interactionIds]],
      )).rows
      return new Set(rows.map((row) => row.interaction_id))
    },

    async getRun(organizationId, runId) {
      const row = (await db.query<RunRow>(`select * from feedback_analysis_runs where id = $1 and organization_id = $2`, [runId, organizationId])).rows[0]
      return row ? toRun(row) : null
    },

    async getCallAssessmentByRun(organizationId, runId): Promise<StoredCallAssessment | null> {
      const row = (await db.query<{ id: string; is_current: boolean; interaction_id: string; person_id: string; occurred_at: Date; time_zone: string; subject_raw: string | null; subject_canonical: string | null; channel: string | null; team_id: string | null; subteam_id: string | null; supervisor_id: string | null; transcript_checksum: string | null; selection_reason: string; result: VerifiedCallAnalysis }>(
        `select a.id, a.is_current, a.interaction_id, a.person_id, a.occurred_at, a.time_zone, a.subject_raw, a.subject_canonical, a.channel, a.team_id, a.subteam_id, a.supervisor_id, a.transcript_checksum, a.selection_reason, r.result
         from call_assessments a join feedback_analysis_runs r on r.id = a.analysis_run_id
         where a.analysis_run_id = $1 and a.organization_id = $2 order by a.created_at desc limit 1`,
        [runId, organizationId],
      )).rows[0]
      if (!row) return null
      const keys = (await db.query<{ line_key: string | null; criterion_key: string }>(`select verification->>'lineKey' line_key, criterion_key from call_criterion_assessments where call_assessment_id = $1`, [row.id])).rows
      const analysis = row.result
      const criterionKeys: Record<string, string> = {}
      for (const entry of keys) if (entry.line_key) criterionKeys[entry.line_key] = entry.criterion_key
      const snapshot: CallSnapshot = { interactionId: row.interaction_id, personId: row.person_id, occurredAt: new Date(row.occurred_at), timeZone: row.time_zone, subjectRaw: row.subject_raw, subjectCanonical: row.subject_canonical, channel: row.channel, teamId: row.team_id, subteamId: row.subteam_id, supervisorId: row.supervisor_id, transcriptChecksum: row.transcript_checksum, selectionReason: row.selection_reason }
      return { id: row.id, analysisRunId: runId, isCurrent: row.is_current, snapshot, analysis, criterionKeys }
    },

    async getIndicatorInvestigationByRun(organizationId, runId) {
      const row = (await db.query<{ id: string; result: IndicatorInvestigation }>(
        `select i.id, r.result from indicator_investigations i join feedback_analysis_runs r on r.id = i.analysis_run_id where i.analysis_run_id = $1 and i.organization_id = $2 order by i.created_at desc limit 1`,
        [runId, organizationId],
      )).rows[0]
      return row ? { id: row.id, investigation: row.result } : null
    },

    async resolveCriteria(organizationId, document, previous) {
      const existing = await loadPersisted(db, organizationId, document.documentId, document.version)
      if (!existing || existing.length < document.lines.length) {
        // Versão anterior: a persistida mais recente; sem nenhuma, a publicada anterior (extraída agora, como primeira vista).
        const prior = (await db.query<{ version: number | null }>(`select max(document_version) version from knowledge_criteria where organization_id = $1 and document_id = $2 and document_version < $3 and extraction_version = $4`, [organizationId, document.documentId, document.version, CRITERIA_EXTRACTION_VERSION])).rows[0]?.version ?? null
        let priorCriteria = prior !== null ? await loadPersisted(db, organizationId, document.documentId, prior) : null
        let reconciledWith = prior
        if (!priorCriteria) {
          const loaded = await previous()
          if (loaded) {
            const firstSeen = reconcileCriteria(loaded.lines, null)
            await persistCriteria(organizationId, document.documentId, loaded.version, loaded.lines, firstSeen, null)
            priorCriteria = await loadPersisted(db, organizationId, document.documentId, loaded.version)
            reconciledWith = loaded.version
          }
        }
        const identities = reconcileCriteria(document.lines, priorCriteria)
        await persistCriteria(organizationId, document.documentId, document.version, document.lines, identities, reconciledWith)
      }
      const rows = (await db.query<{ line_key: string; criterion_key: string; identity_basis: CriterionIdentity["basis"]; previous_criterion_key: string | null }>(
        `select line_key, criterion_key, identity_basis, previous_criterion_key from knowledge_criteria where organization_id = $1 and document_id = $2 and document_version = $3 and extraction_version = $4`,
        [organizationId, document.documentId, document.version, CRITERIA_EXTRACTION_VERSION],
      )).rows
      return new Map(rows.map((row) => [row.line_key, { lineKey: row.line_key, criterionKey: row.criterion_key, basis: row.identity_basis, previousCriterionKey: row.previous_criterion_key }]))
    },

    loadCriteria: (organizationId, documentId, version) => loadPersisted(db, organizationId, documentId, version),

    async criterionHistory(organizationId, personId, criterionKeys, input) {
      if (criterionKeys.length === 0) return []
      const rows = (await db.query<{ criterion_key: string; assessed: string; met: string; not_met: string; partial: string; inconclusive: string; last_dates: string[] }>(
        `select criterion_key,
                count(*) filter (where effective_status in ('MET','NOT_MET','PARTIAL')) assessed,
                count(*) filter (where effective_status = 'MET') met,
                count(*) filter (where effective_status = 'NOT_MET') not_met,
                count(*) filter (where effective_status = 'PARTIAL') partial,
                count(*) filter (where effective_status in ('NOT_OBSERVABLE','NOT_ASSESSED')) inconclusive,
                (array_agg(local_date::text order by local_date desc))[1:5] last_dates
         from (select c.*, ${effectiveCriterionStatusSql("c")} effective_status from call_criterion_assessments c where ${reviewSettledSql("c")}) h
         where organization_id = $1 and person_id = $2 and criterion_key = any($3::text[]) and is_current and not rule_conflict
           and ($4::uuid is null or interaction_id <> $4::uuid) and occurred_at >= $5 and occurred_at < $6
         group by criterion_key`,
        [organizationId, personId, [...criterionKeys], input.excludeInteractionId, input.since, input.until],
      )).rows
      return rows.map((row) => ({ criterionKey: row.criterion_key, assessed: Number(row.assessed), met: Number(row.met), notMet: Number(row.not_met), partial: Number(row.partial), inconclusive: Number(row.inconclusive), lastDates: row.last_dates ?? [] }))
    },

    async deliveredFindings(organizationId, personId, findingKeys) {
      if (findingKeys.length === 0) return []
      const rows = (await db.query<{ finding_key: string; id: string; delivered_at: Date | null }>(
        `select k.finding_key, m.id, m.delivered_at from feedback_engine_messages m cross join lateral unnest(m.finding_keys) k(finding_key)
         where m.organization_id = $1 and m.person_id = $2 and m.status = 'PUBLISHABLE' and m.delivered_at is not null and m.finding_keys && $3::text[] and k.finding_key = any($3::text[])
           and not ${engineMessageHiddenSql("m")}`,
        [organizationId, personId, [...findingKeys]],
      )).rows
      return rows.map((row) => ({ findingKey: row.finding_key, messageId: row.id, deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null }))
    },

    deliveredMonitoringOf: (organizationId, interactionId, options) => deliveredMonitoringOfSql(db, organizationId, interactionId, options?.excludeMessageId ?? null),
    deliveredIndicatorPeriods: (organizationId, personId, options) => deliveredIndicatorPeriodsSql(db, organizationId, personId, options?.excludeMessageId ?? null),

    async deliveredPractices(organizationId, personId, practiceKeys, before) {
      if (practiceKeys.length === 0) return []
      const rows = (await db.query<{ practice_key: string; delivered_at: Date }>(
        // Mensagens anteriores às práticas guardam a chave da LINHA-âncora (KC-<chave de linha>): a prática dessa linha, quando já
        // organizada, é a que vale — a orientação entregue continua contando depois que a base foi organizada.
        `select coalesce(pm.practice_key, k.practice_key) practice_key, max(m.delivered_at) delivered_at
           from feedback_engine_messages m
           cross join lateral jsonb_array_elements(case when jsonb_typeof(m.brief -> 'developments') = 'array' then m.brief -> 'developments' else '[]'::jsonb end) d
           cross join lateral jsonb_array_elements_text(case when jsonb_typeof(d -> 'practiceKeys') = 'array' then d -> 'practiceKeys' else '[]'::jsonb end) k(practice_key)
           left join knowledge_practice_members pm on pm.organization_id = m.organization_id and pm.practice_key is not null and 'KC-' || pm.line_key = k.practice_key
          where m.organization_id = $1 and m.person_id = $2 and m.status = 'PUBLISHABLE' and m.delivered_at is not null and m.delivered_at < $4
            and not ${engineMessageHiddenSql("m")}
            and (d ->> 'findingKey') = any(m.finding_keys) and coalesce(pm.practice_key, k.practice_key) = any($3::text[])
          group by 1`,
        [organizationId, personId, [...practiceKeys], before],
      )).rows
      return rows.map((row) => ({ practiceKey: row.practice_key, deliveredAt: new Date(row.delivered_at) }))
    },

    async currentMemory(organizationId, query) {
      const assessments = (await db.query<{ id: string; analysis_run_id: string; interaction_id: string; person_id: string; occurred_at: Date; as_of: Date; path_assessment: string | null; outcome: string; logic_version: string | null; segment_key: string | null; product_identification: ProductApplicabilityRecord | null; rule_perspective: string | null }>(
        `select a.id, a.analysis_run_id, a.interaction_id, a.person_id, a.occurred_at, a.as_of, a.path_assessment, a.outcome, r.logic_version, ${segmentKeySql("i")} segment_key, a.rule_perspective, a.product_identification
         from call_assessments a join feedback_analysis_runs r on r.id = a.analysis_run_id join interactions i on i.id = a.interaction_id
         where a.organization_id = $1 and a.is_current
           and (cardinality($2::uuid[]) = 0 or a.person_id = any($2::uuid[]))
           and ($3::timestamptz is null or a.occurred_at >= $3) and ($4::timestamptz is null or a.occurred_at < $4)
           and ($5::uuid[] is null or a.interaction_id = any($5::uuid[]))`,
        [organizationId, [...query.personIds], query.window?.start ?? null, query.window?.end ?? null, query.interactionIds ? [...query.interactionIds] : null],
      )).rows
      if (assessments.length === 0) return { assessments: [], criteria: [] }
      const segmentOf = new Map(assessments.map((row) => [row.id, row.segment_key]))
      // `PRACTICE_IDENTITY_V1`: a PRÁTICA da linha-âncora da obrigação (antes do '#' da chave de linha), decidida pela leitura do modelo;
      // sem decisão ainda, a identidade da linha da base (`PRACTICE_ANCHOR_V1`) — como antes.
      const criteria = (await db.query<{ call_assessment_id: string; interaction_id: string; person_id: string; criterion_key: string; anchor_key: string | null; anchor_line_key: string | null; source_line_keys: string[] | null; obligation_line_key: string | null; practice_key: string | null; practice_title: string | null; document_id: string; title: string; source_kind: string; section_heading: string | null; criterion_text: string; status: MemoryRow["status"]; local_date: string; evidence: MemoryRow["evidence"]; rationale: string | null; guidance: MemoryRow["guidance"]; materiality: MemoryRow["materiality"]; product_applicability: { request: string | null; scope: string[] | "ALL" | "UNKNOWN" } | null; argument_item: (MemoryArgument & { itemKey?: string }) | null }>(
        `select c.call_assessment_id, c.interaction_id, c.person_id, c.criterion_key, c.verification->'productApplicability' product_applicability, c.verification->'argumentItem' argument_item, kc.criterion_key anchor_key, split_part(c.verification->>'lineKey', '#', 1) anchor_line_key, c.verification->'sourceLineKeys' source_line_keys, case when c.verification->>'lineKey' like '%#%' then c.verification->>'lineKey' end obligation_line_key, pm.practice_key, kp.title practice_title, coalesce(c.document_id, c.argument_script_id) document_id, coalesce(d.title, 'Argumentário: ' || s.name) title, c.source_kind, c.section_heading, c.criterion_text, ${effectiveCriterionStatusSql("c")} status, c.local_date::text local_date, c.evidence, c.rationale, c.guidance, c.materiality
         from call_criterion_assessments c left join knowledge_documents d on d.id = c.document_id left join argument_scripts s on s.id = c.argument_script_id
         left join knowledge_criteria kc on kc.organization_id = c.organization_id and kc.document_id = c.document_id and kc.document_version = c.document_version and kc.line_key = split_part(c.verification->>'lineKey', '#', 1)
         left join lateral (${practiceOfRowSql("c")}) pm on true
         left join knowledge_practices kp on kp.organization_id = c.organization_id and kp.practice_key = pm.practice_key
         where c.organization_id = $1 and c.call_assessment_id = any($2::uuid[]) and c.is_current and not c.rule_conflict`,
        [organizationId, assessments.map((row) => row.id)],
      )).rows
      // `PRODUCT_IN_FEEDBACK_V1`: de que documento é cada linha-fonte (uma consulta para todas), para o "Vale para" de cada regra.
      const sourceKeys = [...new Set(criteria.flatMap((row) => (Array.isArray(row.source_line_keys) ? row.source_line_keys : [])))]
      const documentsOfLine = new Map<string, string[]>()
      if (sourceKeys.length > 0) {
        for (const entry of (await db.query<{ line_key: string; document_id: string }>(`select distinct line_key, document_id from knowledge_criteria where organization_id = $1 and line_key = any($2::text[])`, [organizationId, sourceKeys])).rows) documentsOfLine.set(entry.line_key, [...(documentsOfLine.get(entry.line_key) ?? []), entry.document_id])
      }
      const sourceDocumentsOf = (keys: string[] | null) => [...new Set((Array.isArray(keys) ? keys : []).flatMap((key) => documentsOfLine.get(key) ?? []))]
      return {
        assessments: assessments.map((row) => ({ productRecord: row.product_identification, callAssessmentId: row.id, analysisRunId: row.analysis_run_id, interactionId: row.interaction_id, personId: row.person_id, occurredAt: new Date(row.occurred_at), asOf: new Date(row.as_of), segmentKey: row.segment_key, pathAssessment: row.path_assessment, outcome: row.outcome, logicVersion: row.logic_version, rulePerspective: row.rule_perspective })),
        criteria: criteria.map((row): MemoryCriterionRow => ({ callAssessmentId: row.call_assessment_id, segmentKey: segmentOf.get(row.call_assessment_id) ?? null, interactionId: row.interaction_id, personId: row.person_id, criterionKey: row.criterion_key, ...(row.anchor_line_key ? { anchorLineKey: row.anchor_line_key } : {}), ...(Array.isArray(row.source_line_keys) && row.source_line_keys.length > 0 ? { sourceLineKeys: row.source_line_keys, sourceDocumentIds: sourceDocumentsOf(row.source_line_keys) } : {}), ...(row.obligation_line_key ? { obligationLineKey: row.obligation_line_key } : {}), ...(row.practice_key ? { practiceKey: row.practice_key, ...(row.practice_title ? { practiceTitle: row.practice_title } : {}) } : row.anchor_key ? { practiceKey: row.anchor_key } : {}), documentId: row.document_id, documentTitle: row.title, heading: row.section_heading, text: row.criterion_text, status: row.status, localDate: row.local_date, evidence: row.evidence ?? [], rationale: row.rationale, guidance: row.guidance, materiality: row.materiality, ...(row.source_kind === "ARGUMENT_SCRIPT" ? { sourceKind: "ARGUMENT_SCRIPT" as const } : {}), productApplicability: row.product_applicability, argumentItem: row.argument_item ? { scriptId: row.argument_item.scriptId, version: row.argument_item.version ?? null, field: row.argument_item.field ?? null, modality: row.argument_item.modality ?? null } : null })),
      }
    },

    async practiceMemberships(organizationId, lineKeys) {
      if (lineKeys.length === 0) return new Map()
      const rows = (await db.query<{ line_key: string; practice_key: string | null; title: string | null }>(
        `select m.line_key, m.practice_key, p.title from knowledge_practice_members m left join knowledge_practices p on p.organization_id = m.organization_id and p.practice_key = m.practice_key
          where m.organization_id = $1 and m.line_key = any($2::text[])`,
        [organizationId, [...lineKeys]],
      )).rows
      return new Map(rows.map((row) => [row.line_key, { practiceKey: row.practice_key, title: row.title }]))
    },

    async practiceCatalog(organizationId) {
      const rows = (await db.query<{ practice_key: string; title: string; short_title: string | null; examples: { sourceTitle: string; heading: string | null; text: string }[] | null }>(
        `select p.practice_key, p.title, p.short_title,
                (select jsonb_agg(jsonb_build_object('sourceTitle', e.source_title, 'heading', e.section_heading, 'text', e.rule_text) order by e.assigned_at, e.line_key)
                   from (select m.source_title, m.section_heading, m.rule_text, m.assigned_at, m.line_key from knowledge_practice_members m
                          where m.organization_id = p.organization_id and m.practice_key = p.practice_key order by m.assigned_at, m.line_key limit 2) e) examples
           from knowledge_practices p where p.organization_id = $1 order by p.created_at, p.practice_key`,
        [organizationId],
      )).rows
      return rows.map((row) => ({ practiceKey: row.practice_key, title: row.title, examples: row.examples ?? [], shortTitle: row.short_title }))
    },

    async savePracticeAssignments(organizationId, result, provenance, now) {
      return inTransaction(db, async (client) => {
        for (const practice of result.practices) {
          await client.query(
            `insert into knowledge_practices (organization_id, practice_key, title, identity_version, model, created_at) values ($1,$2,$3,$4,$5,$6) on conflict (organization_id, practice_key) do nothing`,
            [organizationId, practice.practiceKey, practice.title, provenance.identityVersion, provenance.model, now],
          )
        }
        let members = 0
        for (const member of result.members) {
          const inserted = await client.query(
            `insert into knowledge_practice_members (organization_id, line_key, practice_key, basis, source_kind, source_id, source_version, source_title, section_heading, lead_in, rule_text, identity_version, model, assigned_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (organization_id, line_key) do nothing`,
            [organizationId, member.line.lineKey, member.practiceKey, member.basis, member.line.sourceKind, member.line.sourceId, member.line.sourceVersion, member.line.sourceTitle, member.line.heading, member.line.leadIn, member.line.text, provenance.identityVersion, provenance.model, now],
          )
          members += inserted.rowCount ?? 0
        }
        // Prática nova cujas linhas outra execução já organizou: não fica registrada vazia.
        const created = result.practices.map((practice) => practice.practiceKey)
        const orphans = created.length === 0 ? 0 : (await client.query(
          `delete from knowledge_practices p where p.organization_id = $1 and p.practice_key = any($2::text[])
             and not exists (select 1 from knowledge_practice_members m where m.organization_id = p.organization_id and m.practice_key = p.practice_key)`,
          [organizationId, created],
        )).rowCount ?? 0
        return { members, practices: created.length - orphans }
      })
    },

    async practicesWithoutTheme(organizationId, practiceKeys) {
      const rows = (await db.query<{ practice_key: string; title: string; examples: { sourceTitle: string; heading: string | null; text: string }[] | null }>(
        `select p.practice_key, p.title,
                (select jsonb_agg(jsonb_build_object('sourceTitle', e.source_title, 'heading', e.section_heading, 'text', e.rule_text) order by e.assigned_at, e.line_key)
                   from (select m.source_title, m.section_heading, m.rule_text, m.assigned_at, m.line_key from knowledge_practice_members m
                          where m.organization_id = p.organization_id and m.practice_key = p.practice_key order by m.assigned_at, m.line_key limit 2) e) examples
           from knowledge_practices p
          where p.organization_id = $1 and p.theme_key is null and ($2::text[] is null or p.practice_key = any($2::text[]))
          order by p.created_at, p.practice_key`,
        [organizationId, practiceKeys === null ? null : [...practiceKeys]],
      )).rows
      return rows.map((row) => ({ practiceKey: row.practice_key, title: row.title, examples: row.examples ?? [] }))
    },

    async practiceThemeCatalog(organizationId) {
      const rows = (await db.query<{ theme_key: string; title: string; points: string[] | null }>(
        `select t.theme_key, t.title,
                (select array_agg(e.short_title order by e.themed_at, e.practice_key)
                   from (select p.short_title, p.themed_at, p.practice_key from knowledge_practices p
                          where p.organization_id = t.organization_id and p.theme_key = t.theme_key order by p.themed_at, p.practice_key limit 8) e) points
           from knowledge_practice_themes t where t.organization_id = $1 order by t.created_at, t.theme_key`,
        [organizationId],
      )).rows
      return rows.map((row) => ({ themeKey: row.theme_key, title: row.title, points: row.points ?? [] }))
    },

    async savePracticeThemes(organizationId, result, provenance, now) {
      return inTransaction(db, async (client) => {
        for (const theme of result.themes) {
          await client.query(
            `insert into knowledge_practice_themes (organization_id, theme_key, title, theme_version, model, created_at) values ($1,$2,$3,$4,$5,$6) on conflict (organization_id, theme_key) do nothing`,
            [organizationId, theme.themeKey, theme.title, provenance.themeVersion, provenance.model, now],
          )
        }
        let practices = 0
        for (const assignment of result.assignments) {
          // Só prática ainda sem tema: outra execução que agrupou antes fica como estava.
          const updated = await client.query(
            `update knowledge_practices set short_title = $3, theme_key = $4, theme_version = $5, theme_model = $6, themed_at = $7
              where organization_id = $1 and practice_key = $2 and theme_key is null`,
            [organizationId, assignment.practiceKey, assignment.shortTitle, assignment.themeKey, provenance.themeVersion, provenance.model, now],
          )
          practices += updated.rowCount ?? 0
        }
        // Tema novo cujas práticas outra execução já agrupou: não fica registrado vazio.
        const created = result.themes.map((theme) => theme.themeKey)
        const orphans = created.length === 0 ? 0 : (await client.query(
          `delete from knowledge_practice_themes t where t.organization_id = $1 and t.theme_key = any($2::text[])
             and not exists (select 1 from knowledge_practices p where p.organization_id = t.organization_id and p.theme_key = t.theme_key)`,
          [organizationId, created],
        )).rowCount ?? 0
        return { practices, themes: created.length - orphans }
      })
    },

    async findCompletedByReuseKey(organizationId, kind, key) {
      const row = (await db.query<RunRow>(
        `select * from feedback_analysis_runs where organization_id = $1 and kind = $2 and status = 'COMPLETED' and (analysis_key = $3 or provenance -> 'reuseKeys' ? $3) order by completed_at desc limit 1`,
        [organizationId, kind, key],
      )).rows[0]
      return row ? toRun(row) : null
    },

    // ------------------------------------------------------------------ mensagens
    async claimMessage(identity, now, leaseSeconds) {
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000)
      const owned = await db.query<{ id: string }>(
        `insert into feedback_engine_messages as m (organization_id, message_key, enrollment_id, workflow_id, workflow_version_id, node_id, source_node_id, person_id, domain, status, claimed_until, attempts, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'RUNNING',$10,1,$11)
         on conflict (organization_id, message_key) do update set status = 'RUNNING', claimed_until = $10, attempts = m.attempts + 1, error = null
           where m.status = 'FAILED' or (m.status = 'RUNNING' and m.claimed_until < $11)
              -- abstenção gravada por uma revisão que NÃO aconteceu (falha técnica, versão anterior) não é decisão: refeita.
              or (m.status = 'ABSTAINED' and m.abstain_reason like '%${LEGACY_REVIEW_UNAVAILABLE}%')
         returning m.id`,
        [identity.organizationId, identity.messageKey, identity.enrollmentId, identity.workflowId, identity.workflowVersionId, identity.nodeId, identity.sourceNodeId, identity.personId, identity.domain, leaseUntil, now],
      )
      if (owned.rows[0]) return { kind: "CLAIMED" as const, messageId: owned.rows[0].id }
      const row = (await db.query<MessageRow>(`select * from feedback_engine_messages where organization_id = $1 and message_key = $2`, [identity.organizationId, identity.messageKey])).rows[0]!
      return row.status === "PUBLISHABLE" || row.status === "ABSTAINED" ? { kind: "COMPLETED" as const, record: toMessage(row) } : { kind: "IN_PROGRESS" as const }
    },

    async completeMessage(organizationId, messageId, data, now) {
      return inTransaction(db, async (client) => {
        const updated = (await client.query<MessageRow>(
          `update feedback_engine_messages set status = $3, analysis_run_ids = $4, abstain_reason = $5, finding_keys = $6, brief = $7, message = $8, composition = $9, suppressed = $10, metrics = $11, completed_at = $12, claimed_until = null, error = null
           where id = $1 and organization_id = $2 returning *`,
          [messageId, organizationId, data.status, data.analysisRunIds, data.abstainReason, data.findingKeys, data.brief ? JSON.stringify(data.brief) : null, data.message ? JSON.stringify(data.message) : null, data.composition ? JSON.stringify(data.composition) : null, JSON.stringify(data.suppressed), JSON.stringify(data.metrics), now],
        )).rows[0]!
        for (const material of data.materials) {
          await client.query(
            `insert into feedback_material_recommendations (organization_id, message_id, person_id, document_id, document_version, criterion_keys, reason, created_at)
             select $1,$2,$3,$4,$5,$6,$7,$8 where exists (select 1 from knowledge_documents where id = $4 and organization_id = $1)
             on conflict (message_id, document_id) do nothing`,
            [organizationId, messageId, updated.person_id, material.documentId, material.documentVersion, material.criterionKeys, material.reason, now],
          )
        }
        return toMessage(updated)
      })
    },

    async failMessage(organizationId, messageId, error, now) {
      await db.query(`update feedback_engine_messages set status = 'FAILED', error = $3, completed_at = $4, claimed_until = null where id = $1 and organization_id = $2 and status = 'RUNNING'`, [messageId, organizationId, error.slice(0, 2_000), now])
    },

    async getMessage(organizationId, messageId) {
      const row = (await db.query<MessageRow>(`select * from feedback_engine_messages where id = $1 and organization_id = $2`, [messageId, organizationId])).rows[0]
      return row ? toMessage(row) : null
    },

    async markDelivered(organizationId, messageId, at) {
      await db.query(`update feedback_engine_messages set delivered_at = coalesce(delivered_at, $3) where id = $1 and organization_id = $2`, [messageId, organizationId, at])
    },
  }
}

type MessageRow = { id: string; organization_id: string; message_key: string; enrollment_id: string | null; workflow_id: string | null; workflow_version_id: string | null; node_id: string | null; source_node_id: string | null; person_id: string; domain: MessageRecord["domain"]; status: MessageRecord["status"]; analysis_run_ids: string[]; abstain_reason: string | null; finding_keys: string[]; brief: MessageRecord["brief"]; message: MessageRecord["message"]; composition: MessageRecord["composition"]; suppressed: unknown[]; metrics: Record<string, unknown>; completed_at: Date | null }
const toMessage = (row: MessageRow): MessageRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  messageKey: row.message_key,
  enrollmentId: row.enrollment_id,
  workflowId: row.workflow_id,
  workflowVersionId: row.workflow_version_id,
  nodeId: row.node_id,
  sourceNodeId: row.source_node_id,
  personId: row.person_id,
  domain: row.domain,
  status: row.status,
  analysisRunIds: row.analysis_run_ids ?? [],
  abstainReason: row.abstain_reason,
  findingKeys: row.finding_keys ?? [],
  brief: row.brief,
  message: row.message,
  composition: row.composition,
  suppressed: row.suppressed ?? [],
  metrics: row.metrics ?? {},
  completedAt: row.completed_at ? new Date(row.completed_at) : null,
})
