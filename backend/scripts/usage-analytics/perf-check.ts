/**
 * Desempenho da Monitoria de usabilidade com MASSA SINTÉTICA no banco de TESTE (TEST_DATABASE_URL — nunca dev/produção).
 * Cria uma organização própria (slug `prova-usabilidade-…`), N colaboradores com conta, D dias de uso (eventos crus do
 * navegador no mesmo formato da ingestão), feedbacks publicados com exposição/abertura/avaliação/ciência, conversas com a
 * INIA e execuções de Workflow com fan-out; roda a PROJEÇÃO REAL, mede o tempo de cada consulta das abas (contexto + consulta,
 * 1 aquecimento + R repetições) e APAGA tudo pela organização no fim.
 *   NODE_ENV=test npx tsx scripts/usage-analytics/perf-check.ts [pessoas=2000] [dias=37] [repetições=7]
 */
import { appendFileSync } from "node:fs"
import { cpus, totalmem } from "node:os"
import pg from "pg"
import { env } from "../../src/config/env.js"
import type { Database } from "../../src/infrastructure/database/pool.js"
import { createPostgresAccessRepository } from "../../src/modules/access/infrastructure/postgres-access-repository.js"
import { runActivityProjection } from "../../src/modules/usage-analytics/application/activity-projection.js"
import { projectOrganization } from "../../src/modules/usage-analytics/application/eligibility-projection.js"
import { invalidateUsageSettings } from "../../src/modules/usage-analytics/application/usage-settings.js"
import { contextQuery } from "../../src/modules/usage-analytics/application/query/context-query.js"
import { conversationsQuery } from "../../src/modules/usage-analytics/application/query/conversations-query.js"
import { feedbacksQuery } from "../../src/modules/usage-analytics/application/query/feedbacks-query.js"
import { journeysQuery } from "../../src/modules/usage-analytics/application/query/journeys-query.js"
import { overviewQuery } from "../../src/modules/usage-analytics/application/query/overview-query.js"
import { peopleQuery } from "../../src/modules/usage-analytics/application/query/people-query.js"
import { personDetailQuery, personTimelineQuery } from "../../src/modules/usage-analytics/application/query/person-query.js"
import { qualityQuery } from "../../src/modules/usage-analytics/application/query/quality-query.js"
import { retentionQuery } from "../../src/modules/usage-analytics/application/query/retention-query.js"
import { screensQuery } from "../../src/modules/usage-analytics/application/query/screens-query.js"
import { buildUsabilityContext } from "../../src/modules/usage-analytics/application/query/usability-context.js"
import type { UsabilityTab } from "../../src/modules/usage-analytics/application/query/usability-filters.js"
import { workflowsQuery } from "../../src/modules/usage-analytics/application/query/workflows-query.js"
import { USAGE_EVENTS } from "../../src/modules/usage-analytics/domain/usage-events.js"
import { FIXTURE_TZ, cleanupFixture, cleanupLeftovers, seedFixtureBase, type FixtureIds } from "../../src/modules/usage-analytics/testing/usability-fixture.js"

const PEOPLE = Number(process.argv[2] ?? 2000)
const DAYS = Number(process.argv[3] ?? 37)
const REPS = Number(process.argv[4] ?? 7)
const NOW = new Date("2026-10-07T15:00:00Z")
const LAST_DAY = "2026-10-06"
if (!env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL ausente.")
const pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 10 })
// PERF_SLOW_MS=n: registra cada SQL mais lento que n ms (diagnóstico de plano).
const SLOW_MS = Number(process.env.PERF_SLOW_MS ?? 0)
if (SLOW_MS > 0) {
  const original = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>
  ;(pool as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = async (...args: unknown[]) => {
    const started = performance.now()
    try {
      return await original(...args)
    } finally {
      const elapsed = performance.now() - started
      if (elapsed > SLOW_MS && process.env.PERF_SLOW_DUMP)
        appendFileSync(
          process.env.PERF_SLOW_DUMP,
          `${JSON.stringify({ elapsed, text: typeof args[0] === "string" ? args[0] : (args[0] as { text?: string }).text, values: typeof args[0] === "string" ? args[1] : (args[0] as { values?: unknown }).values })}\n`,
        )
      if (elapsed > SLOW_MS)
        process.stdout.write(
          `    [lento ${elapsed.toFixed(0)} ms] ${String(typeof args[0] === "string" ? args[0] : (args[0] as { text?: string }).text)
            .replace(/\s+/g, " ")
            .slice(0, 300)}\n`,
        )
    }
  }
}
const db = pool as unknown as Database
const log = (message: string) => process.stdout.write(`${message}\n`)
const timed = async <T>(label: string, task: () => Promise<T>) => {
  const started = performance.now()
  const result = await task()
  log(`  ${label}: ${((performance.now() - started) / 1000).toFixed(1)} s`)
  return result
}
// Sorteio determinístico 0–99 por chave (hashtext pode ser −2³¹: soma em bigint antes do módulo).
const roll = (expr: string) => `((hashtext(${expr})::bigint + 2147483648) % 100)`
const iso = (expr: string) => `to_char((${expr}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

// PERF_REUSE=1: mede sobre a massa mantida por uma execução anterior com PERF_KEEP=1 (mesmos pessoas/dias), sem recriar.
const REUSE = process.env.PERF_REUSE === "1"
async function keptIds(): Promise<FixtureIds> {
  const org = (
    await pool.query<{ id: string; slug: string }>(
      `select o.id, o.slug from organizations o where o.slug like 'prova-usabilidade-%' and o.slug not like 'prova-usabilidade-outra-%' and exists (select 1 from people p where p.organization_id = o.id and p.matricula like 'PERF-%')`,
    )
  ).rows[0]
  if (!org) throw new Error("Nenhuma massa mantida (rode antes com PERF_KEEP=1).")
  const other = (await pool.query<{ id: string }>(`select id from organizations where slug = $1`, [org.slug.replace("prova-usabilidade-", "prova-usabilidade-outra-")])).rows[0]
  const who = async (name: string) =>
    (
      await pool.query<{ person: string; account: string }>(`select p.id person, a.id account from people p join user_accounts a on a.person_id = p.id where p.organization_id = $1 and p.name = $2`, [
        org.id,
        name,
      ])
    ).rows[0]!
  const [vera, lia, alan] = [await who("Vera Gestora"), await who("Lia Leitora"), await who("Alan Analista")]
  return {
    org: org.id,
    otherOrg: other?.id ?? org.id,
    people: { vera: vera.person, lia: lia.person, alan: alan.person },
    accounts: { vera: vera.account, lia: lia.account, alan: alan.account },
  } as unknown as FixtureIds
}
if (!REUSE) await cleanupLeftovers(pool)
const ids = REUSE ? await keptIds() : await seedFixtureBase(pool)
const org = ids.org
const firstDay = new Date(new Date(`${LAST_DAY}T12:00:00Z`).getTime() - (DAYS - 1) * 86_400_000).toISOString().slice(0, 10)
try {
  invalidateUsageSettings()
  if (!REUSE) {
    log(`Massa sintética: ${PEOPLE} pessoas × ${DAYS} dias (${firstDay} a ${LAST_DAY}, fuso ${FIXTURE_TZ}), organização ${org}`)
    await timed("pessoas e contas", async () => {
      await pool.query(
        `insert into people (organization_id, name, role, team_id, subteam_id, active, current_employment_status, reports_to_id, job_title, matricula)
       select $1, 'Sintético ' || g, 'OPERATOR', case when g % 2 = 0 then $2::uuid else $3::uuid end, case when g % 4 = 0 then $4::uuid end, true,
         case when g % 25 = 0 then 'FERIAS' else 'EM_PRODUCAO' end, $5, 'Operador(a)', 'PERF-' || g || '-' || $7
       from generate_series(1, $6::int) g`,
        [org, ids.teamA, ids.teamB, ids.subteamA, ids.people.vera, PEOPLE, org.slice(0, 8)],
      )
      // 5 % sem conta (elegíveis sem acesso possível).
      await pool.query(
        `insert into user_accounts (organization_id, person_id, email, password_hash, active, created_at)
       select $1, id, 'perf-' || id || '@prova-usabilidade.local', 'x', true, '2026-08-01T12:00:00Z' from people
       where organization_id = $1 and matricula like 'PERF-%' and ${roll("id::text")} >= 5`,
        [org],
      )
    })
    await timed("elegibilidade (projeção real)", () => projectOrganization(pool, org, new Date("2026-08-01T12:00:00Z")))
    await pool.query(
      `insert into usage_coverage (organization_id, family, first_event_at, last_event_at, last_received_at) select $1, f, '2026-08-01T12:00:00Z', $2, $2 from unnest($3::text[]) f
     on conflict (organization_id, family) do update set first_event_at = excluded.first_event_at, last_event_at = excluded.last_event_at, last_received_at = excluded.last_received_at`,
      [org, NOW, [...new Set(USAGE_EVENTS.map((event) => event.family))]],
    )

    // Dias ativos: ~60 % dos dias de quem tem conta; uma sessão por dia de 20 eventos (≈ 5 min), 25 % no celular.
    const activeDays = `select p.id person, p.team_id, p.subteam_id, p.reports_to_id, a.id account, d::date dia,
      md5('s' || p.id || d)::uuid session, md5('t' || p.id || d)::uuid tab,
      ((d::date + make_interval(hours => 8 + (${roll("p.id::text || d::text")} % 9)::int)) at time zone '${FIXTURE_TZ}') t0,
      case when ${roll("'dev' || p.id::text")} < 25 then 'MOBILE' else 'DESKTOP' end device
    from people p join user_accounts a on a.person_id = p.id and a.organization_id = p.organization_id
    cross join generate_series($2::date, $3::date, interval '1 day') d
    where p.organization_id = $1 and p.matricula like 'PERF-%' and ${roll("'day' || p.id::text || d::text")} < 60`
    const eventColumns = `organization_id, event_id, event_name, schema_version, family, source, actor_type, account_id, actor_person_id, subject_person_id, occurred_at,
    client_occurred_at, received_at, timestamp_status, usage_session_id, tab_id, screen_instance_id, screen_key, feature_key, element_key, route_template, area,
    entity_type, entity_id, device, app_version, environment, population_class, team_id, subteam_id, reports_to_id, properties`
    await timed("eventos de navegação (sessões)", () =>
      pool.query(
        `with days as (${activeDays}), ev as (
         select d.*, k, d.t0 + make_interval(secs => k * 15) at_k,
           md5('i1' || d.session)::uuid i1, md5('i2' || d.session)::uuid i2
         from days d cross join generate_series(0, 19) k)
       insert into usage_events (${eventColumns})
       select $1, gen_random_uuid(),
         case when k = 0 or k = 10 then 'screen.viewed' when k = 9 then 'element.activated' when k = 18 then 'content.scrolled' when k = 19 then 'screen.left' else 'activity.heartbeat' end,
         1,
         case when k = 0 or k = 10 or k = 19 then 'NAVIGATION' when k = 9 then 'ELEMENT' when k = 18 then 'SCROLL' else 'SESSION' end,
         'CLIENT', 'HUMAN', account, person, null, at_k, at_k, at_k + interval '2 seconds', 'OK', session, tab,
         case when k < 10 or k = 18 then i1 else i2 end,
         case when k < 10 or k = 18 then 'my_profile.operator.followup' else 'my_profile.operator.indicators' end,
         case when k < 10 or k = 18 then 'followup' else 'indicators' end,
         case when k = 9 then 'chat.history.open' end, '/operator', 'OPERATIONAL', null, null, device, 'perf-1.0.0', 'test', 'REAL', team_id, subteam_id, reports_to_id,
         case
           when k = 0 then jsonb_build_object('kind', 'ROUTE', 'navigation', 'INITIAL', 'entry', true)
           when k = 10 then jsonb_build_object('kind', 'TAB', 'navigation', 'TAB_SWITCH', 'entry', false, 'previousScreenKey', 'my_profile.operator.followup')
           when k = 9 then jsonb_build_object('interaction', case when device = 'MOBILE' then 'TAP' else 'CLICK' end)
           when k = 18 then jsonb_build_object('contentKey', 'followup.feed', 'depth', 50, 'fitsViewport', false)
           when k = 19 then jsonb_build_object('reason', 'NAVIGATION', 'visibleMs', 135000)
           else jsonb_build_object('spanStart', ${iso("at_k - interval '15 seconds'")}, 'spanEnd', ${iso("at_k")}, 'reason', 'INTERACTION', 'lastInteractionAt', ${iso("at_k")})
         end
       from ev`,
        [org, firstDay, LAST_DAY],
      ),
    )

    // Feedbacks: ~1 a cada 15 dias por pessoa; 85 % expostos, 60 % abertos, 35 % avaliados, 50 % com ciência.
    const feedbackDays = `select p.id person, p.team_id, p.subteam_id, p.reports_to_id, a.id account, d::date dia,
      md5('case' || p.id || d)::uuid case_id, md5('fb' || p.id || d)::uuid feedback_id,
      ((d::date + time '09:00') at time zone '${FIXTURE_TZ}') published_at, ${roll("'fb' || p.id::text || d::text")} r
    from people p left join user_accounts a on a.person_id = p.id and a.organization_id = p.organization_id
    cross join generate_series($2::date, $3::date, interval '1 day') d
    where p.organization_id = $1 and p.matricula like 'PERF-%' and ${roll("'pub' || p.id::text || d::text")} < 7`
    await timed("feedbacks, avaliações, ciência e consumo", async () => {
      await pool.query(
        `insert into supervision_cases (id, organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target)
       select case_id, $1, person, team_id, 'Perf', 'Resumo', 'P3', 'TMA', '400', '380' from (${feedbackDays}) f`,
        [org, firstDay, LAST_DAY],
      )
      await pool.query(
        `insert into feedbacks (id, organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, published_at, acknowledged_at)
       select feedback_id, $1, case_id, person, 'PUBLISHED', (case when r % 2 = 0 then 'MONITORING' else 'INDICATOR' end)::feedback_kind, '—', '—', '—', '—', 'Texto.', published_at,
         case when account is not null and r < 50 then published_at + interval '5 hours' end
       from (${feedbackDays}) f`,
        [org, firstDay, LAST_DAY],
      )
      await pool.query(
        `insert into feedback_ratings (organization_id, person_id, source_kind, feedback_id, value, reason, comment, created_at)
       select $1, person, 'PUBLISHED_FEEDBACK', feedback_id, case when r % 3 = 0 then 'DOWN' else 'UP' end, case when r % 3 = 0 then 'UNCLEAR' end,
         case when r % 3 = 0 then 'Comentário sintético.' end, published_at + interval '4 hours'
       from (${feedbackDays}) f where account is not null and r < 35`,
        [org, firstDay, LAST_DAY],
      )
      await pool.query(
        `insert into feedback_read_confirmation_events (organization_id, person_id, account_id, source_kind, feedback_id, entry_point, attempt_id, event, failure_reason, already_confirmed, completed_application, device, occurred_at)
       select $1, person, account, 'PUBLISHED_FEEDBACK', feedback_id, 'FOLLOW_UP_FEED', md5('att' || feedback_id)::uuid, e, null,
         case when e = 'CONFIRMED' then false end, case when e = 'CONFIRMED' then false end, 'DESKTOP',
         published_at + interval '5 hours' - case when e = 'OPENED' then interval '30 seconds' else interval '0' end
       from (${feedbackDays}) f cross join unnest(array['OPENED', 'CONFIRMED']) e where account is not null and r < 50`,
        [org, firstDay, LAST_DAY],
      )
      await pool.query(
        `with f as (${feedbackDays}), ev as (
         select f.*, k, f.published_at + interval '1 hour' + make_interval(secs => k * 20) at_k, md5('fs' || f.feedback_id)::uuid session, md5('fi' || f.feedback_id)::uuid inst,
           md5('fd' || f.feedback_id)::uuid detail
         from f cross join generate_series(0, 3) k
         where f.account is not null and f.r < 85 and (k <= 1 or f.r < 60))
       insert into usage_events (${eventColumns})
       select $1, gen_random_uuid(),
         case when k = 0 then 'screen.viewed' when k = 1 then 'element.exposed' when k = 2 then 'screen.viewed' else 'content.scrolled' end, 1,
         case when k = 1 then 'ELEMENT' when k = 3 then 'SCROLL' else 'NAVIGATION' end,
         'CLIENT', 'HUMAN', account, person, case when k > 0 then person end, at_k, at_k, at_k + interval '2 seconds', 'OK', session, md5('ft' || feedback_id)::uuid,
         case when k <= 1 then inst else detail end,
         case when k <= 1 then 'my_profile.operator.followup' else 'feedback.detail' end,
         case when k <= 1 then 'followup' else 'feedback_read' end,
         case when k = 1 then 'feedback.card' end, '/operator', 'OPERATIONAL',
         case when k > 0 then 'PUBLISHED_FEEDBACK' end, case when k > 0 then feedback_id end,
         'DESKTOP', 'perf-1.0.0', 'test', 'REAL', team_id, subteam_id, reports_to_id,
         case
           when k = 0 then jsonb_build_object('kind', 'ROUTE', 'navigation', 'INITIAL', 'entry', true)
           when k = 1 then '{}'::jsonb
           when k = 2 then jsonb_build_object('kind', 'MODAL', 'navigation', 'OPEN', 'entry', false)
           else jsonb_build_object('contentKey', 'feedback.narrative', 'depth', 75, 'fitsViewport', false)
         end
       from ev`,
        [org, firstDay, LAST_DAY],
      )
    })

    // Conversas com a INIA: 20 % dos dias ativos, 2 perguntas (uma por voz em 30 %).
    await timed("conversas e mensagens", async () => {
      await pool.query(
        `insert into assistant_conversations (id, organization_id, owner_person_id, kind, status, origin, started_at, last_activity_at, closed_at, close_reason, created_at)
       select md5('c' || person || dia)::uuid, $1, person, 'CONVERSATION', 'CLOSED', 'USER', t0, t0 + interval '3 minutes', t0 + interval '1 day', 'INACTIVITY', t0
       from (${activeDays}) d where ${roll("'chat' || person::text || dia::text")} < 20`,
        [org, firstDay, LAST_DAY],
      )
      await pool.query(
        `insert into assistant_interactions (organization_id, operator_id, channel, role, content, conversation_id, occurred_at, created_at)
       select $1, person, case when ${roll("'voice' || person::text || dia::text")} < 30 and m >= 2 then 'voice' else 'chat' end,
         case when m % 2 = 0 then 'user' else 'assistant' end, '(conteúdo sintético)', md5('c' || person || dia)::uuid,
         t0 + make_interval(secs => 20 + m * 25), t0 + make_interval(secs => 20 + m * 25)
       from (${activeDays}) d cross join generate_series(0, 3) m where ${roll("'chat' || person::text || dia::text")} < 20`,
        [org, firstDay, LAST_DAY],
      )
    })

    // Workflows: 3 agendados por dia com fan-out para 300 pessoas (90 % concluídas, 5 % falhas, 5 % aguardando).
    await timed("execuções de Workflow (raízes + fan-out)", async () => {
      for (let index = 1; index <= 3; index += 1) {
        const workflow = (
          await pool.query<{ id: string }>(
            `insert into workflows (organization_id, name, trigger_config, draft_graph, active) values ($1, $2, '{"kind":"schedule"}', '{"nodes":[],"edges":[]}', true) returning id`,
            [org, `Perf · Workflow ${index}`],
          )
        ).rows[0]!.id
        const version = (await pool.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1, '{"nodes":[],"edges":[]}') returning id`, [workflow])).rows[0]!.id
        await pool.query(`update workflows set active_version_id = $2 where id = $1`, [workflow, version])
        await pool.query(
          `insert into workflow_enrollments (id, organization_id, workflow_id, version_id, current_node_id, status, scheduled_subject_id, scheduled_for, created_at, updated_at)
         select md5('root' || $3::uuid::text || d)::uuid, $1, $3::uuid, $4::uuid, 'end', 'completed', $5, (d::date + time '06:00') at time zone '${FIXTURE_TZ}',
           (d::date + time '06:00') at time zone '${FIXTURE_TZ}', (d::date + time '06:20') at time zone '${FIXTURE_TZ}'
         from generate_series($6::date, $2::date, interval '1 day') d`,
          [org, LAST_DAY, workflow, version, ids.people.vera, firstDay],
        )
        await pool.query(
          `with roots as (select md5('root' || $3::uuid::text || d)::uuid root, (d::date + time '06:00') at time zone '${FIXTURE_TZ}' at0 from generate_series($5::date, $2::date, interval '1 day') d),
          members as (select id person, row_number() over (order by id) n from people where organization_id = $1 and matricula like 'PERF-%')
         insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, scheduled_subject_id, scheduled_for, parent_enrollment_id, fan_out_node_id, created_at, updated_at)
         select $1, $3::uuid, $4::uuid, 'end', case when ${roll("root::text || person::text")} < 90 then 'completed' when ${roll("root::text || person::text")} < 95 then 'dead' else 'waiting' end,
           person, null, root, 'fan', at0 + interval '1 second', at0 + make_interval(secs => 60 + ${roll("person::text")} * 6)
         from roots cross join members where n <= 300`,
          [org, LAST_DAY, workflow, version, firstDay],
        )
      }
    })

    await pool.query(
      `insert into usage_projection_dirty (organization_id, person_id, local_date, marked_at)
     select distinct organization_id, actor_person_id, (occurred_at at time zone '${FIXTURE_TZ}')::date, $2::timestamptz from usage_events where organization_id = $1 and actor_person_id is not null
     on conflict (organization_id, person_id, local_date) do nothing`,
      [org, NOW],
    )
    // Estatísticas em dia (como em produção, depois do autovacuum): logo após a carga em massa, sem `analyze`, o planejador
    // escolhe laços aninhados sobre tabelas que acha vazias (segundos por consulta).
    for (const table of [
      "people",
      "user_accounts",
      "teams",
      "subteams",
      "access_role_assignments",
      "usage_events",
      "usage_projection_dirty",
      "usage_eligibility_periods",
      "usage_coverage",
      "supervision_cases",
      "feedbacks",
      "feedback_ratings",
      "feedback_read_confirmation_events",
      "assistant_conversations",
      "assistant_interactions",
      "workflows",
      "workflow_versions",
      "workflow_enrollments",
    ])
      await pool.query(`analyze ${table}`)
    const dirty = Number((await pool.query<{ n: number }>(`select count(*)::int n from usage_projection_dirty where organization_id = $1`, [org])).rows[0]!.n)
    const projectionStarted = performance.now()
    let projected = 0
    for (;;) {
      const result = await runActivityProjection(db, {
        now: NOW,
        batchSize: 500,
        maxBatches: 20,
      })
      projected += result.processed
      if (result.failed > 0) throw new Error(`projeção com ${result.failed} falha(s)`)
      if (result.processed === 0) break
    }
    const projectionSeconds = (performance.now() - projectionStarted) / 1000
    log(`  projeção de atividade: ${projected} pessoa-dia em ${projectionSeconds.toFixed(1)} s (${(projected / projectionSeconds).toFixed(0)} pessoa-dia/s; ${dirty} marcados)`)
    await pool.query(`analyze usage_sessions; analyze usage_person_days; analyze usage_screen_person_days; analyze usage_eligibility_periods`)
  }

  const counts = (
    await pool.query<Record<string, number>>(
      `select (select count(*)::int from people where organization_id = $1) people, (select count(*)::int from usage_events where organization_id = $1) events,
        (select count(*)::int from usage_sessions where organization_id = $1) sessions, (select count(*)::int from usage_person_days where organization_id = $1) person_days,
        (select count(*)::int from feedbacks where organization_id = $1) feedbacks, (select count(*)::int from assistant_interactions where organization_id = $1) messages,
        (select count(*)::int from workflow_enrollments where organization_id = $1) enrollments, (select count(*)::int from usage_events) events_all_orgs`,
      [org],
    )
  ).rows[0]!
  const version = (await pool.query<{ v: string }>(`select version() v`)).rows[0]!.v

  // Pessoa com mais dias ativos (detalhe individual).
  const busiest = (await pool.query<{ person_id: string }>(`select person_id from usage_person_days where organization_id = $1 group by 1 order by count(*) desc limit 1`, [org])).rows[0]!.person_id
  const access = await createPostgresAccessRepository(pool).loadContext(org, ids.accounts.vera)
  const lia = await createPostgresAccessRepository(pool).loadContext(org, ids.accounts.lia)
  const alan = await createPostgresAccessRepository(pool).loadContext(org, ids.accounts.alan)
  type Case = {
    label: string
    viewer?: typeof access
    viewerPerson?: string
    tab: UsabilityTab
    query?: Record<string, unknown>
    run: (ctx: Awaited<ReturnType<typeof buildUsabilityContext>>) => Promise<unknown>
  }
  const cases: Case[] = [
    {
      label: "Contexto (filtros/dicionário)",
      tab: "overview",
      run: (ctx) => contextQuery(pool, ctx),
    },
    {
      label: "Visão geral",
      tab: "overview",
      run: (ctx) => overviewQuery(pool, ctx),
    },
    {
      label: "Visão geral · leitor de agregados",
      viewer: lia,
      viewerPerson: ids.people.lia,
      tab: "overview",
      run: (ctx) => overviewQuery(pool, ctx),
    },
    {
      label: "Pessoas e acessos (lista)",
      tab: "people",
      run: (ctx) => peopleQuery(pool, ctx),
    },
    {
      label: "Pessoas e acessos · escopo de Grupo",
      viewer: alan,
      viewerPerson: ids.people.alan,
      tab: "people",
      run: (ctx) => peopleQuery(pool, ctx),
    },
    {
      label: "Pessoas · retenção semanal",
      tab: "people",
      run: (ctx) => retentionQuery(pool, ctx),
    },
    {
      label: "Telas e cliques",
      tab: "screens",
      run: (ctx) => screensQuery(pool, ctx),
    },
    {
      label: "Feedbacks e ciência",
      tab: "feedbacks",
      run: (ctx) => feedbacksQuery(pool, ctx),
    },
    {
      label: "INIA voz e texto",
      tab: "conversations",
      run: (ctx) => conversationsQuery(pool, ctx),
    },
    {
      label: "Workflows",
      tab: "workflows",
      run: (ctx) => workflowsQuery(pool, ctx),
    },
    {
      label: "Jornadas e dificuldades",
      tab: "journeys",
      run: (ctx) => journeysQuery(pool, ctx),
    },
    {
      label: "Qualidade da medição",
      tab: "quality",
      run: (ctx) => qualityQuery(pool, ctx),
    },
    {
      label: "Detalhe individual",
      tab: "person",
      run: (ctx) => personDetailQuery(pool, ctx, busiest),
    },
    {
      label: "Linha do tempo individual",
      tab: "person",
      run: (ctx) => personTimelineQuery(pool, ctx, busiest),
    },
    {
      label: `Visão geral · ${DAYS} dias (massa inteira)`,
      tab: "overview",
      query: { period: "CUSTOM", from: firstDay, to: LAST_DAY },
      run: (ctx) => overviewQuery(pool, ctx),
    },
    {
      label: `Pessoas · retenção · ${DAYS} dias (massa inteira)`,
      tab: "people",
      query: { period: "CUSTOM", from: firstDay, to: LAST_DAY },
      run: (ctx) => retentionQuery(pool, ctx),
    },
    {
      label: `Pessoas · ${DAYS} dias (massa inteira)`,
      tab: "people",
      query: { period: "CUSTOM", from: firstDay, to: LAST_DAY },
      run: (ctx) => peopleQuery(pool, ctx),
    },
  ]
  const percentile = (values: number[], q: number) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!
  }
  const rows: { label: string; p50: number; p95: number; max: number }[] = []
  for (const item of cases) {
    const samples: number[] = []
    for (let attempt = 0; attempt <= REPS; attempt += 1) {
      const started = performance.now()
      const ctx = await buildUsabilityContext(pool, {
        access: item.viewer ?? access,
        personId: item.viewerPerson ?? ids.people.vera,
        tab: item.tab,
        query: { period: "LAST_30_DAYS", ...item.query },
        now: NOW,
      })
      await item.run(ctx)
      if (attempt > 0) samples.push(performance.now() - started)
    }
    rows.push({
      label: item.label,
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      max: Math.max(...samples),
    })
  }

  log("")
  log(`Hardware: ${cpus()[0]?.model ?? "?"} · ${cpus().length} núcleos · ${(totalmem() / 1024 ** 3).toFixed(0)} GB · ${version.split(",")[0]}`)
  log(
    `Volume da organização: ${counts.people} pessoas · ${counts.events} eventos · ${counts.sessions} sessões · ${counts.person_days} pessoa-dia · ${counts.feedbacks} feedbacks · ${counts.messages} mensagens · ${counts.enrollments} execuções de Workflow (usage_events no banco inteiro: ${counts.events_all_orgs})`,
  )
  log(`Consultas (contexto + consulta, período LAST_30_DAYS salvo indicação, ${REPS} repetições após 1 aquecimento):`)
  log("| Consulta | p50 (ms) | p95 (ms) | máx. (ms) |")
  log("| --- | ---: | ---: | ---: |")
  for (const row of rows) log(`| ${row.label} | ${row.p50.toFixed(0)} | ${row.p95.toFixed(0)} | ${row.max.toFixed(0)} |`)
  const worst = rows.reduce((max, row) => Math.max(max, row.p95), 0)
  log(`Pior p95: ${worst.toFixed(0)} ms — meta de 2.000 ms ${worst <= 2000 ? "ATENDIDA" : "NÃO atendida"}.`)
} finally {
  // PERF_KEEP=1 mantém a massa para EXPLAIN (a próxima execução apaga os restos pelo slug da prova).
  if (process.env.PERF_KEEP || REUSE) log(`  massa mantida (PERF_KEEP/PERF_REUSE): organização ${org}`)
  else await timed("limpeza (pela organização da prova)", () => cleanupFixture(pool, ids))
  await pool.end()
}
