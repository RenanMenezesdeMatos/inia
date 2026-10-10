/**
 * CENÁRIO "TMA RUIM EM SETEMBRO/2026" DA LARISSA MONTEIRO (DEMO-OP-0001) — dados de demonstração (02/10/2026).
 *
 * O que grava (tudo com ids DETERMINÍSTICOS, removível pela própria lista — nunca por `source`):
 *   - 20 chamadas com transcrição (`scenario-calls.ts`): 10 contestações da Larissa em 22–30/09 (7 com erros de regra vigente, 3 bem
 *     conduzidas) e 2 contestações bem conduzidas de cada um dos 5 colegas de melhor TMA do Subgrupo em 15–19/09;
 *   - medição diária de TMA e de Atendimentos da Larissa em 22–30/09 (a massa demo vai só até 21/09), com o TMA alto;
 *   - FECHAMENTO OFICIAL de setembro/2026 de TMA do Subgrupo "Diagnóstico IA — Operadores com gravações": o de cada pessoa é a média
 *     ponderada da própria medição diária de setembro (como a massa demo faria), o da Larissa é 452 s (meta 400 s); quartil dentro do
 *     Subgrupo. Só TMA: as outras competências de setembro continuam sem fechamento (limitação conhecida).
 *
 * Fechamento oficial é INSERT-ONLY: se já existir fechamento de setembro para alguém do Subgrupo, o script recusa (nunca reescreve).
 *
 *   npx tsx scripts/dev/larissa-scenario/tma-setembro.ts             # ensaio (nada gravado)
 *   npx tsx scripts/dev/larissa-scenario/tma-setembro.ts --apply
 *   npx tsx scripts/dev/larissa-scenario/tma-setembro.ts --reset     # remove só o que este cenário gravou (pelos ids)
 */
import { createHash } from "node:crypto"
import { pool } from "../../../src/infrastructure/database/pool.js"
import { SCENARIO_CALLS } from "./scenario-calls.js"

const ORG_PERSON = "de00ae6a-c8c9-490a-816b-e3cc8cf18986"
const SUBTEAM = "de003187-930c-4686-88af-7a9a2e802a4e"
const PEERS: Record<string, string> = {
  PEER_1: "de002ca2-1f7f-4186-8275-e1833ae30302", // Jonas Lopes
  PEER_2: "de003fd7-3310-48b1-8e06-b11c86184230", // Denise Farias
  PEER_3: "de00ae75-1c37-45ab-818a-64c7e879a519", // Adriano Viana
  PEER_4: "de0047d2-b183-4ec1-857b-8c19201346dd", // Beatriz Nogueira
  PEER_5: "de00a09b-08ee-4996-8bb7-249cdd9ea5ce", // Thiago Moreira
}
const PERIOD = "2026-09"
const LARISSA_OFFICIAL_TMA = 452
const TARGET = 400
/** TMA diário da Larissa a partir de 22/09 (contatos do dia). */
const LARISSA_DAILY: { date: string; value: number; contacts: number }[] = [
  { date: "2026-09-22", value: 680, contacts: 28 },
  { date: "2026-09-23", value: 705, contacts: 27 },
  { date: "2026-09-24", value: 670, contacts: 29 },
  { date: "2026-09-25", value: 660, contacts: 30 },
  { date: "2026-09-28", value: 725, contacts: 26 },
  { date: "2026-09-29", value: 700, contacts: 28 },
  { date: "2026-09-30", value: 690, contacts: 30 },
]
const SOURCE = "DEMO_SEED"

/** UUID determinístico a partir de um nome (mesma entrada → mesmo id; reaplicar não duplica). */
const idOf = (name: string) => {
  const hex = createHash("sha256").update(`inia-scenario-tma-setembro:${name}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
const firstName = (name: string) => name.trim().split(/\s+/)[0]!
const transcriptOf = (lines: readonly string[], operator: string) => lines
  .map((line) => line.replace("{OPERADOR}", operator))
  .map((line) => (line.startsWith("O: ") ? `Operador: ${line.slice(3)}` : line.startsWith("C: ") ? `Cliente: ${line.slice(3)}` : line))
  .join("\n")

async function main() {
  const apply = process.argv.includes("--apply")
  const reset = process.argv.includes("--reset")
  const client = await pool.connect()
  try {
    const org = (await client.query<{ organization_id: string }>(`select organization_id from people where id = $1`, [ORG_PERSON])).rows[0]!.organization_id
    const tma = (await client.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = 'TMA'`, [org])).rows[0]!.id
    const atendimentos = (await client.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = 'ATENDIMENTOS'`, [org])).rows[0]?.id ?? null
    const ownerOf = (owner: string) => (owner === "LARISSA" ? ORG_PERSON : PEERS[owner]!)
    const names = new Map((await client.query<{ id: string; name: string }>(`select id, name from people where id = any($1::uuid[])`, [[ORG_PERSON, ...Object.values(PEERS)]])).rows.map((row) => [row.id, row.name]))

    const interactionIds = SCENARIO_CALLS.map((call) => idOf(`interaction:${call.key}`))
    const transcriptIds = SCENARIO_CALLS.map((call) => idOf(`transcript:${call.key}`))
    const dailyIds = LARISSA_DAILY.flatMap((day) => [idOf(`daily:TMA:${day.date}`), idOf(`daily:ATENDIMENTOS:${day.date}`)])

    if (reset) {
      await client.query("begin")
      const closings = (await client.query<{ id: string }>(`select id from employee_indicator_performance where id = any($1::uuid[])`, [await closingIds(client, org)])).rows.map((row) => row.id)
      await client.query(`delete from transcripts where id = any($1::uuid[])`, [transcriptIds])
      await client.query(`delete from interactions where id = any($1::uuid[])`, [interactionIds])
      await client.query(`delete from indicator_measurements where id = any($1::uuid[])`, [dailyIds])
      await client.query(`delete from employee_indicator_performance where id = any($1::uuid[])`, [closings])
      await client.query("commit")
      console.log(`Removido: ${interactionIds.length} chamadas, ${dailyIds.length} medições diárias, ${closings.length} fechamentos.`)
      return
    }

    // Fechamento de setembro do Subgrupo: média ponderada da medição diária de setembro de cada pessoa ativa.
    const members = (await client.query<{ id: string; name: string; num: string | null; den: string | null; weight: string | null }>(
      `select p.id, p.name,
              (select sum(m.numerator) from indicator_measurements m where m.subject_type = 'PERSON' and m.subject_id = p.id and m.indicator_definition_id = $2 and m.granularity = 'DAILY' and m.period_start >= '2026-09-01' and m.period_start < '2026-10-01') num,
              (select sum(m.denominator) from indicator_measurements m where m.subject_type = 'PERSON' and m.subject_id = p.id and m.indicator_definition_id = $2 and m.granularity = 'DAILY' and m.period_start >= '2026-09-01' and m.period_start < '2026-10-01') den,
              (select e.weight_percent from employee_indicator_performance e where e.person_id = p.id and e.indicator_definition_id = $2 and e.reference_period = '2026-08') weight
         from people p where p.organization_id = $1 and p.subteam_id = $3 and p.active and p.role = 'OPERATOR'`,
      [org, tma, SUBTEAM],
    )).rows
    const existing = (await client.query<{ n: string }>(`select count(*) n from employee_indicator_performance where indicator_definition_id = $1 and reference_period = $2 and person_id = any($3::uuid[]) and not (id = any($4::uuid[]))`, [tma, PERIOD, members.map((member) => member.id), await closingIds(client, org)])).rows[0]!.n
    if (Number(existing) > 0) throw new Error(`Recusado: já existe fechamento de ${PERIOD} de TMA para ${existing} pessoa(s) do Subgrupo (fechamento oficial nunca é reescrito).`)
    const values = members.map((member) => ({
      ...member,
      value: member.id === ORG_PERSON ? LARISSA_OFFICIAL_TMA : member.num && member.den && Number(member.den) > 0 ? Math.round(Number(member.num) / Number(member.den)) : null,
    })).filter((member) => member.value !== null) as (typeof members[number] & { value: number })[]
    const ranked = [...values].sort((a, b) => a.value - b.value)
    const quartileOf = (index: number) => (`Q${Math.min(4, Math.floor((index * 4) / ranked.length) + 1)}`) as "Q1" | "Q2" | "Q3" | "Q4"
    const closings = ranked.map((member, index) => ({ id: idOf(`closing:${member.id}`), personId: member.id, name: member.name, value: member.value, achievement: Math.round((TARGET / member.value) * 1000) / 10, quartile: quartileOf(index), weight: member.weight === null ? null : Number(member.weight) }))

    const plan = {
      mode: apply ? "APPLY" : "DRY_RUN",
      calls: SCENARIO_CALLS.map((call) => ({ key: call.key, owner: names.get(ownerOf(call.owner)), when: `${call.date} ${call.time}`, seconds: call.durationSeconds, good: call.intent.good, failures: call.intent.failures })),
      larissaDaily: LARISSA_DAILY,
      closings: { period: PERIOD, people: closings.length, larissa: closings.find((entry) => entry.personId === ORG_PERSON), best5: closings.slice(0, 5).map((entry) => `${entry.name} ${entry.value}s ${entry.quartile}`), peersOfScenario: closings.filter((entry) => Object.values(PEERS).includes(entry.personId)).map((entry) => `${entry.name} ${entry.value}s ${entry.quartile}`) },
    }
    console.log(JSON.stringify(plan, null, 2))
    if (!apply) return

    await client.query("begin")
    for (const call of SCENARIO_CALLS) {
      const owner = ownerOf(call.owner)
      const startedAt = new Date(`${call.date}T${call.time}:00-03:00`)
      const endedAt = new Date(startedAt.getTime() + call.durationSeconds * 1000)
      await client.query(
        `insert into interactions (id, organization_id, operator_id, reason, channel, started_at, ended_at, external_id) values ($1, $2, $3, $4, 'VOICE', $5, $6, $7)
         on conflict (id) do update set operator_id = excluded.operator_id, reason = excluded.reason, started_at = excluded.started_at, ended_at = excluded.ended_at`,
        [idOf(`interaction:${call.key}`), org, owner, call.reason, startedAt, endedAt, `SCENARIO-TMA-SET-${call.key}`],
      )
      await client.query(
        `insert into transcripts (id, organization_id, interaction_id, version, content, language, confidence) values ($1, $2, $3, 1, $4, 'pt-BR', 0.9)
         on conflict (id) do update set content = excluded.content`,
        [idOf(`transcript:${call.key}`), org, idOf(`interaction:${call.key}`), transcriptOf(call.lines, firstName(names.get(owner) ?? "Atendente"))],
      )
    }
    for (const day of LARISSA_DAILY) {
      const start = `${day.date} 00:00:00-03`
      const end = `${day.date} 23:59:59-03`
      await client.query(
        `insert into indicator_measurements (id, organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator, sample_count)
         values ($1, $2, $3, 'PERSON', $4, $5, $6, $7, $8, 'DAILY', $9, $10::numeric, $10::int)
         on conflict (id) do update set value = excluded.value, numerator = excluded.numerator, denominator = excluded.denominator, sample_count = excluded.sample_count`,
        [idOf(`daily:TMA:${day.date}`), org, tma, ORG_PERSON, day.value, start, end, SOURCE, day.value * day.contacts, day.contacts],
      )
      if (atendimentos) await client.query(
        `insert into indicator_measurements (id, organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator, sample_count)
         values ($1, $2, $3, 'PERSON', $4, $5::numeric, $6, $7, $8, 'DAILY', $5::numeric, 1, $5::int)
         on conflict (id) do update set value = excluded.value, numerator = excluded.numerator, sample_count = excluded.sample_count`,
        [idOf(`daily:ATENDIMENTOS:${day.date}`), org, atendimentos, ORG_PERSON, day.contacts, start, end, SOURCE],
      )
    }
    for (const closing of closings) {
      await client.query(
        `insert into employee_indicator_performance (id, organization_id, person_id, indicator_definition_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (id) do nothing`,
        [closing.id, org, closing.personId, tma, SUBTEAM, PERIOD, closing.value, TARGET, closing.achievement, closing.weight, closing.quartile, SOURCE],
      )
    }
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, null, 'DEV_SCENARIO_TMA_SETEMBRO_APPLIED', 'person', $2, $3)`,
      [org, ORG_PERSON, JSON.stringify({ calls: SCENARIO_CALLS.length, daily: dailyIds.length, closings: closings.length, period: PERIOD })],
    )
    await client.query("commit")
    console.log(`Aplicado: ${SCENARIO_CALLS.length} chamadas, ${dailyIds.length} medições diárias, ${closings.length} fechamentos de ${PERIOD}.`)
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

/** Ids dos fechamentos que ESTE cenário grava (um por pessoa ativa do Subgrupo). */
async function closingIds(client: { query: typeof pool.query }, org: string): Promise<string[]> {
  const members = (await client.query<{ id: string }>(`select id from people where organization_id = $1 and subteam_id = $2`, [org, SUBTEAM])).rows
  return members.map((member) => idOf(`closing:${member.id}`))
}

await main()
