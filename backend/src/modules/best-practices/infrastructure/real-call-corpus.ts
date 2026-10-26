import { createHash } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { loadArgumentScriptsInForce } from "../../argument-scripts/infrastructure/argument-script-loaders.js"
import type { ArgumentScriptSource } from "../../argument-scripts/domain/argument-script.js"
import { selectDocumentsForCall, type CandidateDocument } from "../../feedback-engine/domain/document-selection.js"
import type { Quartile } from "../../indicators/domain/employee-performance-schema.js"
import { loadProductCatalogAt } from "../../product-catalog/infrastructure/product-catalog-loaders.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { transcriptForModel } from "../../workflows/application/transcript.js"
import type { ObligationSource, ObligationSourceSet } from "../domain/obligation-check.js"
import { argumentScriptSource, documentSource, practiceSource, withAppliesTo, type ScriptItem } from "../domain/obligation-sources.js"
import type { CallCorpus, CorpusCall, CorpusOperator } from "../application/ports.js"

/**
 * CORPUS REAL — interações da organização, sempre escopadas a ela e à população da análise: o Grupo ou, com `subteamId`
 * (`BEST_PRACTICE_ANALYSIS_V2`), só o Subgrupo — os melhores do subgrupo comparados com os demais do subgrupo, pelo MESMO quartil
 * oficial (nunca recalculado para o subgrupo). Leituras só; a transcrição sai mascarada (`transcriptForModel`) e o checksum é desse
 * texto. Fontes de obrigação: procedimentos da base que valem para a população (organização, Grupo e, no Subgrupo, também os do
 * Subgrupo), argumentários vigentes no fim do período e os pontos do processo já organizados pelo motor de feedback.
 */
export const OBLIGATION_DOCUMENT_BUDGET_CHARS = 60_000

export function createRealCallCorpus(db: Database, input: { organizationId: string; teamId: string; teamName: string; subteamId?: string | null; subteamName?: string | null }): CallCorpus {
  const { organizationId, teamId } = input
  const subteamId = input.subteamId ?? null
  return {
    origin: "REAL",
    populationLabel: subteamId ? `Subgrupo ${input.subteamName ?? ""} (Grupo ${input.teamName})` : `Grupo ${input.teamName}`,

    async operators(): Promise<CorpusOperator[]> {
      const rows = (await db.query<{ id: string; name: string }>(`select id, name from people where organization_id = $1 and team_id = $2 and ($3::uuid is null or subteam_id = $3) order by name, id`, [organizationId, teamId, subteamId])).rows
      return rows.map((row) => ({ ref: row.id, personId: row.id, name: row.name }))
    },

    async quartiles(indicatorDefinitionId, referencePeriods) {
      const rows = (await db.query<{ person_id: string; reference_period: string; quartile: Quartile | null }>(
        `select e.person_id, e.reference_period, e.quartile
           from employee_indicator_performance e join people p on p.id = e.person_id and p.organization_id = e.organization_id
          where e.organization_id = $1 and p.team_id = $2 and ($5::uuid is null or p.subteam_id = $5) and e.indicator_definition_id = $3 and e.reference_period = any($4::text[])`,
        [organizationId, teamId, indicatorDefinitionId, [...referencePeriods], subteamId],
      )).rows
      return rows.map((row) => ({ operatorRef: row.person_id, referencePeriod: row.reference_period, quartile: row.quartile }))
    },

    async calls(operatorRefs, window, channel): Promise<CorpusCall[]> {
      if (operatorRefs.length === 0) return []
      const timeZone = await resolveOrganizationTimezone(db, organizationId)
      const rows = (await db.query<{ id: string; operator_id: string; reason: string; sub_reason: string | null; channel: string | null; started_at: Date; seconds: string | null; has_transcript: boolean }>(
        `select i.id, i.operator_id, i.reason, i.sub_reason, i.channel, i.started_at,
                extract(epoch from (i.ended_at - i.started_at))::int seconds,
                exists (select 1 from transcripts t where t.interaction_id = i.id and length(btrim(t.content)) > 0) has_transcript
           from interactions i
          where i.organization_id = $1 and i.operator_id = any($2::uuid[])
            and i.started_at >= ($3::date at time zone $5) and i.started_at < ($4::date at time zone $5)
            and ($6::text is null or i.channel = $6)`,
        [organizationId, [...operatorRefs], window.start, window.endExclusive, timeZone, channel],
      )).rows
      return rows.map((row) => ({ ref: row.id, interactionId: row.id, personId: row.operator_id, operatorRef: row.operator_id, reason: row.reason, subReason: row.sub_reason?.trim() || null, channel: row.channel, occurredAt: new Date(row.started_at), durationSeconds: row.seconds === null ? null : Number(row.seconds), hasTranscript: row.has_transcript }))
    },

    async callSignals(callRefs, signal) {
      if (callRefs.length === 0) return new Map()
      const rows = (await db.query<{ interaction_id: string; value_boolean: boolean | null; value_numeric: string | null }>(
        `select distinct on (f.interaction_id) f.interaction_id, f.value_boolean, f.value_numeric
           from interaction_flags f join interactions i on i.id = f.interaction_id and i.organization_id = $1
          where f.channel_flag_id = $2 and f.interaction_id = any($3::uuid[]) order by f.interaction_id, f.received_at desc`,
        [organizationId, signal.id, [...callRefs]],
      )).rows
      return new Map(rows.map((row) => [row.interaction_id, { boolean: row.value_boolean, numeric: row.value_numeric === null ? null : Number(row.value_numeric) }]))
    },

    async transcripts(callRefs) {
      if (callRefs.length === 0) return new Map()
      const rows = (await db.query<{ interaction_id: string; content: string }>(
        `select distinct on (t.interaction_id) t.interaction_id, t.content
           from transcripts t join interactions i on i.id = t.interaction_id and i.organization_id = $1
          where t.interaction_id = any($2::uuid[]) order by t.interaction_id, t.version desc`,
        [organizationId, [...callRefs]],
      )).rows
      return new Map(rows.filter((row) => row.content.trim().length > 0).map((row) => {
        const content = transcriptForModel(row.content)
        return [row.interaction_id, { content, checksum: createHash("sha256").update(content).digest("hex").slice(0, 16) }] as const
      }))
    },

    async obligationSources({ cells, candidatesText, at }): Promise<ObligationSourceSet> {
      const documents = (await db.query<{ id: string; title: string; in_force_version: number | null; in_force_content: string | null; in_force_hash: string | null; latest_version: number | null; latest_content: string | null; latest_hash: string | null }>(
        `select d.id, d.title, f.version in_force_version, f.content in_force_content, f.content_hash in_force_hash, l.version latest_version, l.content latest_content, l.content_hash latest_hash
           from knowledge_documents d
           left join lateral (select version, content, content_hash from knowledge_versions where document_id = d.id and status = 'PUBLISHED' and coalesce(effective_from, created_at) <= $3 order by version desc limit 1) f on true
           left join lateral (select version, content, content_hash from knowledge_versions where document_id = d.id and status = 'PUBLISHED' order by version desc limit 1) l on true
          where d.organization_id = $1 and d.deleted_at is null and d.document_type in ('PROCEDURE', 'MANUAL')
            and (not exists (select 1 from knowledge_document_org_scopes s where s.knowledge_document_id = d.id)
                 or exists (select 1 from knowledge_document_org_scopes s where s.knowledge_document_id = d.id and (s.scope_type = 'ALL_TEAMS' or s.team_id = $2 or s.subteam_id = $4)))
          order by d.title, d.id`,
        [organizationId, teamId, at, subteamId],
      )).rows
      const candidates: CandidateDocument[] = documents.flatMap((row): CandidateDocument[] => {
        if (row.in_force_version !== null && row.in_force_content) return [{ documentId: row.id, title: row.title, version: row.in_force_version, content: row.in_force_content, contentHash: row.in_force_hash ?? "", perspective: "RULE_IN_FORCE_AT_CALL" }]
        if (row.latest_version !== null && row.latest_content) return [{ documentId: row.id, title: row.title, version: row.latest_version, content: row.latest_content, contentHash: row.latest_hash ?? "", perspective: "CURRENT_RULE_REEVALUATION" }]
        return []
      })
      const selection = selectDocumentsForCall(candidates, { subject: cells.map((cell) => [cell.reason, cell.subReason].filter(Boolean).join(" ")).join(" · "), transcript: candidatesText, budgetChars: OBLIGATION_DOCUMENT_BUDGET_CHARS })
      const sources: ObligationSource[] = selection.selected.map((document, index) => documentSource(`D${index + 1}`, { sourceId: document.documentId, title: document.title, version: document.version, content: document.content }))
      const scripts = await loadArgumentScriptsInForce(db, organizationId, { teamId, subteamId }, at)
      scripts.forEach((script, index) => sources.push(argumentScriptSource(`G${index + 1}`, { sourceId: script.scriptId, title: script.name, version: script.version, items: scriptItemsOf(script) })))
      const practices = (await db.query<{ practice_key: string; title: string; example: string | null }>(
        `select p.practice_key, coalesce(nullif(btrim(p.short_title), ''), p.title) title,
                (select m.rule_text from knowledge_practice_members m where m.organization_id = p.organization_id and m.practice_key = p.practice_key order by m.assigned_at limit 1) example
           from knowledge_practices p where p.organization_id = $1 order by p.created_at, p.practice_key limit 80`,
        [organizationId],
      )).rows
      // `BEST_PRACTICE_OBLIGATION_PROMPT_V2`: o "Vale para" de cada procedimento e argumentário, como o cadastro de abrangência estava no fim do período.
      const catalog = await loadProductCatalogAt(db, organizationId, at, sources.map((source) => source.sourceId))
      const nameOf = new Map((catalog?.nodes ?? []).map((node) => [node.id, node.name]))
      const scopeOf = (source: ObligationSource) => (catalog?.scopes ?? []).filter((scope) => scope.sourceId === source.sourceId && scope.sourceKind === (source.kind === "DOCUMENT" ? "KNOWLEDGE_DOCUMENT" : "ARGUMENT_SCRIPT")).flatMap((scope) => scope.nodeIds.flatMap((id) => (nameOf.has(id) ? [nameOf.get(id)!] : [])))
      const scoped = withAppliesTo(sources, scopeOf)
      const practiceLines = practiceSource(practices.map((row) => ({ practiceKey: row.practice_key, title: row.title, example: row.example })))
      if (practiceLines) scoped.push(practiceLines)
      return { sources: scoped.filter((source) => source.lines.length > 0), omitted: selection.omitted.map((item) => ({ kind: "DOCUMENT" as const, title: item.title, reason: "BUDGET" as const })) }
    },
  }
}

export function scriptItemsOf(script: Pick<ArgumentScriptSource, "content">): ScriptItem[] {
  const content = script.content
  const items: ScriptItem[] = []
  if (content.legacyExpectation?.trim()) items.push({ marker: "ORIENTAÇÃO", text: content.legacyExpectation.trim() })
  for (const item of content.operatorGuidance) items.push({ marker: item.modality === "MUST" ? "DEVE" : item.modality === "MAY" ? "PODE" : "ORIENTAÇÃO", text: item.text })
  const pointText = (item: { text: string; condition: string | null }) => (item.condition ? `${item.text} (quando: ${item.condition})` : item.text)
  for (const group of content.requiredPoints) {
    if (group.mode === "ANY") items.push({ marker: "PONTO OBRIGATÓRIO", text: `Pelo menos uma destas alternativas: ${group.items.map(pointText).join("; ")}` })
    else for (const item of group.items) items.push({ marker: "PONTO OBRIGATÓRIO", text: pointText(item) })
  }
  for (const item of content.avoid) items.push({ marker: "EVITAR", text: item.text })
  return items
}
