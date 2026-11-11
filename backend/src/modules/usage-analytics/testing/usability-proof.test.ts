/**
 * PROVA contra o banco de TESTE real — Monitoria de usabilidade (migration 116). Organização PRÓPRIA, apagada no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run usability-proof
 *
 * Usa a massa determinística (usability-fixture*.ts): ingestão real do navegador, fatos de servidor reais, projeção real e as
 * MESMAS consultas da API/CSV. Os números esperados estão documentados em docs/dev/monitoria-usabilidade.md.
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { canAnywhere } from "../../access/domain/access-decision.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { runActivityProjection } from "../application/activity-projection.js"
import { projectOrganization } from "../application/eligibility-projection.js"
import { invalidateUsageSettings } from "../application/usage-settings.js"
import { runUsageRetention } from "../application/usage-retention.js"
import { conversationsQuery } from "../application/query/conversations-query.js"
import { feedbacksQuery } from "../application/query/feedbacks-query.js"
import { journeysQuery } from "../application/query/journeys-query.js"
import { overviewQuery } from "../application/query/overview-query.js"
import { peopleQuery } from "../application/query/people-query.js"
import { qualityQuery } from "../application/query/quality-query.js"
import { personDetailQuery } from "../application/query/person-query.js"
import { screensQuery } from "../application/query/screens-query.js"
import { assertAggregateCohort, buildUsabilityContext, OFFICIAL_SOURCE_MIGRATIONS } from "../application/query/usability-context.js"
import { buildUsabilityExport } from "../application/query/usability-export.js"
import type { UsabilityTab } from "../application/query/usability-filters.js"
import { workflowsQuery } from "../application/query/workflows-query.js"
import { COLLECTION_START, FIXTURE_NOW, cleanupFixture, cleanupLeftovers, seedFixtureBase, type FixtureIds } from "./usability-fixture.js"
import { IDS, ingest, seedFixtureEvents } from "./usability-fixture-events.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let ids: FixtureIds
const db = () => pool as unknown as Database
const PERIOD = { period: "CUSTOM", from: "2026-10-05", to: "2026-10-06" }

async function ctxFor(viewer: "vera" | "lia" | "alan", tab: UsabilityTab, query: Record<string, unknown> = {}) {
  const access = await createPostgresAccessRepository(pool).loadContext(ids.org, ids.accounts[viewer])
  return buildUsabilityContext(pool, { access, personId: ids.people[viewer], tab, query: { ...PERIOD, ...query }, now: FIXTURE_NOW })
}

async function project() {
  for (let round = 0; round < 20; round += 1) {
    const result = await runActivityProjection(db(), { now: FIXTURE_NOW, maxBatches: 20 })
    if (result.processed === 0 && result.failed === 0) return
  }
}

/**
 * Cada FONTE OFICIAL conta a partir da migration que criou a tabela (`schema_migrations.applied_at`). Num banco de teste recém-criado
 * as migrations são de hoje e o período da massa (outubro/2026) ficaria sem cobertura — "sem dados", como deve ser em produção. A
 * prova declara que as tabelas já existiam antes da coleta e devolve as datas originais no fim.
 */
let backdatedMigrations: { name: string; applied_at: Date }[] = []

describe.skipIf(!ENABLED)("Monitoria de usabilidade — prova Postgres", () => {
  let firstBatch: Awaited<ReturnType<typeof seedFixtureEvents>>

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    const before = new Date(COLLECTION_START.getTime() - 86_400_000)
    backdatedMigrations = (await pool.query<{ name: string; applied_at: Date }>(`select name, applied_at from schema_migrations where name = any($1::text[]) and applied_at > $2`, [Object.values(OFFICIAL_SOURCE_MIGRATIONS), before])).rows
    if (backdatedMigrations.length > 0) await pool.query(`update schema_migrations set applied_at = $2 where name = any($1::text[])`, [backdatedMigrations.map((row) => row.name), before])
    await cleanupLeftovers(pool)
    ids = await seedFixtureBase(pool)
    invalidateUsageSettings()
    await projectOrganization(pool, ids.org, COLLECTION_START)
    firstBatch = await seedFixtureEvents(pool, ids)
    await project()
  }, 120_000)

  afterAll(async () => {
    if (!pool) return
    if (ids) await cleanupFixture(pool, ids)
    for (const row of backdatedMigrations) await pool.query(`update schema_migrations set applied_at = $2 where name = $1`, [row.name, row.applied_at])
    await pool.end()
  })

  it("ingestão: tudo aceito; retentativa do mesmo lote não duplica; lote de outra conta é recusado", async () => {
    expect(firstBatch.results.every((result) => result.rejected === 0)).toBe(true)
    const again = await pool.query<{ n: number }>(`select count(*)::int n from usage_events where organization_id = $1`, [ids.org])
    // Reenvio com os MESMOS eventIds (retry): nada novo.
    const s1Ids = await pool.query<{ event_id: string; event_name: string; occurred_at: Date }>(`select event_id, event_name, occurred_at from usage_events where organization_id = $1 and usage_session_id = $2 order by occurred_at limit 3`, [ids.org, IDS.u1])
    const retryBody = { accountId: ids.accounts.ana, sentAt: "2026-10-05T12:37:00Z", appVersion: "prova-1.0.0", device: "DESKTOP", events: s1Ids.rows.map((row) => ({ eventId: row.event_id, name: "screen.viewed", schemaVersion: 1, occurredAt: row.occurred_at.toISOString(), usageSessionId: IDS.u1, tabId: IDS.t1, screenInstanceId: "11111111-1111-4111-8111-111111111111", screenKey: "home", elementKey: null, routeTemplate: "/", entity: null, correlationId: null, properties: { kind: "ROUTE", navigation: "NAVIGATION", entry: false } })) }
    const { ingestClientBatch } = await import("../application/ingest-client-events.js")
    const retry = await ingestClientBatch(pool, { organizationId: ids.org, accountId: ids.accounts.ana, personId: ids.people.ana }, retryBody, { transport: "FETCH", now: new Date("2026-10-05T12:37:00Z") })
    expect(retry).toMatchObject({ accepted: 0, duplicates: 3 })
    expect((await pool.query<{ n: number }>(`select count(*)::int n from usage_events where organization_id = $1`, [ids.org])).rows[0]!.n).toBe(again.rows[0]!.n)
    await expect(ingest(pool, ids, "ana", [], { receivedAt: "2026-10-06T18:00:00Z", accountOverride: ids.accounts.bruno }).catch((error: { code: string }) => Promise.reject(new Error(error.code)))).rejects.toThrow()
  })

  it("propriedade fora do esquema (ex.: senha) e entidade de outra organização são recusadas; nada sensível é gravado", async () => {
    const result = await ingest(pool, ids, "xavier", [{ name: "screen.viewed", at: "2026-10-06T12:00:00Z", tab: IDS.tX, session: IDS.uX, screen: "home", route: "/", instance: IDS.k1, props: { kind: "ROUTE", navigation: "NAVIGATION", entry: false, password: "segredo123" } }, { name: "element.exposed", at: "2026-10-06T12:00:01Z", tab: IDS.tX, session: IDS.uX, screen: "home", route: "/", instance: IDS.k1, element: "feedback.card", entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f1 } }], { receivedAt: "2026-10-06T12:00:10Z" })
    expect(result.rejections).toMatchObject({ INVALID_PROPERTIES: 1, ENTITY_NOT_FOUND: 1 })
    const leaked = await pool.query<{ n: number }>(`select count(*)::int n from usage_events where properties::text ilike '%segredo123%'`)
    expect(leaked.rows[0]!.n).toBe(0)
  })

  it("sessões: 3 telas + 10 cliques + reload + 2 abas = UM acesso; 46 min parado = nova sessão; outro dispositivo = outra sessão", async () => {
    const sessions = await pool.query<{ usage_session_id: string; seq: number; started_local_date: string; end_reason: string }>(`select usage_session_id, seq, to_char(started_local_date, 'YYYY-MM-DD') started_local_date, end_reason from usage_sessions where organization_id = $1 and person_id = $2 order by started_at`, [ids.org, ids.people.ana])
    expect(sessions.rows.map((row) => [row.usage_session_id === IDS.u0 ? "u0" : row.usage_session_id === IDS.u1 ? "u1" : "u2", row.seq, row.started_local_date])).toEqual([["u0", 0, "2026-10-04"], ["u1", 0, "2026-10-05"], ["u1", 1, "2026-10-05"], ["u2", 0, "2026-10-05"], ["u2", 1, "2026-10-06"]])
  })

  it("tempo ativo: abas simultâneas contam uma vez; meia-noite divide entre os dias", async () => {
    const days = await pool.query<{ local_date: string; active_seconds: number; sessions_started: number; sessions_active: number }>(`select to_char(local_date, 'YYYY-MM-DD') local_date, active_seconds, sessions_started, sessions_active from usage_person_days where organization_id = $1 and person_id = $2 order by local_date`, [ids.org, ids.people.ana])
    expect(days.rows).toEqual([
      { local_date: "2026-10-04", active_seconds: 0, sessions_started: 1, sessions_active: 1 },
      { local_date: "2026-10-05", active_seconds: 100, sessions_started: 3, sessions_active: 3 },
      { local_date: "2026-10-06", active_seconds: 20, sessions_started: 1, sessions_active: 2 },
    ])
  })

  it("visão geral: pessoas únicas no intervalo (nunca soma de DAU), adoção com base, demonstração fora por padrão", async () => {
    const data = await overviewQuery(db(), await ctxFor("vera", "overview"))
    const kpi = (metric: string) => data.kpis.find((item) => item.metric === metric)!
    expect(kpi("activity.active_people")).toMatchObject({ status: "VALUE", value: 2 })
    expect(kpi("population.eligible_period")).toMatchObject({ value: 6 })
    expect(kpi("activity.adoption_rate")).toMatchObject({ numerator: 2, denominator: 6, value: 33.3 })
    expect(kpi("activity.eligible_inactive")).toMatchObject({ value: 4 })
    expect(kpi("activity.engaged_people")).toMatchObject({ value: 2 })
    expect(kpi("sessions.started")).toMatchObject({ value: 4 })
    expect(kpi("auth.logins")).toMatchObject({ value: 1 })
    expect(data.series.map((row) => [row.date, row.dau])).toEqual([["2026-10-05", 2], ["2026-10-06", 1]])
    expect(data.series.reduce((sum, row) => sum + (row.dau ?? 0), 0)).toBe(3)
    expect(data.population).toMatchObject({ noAccount: 1, accountDisabled: 1, away: 1, terminated: 1 })
    const withDemo = await overviewQuery(db(), await ctxFor("vera", "overview", { includeDemo: "1" }))
    expect(withDemo.kpis.find((item) => item.metric === "activity.active_people")!.value).toBe(3)
  })

  it("antes da coleta = sem dados (nunca zero); comparação de mesma duração", async () => {
    const before = await overviewQuery(db(), await ctxFor("vera", "overview", { from: "2026-09-01", to: "2026-09-02" }))
    expect(before.kpis.find((item) => item.metric === "activity.active_people")).toMatchObject({ status: "NO_DATA", value: null })
    const data = await overviewQuery(db(), await ctxFor("vera", "overview"))
    expect(data.meta.comparison).toMatchObject({ fromDate: "2026-10-03", toDate: "2026-10-04" })
  })

  it("pessoas: segmentos com predicado único (sem conta fora da base de habilitadas; nunca acessou só com cobertura)", async () => {
    const data = await peopleQuery(db(), await ctxFor("vera", "people", { segment: "ELIGIBLE_INACTIVE" }))
    expect(data.counts).toMatchObject({ ACTIVE: 2, ELIGIBLE: 6, ELIGIBLE_INACTIVE: 4, NEVER_SINCE_ENABLED: 1, NO_RECORD_SINCE_COLLECTION: 3, FIRST_ACCESS: 1, NO_ACCOUNT: 1, ACCOUNT_DISABLED: 1, AWAY: 1, TERMINATED: 1 })
    expect(data.items!.map((row) => row.name).sort()).toEqual(["Alan Analista", "Bruno Prova", "Gabi Prova", "Lia Leitora"])
    const never = await peopleQuery(db(), await ctxFor("vera", "people", { segment: "NEVER_SINCE_ENABLED" }))
    expect(never.items!.map((row) => row.name)).toEqual(["Gabi Prova"])
  })

  it("CSV = API: mesmo recorte, mesmo total e mesma linha de métrica", async () => {
    const ctx = await ctxFor("vera", "people", { segment: "ELIGIBLE_INACTIVE" })
    const api = await peopleQuery(db(), ctx)
    const csv = await buildUsabilityExport(db(), ctx, "people", "people")
    expect(csv.rows).toBe(api.total)
    const overviewCtx = await ctxFor("vera", "overview")
    const overviewCsv = await buildUsabilityExport(db(), overviewCtx, "overview", "kpis")
    expect(overviewCsv.csv).toContain("Pessoas ativas;Pessoas com ao menos uma tela")
    expect(overviewCsv.csv).toMatch(/Adoção no período;[^\r\n]*;VALUE;33,3;2;6;/)
  })

  it("feedbacks: coorte com exposição/abertura/ciência por fonte; avaliação vigente muda com o corte (UP→DOWN→NONE)", async () => {
    const week = await feedbacksQuery(db(), await ctxFor("vera", "feedbacks"))
    expect(week.cohort.counts).toMatchObject({ AVAILABLE: 4, EXPOSED: 3, OPENED: 2, ACKED: 1, PENDING_ACK: 3, APPLICATION_STARTED: 1, ACK_OUTSIDE_APPLICATION: 1, NOT_EXPOSED: 1, RATED: 0 })
    expect(week.cohort.ratings).toMatchObject({ up: 0, down: 0, withdrawn: 1 })
    expect(week.meta.cohort.immature).toBe(4)
    const oneDay = await feedbacksQuery(db(), await ctxFor("vera", "feedbacks", { cohortWindow: "1" }))
    expect(oneDay.cohort.ratings).toMatchObject({ up: 0, down: 1, withdrawn: 0 })
    expect(oneDay.cohort.rates.useful).toMatchObject({ numerator: 0, denominator: 1, value: 0 })
    expect(week.volume).toMatchObject({ rating_up: 1, rating_down: 1, rating_withdrawn: 1, confirmations: 1, repeated_confirmations: 1 })
    expect(week.confirmation).toMatchObject({ attempts: 2, failures: 1, withFailure: 1, recovered: 1, confirmedNew: 1, confirmedIdempotent: 1 })
    expect(week.reasons).toEqual([expect.objectContaining({ reason: "UNCLEAR", count: 1 })])
  })

  it("feedback de outro TIPO com o mesmo id não se mistura (entidade validada pelo tipo)", async () => {
    const result = await ingest(pool, ids, "ana", [{ name: "element.exposed", at: "2026-10-06T17:00:30Z", tab: IDS.t3, session: IDS.u2, screen: "my_profile.operator.followup", route: "/operator", instance: IDS.kRate, element: "feedback.card", entity: { type: "INTERACTION_FEEDBACK_DELIVERY", id: ids.feedbacks.f1 } }], { receivedAt: "2026-10-06T17:01:00Z" })
    expect(result.rejections).toMatchObject({ ENTITY_NOT_FOUND: 1 })
  })

  it("INIA voz × texto: entrada humana separada da saída; reconexão não cria conversa; conexão sem fala não conta como fala; proativa não é participação", async () => {
    const data = await conversationsQuery(db(), await ctxFor("vera", "conversations"))
    expect(data.people).toEqual({ used: 1, text: 1, voice: 1, both: 1 })
    expect(data.messages).toMatchObject({ userText: 1, userVoiceTurns: 2, iniaText: 1, iniaVoice: 2, proactive: 1 })
    expect(data.conversations).toMatchObject({ created: 3, withHumanParticipation: 2, textOnly: 0, voiceOnly: 1, mixed: 1 })
    expect(data.voice).toMatchObject({ intents: 2, established: 2, withSpeech: 1, withoutSpeech: 1, reconnections: 1, connectedSeconds: 770, micSeconds: 30, playbackSeconds: 15 })
    expect(data.responseRate).toMatchObject({ eligible: 3, answered: 3, value: 100 })
    expect(data.chatUi).toMatchObject({ panelViews: 2, openedWithoutMessage: 1, attempted: 1, persistedAck: 1 })
  })

  it("workflows: raiz com 10 filhos e retries = 1 disparo; solicitante ≠ sujeito; abertas fora do p95; custo atribuído pela raiz", async () => {
    const data = await workflowsQuery(db(), await ctxFor("vera", "workflows"))
    expect(data.totalRoots).toBe(3)
    const w1 = data.ranking.find((row) => row.workflowId === ids.workflows.w1)!
    expect(w1).toMatchObject({ roots: 2, children: 10, peopleReached: 2, completed: 1, failed: 1, byOrigin: { MANUAL: 1, SCHEDULE: 1, INTERACTION: 0, INDICATOR: 0 } })
    expect(w1.failureRate).toMatchObject({ numerator: 1, denominator: 2, value: 50 })
    expect(w1.duration.median).toBe(299)
    expect(w1.results).toMatchObject({ feedbacksDelivered: 1, feedbacksOpened: 1 })
    expect(w1.cost[0]).toMatchObject({ currency: "USD", perRoot: "0.010000" })
    expect(w1.manualRequesters).toEqual([expect.objectContaining({ name: "Vera Gestora", runs: 1 })])
    const w2 = data.ranking.find((row) => row.workflowId === ids.workflows.w2)!
    expect(w2).toMatchObject({ roots: 1, waiting: 1, duration: { median: null } })
    expect(data.humanReviews).toMatchObject({ requested: 1, pending: 1 })
    expect(data.withoutExecution.map((row) => row.workflowId)).toContain(ids.workflows.w3)
    const root = data.items!.find((row) => row.rootId === ids.roots.r1)!
    expect(root).toMatchObject({ requesterName: "Vera Gestora", subjectName: "Ana Prova", children: 10 })
  })

  it("jornadas: cada funil correlaciona a MESMA entidade", async () => {
    const data = await journeysQuery(db(), await ctxFor("vera", "journeys"))
    const reached = (key: string) => data.funnels.find((funnel) => funnel.key === key)!.steps.map((step) => step.reached)
    expect(reached("ENTRY_TO_RATING")).toEqual([4, 3, 1, 1])
    expect(reached("FEEDBACK_ACK")).toEqual([4, 3, 2, 1])
    expect(reached("CHAT")).toEqual([2, 1, 1])
    expect(reached("VOICE")).toEqual([2, 2, 2, 1, 1])
    expect(reached("MANUAL_WORKFLOW")).toEqual([1, 1, 1, 1, 1])
    expect(reached("NOTIFICATION")).toEqual([1, 1, 1, 1])
    expect(reached("INVITE_TO_ACK")).toEqual([1, 1, 1, 1, 0])
    expect(data.signals.find((signal) => signal.key === "RAGE_CLICK")).toMatchObject({ value: 1 })
  })

  it("telas e elementos: visualização canônica, exposição × acionamento", async () => {
    const data = await screensQuery(db(), await ctxFor("vera", "screens"))
    expect(data.totalViews).toBe(12)
    expect(data.screens.find((row) => row.screenKey === "my_profile.operator.followup")).toMatchObject({ views: 5, people: 1 })
    expect(data.elements.find((row) => row.elementKey === "notifications.item")).toMatchObject({ exposureMeasured: true, exposedPeople: 1, activationRate: 100 })
    expect(data.elements.find((row) => row.elementKey === "feedback.card")).toMatchObject({ exposureMeasured: true, activations: 0, activationRate: 0 })
  })

  it("escopo: analista do Grupo B só vê o Grupo B; detalhe de quem está fora = 404", async () => {
    const data = await peopleQuery(db(), await ctxFor("alan", "people"))
    expect(data.items!.map((row) => row.name).sort()).toEqual(["Alan Analista", "Bruno Prova"])
    await expect(personDetailQuery(db(), await ctxFor("alan", "person"), ids.people.ana)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("agregados sem identificação: leitora não recebe nomes/ids, nem detalhe, nem exportação", async () => {
    const data = await peopleQuery(db(), await ctxFor("lia", "people"))
    expect(data.items).toBeNull()
    expect(JSON.stringify(data)).not.toContain(ids.people.ana)
    await expect(personDetailQuery(db(), await ctxFor("lia", "person"), ids.people.ana)).rejects.toMatchObject({ statusCode: 403 })
    expect((await ctxFor("lia", "people")).can.export).toBe(false)
    await expect(ctxFor("lia", "people", { personId: ids.people.ana })).rejects.toMatchObject({ statusCode: 403 })
  })

  it("leitora só de agregados: recorte com menos de 5 pessoas não mostra números; cargo e situação ficam reservados (C18, 4ª auditoria)", async () => {
    // Organização inteira: recorte grande, segue normal.
    await expect(assertAggregateCohort(db(), await ctxFor("lia", "overview"))).resolves.toBeUndefined()
    // Grupo B (poucas pessoas): recusado com o motivo, sem número nenhum.
    await expect(assertAggregateCohort(db(), await ctxFor("lia", "overview", { teamId: ids.teamB }))).rejects.toMatchObject({ code: "USABILITY_SMALL_COHORT", statusCode: 422 })
    // Filtros que isolam pessoas (cargo único, papel, situação) são da permissão de pessoas identificadas.
    for (const query of [{ jobTitle: "Gestão" }, { accessRole: "ANALISTA_DE_USABILIDADE" }, { personStatus: "AWAY" }, { accountStatus: "DISABLED" }]) {
      await expect(ctxFor("lia", "overview", query)).rejects.toMatchObject({ code: "USABILITY_PEOPLE_FORBIDDEN" })
    }
    // A leitora lê pela estrutura atual (o recorte contado é o mesmo dos números).
    expect((await ctxFor("lia", "overview", { structureMode: "AT_FACT" })).filters.structureMode).toBe("CURRENT")
    // Quem vê pessoas identificadas não muda: o mesmo Grupo B passa, e os filtros continuam.
    await expect(assertAggregateCohort(db(), await ctxFor("vera", "overview", { teamId: ids.teamB }))).resolves.toBeUndefined()
    expect((await ctxFor("vera", "overview", { jobTitle: "Gestão" })).filters.jobTitle).toBe("Gestão")
  })

  it("leitora só de agregados não reconstrói recorte pequeno por diferença: Organização − Grupo A ≠ Grupo B (desvio do C18, 2ª rodada)", async () => {
    // Grupo B (Alan, Bruno) continua recusado sozinho…
    await expect(assertAggregateCohort(db(), await ctxFor("lia", "conversations", { teamId: ids.teamB }))).rejects.toMatchObject({ code: "USABILITY_SMALL_COHORT" })
    // …e a organização e o Grupo A, ambos permitidos, não diferem mais em nada: as células com menos de 5 pessoas saem dos dois.
    for (const tab of ["conversations", "overview"] as const) {
      const org = await ctxFor("lia", tab)
      const teamA = await ctxFor("lia", tab, { teamId: ids.teamA })
      await expect(assertAggregateCohort(db(), org)).resolves.toBeUndefined()
      await expect(assertAggregateCohort(db(), teamA)).resolves.toBeUndefined()
      const strip = (data: { meta: unknown }) => ({ ...data, meta: undefined })
      if (tab === "conversations") {
        const [whole, partial] = [await conversationsQuery(db(), org), await conversationsQuery(db(), teamA)]
        expect(whole.messages.proactive).toBe(partial.messages.proactive)
        expect(strip(whole)).toEqual(strip(partial))
      } else {
        expect(strip(await overviewQuery(db(), org))).toEqual(strip(await overviewQuery(db(), teamA)))
      }
    }
    // Quem vê pessoas identificadas continua vendo o Bruno (recado proativo) no total da organização.
    const vera = await conversationsQuery(db(), await ctxFor("vera", "conversations"))
    expect(vera.messages.proactive).toBe(1)
  })

  it("afastamento sensível sai como AFASTAMENTO_PROTEGIDO na lista, no detalhe e no CSV; o filtro de afastados continua valendo (C04, 4ª auditoria)", async () => {
    await pool.query(`update people set current_employment_status = 'INSS' where id = $1`, [ids.people.diego])
    try {
      const ctx = await ctxFor("vera", "people", { segment: "AWAY" })
      const away = await peopleQuery(db(), ctx)
      expect(away.items!.map((row) => [row.name, row.employmentStatus])).toEqual([["Diego Prova", "AFASTAMENTO_PROTEGIDO"]])
      const detail = await personDetailQuery(db(), await ctxFor("vera", "person"), ids.people.diego)
      expect(detail.person.employmentStatus).toBe("AFASTAMENTO_PROTEGIDO")
      const csv = await buildUsabilityExport(db(), ctx, "people", "people")
      expect(csv.csv).toContain("AFASTAMENTO_PROTEGIDO")
      expect(csv.csv).not.toMatch(/INSS|MATERNIDADE|PATERNIDADE/)
      // Situação que não é sensível continua como veio.
      await pool.query(`update people set current_employment_status = 'FERIAS' where id = $1`, [ids.people.diego])
      expect((await peopleQuery(db(), ctx)).items!.map((row) => row.employmentStatus)).toEqual(["FERIAS"])
    } finally {
      await pool.query(`update people set current_employment_status = 'FERIAS' where id = $1`, [ids.people.diego])
    }
  })

  it("detalhe individual é auditado e não traz conteúdo", async () => {
    const data = await personDetailQuery(db(), await ctxFor("vera", "person"), ids.people.ana)
    expect(data.totals).toMatchObject({ activeDays: 2, sessionsStarted: 4, activeSeconds: 120 })
    const audit = await pool.query<{ n: number }>(`select count(*)::int n from audit_logs where organization_id = $1 and action = 'USABILITY_PERSON_VIEWED' and entity_id = $2`, [ids.org, ids.people.ana])
    expect(audit.rows[0]!.n).toBeGreaterThan(0)
  })

  it("outra organização nunca aparece; revogação remove o acesso efetivo", async () => {
    const data = await peopleQuery(db(), await ctxFor("vera", "people", { includeDemo: "1", includeTest: "1" }))
    expect(JSON.stringify(data)).not.toContain(ids.people.xavier)
    await pool.query(`update access_role_assignments set revoked_at = now() where id = $1`, [ids.assignments.alan])
    const revoked = await createPostgresAccessRepository(pool).loadContext(ids.org, ids.accounts.alan)
    expect(canAnywhere(revoked, "usability.view")).toBe(false)
    await expect(ctxFor("alan", "people")).rejects.toMatchObject({ statusCode: 403 })
  })

  it("evento TARDIO corrige o dia do fato (não o dia do recebimento), sem duplicar", async () => {
    const before = await pool.query<{ screen_views: number }>(`select screen_views from usage_person_days where organization_id = $1 and person_id = $2 and local_date = '2026-10-05'`, [ids.org, ids.people.ana])
    const late = await ingest(pool, ids, "ana", [{ name: "screen.viewed", at: "2026-10-05T12:30:00Z", tab: IDS.t1, session: IDS.u1, screen: "home", route: "/", instance: IDS.kRate, props: { kind: "ROUTE", navigation: "NAVIGATION", entry: false } }], { receivedAt: "2026-10-06T18:00:00Z" })
    expect(late.accepted).toBe(1)
    expect((await pool.query<{ timestamp_status: string }>(`select timestamp_status from usage_events where organization_id = $1 and occurred_at = '2026-10-05T12:30:00Z' and received_at = '2026-10-06T18:00:00Z'`, [ids.org])).rows[0]!.timestamp_status).toBe("LATE")
    await project()
    const after = await pool.query<{ screen_views: number }>(`select screen_views from usage_person_days where organization_id = $1 and person_id = $2 and local_date = '2026-10-05'`, [ids.org, ids.people.ana])
    expect(after.rows[0]!.screen_views).toBe(before.rows[0]!.screen_views + 1)
  })

  it("retenção remove só eventos brutos expirados; fatos, marcos e dados de negócio continuam", async () => {
    await runUsageRetention(pool, new Date("2027-02-01T12:00:00Z"))
    const count = async (sql: string) => (await pool.query<{ n: number }>(sql, [ids.org])).rows[0]!.n
    expect(await count(`select count(*)::int n from usage_events where organization_id = $1`)).toBe(0)
    expect(await count(`select count(*)::int n from usage_person_days where organization_id = $1`)).toBeGreaterThan(0)
    expect(await count(`select count(*)::int n from usage_person_milestones where organization_id = $1 and first_observed_at is not null`)).toBeGreaterThan(0)
    expect(await count(`select count(*)::int n from feedback_ratings where organization_id = $1`)).toBe(3)
    expect(await count(`select count(*)::int n from assistant_interactions where organization_id = $1`)).toBe(7)
    // A execução de retenção é da instalação: a Qualidade mostra só o detalhe da organização de quem consulta.
    const quality = await qualityQuery(pool, await ctxFor("vera", "quality"))
    const retention = quality.projection.runs.find((item) => item.kind === "RETENTION")
    expect(retention?.details).toMatchObject({ events: expect.any(Number) })
    expect(JSON.stringify(quality.projection.runs)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/)
  })
})
