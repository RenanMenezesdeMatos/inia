/**
 * PROVA contra o banco de TESTE real: a posse da análise da IA por entrega (`claimAnalysis`, `claimNextAnalysis`,
 * `finishAnalysis`) vale entre PROCESSOS — dois pools (duas conexões cada, como duas instâncias do worker), cada instrução em
 * autocommit. Organização própria criada e apagada pela prova (o report apaga em cascata execuções e entregas). IA falsa. A
 * recuperação é global (como no worker): a prova recusa rodar se houver análise a recuperar de OUTRA organização no banco.
 * Testes em sequência: cada um deixa as suas entregas resolvidas.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run report-analysis-claim-proof
 */
import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { analyzeDelivery, retryPendingAnalyses, type AnalysisWriter } from "../application/report-analysis.js"
import { ANALYSIS_CLAIM_SECONDS, createPostgresReportStore, type ReportRecord, type ReportStore, type RunRecord } from "../application/report-store.js"
import { reportAnalysisSchema, reportDefinitionSchema, reportScheduleSchema, reportVisualizationSchema } from "../domain/report-definition.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let processA: pg.Pool
let processB: pg.Pool
let storeA: ReportStore
let storeB: ReportStore
let organizationId = ""
let report: ReportRecord
let run: RunRecord
let scope = 0

function card(label: string): QueryTableCard {
  return {
    type: "QUERY_TABLE", generatedAt: "2026-10-19T12:00:00.000Z", structure: { subject: { kind: "SUPERVISOR_TEAM", supervisorId: "x" }, label, description: null }, source: "OFFICIAL",
    title: `Pessoas — TMA (${label})`, scopeNote: "Competência oficial: 2026-09", period: "2026-09", indicatorCode: "TMA",
    columns: [{ key: "person", label: "Pessoa", numeric: false }, { key: "value", label: "Valor", numeric: true }],
    rows: [{ cells: { person: "Ana", value: "420 s" }, subject: null, personId: null }], totalRows: 1, highlights: [], methods: [], limitations: [],
  }
}

async function newDeliveries(count: number): Promise<string[]> {
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    scope += 1
    const label = `Equipe ${scope}`
    const saved = await storeA.insertDelivery({ organizationId, reportId: report.id, runId: run.id, configVersion: 1, scopeKey: `escopo-${scope}`, kind: "DELIVERY", reason: null, structureLabel: label, periodKey: "2026-09", periodLabel: "Setembro de 2026", sources: [], dataset: card(label), visualization: null, comparison: null, fingerprint: `f${scope}`, empty: false, analysisStatus: "PENDING" })
    ids.push(saved.delivery.id)
  }
  return ids
}

/** IA falsa e lenta (as duas instâncias ficam com chamadas em andamento ao mesmo tempo); registra a estrutura de cada chamada. */
function slowWriter(reply = "**Resumo** ok.") {
  const calls: string[] = []
  const writer: AnalysisWriter = async (input) => {
    calls.push(String((JSON.parse(input.user) as { estrutura: string }).estrutura))
    await new Promise((resolve) => setTimeout(resolve, 30))
    return reply
  }
  return { writer, calls }
}

const analysisOf = async (ids: string[]) =>
  (await processA.query<{ id: string; analysis_status: string; analysis_attempts: number; analysis_text: string | null }>(`select id, analysis_status, analysis_attempts, analysis_text from report_deliveries where id = any($1::uuid[])`, [ids])).rows

describe.skipIf(!ENABLED)("Posse da análise de report por entrega — prova Postgres (dois processos)", () => {
  beforeAll(async () => {
    processA = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 2 })
    processB = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 2 })
    const foreign = await processA.query<{ n: number }>(`select count(*)::int n from report_deliveries where kind = 'DELIVERY' and analysis_status in ('PENDING', 'FAILED')`)
    if (foreign.rows[0]!.n > 0) throw new Error(`Há ${foreign.rows[0]!.n} análise(s) de report a recuperar no banco de teste; a prova analisaria entregas de outros.`)
    storeA = createPostgresReportStore(processA)
    storeB = createPostgresReportStore(processB)
    const tag = randomUUID().slice(0, 8)
    const one = async (sql: string, params: unknown[]) => (await processA.query<{ id: string }>(sql, params)).rows[0]!.id
    organizationId = await one(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Prova Posse da Análise ${tag}`, `prova-report-analise-${tag}`])
    const personId = await one(`insert into people (organization_id, name, role, active) values ($1, 'Sara Supervisora', 'SUPERVISOR', true) returning id`, [organizationId])
    const accountId = await one(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'x') returning id`, [organizationId, personId, `sara-${tag}@prova-report-analise.test`])
    report = await storeA.createReport(
      {
        organizationId, ownerAccountId: accountId, ownerPersonId: personId, name: "Prova da posse da análise", description: null, status: "INACTIVE", origin: "SCREEN", timeZone: "America/Sao_Paulo", nextRunAt: null, sourceProposalId: null,
        definition: reportDefinitionSchema.parse({ tool: "INDICATOR_QUERY", structure: { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" }, indicators: ["TMA"] }),
        visualization: reportVisualizationSchema.parse({ type: "TABLE" }),
        schedule: reportScheduleSchema.parse({ frequency: "DAILY", times: ["08:00"] }),
        audience: { mode: "SELF" },
        analysis: reportAnalysisSchema.parse({ comparison: false }),
      },
      accountId,
    )
    run = (await storeA.enqueueRun({ organizationId, reportId: report.id, scheduledFor: new Date().toISOString(), triggerKind: "MANUAL", configVersion: 1 }))!
    await processA.query(`update report_runs set status = 'COMPLETED', finished_at = now() where id = $1`, [run.id])
  })

  afterAll(async () => {
    if (!processA) return
    if (organizationId) {
      await processA.query(`delete from reports where organization_id = $1`, [organizationId])
      await processA.query(`delete from user_accounts where organization_id = $1`, [organizationId])
      await processA.query(`delete from people where organization_id = $1`, [organizationId])
      await processA.query(`delete from organizations where id = $1`, [organizationId])
    }
    await Promise.all([processA.end(), processB.end()])
  })

  it("duas recuperações ao mesmo tempo, em processos diferentes: cada entrega chama a IA uma única vez", async () => {
    const ids = await newDeliveries(6)
    const ai = slowWriter()
    const [first, second] = await Promise.all([retryPendingAnalyses(storeA, ai.writer, { limit: 6 }), retryPendingAnalyses(storeB, ai.writer, { limit: 6 })])
    expect(first).toBeGreaterThan(0)
    expect(second).toBeGreaterThan(0)
    expect(first + second).toBe(6)
    expect(new Set(ai.calls).size).toBe(6)
    expect(ai.calls).toHaveLength(6)
    expect((await analysisOf(ids)).map((row) => [row.analysis_status, row.analysis_attempts])).toEqual(Array.from({ length: 6 }, () => ["READY", 1]))
  })

  it("20 reivindicações simultâneas da mesma entrega (10 por processo): exatamente uma ganha", async () => {
    const [id] = await newDeliveries(1)
    const claims = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? storeA : storeB).claimAnalysis(id!, "AUTOMATIC")))
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(await analysisOf([id!])).toEqual([expect.objectContaining({ analysis_status: "PENDING", analysis_attempts: 1 })])
    // Em análise: nem a recuperação nem o "Tentar de novo" pegam.
    expect(await storeB.claimNextAnalysis()).toBeNull()
    expect(await storeB.claimAnalysis(id!, "MANUAL")).toBeNull()
    expect(await storeA.finishAnalysis(id!, 1, "READY", "**Resumo** ok.", null)).toBe(true)
  })

  it("análise inicial (processo A) × recuperação (processo B) sobre a entrega recém-gravada: uma chamada", async () => {
    const [id] = await newDeliveries(1)
    const delivery = (await storeA.getDelivery(id!, organizationId))!
    const ai = slowWriter()
    await Promise.all([analyzeDelivery(storeA, ai.writer, delivery, report), retryPendingAnalyses(storeB, ai.writer, { limit: 1 })])
    expect(ai.calls).toHaveLength(1)
    expect(await analysisOf([id!])).toEqual([expect.objectContaining({ analysis_status: "READY", analysis_attempts: 1 })])
  })

  it("posse vencida e reivindicada por outro processo: a gravação atrasada é descartada (um FAILED não cobre o READY)", async () => {
    const [id] = await newDeliveries(1)
    const late = (await storeA.claimAnalysis(id!, "AUTOMATIC"))!
    // Prazo vencido sem resposta (a chamada do processo A demorou mais que o prazo).
    await processA.query(`update report_deliveries set analysis_updated_at = now() - make_interval(secs => $2) where id = $1`, [id, ANALYSIS_CLAIM_SECONDS + 60])
    const ai = slowWriter("**Resumo** do processo B.")
    expect(await retryPendingAnalyses(storeB, ai.writer, { limit: 1 })).toBe(1)
    expect(await storeA.finishAnalysis(id!, late.analysisAttempts, "FAILED", null, "429")).toBe(false)
    expect(await analysisOf([id!])).toEqual([expect.objectContaining({ analysis_status: "READY", analysis_attempts: 2, analysis_text: "**Resumo** do processo B." })])
  })

  it("'Tentar de novo' simultâneo nos dois processos sobre uma análise que falhou: uma chamada", async () => {
    const [id] = await newDeliveries(1)
    const claimed = (await storeA.claimAnalysis(id!, "AUTOMATIC"))!
    expect(await storeA.finishAnalysis(id!, claimed.analysisAttempts, "FAILED", null, "429")).toBe(true)
    const failed = (await storeA.getDelivery(id!, organizationId))!
    const ai = slowWriter("**Resumo** depois do clique.")
    await Promise.all([analyzeDelivery(storeA, ai.writer, failed, report, "MANUAL"), analyzeDelivery(storeB, ai.writer, failed, report, "MANUAL")])
    expect(ai.calls).toHaveLength(1)
    expect(await analysisOf([id!])).toEqual([expect.objectContaining({ analysis_status: "READY", analysis_attempts: 2 })])
  })

  it("'em análise' abandonada na última tentativa: a recuperação fecha como falha sem chamar a IA", async () => {
    const [id] = await newDeliveries(1)
    await processA.query(`update report_deliveries set analysis_attempts = 3, analysis_updated_at = now() - make_interval(secs => $2) where id = $1`, [id, ANALYSIS_CLAIM_SECONDS + 60])
    const ai = slowWriter()
    await retryPendingAnalyses(storeB, ai.writer, { limit: 10 })
    expect(ai.calls).toHaveLength(0)
    expect(await analysisOf([id!])).toEqual([expect.objectContaining({ analysis_status: "FAILED", analysis_attempts: 3 })])
  })
})
