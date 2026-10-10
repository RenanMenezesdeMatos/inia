import type { Database } from "../../../infrastructure/database/pool.js"
import { formatIndicatorValue } from "../../indicators/domain/indicator-definition.js"
import { describeTargetGap } from "../../indicators/domain/indicator-canonical-context.js"
import { eligibleMeasurementFilter } from "../../indicators/application/operational-measurement-resolver.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { loadPersonPresentation } from "../../profile-preferences/application/person-presentation-loader.js"


const DEFAULT_WINDOW_DAYS = 7
const MAX_WINDOW_DAYS = 180
const FEEDBACK_HISTORY_LIMIT = 8
const FEEDBACK_KIND_LABEL: Record<string, string> = { INDICATOR: "Indicador", MONITORING: "Monitoria" }

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text
}


export type OperatorIdentity = {
  name: string
  teamId: string | null
  teamName: string | null
  preferredName: string | null
  addressName: string | null
  /** Cargo informado no cadastro (texto livre) e nível hierárquico — CONTEXTO para a resposta, nunca permissão. */
  jobTitle?: string | null
  level?: string | null
  /** Pessoas ativas que respondem diretamente a ela (reports_to) — define se a pergunta vem de alguém que lidera. */
  directReports?: number
}

/**
 * Quem é o operador que está perguntando — sem isso, todo especialista chamado pelo
 * orquestrador tem que perguntar "qual sua matrícula/grupo?" pra cada pergunta, mesmo já
 * estando numa sessão autenticada onde essa informação já é conhecida.
 */
export async function buildOperatorIdentity(db: Database, organizationId: string, operatorId: string): Promise<OperatorIdentity | null> {
  const result = await db.query<{ name: string; team_id: string | null; team_name: string | null; job_title: string | null; role: string | null; direct_reports: number }>(
    `select p.name, p.team_id, t.name team_name, p.job_title, p.role,
            (select count(*)::int from people sub where sub.organization_id = p.organization_id and sub.reports_to_id = p.id and sub.active) direct_reports
     from people p left join teams t on t.id = p.team_id where p.id = $1 and p.organization_id = $2`,
    [operatorId, organizationId],
  )
  const row = result.rows[0]
  if (!row) return null
  // Como a pessoa quer ser chamada — resolução ÚNICA (profile-preferences), nunca `name.split(" ")[0]` aqui.
  const presentation = await loadPersonPresentation(db, organizationId, operatorId)
  return { name: row.name, teamId: row.team_id, teamName: row.team_name, preferredName: presentation?.preferredName ?? null, addressName: presentation?.addressName ?? null, jobTitle: row.job_title, level: row.role, directReports: row.direct_reports ?? 0 }
}

/** Janela, em dias, dos indicadores que o especialista recebe: o período pedido, sempre entre 1 e `MAX_WINDOW_DAYS` (padrão 7). */
export function indicatorWindowDays(windowDays: number = DEFAULT_WINDOW_DAYS): number {
  return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.round(windowDays) || DEFAULT_WINDOW_DAYS))
}

/**
 * Mesma agregação de "resumo geral de indicadores" já usada no gatilho por agenda
 * (action-executors.ts/callAgentForIndicatorSummary), mas com uma janela diferente de
 * propósito: aqui é uma pergunta ao vivo ("como estou indo?"), não uma comparação de período
 * fechado — uma janela corrida até agora (não o período de calendário completo anterior; esse
 * `resolvePeriodWindow("WEEK", ...)` significa "semana passada inteira", que ficaria vazio pra
 * medições de ontem/hoje, como as que o sistema normalmente tem — confirmado ao vivo em
 * 2026-09-11). Retorna null (não lança) quando não há meta ou medição — o especialista aí só
 * não tem números pra citar, mas a conversa continua normalmente.
 *
 * `windowDays` vem do próprio pedido do colaborador (o orquestrador extrai isso da pergunta
 * via function calling — ver `periodDays` na tool declarada em resolve-orchestrator.ts) — o
 * padrão de 7 dias cobre a maioria das perguntas, mas "me mostra os últimos 3 meses" deveria
 * mesmo olhar 3 meses, não sempre a mesma semana. Sempre clampado (nunca confia no valor que o
 * modelo manda) entre 1 e `MAX_WINDOW_DAYS`.
 */
export async function buildIndicatorSnapshot(
  db: Database,
  organizationId: string,
  operatorId: string,
  teamId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<string | null> {
  const clampedDays = indicatorWindowDays(windowDays)
  const now = new Date()
  const window = { start: new Date(now.getTime() - clampedDays * 24 * 60 * 60 * 1000), end: now }
  const periodLabel = clampedDays === 1 ? "Último dia" : `Últimos ${clampedDays} dias`

  const goalRows = await db.query<{ code: string; name: string; unit: string; desired_direction: string; indicator_id: string }>(
    `select distinct on (i.id) i.code, i.name, i.unit, i.desired_direction, i.id indicator_id
     from goals g join indicator_definitions i on i.id = g.indicator_definition_id
     where g.organization_id = $1 and g.subject_type = 'TEAM' and g.subject_id = $2
       and g.valid_from <= $3::date and (g.valid_until is null or g.valid_until >= $3::date)
     order by i.id, g.valid_from desc`,
    [organizationId, teamId, window.end.toISOString()],
  )
  if (goalRows.rows.length === 0) return null

  const lines: string[] = []
  // Só medições de datas ELEGÍVEIS (predicado canônico) — o contexto do assistente nunca lê um dia de folga como produção.
  const eligible = await eligibleMeasurementFilter(db, { subjectIds: [operatorId], window, timeZone: await resolveOrganizationTimezone(db, organizationId), firstParam: 6 })
  for (const row of goalRows.rows) {
    const aggRow = await db.query<{ avg_value: string | null }>(
      `with ${eligible.cte}
       select avg(m.value)::numeric avg_value
       from indicator_measurements m
       ${eligible.join}
       where m.organization_id = $1 and m.indicator_definition_id = $2 and m.subject_type = 'PERSON' and m.subject_id = $3
         and m.period_start >= $4 and m.period_start < $5 and ${eligible.predicate}`,
      [organizationId, row.indicator_id, operatorId, window.start.toISOString(), window.end.toISOString(), ...eligible.params],
    )
    const avgValue = aggRow.rows[0]?.avg_value
    if (!avgValue) continue

    const targetGoal = await db.query<{ target_value: string }>(
      `select target_value from goals
       where organization_id = $1 and indicator_definition_id = $2 and subject_type = 'PERSON' and subject_id = $3
         and valid_from <= $4::date and (valid_until is null or valid_until >= $4::date)
       order by valid_from desc limit 1`,
      [organizationId, row.indicator_id, operatorId, window.end.toISOString()],
    )
    const value = Number(avgValue)
    const targetValue = targetGoal.rows[0] ? Number(targetGoal.rows[0].target_value) : null
    const gap = describeTargetGap(value, targetValue, row.desired_direction, row.unit)
    lines.push(
      `- ${row.name} (${row.code}): ${formatIndicatorValue(value, row.unit)}, meta ${targetValue !== null ? formatIndicatorValue(targetValue, row.unit) : "não cadastrada"}. ${gap}`,
    )
  }
  if (lines.length === 0) return null

  return [`Indicadores do operador — ${periodLabel} (${window.start.toISOString().slice(0, 10)} a ${window.end.toISOString().slice(0, 10)}):`, ...lines].join(
    "\n",
  )
}

/**
 * Histórico real de feedbacks já publicados pro operador (monitoria e indicador, mesma tabela,
 * distinguidos por `feedback_kind`) — mesma junção usada pelo painel de Acompanhamento do
 * operador (reporting/fetch-operator-overview.ts), só que aqui formatado como texto pra entrar
 * no prompt do especialista em vez de JSON pra UI. Sem isso, um agente cujo objetivo é
 * justamente "analisar a evolução a partir do histórico de feedbacks" não tinha nenhum
 * histórico de verdade pra analisar — só podia pedir pro operador colar os dados manualmente
 * (confirmado ao vivo em 2026-09-11). `status = 'PUBLISHED'` exclui rascunhos/cancelados —
 * evidência que nunca chegou a virar um feedback de verdade não deveria alimentar a próxima
 * resposta da IA.
 */
export async function buildFeedbackHistory(db: Database, operatorId: string): Promise<string | null> {
  const result = await db.query<{ kind: string; impacted_indicator: string; recommendation: string; published_at: string }>(
    `select f.feedback_kind kind, f.impacted_indicator, f.recommendation, f.published_at
     from feedbacks f
     where f.operator_id = $1 and f.status = 'PUBLISHED'
     order by f.published_at desc
     limit $2`,
    [operatorId, FEEDBACK_HISTORY_LIMIT],
  )
  if (result.rows.length === 0) return null

  const lines = result.rows.map((row) => {
    const date = new Date(row.published_at).toLocaleDateString("pt-BR")
    const kind = FEEDBACK_KIND_LABEL[row.kind] ?? row.kind
    return `- [${date}] ${kind} — ${row.impacted_indicator}: ${truncate(row.recommendation, 280)}`
  })
  return [`Histórico de feedbacks já publicados pro operador (mais recente primeiro):`, ...lines].join("\n")
}
