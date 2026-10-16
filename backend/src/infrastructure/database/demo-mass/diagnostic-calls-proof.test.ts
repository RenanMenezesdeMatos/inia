import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { DEMO_ORGANIZATION_ID } from "./demo-constants.js"
import { DIAGNOSTIC_CALL_OPERATORS, DIAGNOSTIC_CALLS_DATASET, DiagnosticCallsConflictError, loadDiagnosticCalls, mapDiagnosticCalls, persistDiagnosticCalls, reportDiagnosticCalls } from "./diagnostic-calls.js"
import { ensureChannelFlags } from "./persist-demo-mass.js"
import { loadDemoMass } from "./seed-demo-mass.js"
import { DIAGNOSTIC_LEGACY_OPERATORS } from "./legacy-adoption.js"
import { DIAGNOSTIC_SUBGROUP } from "./structure-generator.js"
import { computeDiagnosticDatasetFingerprint, DIAGNOSTIC_DATASET } from "./diagnostic-dataset.js"
import { persistPerformance, persistStructure } from "./persist-demo-mass.js"
import { resolveWorkdaysBySubject } from "../../../modules/indicators/application/operational-measurement-resolver.js"
import { HandleRegistry } from "../../../modules/investigation/domain/handle-registry.js"
import { findTool } from "../../../modules/investigation/domain/tool-catalog.js"
import { executeTool } from "../../../modules/investigation/application/tool-executor.js"
import { loadSubject, type ToolContext, defaultInvestigationToolState } from "../../../modules/investigation/application/tool-context.js"
import { buildTranscriptAnalysisInput, loadTranscripts, projectPeerTranscripts } from "../../../modules/investigation/application/tools/interaction-tools.js"
import { countTechnicalIds } from "../../../modules/investigation/domain/handle-registry.js"
import { identifyingNameVariants, sourceHashOf } from "../../../modules/investigation/domain/peer-privacy-projection.js"
import type { Database } from "../pool.js"

const TZ = "America/Fortaleza"
async function toolContext(operatorId: string, period: { start: string; end: string; label: string }): Promise<ToolContext> {
  const db = client as unknown as Database
  return {
    db, organizationId: DEMO_ORGANIZATION_ID, agentId: "00000000-0000-4000-8000-0000000000aa", now: new Date("2026-09-18T18:00:00Z"), timeZone: TZ,
    subject: await loadSubject(db, DEMO_ORGANIZATION_ID, operatorId, {}),
    defaultPeriod: { start: new Date(period.start), end: new Date(period.end), label: period.label },
    workdayCache: new Map(), knowledgeCandidates: new Map(), collectedFacts: [], telemetry: { requests: [] }, handles: new HandleRegistry(),
    investigation: defaultInvestigationToolState(),
  }
}
const JUN_AUG = { start: "2026-06-01T03:00:00Z", end: "2026-09-01T03:00:00Z", label: "2026-06-01 a 2026-08-31" }
const runTool = (ctx: ToolContext, key: string, args: unknown) => executeTool(ctx, findTool(key)!, args)
const personIdByName = async (name: string) => (await client.query<{ id: string }>(`select id from people where organization_id = $1 and name = $2 and matricula like 'DEMO-%' order by matricula limit 1`, [DEMO_ORGANIZATION_ID, name])).rows[0]!.id

/**
 * PROVA no banco de TESTE real, DEPOIS de `npm run db:seed:demo:test` (o lote entra pelo seed, como
 * em qualquer ambiente demo): contagens do lote por pessoa/assunto/flag, população do Subgrupo de
 * diagnóstico e estrutura válida, comparáveis por assunto/canal, idempotência (segunda persistência =
 * 0 inserções, contagens iguais), conflito de chave natural recusado sem escrita, e AUSÊNCIA de qualquer
 * rótulo do gabarito em tudo que pode chegar ao modelo (transcrições, interações, bases de conhecimento,
 * agentes, orquestradores, workflows, feedbacks). Tudo que escreve roda em transação revertida.
 *
 *   npm run db:seed:demo:test && INIA_DB_PROOF=1 npx vitest run diagnostic-calls-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const LOT = `DEMO-${DIAGNOSTIC_CALLS_DATASET.lot}:%`
/** Rótulos plantados pelo gabarito (copiados aqui como STRINGS de teste — o gabarito em si não é lido pelo runtime). */
const PLANTED_LABELS = ["consulta_com_silencio_sem_atualizacao_intermediaria", "controle_sem_sinal_comportamental_alvo", "conversa_humana_nao_sensivel", "delimitacao_escopo_e_confirmacao", "falha_informacao_prazo_acompanhamento", "multitema", "pergunta_redundante_retrabalho", "protocolo_solicitado_nao_informado_em_voz", "rechamada_mesmo_caso", "rotulos_plantados", "caso_controle", "ground truth", "ground_truth", "gabarito"]

let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("chamadas de diagnóstico — prova no banco demo", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    const subgroup = await client.query(`select 1 from subteams where organization_id = $1 and name = $2`, [DEMO_ORGANIZATION_ID, DIAGNOSTIC_SUBGROUP.name])
    if (subgroup.rowCount === 0) throw new Error("Massa demo ausente no banco de teste — rode `npm run db:seed:demo:test` antes desta prova.")
  })
  afterAll(async () => {
    client?.release()
    await pool?.end()
  })

  it("90 chamadas no banco: 30 Mariana, 30 Rafael, 30 Camila — pessoa canônica, transcrição integral, flags da fonte, datas/duração da fonte", async () => {
    const calls = await loadDiagnosticCalls()
    const byOperator = await client.query<{ name: string; matricula: string; n: string; transcripts: string; subteam: string; team: string }>(
      `select p.name, p.matricula, count(distinct i.id)::text n, count(distinct t.interaction_id)::text transcripts, st.name subteam, tm.name team
       from interactions i join people p on p.id = i.operator_id join subteams st on st.id = p.subteam_id join teams tm on tm.id = p.team_id
       left join transcripts t on t.interaction_id = i.id where i.external_id like $1 group by p.name, p.matricula, st.name, tm.name order by p.name`,
      [LOT],
    )
    expect(byOperator.rows.map((row) => [row.name, row.matricula, Number(row.n), Number(row.transcripts)])).toEqual([["Camila Fonseca", "DEMO-OP-0005", 30, 30], ["Mariana Alves", "DEMO-OP-0002", 30, 30], ["Rafael Cardoso", "DEMO-OP-0004", 30, 30]])
    expect(byOperator.rows.every((row) => row.subteam === DIAGNOSTIC_SUBGROUP.name && row.team === "B2C · Atendimento Geral")).toBe(true)
    // Nenhum homônimo recebeu chamada do lote.
    const homonyms = await client.query<{ n: string }>(`select count(*)::text n from people where organization_id = $1 and name = any($2::text[]) and role = 'OPERATOR'`, [DEMO_ORGANIZATION_ID, Object.values(DIAGNOSTIC_CALL_OPERATORS).map((o) => o.name)])
    expect(Number(homonyms.rows[0]!.n)).toBe(3)

    const rows = await client.query<{ external_id: string; reason: string; started_at: string; ended_at: string; duration: string; content: string; confidence: string | null }>(
      `select i.external_id, i.reason, to_char(i.started_at at time zone 'America/Fortaleza', 'YYYY-MM-DD"T"HH24:MI:SS"-03:00"') started_at, to_char(i.ended_at at time zone 'America/Fortaleza', 'YYYY-MM-DD"T"HH24:MI:SS"-03:00"') ended_at,
              extract(epoch from i.ended_at - i.started_at)::text duration, t.content, t.confidence::text
       from interactions i join transcripts t on t.interaction_id = i.id where i.external_id like $1`,
      [LOT],
    )
    expect(rows.rows).toHaveLength(90)
    const source = new Map(calls.map((call) => [`DEMO-${DIAGNOSTIC_CALLS_DATASET.lot}:${call.interacao_id_externo}`, call]))
    // Posição no calendário = layout V2 determinístico (a mesma que o gerador calcula); conteúdo/duração = fonte.
    const placed = new Map(mapDiagnosticCalls(calls, (await loadDemoMass(client)).structure, () => []).map((row) => [row.externalId, row]))
    for (const row of rows.rows) {
      const call = source.get(row.external_id)!
      expect(row.reason).toBe(call.assunto)
      expect(row.started_at.slice(0, 10)).toBe(placed.get(row.external_id)!.localDate)
      expect(Number(row.duration)).toBe(call.duracao_s)
      expect(row.content).toBe(call.transcricao)
      expect(row.confidence).toBeNull()
    }
    const flags = await client.query<{ flag_name: string; n_true: string; n_false: string; ops: string }>(
      `select cf.flag_name, count(*) filter (where f.value_boolean is true or f.value_numeric is not null)::text n_true, count(*) filter (where f.value_boolean is false)::text n_false, count(distinct i.operator_id)::text ops
       from interaction_flags f join channel_flags cf on cf.id = f.channel_flag_id join interactions i on i.id = f.interaction_id where i.external_id like $1 group by cf.flag_name order by cf.flag_name`,
      [LOT],
    )
    expect(flags.rows.map((row) => [row.flag_name, Number(row.n_true), Number(row.n_false), Number(row.ops)])).toEqual([
      ["cancelamento", 10, 80, 3], ["contestacao", 11, 79, 3], ["detrator", 17, 63, 3], ["nota_ura", 80, 0, 3], ["rechamada", 8, 82, 3], ["tempo_silencio", 90, 0, 3], ["transferencia", 7, 83, 3],
    ])
    const subjects = await client.query<{ reason: string; n: string; ops: string }>(`select reason, count(*)::text n, count(distinct operator_id)::text ops from interactions where external_id like $1 group by reason order by count(*) desc, reason`, [LOT])
    expect(subjects.rows).toHaveLength(17)
    expect(subjects.rows.slice(0, 3).map((row) => [row.reason, Number(row.n), Number(row.ops)])).toEqual([["internet_movel", 8, 3], ["segunda_via", 8, 3], ["contestacao", 7, 3]])
  })

  it("layout temporal V2 no banco: 10/10/10 por persona em jun/jul/ago, todas em dia PROGRAMADO pelo calendário operacional real, dentro da jornada, sem sobreposição (90/0/0/0)", async () => {
    const perMonth = await client.query<{ name: string; month_key: string; n: string }>(`select p.name, to_char(i.started_at at time zone $2, 'YYYY-MM') as month_key, count(*)::text n from interactions i join people p on p.id = i.operator_id where i.external_id like $1 group by 1, 2 order by 1, 2`, [LOT, TZ])
    expect(perMonth.rows.map((row) => `${row.name}|${row.month_key}|${row.n}`)).toEqual(["Camila Fonseca", "Mariana Alves", "Rafael Cardoso"].flatMap((name) => ["2026-06", "2026-07", "2026-08"].map((month) => `${name}|${month}|10`)))
    const calls = await client.query<{ external_id: string; operator_id: string; local_date: string; start_min: number; end_min: number; shift_start: string; work_minutes: number }>(
      `select i.external_id, i.operator_id, to_char(i.started_at at time zone $2, 'YYYY-MM-DD') local_date,
              (extract(hour from i.started_at at time zone $2) * 60 + extract(minute from i.started_at at time zone $2))::int start_min,
              (extract(hour from i.ended_at at time zone $2) * 60 + extract(minute from i.ended_at at time zone $2) + case when extract(second from i.ended_at at time zone $2) > 0 then 1 else 0 end)::int end_min,
              s.start_time::text shift_start, s.work_minutes
       from interactions i join lateral (select start_time, work_minutes from employee_work_shifts w where w.person_id = i.operator_id and w.effective_from <= (i.started_at at time zone $2)::date order by w.effective_from desc limit 1) s on true
       where i.external_id like $1`,
      [LOT, TZ],
    )
    expect(calls.rows).toHaveLength(90)
    const operators = [...new Set(calls.rows.map((call) => call.operator_id))]
    const workdays = await resolveWorkdaysBySubject(client as unknown as Database, operators, { start: new Date(JUN_AUG.start), end: new Date(JUN_AUG.end) }, TZ, { now: new Date("2026-09-18T18:00:00Z") })
    const proof = { callsOnScheduledDays: 0, callsOffSchedule: 0, callsOutsideShift: 0 }
    for (const call of calls.rows) {
      const day = workdays.get(call.operator_id)!.days.find((item) => item.date === call.local_date)!
      if (day.plannedToWork && !day.overridesPlan) proof.callsOnScheduledDays += 1
      else proof.callsOffSchedule += 1
      const [hour, minute] = call.shift_start.split(":").map(Number) as [number, number]
      const shiftStart = hour * 60 + minute
      if (call.start_min < shiftStart || call.end_min > shiftStart + call.work_minutes) proof.callsOutsideShift += 1
    }
    const overlaps = await client.query<{ n: string }>(`select count(*)::text n from interactions a join interactions b on b.operator_id = a.operator_id and b.id <> a.id and a.started_at < b.ended_at and b.started_at < a.ended_at where a.operator_id = any($1::uuid[])`, [operators])
    expect({ ...proof, impossibleOverlaps: Number(overlaps.rows[0]!.n) }).toEqual({ callsOnScheduledDays: 90, callsOffSchedule: 0, callsOutsideShift: 0, impossibleOverlaps: 0 })
  })

  it("Subgrupo de diagnóstico = população de comparação: personas + legados com gravações presentes, todos ativos, mesmo Grupo, supervisora válida até o Diretor", async () => {
    const members = await client.query<{ name: string; matricula: string; team: string; supervisor: string; supervisor_active: boolean; interactions: string; transcripts: string }>(
      `select p.name, p.matricula, tm.name team, sup.name supervisor, sup.active supervisor_active,
              (select count(*) from interactions i where i.operator_id = p.id)::text interactions,
              (select count(*) from interactions i join transcripts t on t.interaction_id = i.id where i.operator_id = p.id)::text transcripts
       from people p join subteams st on st.id = p.subteam_id join teams tm on tm.id = p.team_id and tm.id = st.team_id left join people sup on sup.id = p.reports_to_id
       where st.name = $1 and p.role = 'OPERATOR' and p.active order by p.name`,
      [DIAGNOSTIC_SUBGROUP.name],
    )
    // 25 da equipe canônica (as 3 personas estão entre eles) + cada legado com gravações que existe neste banco.
    const legacyInDb = await client.query<{ name: string }>(`select name from people where organization_id = $1 and name = any($2::text[]) and role = 'OPERATOR' and matricula like 'DEMO-LEG-%'`, [DEMO_ORGANIZATION_ID, [...DIAGNOSTIC_LEGACY_OPERATORS]])
    expect(members.rows).toHaveLength(25 + legacyInDb.rows.length)
    expect(members.rows.every((row) => row.team === "B2C · Atendimento Geral" && row.supervisor === members.rows[0]!.supervisor && row.supervisor_active)).toBe(true)
    expect(members.rows.every((row) => Number(row.transcripts) === Number(row.interactions) && Number(row.interactions) >= 10)).toBe(true)
    const names = new Set(members.rows.map((row) => row.name))
    for (const persona of Object.values(DIAGNOSTIC_CALL_OPERATORS)) expect(names.has(persona.name)).toBe(true)
    // Só entra quem existe no banco como pessoa legada (num banco recém-migrado, parte da lista); ninguém foi criado.
    for (const row of legacyInDb.rows) expect(names.has(row.name)).toBe(true)
    const chain = await client.query<{ role: string }>(
      `with recursive chain as (select id, role, reports_to_id from people where id = (select reports_to_id from people where name = $1 and matricula = 'DEMO-OP-0002')
         union all select p.id, p.role, p.reports_to_id from people p join chain c on p.id = c.reports_to_id) select role from chain`,
      ["Mariana Alves"],
    )
    expect(chain.rows.map((row) => row.role)).toEqual(["SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR"])
  })

  it("comparáveis por assunto/canal existem dentro do Subgrupo (mesma regra da Tool: mesmo reason + canal, população sem o próprio)", async () => {
    const pairs = await client.query<{ name: string; reason: string; peers: string; peer_ops: string }>(
      `with sg as (select p.id, p.name from people p join subteams st on st.id = p.subteam_id where st.name = $1 and p.role = 'OPERATOR' and p.active),
            own as (select i.operator_id, s.name, i.reason from interactions i join sg s on s.id = i.operator_id where i.external_id like $2 group by 1, 2, 3)
       select o.name, o.reason, count(p.id)::text peers, count(distinct p.operator_id)::text peer_ops
       from own o join interactions p on p.reason = o.reason and p.channel = 'VOICE' and p.operator_id <> o.operator_id and p.operator_id in (select id from sg)
       group by 1, 2 having count(p.id) >= 4 order by 1, 2`,
      [DIAGNOSTIC_SUBGROUP.name, LOT],
    )
    const byPersona = new Map<string, number>()
    for (const row of pairs.rows) byPersona.set(row.name, (byPersona.get(row.name) ?? 0) + 1)
    // Cada persona tem ao menos 10 assuntos com ≥ 4 pares (o mínimo de amostra da Tool) no Subgrupo.
    expect(byPersona.get("Mariana Alves")).toBeGreaterThanOrEqual(10)
    expect(byPersona.get("Rafael Cardoso")).toBeGreaterThanOrEqual(10)
    expect(byPersona.get("Camila Fonseca")).toBeGreaterThanOrEqual(10)
    expect(pairs.rows.find((row) => row.name === "Mariana Alves" && row.reason === "segunda_via")).toMatchObject({ peers: "5", peer_ops: "2" })
  })

  it("idempotência e conflito: persistir de novo = 0 inserções e contagens iguais; chave natural ocupada por OUTRA interação é recusada antes de escrever", async () => {
    const mass = await loadDemoMass(client)
    const rows = mapDiagnosticCalls(await loadDiagnosticCalls(), mass.structure)
    const flagIds = await ensureChannelFlags(client)
    const before = await reportDiagnosticCalls(client, rows)
    const again = await persistDiagnosticCalls(client, rows, flagIds)
    expect(again).toMatchObject({ read: 90, inserted: 0, updated: 90, transcripts: 90, flagRows: 610 })
    expect(await reportDiagnosticCalls(client, rows)).toEqual(before)
    const totals = await client.query<{ interactions: string; transcripts: string; flags: string }>(`select (select count(*) from interactions)::text interactions, (select count(*) from transcripts)::text transcripts, (select count(*) from interaction_flags)::text flags`)
    await client.query("begin")
    try {
      const first = rows[0]!
      const foreign = "7c0d1a60-0000-4000-8000-00000000d1a6"
      await client.query(`delete from interactions where id = $1`, [first.id])
      await client.query(`insert into interactions (id, organization_id, operator_id, reason, channel, started_at, ended_at, external_id) values ($1, $2, $3, 'outro assunto', 'VOICE', now() - interval '10 minutes', now(), $4)`, [foreign, DEMO_ORGANIZATION_ID, first.operatorId, first.externalId])
      await expect(persistDiagnosticCalls(client, rows, flagIds)).rejects.toBeInstanceOf(DiagnosticCallsConflictError)
      const stillForeign = await client.query<{ reason: string }>(`select reason from interactions where id = $1`, [foreign])
      expect(stillForeign.rows[0]!.reason).toBe("outro assunto")
    } finally {
      await client.query("rollback")
    }
    const after = await client.query<{ interactions: string; transcripts: string; flags: string }>(`select (select count(*) from interactions)::text interactions, (select count(*) from transcripts)::text transcripts, (select count(*) from interaction_flags)::text flags`)
    expect(after.rows[0]).toEqual(totals.rows[0])
  })

  it("assunto canônico: catálogo demo gravado (17 códigos), bruto preservado, mapeados/não mapeados contados; ambíguo fica sem canônico", async () => {
    const defs = await client.query<{ n: string }>(`select count(*)::text n from interaction_subject_definitions where organization_id = $1 and active`, [DEMO_ORGANIZATION_ID])
    expect(Number(defs.rows[0]!.n)).toBe(17)
    const coverage = await client.query<{ total: string; mapped: string; raw_subjects: string; canonical_subjects: string }>(
      `select count(*)::text total, count(cs.code)::text mapped, count(distinct i.reason)::text raw_subjects, count(distinct cs.code)::text canonical_subjects
       from interactions i join people p on p.id = i.operator_id join subteams st on st.id = p.subteam_id
       left join interaction_subject_aliases a on a.organization_id = i.organization_id and lower(btrim(a.raw_subject)) = lower(btrim(i.reason))
       left join interaction_subject_definitions cs on cs.id = a.subject_definition_id and cs.active
       where st.name = $1 and p.role = 'OPERATOR' and p.active`,
      [DIAGNOSTIC_SUBGROUP.name],
    )
    const row = coverage.rows[0]!
    expect(Number(row.mapped)).toBeGreaterThanOrEqual(90)
    expect(Number(row.mapped)).toBeLessThan(Number(row.total))
    expect(Number(row.canonical_subjects)).toBe(17)
    // O bruto do lote continua sendo o código da fonte; o bruto legado continua a frase da fonte.
    const raw = await client.query<{ reason: string }>(`select reason from interactions where external_id = $1`, [`DEMO-${DIAGNOSTIC_CALLS_DATASET.lot}:INIA-DEMO-M-001`])
    expect(raw.rows[0]!.reason).toBe("fatura")
    const ambiguous = await client.query<{ n: string }>(`select count(*)::text n from interaction_subject_aliases where organization_id = $1 and lower(btrim(raw_subject)) in ('linha sem sinal', 'cobrança após pedido de cancelamento e ameaça de reclamação')`, [DEMO_ORGANIZATION_ID])
    expect(Number(ambiguous.rows[0]!.n)).toBe(0)
  })

  it("comparáveis pela Tool real (population = SUBGROUP): mesmo canônico entre operadores do Subgrupo; canônico diferente não é comparável; sem alias = bruto exato; pares anônimos", async () => {
    const mariana = await toolContext(await personIdByName("Mariana Alves"), JUN_AUG)
    const comparable = await runTool(mariana, "find_comparable_interactions", { subject: "segunda_via", reference: "SUBGROUP" })
    const data = comparable.data as { subjectMatching: { canonicalSubject: string | null; mode: string }; comparableInteractions: number; distinctOperators: number; interactions: { peerInteractionId: string }[]; populationDefinition: string }
    expect(data.subjectMatching).toMatchObject({ canonicalSubject: "segunda_via", mode: "CANONICAL" })
    expect(data.comparableInteractions).toBeGreaterThanOrEqual(5)
    expect(data.distinctOperators).toBeGreaterThanOrEqual(2)
    expect(data.populationDefinition).toContain(`Subgrupo ${DIAGNOSTIC_SUBGROUP.name}`)
    // Um alias do bruto legado resolve para o MESMO canônico e encontra os mesmos pares.
    const viaAlias = await runTool(mariana, "find_comparable_interactions", { subject: "Segunda via de fatura", reference: "SUBGROUP" })
    expect((viaAlias.data as { subjectMatching: { canonicalSubject: string | null } }).subjectMatching.canonicalSubject).toBe("segunda_via")
    expect((viaAlias.data as { comparableInteractions: number }).comparableInteractions).toBe(data.comparableInteractions)
    // Canônico diferente não entra: troca_chip ≠ segunda_via (nenhum id em comum).
    const other = await runTool(mariana, "find_comparable_interactions", { subject: "troca_chip", reference: "SUBGROUP" })
    const otherIds = new Set(((other.data as { interactions?: { peerInteractionId: string }[] }).interactions ?? []).map((item) => item.peerInteractionId))
    expect(data.interactions.some((item) => otherIds.has(item.peerInteractionId))).toBe(false)
    // Privacidade: nada de nome/id de operador no resultado.
    const serialized = JSON.stringify(comparable.data)
    for (const name of ["Rafael Cardoso", "Camila Fonseca", "Luana Brenda"]) expect(serialized).not.toContain(name)
    expect(serialized).not.toContain(mariana.subject.operatorId)
    // Sem alias (bruto ambíguo): modo RAW_EXACT e NO_COMPARABLE continua válido.
    const rawOnly = await runTool(mariana, "find_comparable_interactions", { subject: "Linha sem sinal", reference: "SUBGROUP" })
    expect((rawOnly.data as { subjectMatching?: { mode: string } }).subjectMatching?.mode).toBe("RAW_EXACT")
    // GROUP = B2C · Atendimento Geral (Grupo organizacional real), nunca uma coorte paralela.
    const group = await runTool(mariana, "find_comparable_interactions", { subject: "segunda_via", reference: "GROUP" })
    expect((group.data as { populationDefinition?: string }).populationDefinition ?? "").toContain("Grupo B2C · Atendimento Geral")
    // segment_indicator por SUBJECT agrega pelo canônico e mantém o bruto acessível.
    const segments = await runTool(mariana, "segment_indicator", { indicatorCode: "TMA", dimension: "SUBJECT" })
    const buckets = (segments.data as { buckets: { dimensionValue: string; canonicalSubject: string | null; rawSubjects: string[] }[] }).buckets
    const bucket = buckets.find((item) => item.dimensionValue === "segunda_via")!
    expect(bucket.canonicalSubject).toBe("segunda_via")
    expect(bucket.rawSubjects).toContain("segunda_via")
  })

  it("TRANSFERÊNCIA: mudar Grupo/Subgrupo/supervisor de quem tem fechamento de agosto e reexecutar o sync estrutural + fechamentos deixa TODO snapshot oficial idêntico (insert-only)", async () => {
    const snapshot = async () => {
      const indicators = await client.query(`select person_id, indicator_definition_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, source, subteam_id from employee_indicator_performance order by 1, 2, 3`)
      const prv = await client.query(`select person_id, reference_period, achievement_percent, quartile, source, subteam_id from employee_prv_performance order by 1, 2`)
      return JSON.stringify([indicators.rows, prv.rows])
    }
    const before = await snapshot()
    const mariana = await personIdByName("Mariana Alves")
    const august = await client.query<{ n: string }>(`select count(*)::text n from employee_indicator_performance where person_id = $1 and reference_period = '2026-08'`, [mariana])
    expect(Number(august.rows[0]!.n)).toBeGreaterThan(0)
    const mass = await loadDemoMass(client)
    // persistStructure/persistPerformance abrem transações próprias — a posição original é restaurada explicitamente ao final.
    const original = (await client.query<{ team_id: string; subteam_id: string | null; reports_to_id: string }>(`select team_id, subteam_id, reports_to_id from people where id = $1`, [mariana])).rows[0]!
    try {
      const other = await client.query<{ team_id: string; subteam_id: string | null; supervisor: string }>(`select p.team_id, p.subteam_id, p.reports_to_id supervisor from people p join teams t on t.id = p.team_id where t.name = 'B2C · Retenção' and p.role = 'OPERATOR' and p.active limit 1`)
      await client.query(`update people set team_id = $2, subteam_id = $3, reports_to_id = $4 where id = $1`, [mariana, other.rows[0]!.team_id, other.rows[0]!.subteam_id, other.rows[0]!.supervisor])
      // Só fechamentos, com a pessoa no outro Grupo: nada muda (insert-only, e a geração usa a posição vigente na competência).
      await persistPerformance(client, mass)
      expect(await snapshot()).toBe(before)
      // O "sync estrutural" do seed devolve a pessoa à estrutura demo; os fechamentos continuam intocados.
      await persistStructure(client, mass)
      const official = await persistPerformance(client, mass)
      expect(official.indicatorRowsInserted).toBe(0)
      expect(official.prvRowsInserted).toBe(0)
      expect(await snapshot()).toBe(before)
      const restored = (await client.query<{ subteam_id: string | null }>(`select subteam_id from people where id = $1`, [mariana])).rows[0]!
      expect(restored.subteam_id).toBe(original.subteam_id)
    } finally {
      await client.query(`update people set team_id = $2, subteam_id = $3, reports_to_id = $4 where id = $1`, [mariana, original.team_id, original.subteam_id, original.reports_to_id])
    }
    expect(await snapshot()).toBe(before)
  })

  it("coerência temporal no banco: 0 referências temporais inconsistentes nas 90 transcrições persistidas (corpus v3)", async () => {
    const rows = await client.query<{ external_id: string; local_date: string; content: string; previous_date: string | null }>(
      `select i.external_id, to_char(i.started_at at time zone $2, 'YYYY-MM-DD') local_date, t.content,
              (select to_char(p.started_at at time zone $2, 'DD/MM') from interactions p where p.external_id = replace(i.external_id, split_part(i.external_id, ':', 2), split_part(i.external_id, ':', 2))) previous_date
       from interactions i join transcripts t on t.interaction_id = i.id where i.external_id like $1`,
      [LOT, TZ],
    )
    const addDays = (day: string, days: number) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
    const calls = await loadDiagnosticCalls()
    const previousOf = new Map(calls.map((call) => [`DEMO-${DIAGNOSTIC_CALLS_DATASET.lot}:${call.interacao_id_externo}`, call.interacao_anterior_id_externo ? `DEMO-${DIAGNOSTIC_CALLS_DATASET.lot}:${call.interacao_anterior_id_externo}` : null]))
    const dateOf = new Map(rows.rows.map((row) => [row.external_id, row.local_date]))
    const inconsistent: string[] = []
    for (const row of rows.rows) {
      for (const match of row.content.matchAll(/previsto para (\d{2})\/(\d{2})\/(\d{4})/g)) if (`${match[3]}-${match[2]}-${match[1]}` !== addDays(row.local_date, 2)) inconsistent.push(`${row.external_id}: ${match[0]}`)
      for (const match of row.content.matchAll(/registrado em (\d{2})\/(\d{2})/g)) {
        const previous = previousOf.get(row.external_id)
        const previousDate = previous ? dateOf.get(previous) : undefined
        if (!previousDate || `${match[1]}/${match[2]}` !== `${previousDate.slice(8, 10)}/${previousDate.slice(5, 7)}`) inconsistent.push(`${row.external_id}: ${match[0]}`)
      }
    }
    expect(rows.rows).toHaveLength(90)
    expect(inconsistent).toEqual([])
  })

  it("REIDENTIFICAÇÃO: o texto model-facing de analyze_peer_patterns para Mariana, Rafael, Camila, Ícaro e Luana contém 0 identidades de pares (nome completo, primeiro nome do par, UUID, matrícula, e-mail) e os pares aparecem como P-n", async () => {
    const members = await client.query<{ id: string; name: string; matricula: string | null }>(`select p.id, p.name, p.matricula from people p join subteams st on st.id = p.subteam_id where st.name = $1 and p.role = 'OPERATOR' and p.active`, [DIAGNOSTIC_SUBGROUP.name])
    const fullNames = members.rows.map((member) => member.name)
    let peerTranscripts = 0
    const cases: readonly (readonly [string, string])[] = [["Mariana Alves", "segunda_via"], ["Rafael Cardoso", "internet_movel"], ["Camila Fonseca", "contestacao"], ["Icaro Elias", "Chip sem registro na rede"], ["Luana Brenda", "Segunda via de fatura"]]
    // Ícaro/Luana só existem como legados no banco de desenvolvimento; num banco recém-migrado a prova cobre as 3 personas.
    const present = cases.filter(([name]) => members.rows.some((member) => member.name === name))
    expect(present.length).toBeGreaterThanOrEqual(3)
    for (const [name, subject] of present) {
      const ctx = await toolContext(await personIdByName(name), { start: "2026-04-01T03:00:00Z", end: "2026-09-18T03:00:00Z", label: "2026-04-01 a 2026-09-17" })
      const comparable = await runTool(ctx, "find_comparable_interactions", { subject, reference: "SUBGROUP", limit: 8 })
      const ids = ((comparable.data as { interactions?: { peerInteractionId: string }[] }).interactions ?? []).map((item) => item.peerInteractionId)
      expect(ids.length).toBeGreaterThan(0)
      // Metadados de find_comparable_interactions: nenhum nome, nenhum id de operador.
      const comparableText = JSON.stringify(comparable.data)
      for (const full of fullNames) expect(comparableText).not.toContain(full)
      for (const member of members.rows) expect(comparableText).not.toContain(member.id === ctx.subject.operatorId ? "\u0000" : member.id)
      const population = members.rows.map((member) => member.id).filter((id) => id !== ctx.subject.operatorId)
      const transcripts = await loadTranscripts(ctx, ids, population)
      const projections = await projectPeerTranscripts(ctx, transcripts, population)
      const handleOf = new Map(transcripts.map((transcript) => [transcript.id, ctx.handles.register("P", transcript.id)]))
      const modelInput = buildTranscriptAnalysisInput(transcripts, handleOf, projections)
      peerTranscripts += transcripts.length
      // V1.4.0 mudou o cabeçalho model-facing para "=== P1 · assunto: … ===" (handle canônico primeiro, sem "(ref: …)"); a prova
      // continua sendo a mesma: o par aparece SÓ pelo handle P-n (a asserção antiga casava com o formato anterior).
      expect(modelInput).toMatch(/^=== P\d+ · /m)
      expect(countTechnicalIds(modelInput)).toBe(0)
      expect(modelInput).not.toMatch(/DEMO-(OP|LEG|SUP)-\d+/)
      expect(modelInput).not.toMatch(/@inia\.(local|com)/)
      for (const full of fullNames) if (full !== name) expect(modelInput, `${full} no contexto do modelo de ${name}`).not.toContain(full)
      for (const transcript of transcripts) {
        const owner = members.rows.find((member) => member.id === transcript.operatorId)!
        const projected = projections.get(transcript.id)!.projected
        const variants = identifyingNameVariants(owner.name)
        for (const variant of variants.strong) expect(projected).not.toMatch(new RegExp(variant, "i"))
        if (variants.first && !variants.commonWordFirst) expect(projected, `primeiro nome do par (${owner.name}) na projeção`).not.toMatch(new RegExp(`(?<![\\p{L}])${variants.first}(?![\\p{L}])`, "iu"))
        // O bruto continua no banco (o que foi carregado é o persistido) e a projeção aponta para ele pelo hash.
        const projection = projections.get(transcript.id)!
        expect(projection.sourceHash).toBe(sourceHashOf(transcript.content))
        if (projected !== transcript.content) expect(projection.redactions.reduce((sum, item) => sum + item.count, 0)).toBeGreaterThan(0)
      }
    }
    expect(peerTranscripts).toBeGreaterThanOrEqual(20)
  })

  it("regressão Ícaro (DEMO-INT-2026-10 — a 10ª chamada da vaga 2026, Icaro Elias no dev): interação alvo intacta (transcrição bruta, sem redação), comparáveis e projeção de pares coexistem", async () => {
    // A vaga 2026 é de Icaro Elias no banco de desenvolvimento; num banco recém-migrado é a pessoa gerada da mesma vaga — a interação existe nos dois.
    // `SUBJECT_RESOLUTION_V2`: o assunto das Tools é o submotivo quando a fonte o informou (a massa gerada tem), senão o motivo.
    const target = await client.query<{ id: string; operator_id: string; subject: string; content: string }>(`select i.id, i.operator_id, coalesce(nullif(btrim(i.sub_reason), ''), i.reason) subject, t.content from interactions i join transcripts t on t.interaction_id = i.id where i.external_id = 'DEMO-INT-2026-10'`)
    expect(target.rows).toHaveLength(1)
    const icaro = target.rows[0]!.operator_id
    const ctx = await toolContext(icaro, { start: "2026-04-01T03:00:00Z", end: "2026-09-18T03:00:00Z", label: "abril a setembro" })
    const own = await runTool(ctx, "get_interaction_context", { interactionId: target.rows[0]!.id })
    expect((own.data as { subject: string; hasTranscript: boolean }).subject).toBe(target.rows[0]!.subject)
    // A transcrição do ALVO não passa pela projeção: analyze_interactions continua verificando contra o bruto.
    const ownTranscripts = await loadTranscripts(ctx, [target.rows[0]!.id], [icaro])
    expect(ownTranscripts[0]!.content).toBe(target.rows[0]!.content)
    const comparable = await runTool(ctx, "find_comparable_interactions", { subject: target.rows[0]!.subject, reference: "SUBGROUP" })
    expect(["SUFFICIENT", "INSUFFICIENT_SAMPLE", "NO_DATA"]).toContain(comparable.quality.status)
    expect(JSON.stringify(comparable.data)).not.toContain(ctx.subject.operatorName!)
  })

  it("dataset: versão DIAGNOSTIC_DATASET_V1_1 (HOMOLOGATED) e fingerprint determinístico do banco — sem texto de transcrição", async () => {
    expect(DIAGNOSTIC_DATASET).toMatchObject({ version: "DIAGNOSTIC_DATASET_V1_1", previousVersion: "DIAGNOSTIC_DATASET_V1", status: "HOMOLOGATED", sourceLot: "inia_demo_90_v1", corpus: "inia_demo_90_v3", temporalLayout: "V2_JUN_JUL_AGO_2026", subjectCatalog: "DEMO_SUBJECTS_V1" })
    const first = await computeDiagnosticDatasetFingerprint(client)
    const second = await computeDiagnosticDatasetFingerprint(client)
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(first.components.structure.memberCount).toBeGreaterThanOrEqual(25)
    expect(first.components.interactions.count).toBeGreaterThanOrEqual(90)
    expect(first.components.subjects.definitions).toBe(17)
    expect(JSON.stringify(first)).not.toContain("OPERADOR:")
  })

  it("ZERO ground truth no banco: nenhum rótulo/marcador do gabarito em transcrições, interações, bases de conhecimento, agentes, orquestradores, workflows ou feedbacks", async () => {
    const patterns = PLANTED_LABELS.map((label) => `%${label}%`)
    const checks: [string, string][] = [
      ["transcripts", `select count(*)::text n from transcripts where content ilike any($1::text[])`],
      ["interactions", `select count(*)::text n from interactions where reason ilike any($1::text[]) or external_id ilike any($1::text[])`],
      ["knowledge_documents", `select count(*)::text n from knowledge_documents where coalesce(title, '') ilike any($1::text[])`],
      ["knowledge_versions", `select count(*)::text n from knowledge_versions where coalesce(content, '') ilike any($1::text[])`],
      ["agents", `select count(*)::text n from agents where coalesce(context_prompt, '') ilike any($1::text[]) or coalesce(description, '') ilike any($1::text[]) or coalesce(objective, '') ilike any($1::text[])`],
      ["assistant_orchestrators", `select count(*)::text n from assistant_orchestrators where coalesce(output_instructions, '') ilike any($1::text[]) or coalesce(structured_output::text, '') ilike any($1::text[])`],
      ["workflow_versions", `select count(*)::text n from workflow_versions where graph::text ilike any($1::text[])`],
      ["feedbacks", `select count(*)::text n from feedbacks where coalesce(context_snapshot::text, '') ilike any($1::text[]) or coalesce(evidence_found, '') ilike any($1::text[]) or coalesce(recommendation, '') ilike any($1::text[])`],
      ["people", `select count(*)::text n from people where coalesce(bio, '') ilike any($1::text[]) or coalesce(strengths::text, '') ilike any($1::text[]) or coalesce(development_focus::text, '') ilike any($1::text[])`],
    ]
    for (const [table, sql] of checks) {
      const result = await client.query<{ n: string }>(sql, [patterns])
      expect(Number(result.rows[0]!.n), `${table} contém vocabulário do gabarito`).toBe(0)
    }
  }, 120_000)
})
