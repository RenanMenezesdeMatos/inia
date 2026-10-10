/**
 * HIGIENE DE SETEMBRO DA LARISSA (02/10/2026, decisão do usuário: "Mover para pessoa de QA").
 *
 * A Larissa Monteiro (DEMO-OP-0001) acumulou em 25–30/09 cerca de 90 CÓPIAS DE TESTE das rodadas de smoke (SMOKE-V171*…) e das
 * versões antigas do golden demo (sufixos -V, -V174B…G, -FX*, -MW*). Elas poluiriam o mês de setembro (o cenário de TMA ruim): 100
 * chamadas repetidas em 5 dias viram pico artificial e padrão contado várias vezes. Este script passa essas cópias — e tudo o que
 * pertence a elas (memória do motor, observações, feedbacks ocultos, entregas) — para uma pessoa de QA fora da estrutura. NADA é
 * apagado. Ficam com a Larissa: as versões-base de cada cenário do golden demo (uma por cenário, sem sufixo) e a contestação de 29/09
 * — inclusive todas as que sustentam feedbacks visíveis no Acompanhamento dela.
 *
 *   npx tsx scripts/dev/larissa-scenario/move-test-copies.ts            # ensaio: lista o que mudaria (nada gravado)
 *   npx tsx scripts/dev/larissa-scenario/move-test-copies.ts --apply    # aplica numa transação e grava o manifesto
 *   npx tsx scripts/dev/larissa-scenario/move-test-copies.ts --undo <manifesto.json>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../src/infrastructure/database/pool.js"

const here = dirname(fileURLToPath(import.meta.url))
const LARISSA = "de00ae6a-c8c9-490a-816b-e3cc8cf18986"
const QA_MATRICULA = "QA-DEMO-OP-0001"
const QA_NAME = "Larissa Monteiro · QA (cópias de teste)"
/** Cópia de teste = SMOKE-* ou golden demo com sufixo depois de -OK/-GAP. A versão-base (termina em -OK/-GAP) fica com ela. */
const COPY_PATTERN = "^(SMOKE-.+|GOLDEN-LARISSA-ARG-[0-9]{3}-.+-(OK|GAP)-.+)$"

/** Tabelas com interaction_id e uma coluna de pessoa: a pessoa acompanha a chamada. */
const BY_INTERACTION: { table: string; column: string }[] = [
  { table: "call_assessments", column: "person_id" },
  { table: "call_criterion_assessments", column: "person_id" },
  { table: "feedback_analysis_runs", column: "person_id" },
  { table: "process_checkpoint_observations", column: "person_id" },
  { table: "reliable_feedback_artifacts", column: "collaborator_id" },
  { table: "interaction_feedback_generations", column: "collaborator_id" },
  { table: "interaction_feedback_runs", column: "collaborator_id" },
  { table: "operational_issue_occurrences", column: "collaborator_id" },
  { table: "monitoring_evaluations", column: "operator_id" },
  { table: "monitoring_triggers", column: "operator_id" },
  { table: "operator_diagnostics", column: "operator_id" },
  { table: "workflow_manual_runs", column: "collaborator_id" },
]
/** Tabelas ligadas pela matrícula do Workflow (enrollment) das chamadas movidas. */
const BY_ENROLLMENT: { table: string; column: string }[] = [
  { table: "workflow_output_emissions", column: "recipient_id" },
  { table: "workflow_outputs", column: "recipient_id" },
  { table: "feedback_engine_messages", column: "person_id" },
]

type Manifest = { appliedAt: string; qaPersonId: string; interactions: { id: string; externalId: string }[]; rows: Record<string, string[]> }

async function main() {
  const apply = process.argv.includes("--apply")
  const undoIndex = process.argv.indexOf("--undo")
  const client = await pool.connect()
  try {
    if (undoIndex >= 0) {
      const manifest = JSON.parse(readFileSync(process.argv[undoIndex + 1]!, "utf8")) as Manifest
      await client.query("begin")
      for (const [key, ids] of Object.entries(manifest.rows)) {
        const [table, column] = key.split(".")
        if (ids.length > 0) await client.query(`update ${table} set ${column} = $1 where id = any($2::uuid[]) and ${column} = $3`, [LARISSA, ids, manifest.qaPersonId])
      }
      await client.query(`update interactions set operator_id = $1 where id = any($2::uuid[]) and operator_id = $3`, [LARISSA, manifest.interactions.map((entry) => entry.id), manifest.qaPersonId])
      await client.query("commit")
      console.log(`Desfeito: ${manifest.interactions.length} chamadas devolvidas à Larissa.`)
      return
    }

    const org = (await client.query<{ organization_id: string }>(`select organization_id from people where id = $1`, [LARISSA])).rows[0]!.organization_id
    const copies = (await client.query<{ id: string; external_id: string }>(
      `select id, external_id from interactions where operator_id = $1 and external_id ~ $2 order by external_id`, [LARISSA, COPY_PATTERN],
    )).rows
    const keep = (await client.query<{ external_id: string }>(
      `select external_id from interactions where operator_id = $1 and started_at >= '2026-09-01' and not (external_id ~ $2) order by external_id`, [LARISSA, COPY_PATTERN],
    )).rows.map((row) => row.external_id)
    const ids = copies.map((row) => row.id)
    // Segurança: nenhuma chamada movida pode sustentar um feedback VISÍVEL no Acompanhamento dela.
    const visible = (await client.query<{ feedback_id: string; external_id: string }>(
      `select f.id feedback_id, i.external_id from feedbacks f
         join workflow_output_emissions e on e.feedback_id = f.id
         join workflow_enrollments w on w.id = e.enrollment_id
         join interactions i on i.id = w.interaction_id
        where f.operator_id = $1 and i.id = any($2::uuid[])
          and not exists (select 1 from feedback_follow_up_hides h where h.feedback_id = f.id and h.restored_at is null)`,
      [LARISSA, ids],
    )).rows
    if (visible.length > 0) throw new Error(`Recusado: ${visible.length} feedback(s) visível(is) dependem de cópias (${visible.map((row) => row.external_id).join(", ")}).`)

    const enrollmentIds = (await client.query<{ id: string }>(`select id from workflow_enrollments where interaction_id = any($1::uuid[])`, [ids])).rows.map((row) => row.id)
    const plan: Record<string, string[]> = {}
    for (const { table, column } of BY_INTERACTION) {
      plan[`${table}.${column}`] = (await client.query<{ id: string }>(`select id from ${table} where interaction_id = any($1::uuid[]) and ${column} = $2`, [ids, LARISSA])).rows.map((row) => row.id)
    }
    for (const { table, column } of BY_ENROLLMENT) {
      plan[`${table}.${column}`] = (await client.query<{ id: string }>(`select id from ${table} where enrollment_id = any($1::uuid[]) and ${column} = $2`, [enrollmentIds, LARISSA])).rows.map((row) => row.id)
    }
    const feedbackIds = (await client.query<{ id: string; case_id: string | null }>(
      `select distinct f.id, f.case_id from feedbacks f join workflow_output_emissions e on e.feedback_id = f.id where e.enrollment_id = any($1::uuid[]) and f.operator_id = $2`,
      [enrollmentIds, LARISSA],
    )).rows
    plan["feedbacks.operator_id"] = feedbackIds.map((row) => row.id)
    const caseIds = [...new Set(feedbackIds.map((row) => row.case_id).filter((id): id is string => Boolean(id)))]
    plan["supervision_cases.operator_id"] = (await client.query<{ id: string }>(`select id from supervision_cases where id = any($1::uuid[]) and operator_id = $2`, [caseIds, LARISSA])).rows.map((row) => row.id)

    console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", copies: copies.length, keepWithLarissaInSeptember: keep, enrollments: enrollmentIds.length, rows: Object.fromEntries(Object.entries(plan).map(([key, value]) => [key, value.length])) }, null, 2))
    if (!apply) return

    await client.query("begin")
    let qa = (await client.query<{ id: string }>(`select id from people where organization_id = $1 and matricula = $2`, [org, QA_MATRICULA])).rows[0]
    if (!qa) {
      qa = (await client.query<{ id: string }>(
        `insert into people (organization_id, name, role, active, matricula, job_title, bio) values ($1, $2, 'OPERATOR', false, $3, 'QA — cópias de teste', 'Pessoa técnica que guarda as cópias de teste das rodadas de smoke da Larissa Monteiro (fora da estrutura; não aparece em comparações).') returning id`,
        [org, QA_NAME, QA_MATRICULA],
      )).rows[0]!
    }
    for (const [key, rowIds] of Object.entries(plan)) {
      const [table, column] = key.split(".")
      if (rowIds.length > 0) await client.query(`update ${table} set ${column} = $1 where id = any($2::uuid[])`, [qa.id, rowIds])
    }
    await client.query(`update interactions set operator_id = $1 where id = any($2::uuid[])`, [qa.id, ids])
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, null, 'DEV_TEST_COPIES_MOVED_TO_QA_PERSON', 'person', $2, $3)`,
      [org, LARISSA, JSON.stringify({ qaPersonId: qa.id, interactions: ids.length, reason: "Higiene de setembro para o cenário de TMA ruim (decisão do usuário em 02/10/2026)" })],
    )
    await client.query("commit")
    const manifest: Manifest = { appliedAt: new Date().toISOString(), qaPersonId: qa.id, interactions: copies.map((row) => ({ id: row.id, externalId: row.external_id })), rows: plan }
    const dir = join(here, "results")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const out = join(dir, `move-test-copies-${manifest.appliedAt.replace(/[:.]/g, "-")}.json`)
    writeFileSync(out, JSON.stringify(manifest, null, 2))
    console.log(`Aplicado. Manifesto (para desfazer): ${out}`)
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

await main()
