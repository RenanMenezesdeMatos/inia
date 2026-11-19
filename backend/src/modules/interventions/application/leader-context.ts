import type { Database } from "../../../infrastructure/database/pool.js"
import { visibleInFollowUpSql } from "../../feedbacks/application/follow-up-visibility.js"
import { loadIndicatorOperationalDefinition, resolveOperationalWindow } from "../../indicators/application/operational-measurement-resolver.js"
import { defaultMeasurementAggregation } from "../../indicators/domain/operational-aggregation.js"
import { businessDaysInWindow, localDateOf, startOfLocalDate } from "../../workflows/application/time-window.js"
import { addCivilDays, buildEvolution, evolutionPlan, EVOLUTION_MIN_DAYS_SINCE, type Evolution, type EvolutionReference, type EvolutionWindow } from "../domain/evolution.js"
import type { LeaderContext } from "../domain/intelligence-report.js"
import { BRIEF_HISTORY_DAYS, BRIEF_MAX_FEEDBACKS, type BriefFeedback } from "../domain/leader-brief.js"

/**
 * O que a INIA lê para o RESUMO DA LIDERANÇA de uma avaliação que decidiu algo: os feedbacks publicados ao colaborador no
 * período (o que já foi dito a ele) e a evolução do indicador desde o último deles. Só leitura; chamado por quem GRAVA a
 * avaliação (`applyEvaluation`) — a simulação do administrador não passa por aqui, então configurar política continua sem dar
 * acesso ao conteúdo dos feedbacks de ninguém.
 */
const DAY_MS = 86_400_000

/**
 * "Feedback sobre este indicador": o caso ou o feedback apontam o indicador pelo CÓDIGO ou pelo NOME do catálogo — os fluxos de
 * feedback gravam o nome em `impacted_indicator`/`indicator_code` (ex.: "Tempo Médio de Atendimento"), então comparar só com o
 * código nunca encontrava esses feedbacks. `codeParam` nulo = todos os feedbacks.
 */
export const feedbackAboutIndicatorSql = (feedbackAlias: string, caseAlias: string, codeParam: string) =>
  `(${codeParam}::text is null or ${caseAlias}.indicator_code = ${codeParam} or ${feedbackAlias}.impacted_indicator = ${codeParam}
    or exists (select 1 from indicator_definitions d where d.organization_id = ${feedbackAlias}.organization_id and d.code = ${codeParam}
                and lower(d.name) in (lower(${caseAlias}.indicator_code), lower(${feedbackAlias}.impacted_indicator))))`

/**
 * Feedback com citação CONFERIDA: síntese de IA sem citação conferida (achado AI-02) nunca é evidência verificável. O mesmo
 * predicado vale para a condição "Feedbacks publicados" e para o feedback de referência da condição "Evolução" (ARQ-04).
 */
export const feedbackVerifiedSql = (feedbackAlias: string) => `coalesce(${feedbackAlias}.context_snapshot->>'evidenceVerified', 'true') <> 'false'`

export type LeaderContextInput = { organizationId: string; personId: string; indicatorCode: string | null; indicatorName: string | null; asOf: Date; timeZone: string }

export async function loadFeedbackHistory(db: Database, input: LeaderContextInput, days: number = BRIEF_HISTORY_DAYS): Promise<{ feedbacks: BriefFeedback[]; feedbackCount: number }> {
  const since = new Date(input.asOf.getTime() - days * DAY_MS)
  const rows = await db.query<{ id: string; kind: string | null; title: string | null; published_at: Date; acknowledged_at: Date | null; recommendation: string; total: string }>(
    `select f.id, f.feedback_kind::text kind,
            coalesce(f.context_snapshot#>>'{feedbackEngine,feedbackView,heading,title}', f.context_snapshot#>>'{reliableFeedback,feedbackView,heading,title}', f.impacted_indicator) title,
            f.published_at, f.acknowledged_at,
            -- O resumo curto que o próprio feedback publica (o "card" do Acompanhamento) diz o que foi recomendado; feedback anterior a ele: o texto publicado.
            coalesce(nullif(btrim(f.context_snapshot#>>'{feedbackEngine,feedbackView,card}'), ''), nullif(btrim(f.context_snapshot#>>'{reliableFeedback,feedbackView,card}'), ''), f.recommendation) recommendation,
            count(*) over () total
       from feedbacks f join supervision_cases c on c.id = f.case_id and c.organization_id = f.organization_id
      where f.organization_id = $1 and f.operator_id = $2 and f.status in ('PUBLISHED', 'ACKNOWLEDGED')
        and f.published_at >= $3 and f.published_at <= $4 and ${feedbackAboutIndicatorSql("f", "c", "$5")} and ${visibleInFollowUpSql("f")}
      order by f.published_at desc, f.id desc limit $6`,
    [input.organizationId, input.personId, since, input.asOf, input.indicatorCode, BRIEF_MAX_FEEDBACKS],
  )
  return {
    feedbackCount: Number(rows.rows[0]?.total ?? 0),
    feedbacks: rows.rows.map((row) => ({ id: row.id, kind: row.kind === "INDICATOR" || row.kind === "MONITORING" ? row.kind : null, title: row.title, publishedAt: row.published_at.toISOString(), acknowledgedAt: row.acknowledged_at?.toISOString() ?? null, recommendation: row.recommendation ?? "" })),
  }
}

export type EvolutionReferenceOptions = { days?: number; verifiedOnly?: boolean }

/**
 * O MARCO da evolução, por consulta própria (QA-01): o feedback mais recente sobre o indicador com idade suficiente para
 * comparar; se todos forem recentes demais, o mais recente (e o resultado diz que ainda é cedo). Não depende da lista do
 * resumo, que é cortada em `BRIEF_MAX_FEEDBACKS` — com vários feedbacks na semana o marco antigo ficava fora dela.
 * `verifiedOnly`: só feedback com citação conferida (quando o marco vira evidência da regra).
 */
export async function loadEvolutionReference(db: Database, input: LeaderContextInput, options: EvolutionReferenceOptions = {}): Promise<{ id: string; publishedAt: string } | null> {
  const since = new Date(input.asOf.getTime() - (options.days ?? BRIEF_HISTORY_DAYS) * DAY_MS)
  const oldEnough = new Date(input.asOf.getTime() - EVOLUTION_MIN_DAYS_SINCE * DAY_MS)
  const row = (await db.query<{ id: string; published_at: Date }>(
    `select f.id, f.published_at
       from feedbacks f join supervision_cases c on c.id = f.case_id and c.organization_id = f.organization_id
      where f.organization_id = $1 and f.operator_id = $2 and f.status in ('PUBLISHED', 'ACKNOWLEDGED')
        and f.published_at >= $3 and f.published_at <= $4 and ${feedbackAboutIndicatorSql("f", "c", "$5")} and ${visibleInFollowUpSql("f")}
        ${options.verifiedOnly ? `and ${feedbackVerifiedSql("f")}` : ""}
      order by (f.published_at <= $6) desc, f.published_at desc, f.id desc limit 1`,
    [input.organizationId, input.personId, since, input.asOf, input.indicatorCode, oldEnough],
  )).rows[0]
  return row ? { id: row.id, publishedAt: row.published_at.toISOString() } : null
}

/** Evolução do indicador desde o feedback de referência (`loadEvolutionReference`). Sem indicador ou sem feedback não há marco: null. */
export async function loadEvolution(db: Database, input: LeaderContextInput, options: EvolutionReferenceOptions = {}): Promise<Evolution | null> {
  const reference = await loadEvolutionReference(db, input, options)
  if (!reference) return null
  return measureEvolution(db, input, { kind: "FEEDBACK", ref: reference.id, label: "o feedback", at: reference.publishedAt })
}

/**
 * A medição em si: o indicador do colaborador ANTES × DEPOIS de um marco (o feedback de referência, ou o início de um
 * acompanhamento nos checkpoints e no fechamento). Sem indicador ou indicador fora do catálogo não há o que medir: null.
 */
export async function measureEvolution(db: Database, input: LeaderContextInput, reference: EvolutionReference): Promise<Evolution | null> {
  if (!input.indicatorCode) return null
  const definition = await loadIndicatorOperationalDefinition(db, input.organizationId, input.indicatorCode)
  if (!definition) return null
  // Dias civis no fuso da organização: a medição é diária e o dia do marco fica fora das duas janelas (ver `evolutionPlan`).
  const referenceDay = localDateOf(new Date(reference.at), input.timeZone)
  const asOfDay = localDateOf(input.asOf, input.timeZone)
  const base = { indicatorCode: definition.code, indicatorName: input.indicatorName ?? definition.code, unit: definition.unit, direction: definition.direction, dailySupported: definition.dailySupported, reference, referenceDay, asOfDay }
  const plan = evolutionPlan(referenceDay, asOfDay)
  if (!definition.dailySupported || !plan.before || !plan.after) return buildEvolution(base)
  const windows = {
    before: { start: startOfLocalDate(plan.before.startDay, input.timeZone), end: startOfLocalDate(plan.before.endDayExclusive, input.timeZone) },
    // Termina no instante da avaliação (o dia de hoje entra parcial), nunca depois dele.
    after: { start: startOfLocalDate(plan.after.startDay, input.timeZone), end: new Date(Math.min(input.asOf.getTime(), startOfLocalDate(addCivilDays(plan.after.endDay, 1), input.timeZone).getTime())) },
  }
  const measure = async (window: { start: Date; end: Date }): Promise<EvolutionWindow> => {
    const result = await resolveOperationalWindow(
      db,
      { indicatorCode: definition.code, subjectIds: [input.personId], window, aggregation: defaultMeasurementAggregation(definition.kind), expectedDays: businessDaysInWindow(window, input.timeZone), timeZone: input.timeZone, now: input.asOf },
      { kind: definition.kind, unjustifiedAbsencePolicy: definition.unjustifiedAbsencePolicy },
    )
    return { start: window.start.toISOString(), end: window.end.toISOString(), value: result.value, daysWithData: result.daysWithData, expectedDays: result.expectedDays }
  }
  return buildEvolution({ ...base, before: await measure(windows.before), after: await measure(windows.after) })
}

export async function loadLeaderContext(db: Database, input: LeaderContextInput): Promise<LeaderContext> {
  const history = await loadFeedbackHistory(db, input)
  // O texto dos feedbacks é histórico (nunca evidência): o resumo não exige citação conferida; a lista é que tem o teto de 5.
  return { ...history, evolution: history.feedbackCount > 0 ? await loadEvolution(db, input) : null }
}
