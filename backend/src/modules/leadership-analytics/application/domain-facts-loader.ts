import type { Database } from "../../../infrastructure/database/pool.js"
import { communicationLiveSql, segmentPersonSql } from "../../communications/infrastructure/postgres-communication-store.js"
import { visibleInFollowUpSql } from "../../feedbacks/application/follow-up-visibility.js"
import { listSupportAttendanceCounts, SUPPORT_END_CAUSE_LABELS } from "../../human-support/application/support-counts.js"
import { resolveWorkdaysBySubject } from "../../indicators/application/operational-measurement-resolver.js"
import { SCHEDULE_EXCEPTION_LABELS } from "../../people/domain/schedule-exception.js"
import { SCHEDULE_TYPE_LABELS } from "../../people/domain/work-schedule.js"
import { WORKDAY_CLASSIFICATION_LABELS } from "../../people/domain/workday-classification.js"
import { RESOLVED_WORKDAY_STATE_LABELS, type ResolvedWorkday } from "../../people/domain/workday-resolution.js"
import { RECONCILIATION_KIND_LABELS } from "../../people/application/workday-reconciliation-service.js"
import { startOfLocalDate } from "../../workflows/application/time-window.js"
import { MAX_DOMAIN_FACTS, type ChannelFlagSpec, type DomainFacts, type DomainFactsLoader } from "./data-domains.js"
import type { Fact } from "./fact-query.js"

/**
 * Carregamento dos registros dos domínios de dado da liderança. Sempre pela organização e pelos membros da estrutura já resolvidos no
 * backend (o escopo de quem pergunta); datas civis no fuso da organização. Uma consulta por pedido, com teto (`MAX_DOMAIN_FACTS`) e
 * ORDEM ESTÁVEL (data do registro + id): quando o teto corta, o corte é sempre o mesmo — os registros mais antigos do período.
 * Rótulos de escala, exceção, classificação e divergência vêm dos catálogos do módulo dono (nunca reescritos aqui).
 * O Apoio com Anjo é lido pela função do próprio módulo (`support-counts.ts`): só contagens e tempos.
 */

const CRITERION_STATUS: Record<string, string> = { MET: "Cumprido", PARTIAL: "Parcial", NOT_MET: "Não cumprido", NOT_APPLICABLE: "Não aplicável", NOT_OBSERVABLE: "Não observável", NOT_ASSESSED: "Não avaliado" }
const CASE_STATUS: Record<string, string> = { DETECTED: "Detectado", DIAGNOSING: "Em diagnóstico", DIAGNOSED: "Diagnosticado", ACTION_PENDING: "Ação pendente", FOLLOWING_UP: "Acompanhando", ESCALATED: "Escalado", RESOLVED: "Resolvido", CLOSED: "Encerrado" }
const CLOSED_CASES = new Set(["RESOLVED", "CLOSED"])
const FEEDBACK_KIND: Record<string, string> = { INDICATOR: "Indicador", MONITORING: "Monitoria", DELIVERY: "Atendimento" }
const EXCEPTION_LABEL: Record<string, string> = SCHEDULE_EXCEPTION_LABELS
const SCHEDULE_TYPE: Record<string, string> = SCHEDULE_TYPE_LABELS
const CLASSIFICATION_LABEL: Record<string, string> = WORKDAY_CLASSIFICATION_LABELS
const DIVERGENCE_LABEL: Record<string, string> = RECONCILIATION_KIND_LABELS
const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null)
const hoursBetween = (start: string | null, end: string | null) => {
  if (!start || !end) return null
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
  const diff = minutes(end) - minutes(start)
  return (diff < 0 ? diff + 1440 : diff) / 60
}

export type WorkdayResolver = (personIds: string[], window: { start: Date; end: Date }) => Promise<Map<string, readonly ResolvedWorkday[]>>

/**
 * O que o ESTADO RESOLVIDO do dia permite afirmar sobre "escalado × produziu". Só entram nas taxas os dias em que o resolvedor único
 * concluiu algo: trabalhou, pendência "sem produção · classificar" (fontes fechadas e confiáveis) e falta injustificada confirmada.
 * Férias, afastamento, antes da admissão, ausência justificada, feriado, dia em curso ou futuro, dado ainda não esperado e fonte
 * atrasada ficam FORA (`null`): dado ausente nunca é falta.
 */
export function workdayReading(day: Pick<ResolvedWorkday, "state" | "plannedToWork" | "plannedCause">): { situation: string; produced: 0 | 1 | null; missing: 0 | 1 | null; offDayProduction: 0 | 1 | null } {
  const label = RESOLVED_WORKDAY_STATE_LABELS[day.state]
  if (day.state === "WORKED_OBSERVED") {
    if (day.plannedToWork) return { situation: label, produced: 1, missing: 0, offDayProduction: null }
    // Escala desconhecida não é folga: a produção aparece, mas não conta como "trabalhou na folga".
    if (day.plannedCause === "UNKNOWN_SCHEDULE") return { situation: label, produced: null, missing: null, offDayProduction: null }
    return { situation: `${label} · dia planejado como não trabalhado`, produced: null, missing: null, offDayProduction: 1 }
  }
  if (day.state === "MISSING_EXPECTED_PRODUCTION" || day.state === "CLASSIFIED_UNJUSTIFIED_ABSENCE") return { situation: label, produced: 0, missing: 1, offDayProduction: null }
  if (day.state === "PLANNED_NON_WORKING") return { situation: label, produced: null, missing: null, offDayProduction: 0 }
  return { situation: label, produced: null, missing: null, offDayProduction: null }
}

const limited = <T>(rows: T[]) => ({ rows: rows.slice(0, MAX_DOMAIN_FACTS), truncated: rows.length > MAX_DOMAIN_FACTS })

/** `now`: instante da pergunta (o resolvedor do dia separa dia em curso, dado ainda não esperado e dado atrasado). `resolveWorkdays`: só para teste. */
export type DomainFactsLoaderOptions = { now?: Date; resolveWorkdays?: WorkdayResolver }

export function createDomainFactsLoader(db: Database, organizationId: string, timeZone: string, options: DomainFactsLoaderOptions = {}): DomainFactsLoader {
  const resolveWorkdays: WorkdayResolver = options.resolveWorkdays ?? (async (personIds, window) => new Map([...(await resolveWorkdaysBySubject(db, personIds, window, timeZone, { now: options.now ?? new Date() }))].map(([id, subject]) => [id, subject.days])))
  return async (domain, personIds, fromDate, toDateExclusive): Promise<DomainFacts> => {
    if (personIds.length === 0) return { facts: [], truncated: false }
    const window = [organizationId, personIds, fromDate, toDateExclusive, timeZone]
    if (domain === "INTERACTIONS") {
      const flagRows = await db.query<{ flag_name: string; label: string | null; value_type: string }>(
        `select flag_name, label, value_type from channel_flags where organization_id = $1 and active order by flag_name`,
        [organizationId],
      )
      const flags: ChannelFlagSpec[] = flagRows.rows.filter((row) => row.value_type === "BOOLEAN" || row.value_type === "NUMERIC").map((row) => ({ name: row.flag_name, label: row.label?.trim() || row.flag_name, valueType: row.value_type as ChannelFlagSpec["valueType"] }))
      const result = await db.query<{ id: string; person_id: string; reason: string | null; sub_reason: string | null; channel: string | null; local_day: string; seconds: string | null; flags: Record<string, string | null> }>(
        `select i.id, i.operator_id person_id, i.reason, i.sub_reason, i.channel, (i.started_at at time zone $5)::date::text as local_day,
                extract(epoch from i.ended_at - i.started_at)::text seconds,
                coalesce(jsonb_object_agg(cf.flag_name, coalesce(f.value_boolean::text, f.value_numeric::text)) filter (where cf.id is not null), '{}'::jsonb) flags
           from interactions i
           left join interaction_flags f on f.interaction_id = i.id and f.organization_id = i.organization_id
           left join channel_flags cf on cf.id = f.channel_flag_id and cf.active
          where i.organization_id = $1 and i.operator_id = any($2::uuid[])
            and i.started_at >= ($3::date)::timestamp at time zone $5 and i.started_at < ($4::date)::timestamp at time zone $5
          group by i.id
          order by i.started_at, i.id
          limit ${MAX_DOMAIN_FACTS + 1}`,
        window,
      )
      const { rows, truncated } = limited(result.rows)
      const facts: Fact[] = rows.map((row) => {
        const dims: Fact["dims"] = { MOTIVO: row.reason, SUBMOTIVO: row.sub_reason, CANAL: row.channel, DIA: row.local_day }
        const seconds = row.seconds === null ? null : Number(row.seconds)
        const measures: Fact["measures"] = { DURACAO: seconds !== null && seconds >= 0 ? seconds : null }
        for (const flag of flags) {
          const raw = row.flags?.[flag.name]
          if (flag.valueType === "BOOLEAN") {
            // Ocorrência só registrada quando acontece (na prática, quase sempre "sim"): sem registro = sem a ocorrência. A premissa
            // vai escrita no método; contar só quem tem a informação daria taxas de 90–100%.
            measures[flag.name] = raw === "true" ? 1 : 0
            dims[`OCORRENCIA:${flag.name}`] = raw === "true" ? "sim" : "não"
          } else measures[flag.name] = raw === null || raw === undefined ? null : Number(raw)
        }
        return { personId: row.person_id, key: row.id, dims, measures }
      })
      return { facts, truncated, flags }
    }
    if (domain === "MONITORING") {
      const result = await db.query<{ person_id: string; interaction_id: string; subject: string | null; criterion: string | null; status: string; local_day: string }>(
        `select person_id, interaction_id, coalesce(subject_canonical, subject_raw) subject, left(coalesce(section_heading || ' — ', '') || criterion_text, 200) criterion, status, local_date::text as local_day
           from call_criterion_assessments
          where organization_id = $1 and person_id = any($2::uuid[]) and is_current and local_date >= $3::date and local_date < $4::date and $5::text is not null
          order by local_date, interaction_id, id
          limit ${MAX_DOMAIN_FACTS + 1}`,
        window,
      )
      const { rows, truncated } = limited(result.rows)
      const assessable = new Set(["MET", "PARTIAL", "NOT_MET"])
      return {
        truncated,
        facts: rows.map((row) => ({
          personId: row.person_id,
          key: row.interaction_id,
          dims: { ASSUNTO: row.subject, CRITERIO: row.criterion, SITUACAO: CRITERION_STATUS[row.status] ?? row.status, DIA: row.local_day },
          measures: { CUMPRIDO: assessable.has(row.status) ? (row.status === "MET" ? 1 : 0) : null, NAO_CUMPRIDO: assessable.has(row.status) ? (row.status === "NOT_MET" ? 1 : 0) : null },
        })),
      }
    }
    if (domain === "FEEDBACKS") {
      const result = await db.query<{ person_id: string; id: string; kind: string | null; indicator: string | null; local_day: string; acknowledged: boolean; days_to_ack: string | null; agreement: string | null }>(
        `select f.operator_id person_id, f.id, f.feedback_kind::text kind, f.impacted_indicator indicator, (f.published_at at time zone $5)::date::text as local_day,
                f.acknowledged_at is not null acknowledged, (extract(epoch from f.acknowledged_at - f.published_at) / 86400)::text days_to_ack,
                (select a.agreement from feedback_read_agreements a where a.organization_id = f.organization_id and a.feedback_id = f.id order by a.created_at desc limit 1) agreement
           from feedbacks f
          where f.organization_id = $1 and f.operator_id = any($2::uuid[]) and f.published_at is not null
            -- Regra única de leitura do Acompanhamento: publicado e sem ocultação lógica vigente.
            and f.status = 'PUBLISHED' and ${visibleInFollowUpSql("f")}
            and f.published_at >= ($3::date)::timestamp at time zone $5 and f.published_at < ($4::date)::timestamp at time zone $5
         union all
         -- Entregas do motor de feedback (análise de atendimento): também são feedback publicado à pessoa.
         select d.collaborator_id, d.id, 'DELIVERY', null, (d.delivered_at at time zone $5)::date::text,
                d.acknowledged_at is not null, (extract(epoch from d.acknowledged_at - d.delivered_at) / 86400)::text,
                (select a.agreement from feedback_read_agreements a where a.organization_id = d.organization_id and a.interaction_delivery_id = d.id order by a.created_at desc limit 1)
           from interaction_feedback_deliveries d
          where d.organization_id = $1 and d.collaborator_id = any($2::uuid[]) and d.delivered_at is not null
            and d.delivered_at >= ($3::date)::timestamp at time zone $5 and d.delivered_at < ($4::date)::timestamp at time zone $5
          order by local_day, id
          limit ${MAX_DOMAIN_FACTS + 1}`,
        window,
      )
      const { rows, truncated } = limited(result.rows)
      return {
        truncated,
        facts: rows.map((row) => ({
          personId: row.person_id,
          key: row.id,
          dims: { TIPO: row.kind ? FEEDBACK_KIND[row.kind] ?? row.kind : null, INDICADOR: row.indicator, CIENCIA: row.acknowledged ? "Confirmada" : "Aguardando", CONCORDANCIA: row.agreement === "AGREE" ? "Concorda" : row.agreement === "DISAGREE" ? "Não concorda" : "Sem resposta", DIA: row.local_day },
          measures: { CIENCIA: row.acknowledged ? 1 : 0, DIAS_ATE_CIENCIA: row.days_to_ack === null ? null : Number(row.days_to_ack), CONCORDA: row.agreement === "AGREE" ? 1 : row.agreement === "DISAGREE" ? 0 : null },
        })),
      }
    }
    if (domain === "SCHEDULE" || domain === "WORKDAY") {
      // Dias com escala informada (e, na jornada, também os dias com produção), com a exceção ativa, a classificação vigente e as
      // divergências em aberto do dia.
      const result = await db.query<{ person_id: string; local_day: string; scheduled: boolean | null; schedule_type: string | null; shift_start: string | null; shift_end: string | null; calls: number; exception_code: string | null; classification: string | null; divergences: string | null; break_minutes: string | null }>(
        `with days as (
           select person_id, schedule_date as d, scheduled_to_work, schedule_type, shift_start::text, shift_end::text
             from employee_schedule_days where organization_id = $1 and person_id = any($2::uuid[]) and schedule_date >= $3::date and schedule_date < $4::date),
         production as (
           select person_id, local_date as d, interaction_count from person_daily_activity
            where organization_id = $1 and person_id = any($2::uuid[]) and local_date >= $3::date and local_date < $4::date and interaction_count > 0 and $6::boolean),
         keys as (select person_id, d from days union select person_id, d from production)
         select k.person_id, k.d::text as local_day, ds.scheduled_to_work as scheduled, ds.schedule_type, ds.shift_start, ds.shift_end, coalesce(p.interaction_count, 0)::int as calls,
                (select e.code from employee_schedule_exceptions e where e.organization_id = $1 and e.person_id = k.person_id and e.exception_date = k.d and e.active and e.cancelled_at is null order by e.updated_at desc limit 1) as exception_code,
                (select c.classification from workday_classifications c where c.organization_id = $1 and c.person_id = k.person_id and c.workday = k.d and c.superseded_at is null order by c.classified_at desc limit 1) as classification,
                (select string_agg(distinct r.kind, ',') from workday_reconciliations r where r.organization_id = $1 and r.person_id = k.person_id and r.workday = k.d and r.status = 'OPEN') as divergences,
                (select sum(extract(epoch from a.end_time - a.start_time) / 60)::text from employee_schedule_activities a where a.organization_id = $1 and a.person_id = k.person_id and a.schedule_date = k.d and a.active and a.superseded_at is null and a.activity_type = 'BREAK') as break_minutes
           from keys k left join days ds on ds.person_id = k.person_id and ds.d = k.d left join production p on p.person_id = k.person_id and p.d = k.d
          where $5::text is not null
          order by k.d, k.person_id
          limit ${MAX_DOMAIN_FACTS + 1}`,
        [...window, domain === "WORKDAY"],
      )
      const { rows, truncated } = limited(result.rows)
      if (domain === "WORKDAY") {
        // JORNADA: quem decide o dia é o RESOLVEDOR ÚNICO (situação funcional, admissão, exceção, escala, feriado, disponibilidade do
        // dado, dia em curso). A consulta acima só acrescenta o que ele não traz (tipo de escala, atendimentos, pendências em aberto).
        const extras = new Map(rows.map((row) => [`${row.person_id}:${row.local_day}`, row]))
        const resolved = await resolveWorkdays(personIds, { start: startOfLocalDate(fromDate, timeZone), end: startOfLocalDate(toDateExclusive, timeZone) })
        const facts: Fact[] = []
        for (const personId of [...personIds].sort()) {
          for (const day of resolved.get(personId) ?? []) {
            const row = extras.get(`${personId}:${day.date}`)
            const reading = workdayReading(day)
            const calls = row?.calls ?? 0
            facts.push({
              personId,
              key: `${personId}:${day.date}`,
              dims: {
                DIA: day.date,
                SITUACAO: reading.situation,
                ESCALA: row?.schedule_type ? SCHEDULE_TYPE[row.schedule_type] ?? row.schedule_type : "Sem escala informada",
                EXCECAO: row?.exception_code ? EXCEPTION_LABEL[row.exception_code] ?? row.exception_code : "Sem exceção",
                CLASSIFICACAO: row?.classification ? CLASSIFICATION_LABEL[row.classification] ?? row.classification : "Sem classificação",
                DIVERGENCIA: row?.divergences ? row.divergences.split(",").map((kind) => DIVERGENCE_LABEL[kind] ?? kind).join(" + ") : "Sem divergência",
              },
              measures: {
                PRODUZIU_NO_DIA_ESCALADO: reading.produced,
                SEM_PRODUCAO_NO_DIA_ESCALADO: reading.missing,
                PRODUCAO_NA_FOLGA: reading.offDayProduction,
                ATENDIMENTOS_NO_DIA: calls > 0 ? calls : null,
                DIVERGENCIA_ABERTA: row?.divergences ? 1 : 0,
              },
            })
          }
        }
        facts.sort((a, b) => (a.dims.DIA! < b.dims.DIA! ? -1 : a.dims.DIA! > b.dims.DIA! ? 1 : 0))
        return { facts: facts.slice(0, MAX_DOMAIN_FACTS), truncated: truncated || facts.length > MAX_DOMAIN_FACTS }
      }
      return {
        truncated,
        facts: rows.map((row) => {
          const known = row.scheduled !== null
          const excused = row.exception_code !== null
          const scheduled = known && row.scheduled === true && !excused
          const dims: Fact["dims"] = {
            DIA: row.local_day,
            SITUACAO: !known ? "Sem escala informada" : scheduled ? "Escalado" : "Folga",
            ESCALA: row.schedule_type ? SCHEDULE_TYPE[row.schedule_type] ?? row.schedule_type : "Sem escala informada",
            EXCECAO: row.exception_code ? EXCEPTION_LABEL[row.exception_code] ?? row.exception_code : "Sem exceção",
            TURNO: scheduled && row.shift_start && row.shift_end ? `${hhmm(row.shift_start)}–${hhmm(row.shift_end)}` : null,
            ENTRADA: scheduled ? hhmm(row.shift_start) : null,
          }
          const measures: Fact["measures"] = { DIA_ESCALADO: known ? (scheduled ? 1 : 0) : null, HORAS_ESCALADAS: scheduled ? hoursBetween(row.shift_start, row.shift_end) : null, PAUSAS_PLANEJADAS: scheduled && row.break_minutes !== null ? Number(row.break_minutes) : null }
          // Escala: "pessoas com escala" conta só quem tem dia informado.
          return { personId: row.person_id, key: `${row.person_id}:${row.local_day}`, dims, measures }
        }).filter((fact) => fact.dims.SITUACAO !== "Sem escala informada"),
      }
    }
    if (domain === "COMMUNICATIONS") {
      const result = await db.query<{ person_id: string; id: string; title: string; audience: string; local_day: string }>(
        `select p.id as person_id, c.id, c.title, c.audience, (c.published_at at time zone $5)::date::text as local_day
           from communications c join people p on p.organization_id = c.organization_id and p.id = any($2::uuid[])
          where c.organization_id = $1 and ${communicationLiveSql("c")}
            and c.published_at >= ($3::date)::timestamp at time zone $5 and c.published_at < ($4::date)::timestamp at time zone $5
            and (c.audience = 'ORGANIZATION'
              or (c.audience = 'TEAM' and exists (select 1 from communication_recipients r where r.communication_id = c.id and r.organization_id = c.organization_id and r.person_id = p.id))
              or (c.audience = 'SEGMENT' and ${segmentPersonSql("c", "p")}))
          order by c.published_at, c.id, p.id
          limit ${MAX_DOMAIN_FACTS + 1}`,
        window,
      )
      const audience: Record<string, string> = { ORGANIZATION: "Organização inteira", TEAM: "Grupo/Subgrupo", SEGMENT: "Recorte" }
      const { rows, truncated } = limited(result.rows)
      return { truncated, facts: rows.map((row) => ({ personId: row.person_id, key: row.id, dims: { COMUNICADO: row.title, PUBLICO: audience[row.audience] ?? row.audience, DIA: row.local_day }, measures: {} })) }
    }
    if (domain === "INIA_USAGE") {
      const result = await db.query<{ person_id: string; conversation_id: string | null; channel: string; local_day: string }>(
        `select operator_id as person_id, conversation_id::text, channel, (coalesce(occurred_at, created_at) at time zone $5)::date::text as local_day
           from assistant_interactions
          where organization_id = $1 and operator_id = any($2::uuid[]) and role = 'user'
            and coalesce(occurred_at, created_at) >= ($3::date)::timestamp at time zone $5 and coalesce(occurred_at, created_at) < ($4::date)::timestamp at time zone $5
          order by coalesce(occurred_at, created_at), id
          limit ${MAX_DOMAIN_FACTS + 1}`,
        window,
      )
      const { rows, truncated } = limited(result.rows)
      return { truncated, facts: rows.map((row) => ({ personId: row.person_id, key: row.conversation_id ?? "", dims: { CANAL: row.channel === "voice" ? "Voz" : "Chat", DIA: row.local_day }, measures: {} })) }
    }
    if (domain === "SUPPORT") {
      // Lido pelo módulo dono (isolamento do Apoio com Anjo): só quando começou, como terminou e os tempos.
      const { rows, truncated } = limited(await listSupportAttendanceCounts(db, { organizationId, operatorPersonIds: personIds, fromDate, toDateExclusive, timeZone, limit: MAX_DOMAIN_FACTS + 1 }))
      return {
        truncated,
        facts: rows.map((row) => ({
          personId: row.operatorPersonId,
          key: row.id,
          dims: { FIM: row.endCause ? SUPPORT_END_CAUSE_LABELS[row.endCause] ?? row.endCause : row.status === "ENDED" ? "Encerrado" : "Em andamento", DIA: row.localDay },
          measures: { TEMPO_ATE_RESPOSTA: row.secondsToFirstAnswer, DURACAO: row.durationSeconds },
        })),
      }
    }
    const result = await db.query<{ person_id: string; id: string; status: string; priority: string | null; indicator: string | null; local_day: string; open_days: string }>(
      `select operator_id person_id, id, status::text, priority::text, indicator_code indicator, (created_at at time zone $5)::date::text as local_day, (extract(epoch from now() - created_at) / 86400)::text open_days
         from supervision_cases
        where organization_id = $1 and operator_id = any($2::uuid[])
          and created_at >= ($3::date)::timestamp at time zone $5 and created_at < ($4::date)::timestamp at time zone $5
        order by created_at, id
        limit ${MAX_DOMAIN_FACTS + 1}`,
      window,
    )
    const { rows, truncated } = limited(result.rows)
    return {
      truncated,
      facts: rows.map((row) => {
        const open = !CLOSED_CASES.has(row.status)
        return { personId: row.person_id, key: row.id, dims: { STATUS: CASE_STATUS[row.status] ?? row.status, PRIORIDADE: row.priority, INDICADOR: row.indicator, DIA: row.local_day }, measures: { ABERTO: open ? 1 : 0, DIAS_EM_ABERTO: open ? Number(row.open_days) : null } }
      }),
    }
  }
}
