/**
 * CENÁRIO "NOTA DA URA E REINCIDÊNCIA EM SETEMBRO/2026" DA LARISSA MONTEIRO (DEMO-OP-0001) — dados de demonstração (06/10/2026).
 *
 * Dois indicadores do PRV dela (além do TMA, cenário `../tma-setembro.ts`), cada um com uma história PRÓPRIA nas chamadas:
 *   - NOTA_URA (Nota da Pesquisa na URA): as notas baixas (`nota_ura` ≤ 2) se concentram na SEGUNDA VIA de setembro — ela passa a
 *     mandar o cliente para o aplicativo sem acompanhar (Procedimento Segunda Via de Conta). Agosto e o começo de setembro, bem.
 *   - REINCIDENCIA_7D (Reincidência em até 7 dias): os RETORNOS de clientes (`rechamada` = verdadeiro, marcado pela fonte) se concentram
 *     no REPARO DE BANDA LARGA — no retorno ela trata o cliente como se fosse o primeiro contato (Reparo de Banda Larga §3.4, §37, §51).
 *     Só a chamada de retorno é avaliada: o atendimento que gerou a reincidência não está ligado a ela nos dados (nunca é presumido).
 *
 * O que grava (ids DETERMINÍSTICOS, removível pela própria lista — nunca por `source`):
 *   - 38 chamadas com transcrição e as flags que a fonte teria calculado (`call-types.ts`): 9 de segunda via e 9 de reparo da Larissa
 *     (agosto e setembro) e, para cada indicador, 2 chamadas bem conduzidas de cada um dos 5 colegas de MELHOR resultado oficial do
 *     Subgrupo em setembro (escolhidos pelo próprio script, pelo mesmo cálculo do fechamento — são o grupo de referência);
 *   - medição diária de NOTA_URA e REINCIDENCIA_7D da Larissa em 22–30/09 (a massa demo vai até 21/09), com a piora da última semana;
 *   - FECHAMENTO OFICIAL de setembro/2026 dos dois indicadores para o Subgrupo "Diagnóstico IA — Operadores com gravações": o de cada
 *     pessoa é o agregado da própria medição diária de setembro (como a massa demo faria); o da Larissa é o informado abaixo; quartil
 *     dentro do Subgrupo; meta e peso = os de agosto da pessoa.
 *
 * Fechamento oficial é INSERT-ONLY: se já existir fechamento de setembro desses indicadores para alguém do Subgrupo (fora deste
 * cenário), o script recusa (nunca reescreve). Nenhuma chamada passa pela ingestão (não dispara Workflow).
 *
 *   npx tsx scripts/dev/larissa-scenario/nota-ura-reincidencia/setembro.ts             # ensaio (nada gravado)
 *   npx tsx scripts/dev/larissa-scenario/nota-ura-reincidencia/setembro.ts --apply
 *   npx tsx scripts/dev/larissa-scenario/nota-ura-reincidencia/setembro.ts --reset     # remove só o que este cenário gravou (pelos ids)
 */
import { createHash } from "node:crypto"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import type { ScenarioCall } from "./call-types.js"
import { LARISSA_REPARO } from "./larissa-reparo.js"
import { LARISSA_SEGUNDA_VIA } from "./larissa-segunda-via.js"
import { PEERS_REPARO } from "./peers-reparo.js"
import { PEERS_SEGUNDA_VIA } from "./peers-segunda-via.js"

const LARISSA = "de00ae6a-c8c9-490a-816b-e3cc8cf18986"
const SUBTEAM = "de003187-930c-4686-88af-7a9a2e802a4e"
const PERIOD = "2026-09"
const SOURCE = "DEMO_SEED"

type IndicatorPlan = {
  code: "NOTA_URA" | "REINCIDENCIA_7D"
  /** Resultado oficial da Larissa em setembro (o que a fonte do cliente informa). */
  larissa: number
  fallbackTarget: number
  /** Valor do agregado a partir da medição diária (soma do numerador / soma do denominador). */
  valueOf: (numerator: number, denominator: number) => number
  better: "HIGHER" | "LOWER"
  /** Medição diária da Larissa a partir de 22/09 (dia, numerador, denominador). */
  daily: { date: string; numerator: number; denominator: number }[]
  calls: { larissa: ScenarioCall[]; peers: ScenarioCall[] }
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits
const LATE_SEPTEMBER = ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30"]

const PLANS: IndicatorPlan[] = [
  {
    code: "NOTA_URA",
    larissa: 3.9,
    fallbackTarget: 4.3,
    valueOf: (numerator, denominator) => round(numerator / denominator, 2),
    better: "HIGHER",
    // Pesquisas respondidas por dia (6) e a média do dia — a última semana de setembro despenca.
    daily: [3.4, 3.0, 3.2, 3.1, 2.9, 3.3, 3.2].map((value, index) => ({ date: LATE_SEPTEMBER[index]!, numerator: round(value * 6, 2), denominator: 6 })),
    calls: { larissa: LARISSA_SEGUNDA_VIA, peers: PEERS_SEGUNDA_VIA },
  },
  {
    code: "REINCIDENCIA_7D",
    larissa: 11.6,
    fallbackTarget: 9,
    valueOf: (numerator, denominator) => round((numerator / denominator) * 100, 2),
    better: "LOWER",
    // Contatos do dia (os mesmos do cenário do TMA) e quantos foram retorno em até 7 dias.
    daily: [[5, 28], [5, 27], [6, 29], [5, 30], [6, 26], [5, 28], [5, 30]].map(([numerator, denominator], index) => ({ date: LATE_SEPTEMBER[index]!, numerator: numerator!, denominator: denominator! })),
    calls: { larissa: LARISSA_REPARO, peers: PEERS_REPARO },
  },
]

/** UUID determinístico a partir de um nome (mesma entrada → mesmo id; reaplicar não duplica). */
const idOf = (name: string) => {
  const hex = createHash("sha256").update(`inia-scenario-ura-reincidencia-setembro:${name}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
const firstName = (name: string) => name.trim().split(/\s+/)[0]!
const transcriptOf = (lines: readonly string[], operator: string) => lines
  .map((line) => line.replace("{OPERADOR}", operator))
  .map((line) => (line.startsWith("O: ") ? `Operador: ${line.slice(3)}` : line.startsWith("C: ") ? `Cliente: ${line.slice(3)}` : line))
  .join("\n")

type Queryable = { query: typeof pool.query }

async function main() {
  const apply = process.argv.includes("--apply")
  const reset = process.argv.includes("--reset")
  const client = await pool.connect()
  try {
    const org = (await client.query<{ organization_id: string }>(`select organization_id from people where id = $1`, [LARISSA])).rows[0]!.organization_id
    const indicatorIds = new Map((await client.query<{ code: string; id: string }>(`select code, id from indicator_definitions where organization_id = $1 and code = any($2::text[])`, [org, PLANS.map((plan) => plan.code)])).rows.map((row) => [row.code, row.id]))
    const flagIds = new Map((await client.query<{ flag_name: string; id: string }>(`select flag_name, id from channel_flags where organization_id = $1 and flag_name in ('nota_ura', 'rechamada')`, [org])).rows.map((row) => [row.flag_name, row.id]))
    const members = (await client.query<{ id: string; name: string }>(`select id, name from people where organization_id = $1 and subteam_id = $2 and active and role = 'OPERATOR' order by id`, [org, SUBTEAM])).rows
    const allCalls = PLANS.flatMap((plan) => [...plan.calls.larissa, ...plan.calls.peers])
    const keys = new Set(allCalls.map((call) => call.key))
    if (keys.size !== allCalls.length) throw new Error("Chaves de chamada repetidas entre os arquivos do cenário.")
    const interactionIds = allCalls.map((call) => idOf(`interaction:${call.key}`))
    const transcriptIds = allCalls.map((call) => idOf(`transcript:${call.key}`))
    const dailyIds = PLANS.flatMap((plan) => plan.daily.map((day) => idOf(`daily:${plan.code}:${day.date}`)))
    const closingIds = PLANS.flatMap((plan) => members.map((member) => idOf(`closing:${plan.code}:${member.id}`)))

    if (reset) {
      await client.query("begin")
      const flags = await client.query(`delete from interaction_flags where interaction_id = any($1::uuid[])`, [interactionIds])
      await client.query(`delete from transcripts where id = any($1::uuid[])`, [transcriptIds])
      const calls = await client.query(`delete from interactions where id = any($1::uuid[])`, [interactionIds])
      const daily = await client.query(`delete from indicator_measurements where id = any($1::uuid[])`, [dailyIds])
      const closings = await client.query(`delete from employee_indicator_performance where id = any($1::uuid[])`, [closingIds])
      await client.query("commit")
      console.log(`Removido: ${calls.rowCount} chamadas (${flags.rowCount} flags), ${daily.rowCount} medições diárias, ${closings.rowCount} fechamentos.`)
      return
    }

    type Closing = { id: string; personId: string; name: string; value: number; target: number; weight: number | null; achievement: number; quartile: "Q1" | "Q2" | "Q3" | "Q4" }
    const plans: { plan: IndicatorPlan; indicatorId: string; closings: Closing[]; peers: { personId: string; name: string; value: number }[] }[] = []
    for (const plan of PLANS) {
      const indicatorId = indicatorIds.get(plan.code)
      if (!indicatorId) throw new Error(`Indicador ${plan.code} não existe no catálogo.`)
      const aggregates = (await client.query<{ id: string; num: string | null; den: string | null; target: string | null; weight: string | null }>(
        `select p.id,
                (select sum(m.numerator) from indicator_measurements m where m.subject_type = 'PERSON' and m.subject_id = p.id and m.indicator_definition_id = $2 and m.granularity = 'DAILY' and m.period_start >= '2026-09-01' and m.period_start < '2026-10-01' and not (m.id = any($4::uuid[]))) num,
                (select sum(m.denominator) from indicator_measurements m where m.subject_type = 'PERSON' and m.subject_id = p.id and m.indicator_definition_id = $2 and m.granularity = 'DAILY' and m.period_start >= '2026-09-01' and m.period_start < '2026-10-01' and not (m.id = any($4::uuid[]))) den,
                (select e.target_value from employee_indicator_performance e where e.person_id = p.id and e.indicator_definition_id = $2 and e.reference_period = '2026-08') target,
                (select e.weight_percent from employee_indicator_performance e where e.person_id = p.id and e.indicator_definition_id = $2 and e.reference_period = '2026-08') weight
           from people p where p.organization_id = $1 and p.id = any($3::uuid[])`,
        [org, indicatorId, members.map((member) => member.id), dailyIds],
      )).rows
      const existing = Number((await client.query<{ n: string }>(`select count(*) n from employee_indicator_performance where indicator_definition_id = $1 and reference_period = $2 and person_id = any($3::uuid[]) and not (id = any($4::uuid[]))`, [indicatorId, PERIOD, members.map((member) => member.id), closingIds])).rows[0]!.n)
      if (existing > 0) throw new Error(`Recusado: já existe fechamento de ${PERIOD} de ${plan.code} para ${existing} pessoa(s) do Subgrupo (fechamento oficial nunca é reescrito).`)
      const nameOf = new Map(members.map((member) => [member.id, member.name]))
      const values = aggregates.map((row) => ({
        personId: row.id,
        name: nameOf.get(row.id)!,
        value: row.id === LARISSA ? plan.larissa : row.num !== null && row.den !== null && Number(row.den) > 0 ? plan.valueOf(Number(row.num), Number(row.den)) : null,
        target: row.target === null ? plan.fallbackTarget : Number(row.target),
        weight: row.weight === null ? null : Number(row.weight),
      })).filter((row): row is typeof row & { value: number } => row.value !== null)
      // Melhor primeiro (desempate pelo id, determinístico) — a mesma ordem do grupo de referência do motor (resultado oficial).
      const ranked = [...values].sort((a, b) => (plan.better === "HIGHER" ? b.value - a.value : a.value - b.value) || a.personId.localeCompare(b.personId))
      const quartileOf = (index: number) => (`Q${Math.min(4, Math.floor((index * 4) / ranked.length) + 1)}`) as "Q1" | "Q2" | "Q3" | "Q4"
      const closings = ranked.map((row, index) => ({
        id: idOf(`closing:${plan.code}:${row.personId}`),
        ...row,
        achievement: round(plan.better === "HIGHER" ? (row.value / row.target) * 100 : (row.target / row.value) * 100, 1),
        quartile: quartileOf(index),
      }))
      // Os 5 colegas de melhor resultado (fora a Larissa) atendem as chamadas de referência deste indicador.
      const peers = ranked.filter((row) => row.personId !== LARISSA).slice(0, 5)
      if (peers.length < 5) throw new Error(`${plan.code}: menos de 5 colegas com medição em setembro no Subgrupo.`)
      plans.push({ plan, indicatorId, closings, peers })
    }

    const ownerOf = (planIndex: number, owner: ScenarioCall["owner"]) => (owner === "LARISSA" ? LARISSA : plans[planIndex]!.peers[Number(owner.slice(5)) - 1]!.personId)
    const nameOfPerson = new Map(members.map((member) => [member.id, member.name]))
    const report = {
      mode: apply ? "APPLY" : "DRY_RUN",
      indicators: plans.map(({ plan, closings, peers }) => ({
        code: plan.code,
        larissa: closings.find((entry) => entry.personId === LARISSA),
        people: closings.length,
        referencePeers: peers.map((peer) => `${peer.name} ${peer.value}`),
        calls: [...plan.calls.larissa, ...plan.calls.peers].map((call) => `${call.key} ${call.date} ${call.time} ${call.owner === "LARISSA" ? "Larissa" : firstName(nameOfPerson.get(ownerOf(PLANS.indexOf(plan), call.owner))!)} ${JSON.stringify(call.flags)} ${call.intent.good ? "boa" : call.intent.failures.join("+")}`),
      })),
      larissaDaily: PLANS.map((plan) => ({ code: plan.code, days: plan.daily })),
    }
    console.log(JSON.stringify(report, null, 2))
    if (!apply) return

    await client.query("begin")
    for (const [planIndex, { plan }] of plans.entries()) {
      for (const call of [...plan.calls.larissa, ...plan.calls.peers]) {
        const owner = ownerOf(planIndex, call.owner)
        const startedAt = new Date(`${call.date}T${call.time}:00-03:00`)
        const endedAt = new Date(startedAt.getTime() + call.durationSeconds * 1000)
        const interactionId = idOf(`interaction:${call.key}`)
        await client.query(
          `insert into interactions (id, organization_id, operator_id, reason, channel, started_at, ended_at, external_id) values ($1, $2, $3, $4, 'VOICE', $5, $6, $7)
           on conflict (id) do update set operator_id = excluded.operator_id, reason = excluded.reason, started_at = excluded.started_at, ended_at = excluded.ended_at`,
          [interactionId, org, owner, call.reason, startedAt, endedAt, `SCENARIO-URA-REINC-SET-${call.key}`],
        )
        await client.query(
          `insert into transcripts (id, organization_id, interaction_id, version, content, language, confidence) values ($1, $2, $3, 1, $4, 'pt-BR', 0.9)
           on conflict (id) do update set content = excluded.content`,
          [idOf(`transcript:${call.key}`), org, interactionId, transcriptOf(call.lines, firstName(nameOfPerson.get(owner) ?? "Atendente"))],
        )
        await client.query(`delete from interaction_flags where interaction_id = $1`, [interactionId])
        if (call.flags.nota_ura !== undefined) await client.query(`insert into interaction_flags (organization_id, interaction_id, channel_flag_id, value_numeric, received_at) values ($1, $2, $3, $4, $5)`, [org, interactionId, flagIds.get("nota_ura")!, call.flags.nota_ura, endedAt])
        if (call.flags.rechamada) await client.query(`insert into interaction_flags (organization_id, interaction_id, channel_flag_id, value_boolean, received_at) values ($1, $2, $3, true, $4)`, [org, interactionId, flagIds.get("rechamada")!, endedAt])
      }
    }
    for (const { plan, indicatorId } of plans) {
      for (const day of plan.daily) {
        await client.query(
          `insert into indicator_measurements (id, organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator, sample_count)
           values ($1, $2, $3, 'PERSON', $4, $5, $6, $7, $8, 'DAILY', $9, $10::numeric, $10::int)
           on conflict (id) do update set value = excluded.value, numerator = excluded.numerator, denominator = excluded.denominator, sample_count = excluded.sample_count`,
          [idOf(`daily:${plan.code}:${day.date}`), org, indicatorId, LARISSA, plan.valueOf(day.numerator, day.denominator), `${day.date} 00:00:00-03`, `${day.date} 23:59:59-03`, SOURCE, day.numerator, day.denominator],
        )
      }
    }
    for (const { indicatorId, closings } of plans) {
      for (const closing of closings) {
        await client.query(
          `insert into employee_indicator_performance (id, organization_id, person_id, indicator_definition_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, source)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (id) do nothing`,
          [closing.id, org, closing.personId, indicatorId, SUBTEAM, PERIOD, closing.value, closing.target, closing.achievement, closing.weight, closing.quartile, SOURCE],
        )
      }
    }
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, null, 'DEV_SCENARIO_URA_REINCIDENCIA_SETEMBRO_APPLIED', 'person', $2, $3)`,
      [org, LARISSA, JSON.stringify({ calls: allCalls.length, daily: dailyIds.length, closings: plans.map(({ plan, closings }) => ({ code: plan.code, people: closings.length })), period: PERIOD })],
    )
    await client.query("commit")
    console.log(`Aplicado: ${allCalls.length} chamadas, ${dailyIds.length} medições diárias, ${plans.map(({ plan, closings }) => `${closings.length} fechamentos de ${plan.code}`).join(", ")} (${PERIOD}).`)
  } catch (error) {
    await (client as Queryable).query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

await main()
