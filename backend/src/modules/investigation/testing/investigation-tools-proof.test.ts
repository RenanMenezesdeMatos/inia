import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "../../../config/env.js"
import { HandleRegistry } from "../domain/handle-registry.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { findTool } from "../domain/tool-catalog.js"
import { executeTool } from "../application/tool-executor.js"
import { loadSubject, type ToolContext, defaultInvestigationToolState } from "../application/tool-context.js"

/**
 * PROVA no banco de TESTE real das Tools de investigação (migrations aplicadas, inclusive 074):
 * escopo de organização, indicador inválido, população/privacidade, amostra e cobertura mínimas,
 * dimensão não suportada, semânticas diferentes (média ponderada em segundos, taxa em %, soma de
 * contagem, média ponderada em %), oficial lido como fornecido, interações/flags/comparáveis,
 * jornada, KB e materiais. Tudo dentro de uma transação revertida ao final.
 *
 *   INIA_DB_PROOF=1 npx vitest run investigation-tools-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATION = "00000000-0000-4000-8000-000000000010"
const OTHER_ORG = "7c0000ff-0000-4000-8000-000000000000"
const id = (n: number) => `7c000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const TZ = "America/Fortaleza"
const NOW = new Date("2026-09-17T15:00:00Z")

let pool: pg.Pool
let client: pg.PoolClient
const db = () => client as unknown as Database

const TEAM = id(900)
const SUBTEAM = id(901)
const SMALL_SUBTEAM = id(902)
const AGENT = id(903)
const KB_DOC = id(904)
const SUBJECT = id(10)
const PEERS = [11, 12, 13, 14, 15].map(id)
const SMALL_SUBJECT = id(20)
const SMALL_PEERS = [21, 22].map(id)
const OUTSIDER = id(30)
const INDICATORS = { TMA: id(950), QUALIDADE: id(951), PRODUCAO: id(952), ABS: id(953) }

/** Dias úteis de setembro/2026 (fallback seg–sex): 01..16 = 12 dias úteis. */
const SEPTEMBER_BUSINESS_DAYS = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14", "2026-09-15", "2026-09-16"]
const AUGUST_BUSINESS_DAYS = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-31"]

async function insertPerson(personId: string, name: string, role: string, teamId: string | null, subteamId: string | null, organizationId = ORG) {
  await client.query(`insert into people (id, organization_id, name, role, team_id, subteam_id, active, hired_at) values ($1, $2, $3, $4, $5, $6, true, '2020-01-01')`, [personId, organizationId, name, role, teamId, subteamId])
}

async function insertIndicator(indicatorId: string, code: string, unit: string, direction: string, aggregation: string, extra: { minimumSampleSize?: number; minimumCoverage?: number; absencePolicy?: string } = {}) {
  await client.query(
    `insert into indicator_definitions (id, organization_id, code, name, unit, desired_direction, operational_aggregation, daily_supported, minimum_sample_size, minimum_coverage, official_closure_supported, unjustified_absence_policy)
     values ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, true, $10)`,
    [indicatorId, ORG, code, `Prova ${code}`, unit, direction, aggregation, extra.minimumSampleSize ?? null, extra.minimumCoverage ?? null, extra.absencePolicy ?? "NO_SAMPLE"],
  )
}

async function insertDaily(indicatorId: string, personId: string, day: string, value: number, numerator: number | null, denominator: number | null, sampleCount: number | null = null) {
  await client.query(
    `insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator, sample_count)
     values ($1, $2, 'PERSON', $3, $4, $5::timestamptz, $5::timestamptz + interval '1 day', 'PROVA_TOOLS', 'DAILY', $6, $7, $8)`,
    [ORG, indicatorId, personId, value, `${day}T03:00:00Z`, numerator, denominator, sampleCount],
  )
}

let interactionSequence = 0
async function insertInteraction(personId: string, day: string, hour: string, reason: string, durationSeconds: number, flags: Record<string, boolean | number>, transcript: string | null) {
  interactionSequence += 1
  const interactionId = id(5000 + interactionSequence)
  await client.query(
    `insert into interactions (id, organization_id, operator_id, reason, channel, started_at, ended_at, external_id) values ($1, $2, $3, $4, 'VOICE', $5::timestamptz, $5::timestamptz + ($6 || ' seconds')::interval, $7)`,
    [interactionId, ORG, personId, reason, `${day}T${hour}:00-03:00`, String(durationSeconds), `PROVA-TOOLS-${interactionSequence}`],
  )
  for (const [flag, value] of Object.entries(flags)) {
    const flagRow = await client.query<{ id: string }>(`select id from channel_flags where organization_id = $1 and flag_name = $2`, [ORG, flag])
    if (!flagRow.rows[0]) continue
    await client.query(`insert into interaction_flags (organization_id, interaction_id, channel_flag_id, value_boolean, value_numeric) values ($1, $2, $3, $4, $5)`, [ORG, interactionId, flagRow.rows[0].id, typeof value === "boolean" ? value : null, typeof value === "number" ? value : null])
  }
  if (transcript) await client.query(`insert into transcripts (organization_id, interaction_id, version, content) values ($1, $2, 1, $3)`, [ORG, interactionId, transcript])
  return interactionId
}

async function context(operatorId = SUBJECT, extra: { interactionId?: string | null; indicatorCode?: string | null } = {}): Promise<ToolContext> {
  const subject = await loadSubject(db(), ORG, operatorId, extra)
  return {
    db: db(),
    organizationId: ORG,
    agentId: AGENT,
    now: NOW,
    timeZone: TZ,
    subject,
    defaultPeriod: { start: new Date("2026-09-01T03:00:00Z"), end: new Date("2026-09-17T03:00:00Z"), label: "2026-09-01 a 2026-09-16" },
    workdayCache: new Map(),
    knowledgeCandidates: new Map(),
    collectedFacts: [],
    telemetry: { requests: [] },
    handles: new HandleRegistry(),
    investigation: defaultInvestigationToolState(),
  }
}

const run = (ctx: ToolContext, key: string, args: unknown) => executeTool(ctx, findTool(key)!, args)

describe.skipIf(!ENABLED)("Tools de investigação (banco real)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
    await client.query("set local statement_timeout = '20s'")
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await client.query(`insert into organizations (id, name, slug) values ($1, 'Prova Outra Org Tools', 'prova-outra-org-tools')`, [OTHER_ORG])
    await client.query(`insert into teams (id, organization_id, operation_id, name) values ($1, $2, $3, 'Prova Grupo Tools')`, [TEAM, ORG, OPERATION])
    await client.query(`insert into subteams (id, organization_id, team_id, name) values ($1, $2, $3, 'Prova Subgrupo Tools'), ($4, $2, $3, 'Prova Subgrupo Pequeno')`, [SUBTEAM, ORG, TEAM, SMALL_SUBTEAM])
    await insertPerson(SUBJECT, "Prova Operadora", "OPERATOR", TEAM, SUBTEAM)
    for (const [index, peer] of PEERS.entries()) await insertPerson(peer, `Prova Par ${index + 1}`, "OPERATOR", TEAM, SUBTEAM)
    await insertPerson(SMALL_SUBJECT, "Prova Operador Pequeno", "OPERATOR", TEAM, SMALL_SUBTEAM)
    for (const [index, peer] of SMALL_PEERS.entries()) await insertPerson(peer, `Prova Par Pequeno ${index + 1}`, "OPERATOR", TEAM, SMALL_SUBTEAM)
    await insertPerson(OUTSIDER, "Prova Outsider", "OPERATOR", null, null, OTHER_ORG)

    await insertIndicator(INDICATORS.TMA, "PROVA_TMA", "SECONDS", "LOWER", "WEIGHTED_AVERAGE", { minimumCoverage: 0.6 })
    await insertIndicator(INDICATORS.QUALIDADE, "PROVA_QUALIDADE", "PERCENT", "HIGHER", "WEIGHTED_AVERAGE", { minimumSampleSize: 3 })
    await insertIndicator(INDICATORS.PRODUCAO, "PROVA_PRODUCAO", "COUNT", "HIGHER", "SUM", { absencePolicy: "ZERO_CONTRIBUTION" })
    await insertIndicator(INDICATORS.ABS, "PROVA_ABS", "PERCENT", "LOWER", "RATE", { minimumCoverage: 0.5 })
    await client.query(`insert into goals (organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from) values ($1, $2, 'TEAM', $3, 400, '2026-01-01')`, [ORG, INDICATORS.TMA, TEAM])

    // TMA da operadora: 12 dias úteis de setembro, total ÷ contatos; 3ª semana (14–16) mais alta; dia 10 = pico.
    for (const [index, day] of SEPTEMBER_BUSINESS_DAYS.entries()) {
      const calls = 20
      const seconds = day === "2026-09-10" ? 900 : index >= 9 ? 520 : 420
      await insertDaily(INDICATORS.TMA, SUBJECT, day, seconds, seconds * calls, calls)
    }
    // Agosto (referência): 380 s em todos os dias úteis.
    for (const day of AUGUST_BUSINESS_DAYS) await insertDaily(INDICATORS.TMA, SUBJECT, day, 380, 380 * 20, 20)
    // Pares: 400 s por dia em setembro.
    for (const peer of PEERS) for (const day of SEPTEMBER_BUSINESS_DAYS) await insertDaily(INDICATORS.TMA, peer, day, 400, 400 * 20, 20)
    // Subgrupo pequeno: também com dado, mas população insuficiente para comparar.
    for (const person of [SMALL_SUBJECT, ...SMALL_PEERS]) for (const day of SEPTEMBER_BUSINESS_DAYS.slice(0, 5)) await insertDaily(INDICATORS.TMA, person, day, 450, 450 * 10, 10)
    // Qualidade: só 2 avaliações (mínimo 3).
    await insertDaily(INDICATORS.QUALIDADE, SUBJECT, "2026-09-02", 80, 80, 1, 1)
    await insertDaily(INDICATORS.QUALIDADE, SUBJECT, "2026-09-09", 90, 90, 1, 1)
    // Produção: soma de contatos por dia (25 dias × 20 = 240 no total dos 12 dias).
    for (const day of SEPTEMBER_BUSINESS_DAYS) await insertDaily(INDICATORS.PRODUCAO, SUBJECT, day, 20, null, null)
    // Absenteísmo (taxa): 3 ocorrências em 12 dias elegíveis → 25%.
    for (const [index, day] of SEPTEMBER_BUSINESS_DAYS.entries()) await insertDaily(INDICATORS.ABS, SUBJECT, day, index < 3 ? 100 : 0, index < 3 ? 1 : 0, 1)
    // Fechamento oficial como fornecido (nunca recalculado).
    await client.query(`insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, source) values ($1, $2, $3, $4, '2026-08', 385, 400, 103.9, 20, 'Q2', 'PROVA_TOOLS')`, [ORG, SUBJECT, INDICATORS.TMA, SUBTEAM])

    // Interações da operadora: "Segunda via de fatura" longas, "Dúvida sobre plano" curtas; flags reais do catálogo.
    await insertInteraction(SUBJECT, "2026-09-02", "09:10", "Segunda via de fatura", 640, { rechamada: true }, "Cliente: preciso da segunda via.\nOperadora: vou verificar seu cadastro, um momento.\nOperadora: só um instante enquanto localizo a fatura.\nCliente: certo.")
    await insertInteraction(SUBJECT, "2026-09-03", "10:30", "Segunda via de fatura", 700, { contestacao: true }, "Cliente: a fatura veio errada.\nOperadora: só um instante enquanto localizo a fatura.\nOperadora: vou verificar seu cadastro, um momento.")
    await insertInteraction(SUBJECT, "2026-09-08", "14:15", "Dúvida sobre plano", 240, {}, "Cliente: qual meu plano?\nOperadora: seu plano é o Fibra 500.")
    await insertInteraction(SUBJECT, "2026-09-10", "16:00", "Segunda via de fatura", 820, { rechamada: true, tempo_silencio: 200 }, "Operadora: só um instante enquanto localizo a fatura.\nCliente: já liguei ontem sobre isso.")
    // Pares: mesmo assunto, mais curtas.
    for (const [index, peer] of PEERS.entries()) await insertInteraction(peer, "2026-09-04", "11:00", "Segunda via de fatura", 300 + index * 10, {}, "Cliente: preciso da segunda via.\nOperador: já envio por e-mail agora mesmo, confirma o endereço?\nCliente: sim.")

    // KB autorizada para o Agent da prova.
    await client.query(`insert into agents (id, organization_id, name, agent_type, objective, description, context_prompt, investigation_capabilities) values ($1, $2, 'Prova Agent Tools', 'CUSTOM', 'Investigar', 'Prova', 'Prompt', '{KNOWLEDGE,SUPPORT_MATERIALS}')`, [AGENT, ORG])
    await client.query(`insert into knowledge_documents (id, organization_id, title, document_type, source_type) values ($1, $2, 'Procedimento de segunda via de fatura', 'PROCEDURE', 'TEXT')`, [KB_DOC, ORG])
    await client.query(`insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, $3, 'PUBLISHED', 'hash-prova-tools')`, [ORG, KB_DOC, "## Segunda via de fatura\nAo receber pedido de segunda via de fatura, envie o documento por e-mail imediatamente e confirme o endereço cadastrado.\n\n## Rechamada\nEm rechamada, retome o protocolo anterior antes de qualquer verificação."])
    await client.query(`insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1, $2)`, [AGENT, KB_DOC])
  })

  afterAll(async () => {
    await client.query("rollback")
    client.release()
    await pool.end()
    vi.restoreAllMocks()
  })

  it("escopo de organização: colaborador de outra organização não é sujeito; interação de outro operador é invisível", async () => {
    await expect(loadSubject(db(), ORG, OUTSIDER)).rejects.toMatchObject({ code: "INVESTIGATION_SUBJECT_NOT_FOUND" })
    const ctx = await context()
    const peerInteraction = await client.query<{ id: string }>(`select id from interactions where operator_id = $1 limit 1`, [PEERS[0]])
    const result = await run(ctx, "get_interaction_context", { interactionId: peerInteraction.rows[0]!.id })
    expect(result.quality.status).toBe("NO_DATA")
    expect(result.data).toBeNull()
  })

  it("indicador inválido: erro explícito com os códigos reais do catálogo", async () => {
    const ctx = await context()
    await expect(run(ctx, "get_indicator_snapshot", { indicatorCode: "ABS_INVENTADO" })).rejects.toMatchObject({ code: "TOOL_INVALID_INDICATOR" })
  })

  it("get_indicator_snapshot (TMA, média ponderada em segundos): Σ total ÷ Σ contatos, meta do Grupo, cobertura e oficial como fornecido", async () => {
    const ctx = await context()
    const result = await run(ctx, "get_indicator_snapshot", { indicatorCode: "PROVA_TMA" })
    const data = result.data as { operational: { value: number; sampleCount: number; coverage: number; eligibleDays: number }; target: { value: number; scope: string; withinTarget: boolean }; official: { latest: { referencePeriod: string; achievementPercent: number; quartile: string } } }
    // (420×20×9 + 900×20 + 520×20×3 − 420×20) … = média ponderada exata dos 12 dias.
    const expected = (420 * 20 * 8 + 900 * 20 + 520 * 20 * 3) / (20 * 12)
    expect(data.operational.value).toBeCloseTo(Math.round(expected * 100) / 100, 1)
    expect(data.operational.sampleCount).toBe(12)
    expect(data.operational.eligibleDays).toBe(12)
    expect(data.operational.coverage).toBe(1)
    expect(data.target).toMatchObject({ value: 400, scope: "TEAM", withinTarget: false })
    expect(data.official.latest).toMatchObject({ referencePeriod: "2026-08", achievementPercent: 103.9, quartile: "Q2" })
    expect(result.quality.status).toBe("SUFFICIENT")
    expect(result.provenance.dataSource).toContain("MEASUREMENT")
  })

  it("amostra mínima: Qualidade com 2 avaliações (mínimo 3) = INSUFFICIENT_SAMPLE; cobertura mínima: TMA com 3 de 12 dias = INSUFFICIENT_COVERAGE", async () => {
    const ctx = await context()
    const quality = await run(ctx, "validate_data_quality", { indicatorCode: "PROVA_QUALIDADE" })
    expect(quality.quality.status).toBe("INSUFFICIENT_SAMPLE")
    expect((quality.data as { minimumSample: number }).minimumSample).toBe(3)
    const coverage = await run(ctx, "validate_data_quality", { indicatorCode: "PROVA_TMA", period: { from: "2026-09-01", to: "2026-09-16" } })
    expect(coverage.quality.status).toBe("SUFFICIENT")
    const sparse = await run(await context(SMALL_SUBJECT), "validate_data_quality", { indicatorCode: "PROVA_TMA" })
    expect(sparse.quality.status).toBe("INSUFFICIENT_COVERAGE")
    expect(sparse.quality.coverage).toBeCloseTo(5 / 12, 2)
  })

  it("compare_periods: setembro × agosto — diferença absoluta/relativa e sentido de performance calculados pela aplicação", async () => {
    const ctx = await context()
    const result = await run(ctx, "compare_periods", { indicatorCode: "PROVA_TMA", currentPeriod: { from: "2026-09-01", to: "2026-09-16" }, referencePeriod: { from: "2026-08-17", to: "2026-08-31" } })
    const data = result.data as { current: { value: number }; reference: { value: number }; absoluteDifference: number; relativeDifferencePercent: number; directionOfChange: string; performanceDirection: string }
    expect(data.reference.value).toBe(380)
    expect(data.absoluteDifference).toBeCloseTo(data.current.value - 380, 1)
    expect(data.relativeDifferencePercent).toBeCloseTo(((data.current.value - 380) / 380) * 100, 0)
    expect(data.directionOfChange).toBe("UP")
    expect(data.performanceDirection).toBe("DECLINED")
  })

  it("dimensões: TMA aceita dia/dia da semana/semana pela medição e assunto/hora/flag pela duração das interações; Qualidade por assunto = NOT_SUPPORTED", async () => {
    const ctx = await context()
    const dimensions = await run(ctx, "get_available_dimensions", { indicatorCode: "PROVA_TMA" })
    const list = (dimensions.data as { dimensions: { dimension: string; available: boolean }[] }).dimensions
    expect(list.filter((item) => item.available).map((item) => item.dimension)).toEqual(["DAY", "DAY_OF_WEEK", "WEEK", "SUBJECT", "CHANNEL", "HOUR", "FLAG"])
    const unsupported = await run(ctx, "segment_indicator", { indicatorCode: "PROVA_QUALIDADE", dimension: "SUBJECT" })
    expect(unsupported.quality.status).toBe("NOT_SUPPORTED")
  })

  it("segment_indicator por DIA DA SEMANA usa Σ componentes por bucket (nunca AVG cego) e por SEMANA mostra a 3ª semana mais alta", async () => {
    const ctx = await context()
    const byWeekday = await run(ctx, "segment_indicator", { indicatorCode: "PROVA_TMA", dimension: "DAY_OF_WEEK" })
    const buckets = (byWeekday.data as { buckets: { dimensionValue: string; indicatorValue: number; sampleCount: number; contribution: number }[] }).buckets
    const thursday = buckets.find((bucket) => bucket.dimensionValue === "quinta")!
    // quintas: 03 (420), 10 (900) → (420×20 + 900×20) ÷ 40 = 660
    expect(thursday.indicatorValue).toBe(660)
    expect(thursday.sampleCount).toBe(2)
    expect(buckets.reduce((sum, bucket) => sum + bucket.contribution, 0)).toBeCloseTo(1, 1)
    const byWeek = await run(ctx, "segment_indicator", { indicatorCode: "PROVA_TMA", dimension: "WEEK" })
    const weeks = (byWeek.data as { buckets: { dimensionValue: string; indicatorValue: number }[] }).buckets
    expect(weeks.find((bucket) => bucket.dimensionValue === "2026-09-14")!.indicatorValue).toBe(520)
  })

  it("segment_indicator por ASSUNTO segmenta a duração das interações (proxy declarada) — 'Segunda via de fatura' (canônico segunda_via) mais longa que 'Dúvida sobre plano'", async () => {
    const ctx = await context()
    const result = await run(ctx, "segment_indicator", { indicatorCode: "PROVA_TMA", dimension: "SUBJECT" })
    const data = result.data as { metric: string; buckets: { dimensionValue: string; canonicalSubject: string | null; rawSubjects: string[]; value: number; sampleCount: number }[] }
    expect(data.metric).toContain("proxy")
    // O catálogo de assuntos tem alias "Segunda via de fatura" → segunda_via (migration 075): a Tool agrega pelo CANÔNICO
    // e preserva o texto bruto em rawSubjects — contrato atual, não o bruto como dimensão.
    expect(data.buckets[0]).toMatchObject({ dimensionValue: "segunda_via", canonicalSubject: "segunda_via", sampleCount: 3, value: 720 })
    expect(data.buckets[0]!.rawSubjects).toContain("Segunda via de fatura")
    expect(data.buckets[1]).toMatchObject({ dimensionValue: "Dúvida sobre plano", sampleCount: 1, value: 240 })
    expect(result.provenance.dataSource).toContain("INTERACTIONS")
  })

  it("compare_population: agregado do Subgrupo (n=5) sem dado individual; população de 2 é recusada por privacidade", async () => {
    const ctx = await context()
    const result = await run(ctx, "compare_population", { indicatorCode: "PROVA_TMA", reference: "SUBGROUP" })
    const data = result.data as { referenceValue: number; referencePopulation: number; performance: string; populationDefinition: string }
    expect(data.referenceValue).toBe(400)
    expect(data.referencePopulation).toBe(5)
    expect(data.performance).toBe("WORSE_THAN_REFERENCE")
    expect(JSON.stringify(result)).not.toContain("Prova Par 1")
    const small = await run(await context(SMALL_SUBJECT), "compare_population", { indicatorCode: "PROVA_TMA", reference: "SUBGROUP" })
    expect((small.data as { status: string }).status).toBe("POPULATION_TOO_SMALL")
    expect(small.quality.status).toBe("NOT_SUPPORTED")
  })

  it("semânticas diferentes pelo mesmo mecanismo: PRODUÇÃO (soma) = 240 com contribuição por semana; ABS (taxa) = 25% pela Σ ocorrências ÷ Σ elegíveis", async () => {
    const ctx = await context()
    const production = await run(ctx, "get_indicator_snapshot", { indicatorCode: "PROVA_PRODUCAO" })
    expect((production.data as { operational: { value: number } }).operational.value).toBe(240)
    const byWeek = await run(ctx, "segment_indicator", { indicatorCode: "PROVA_PRODUCAO", dimension: "WEEK" })
    const buckets = (byWeek.data as { buckets: { contribution: number; indicatorValue: number }[] }).buckets
    expect(buckets.reduce((sum, bucket) => sum + bucket.indicatorValue, 0)).toBe(240)
    expect(buckets.reduce((sum, bucket) => sum + bucket.contribution, 0)).toBeCloseTo(1, 1)
    const abs = await run(ctx, "get_indicator_snapshot", { indicatorCode: "PROVA_ABS" })
    expect((abs.data as { operational: { value: number; numerator: number; denominator: number } }).operational).toMatchObject({ value: 25, numerator: 3, denominator: 12 })
    const composition = await run(ctx, "inspect_indicator_composition", { indicatorCode: "PROVA_ABS" })
    expect((composition.data as { status: string; components: { label: string; value: number }[] }).components).toEqual([{ component: "numerator", label: "ocorrências", value: 3 }, { component: "denominator", label: "elegíveis (base)", value: 12 }])
  })

  it("detect_anomalies: o dia 10 (900 s) é ANOMALY/WORSE; get_employee_history OFFICIAL devolve o fechamento como fornecido", async () => {
    const ctx = await context()
    const anomalies = await run(ctx, "detect_anomalies", { indicatorCode: "PROVA_TMA" })
    const data = anomalies.data as { anomalies: { date: string; classification: string; performance: string }[]; pattern: string }
    expect(data.anomalies.some((point) => point.date === "2026-09-10" && point.classification === "ANOMALY" && point.performance === "WORSE")).toBe(true)
    const official = await run(ctx, "get_employee_history", { indicatorCode: "PROVA_TMA", layer: "OFFICIAL" })
    expect((official.data as { series: unknown[] }).series).toEqual([{ referencePeriod: "2026-08", value: 385, targetValue: 400, achievementPercent: 103.9, weightPercent: 20, quartile: "Q2" }])
    const operational = await run(ctx, "get_employee_history", { indicatorCode: "PROVA_TMA", layer: "OPERATIONAL" })
    expect((operational.data as { series: { weekStart: string }[] }).series.map((point) => point.weekStart)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"])
  })

  it("find_interactions: filtros reais (assunto, flag), ordenação e limite; sem interações no recorte = NO_DATA", async () => {
    const ctx = await context()
    const longest = await run(ctx, "find_interactions", { subject: "Segunda via de fatura", orderBy: "LONGEST", limit: 2 })
    const data = longest.data as { interactions: { durationSeconds: number; flags: { flag: string }[] }[]; total: number; truncated: boolean }
    expect(data.total).toBe(3)
    expect(data.interactions.map((item) => item.durationSeconds)).toEqual([820, 700])
    expect(data.truncated).toBe(true)
    const recalls = await run(ctx, "find_interactions", { flag: "rechamada" })
    expect((recalls.data as { total: number }).total).toBe(2)
    const none = await run(ctx, "find_interactions", { subject: "Assunto inexistente" })
    expect(none.quality.status).toBe("NO_DATA")
  })

  it("get_interaction_flags: contagem por flag no conjunto, com nota de que coexistência não é causa", async () => {
    const ctx = await context()
    const result = await run(ctx, "get_interaction_flags", {})
    const data = result.data as { interactionsInSet: number; flags: { flag: string; count: number }[]; note: string }
    expect(data.interactionsInSet).toBe(4)
    expect(Object.fromEntries(data.flags.map((flag) => [flag.flag, flag.count]))).toEqual({ rechamada: 2, contestacao: 1, tempo_silencio: 1 })
    expect(data.note).toContain("não é causa")
  })

  it("find_comparable_interactions: interações dos PARES no mesmo assunto, anônimas, mais curtas primeiro; a própria fica fora", async () => {
    const ctx = await context()
    const result = await run(ctx, "find_comparable_interactions", { subject: "Segunda via de fatura", reference: "SUBGROUP", limit: 3 })
    const data = result.data as { comparableInteractions: number; distinctOperators: number; referenceAverageDurationSeconds: number; ownAverageDurationSeconds: number; interactions: { interactionId: string; durationSeconds: number }[] }
    expect(data.comparableInteractions).toBe(5)
    expect(data.distinctOperators).toBe(5)
    expect(data.referenceAverageDurationSeconds).toBe(320)
    expect(data.ownAverageDurationSeconds).toBe(720)
    expect(data.interactions.map((item) => item.durationSeconds)).toEqual([300, 310, 320])
    expect(JSON.stringify(result)).not.toMatch(/Prova Par/)
  })

  it("inspect_work_context: 12 dias elegíveis (fallback seg–sex) com produção observada nos dias com interação", async () => {
    const ctx = await context()
    const result = await run(ctx, "inspect_work_context", {})
    const data = result.data as { calendarDays: number; eligibleDays: number; observedWorkedDays: number; note: string }
    expect(data.calendarDays).toBe(16)
    expect(data.eligibleDays).toBe(12)
    expect(data.observedWorkedDays).toBeGreaterThanOrEqual(4)
    expect(data.note).toContain("não são performance zero")
  })

  it("query_knowledge consulta só as bases autorizadas do Agent e acumula candidatos; recommend_support_materials aceita só candidatos reais com motivo específico", async () => {
    const ctx = await context()
    const knowledge = await run(ctx, "query_knowledge", { query: "segunda via de fatura rechamada" })
    const data = knowledge.data as { mode: string; knowledgeEvidence: { documentId: string; documentTitle: string }[] }
    expect(data.knowledgeEvidence[0]).toMatchObject({ documentId: KB_DOC, documentTitle: "Procedimento de segunda via de fatura" })
    expect(ctx.knowledgeCandidates.has(KB_DOC)).toBe(true)
    const invented = await run(ctx, "recommend_support_materials", { selections: [{ materialId: id(999), reason: "Um material que a IA inventou para esta situação." }] })
    expect((invented.data as { accepted: unknown[] }).accepted).toEqual([])
    const accepted = await run(ctx, "recommend_support_materials", { selections: [{ materialId: KB_DOC, reason: "Descreve o envio imediato da segunda via por e-mail, exatamente o passo que faltou." }] })
    expect((accepted.data as { accepted: { materialId: string; title: string }[] }).accepted).toEqual([{ materialId: KB_DOC, title: "Procedimento de segunda via de fatura", reason: "Descreve o envio imediato da segunda via por e-mail, exatamente o passo que faltou." }])
    const empty = await run(await context(), "recommend_support_materials", { selections: [{ materialId: KB_DOC, reason: "Motivo válido mas sem consulta prévia nesta investigação." }] })
    expect(empty.quality.status).toBe("NO_DATA")
  })

  it("synthesize_evidence organiza os fatos já coletados sem calcular nada novo", async () => {
    const ctx = await context()
    ctx.collectedFacts.push({ tool: "get_indicator_snapshot", label: "Consultar indicador", summary: "PROVA_TMA: 485 s", provenance: { population: "colaborador", filters: [], dataSource: "MEASUREMENT" } })
    const result = await run(ctx, "synthesize_evidence", { supportedHypotheses: ["Concentração em segunda via (F1)"], limitations: ["Qualidade com amostra insuficiente"] })
    const data = result.data as { facts: { ref: string }[]; supportedHypotheses: string[]; evidenceReferences: string[] }
    expect(data.facts.map((fact) => fact.ref)).toEqual(["F1"])
    expect(data.evidenceReferences).toEqual(["F1"])
    expect(data.supportedHypotheses).toEqual(["Concentração em segunda via (F1)"])
  })
})
