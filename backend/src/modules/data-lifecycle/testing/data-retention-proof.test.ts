import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { fixedClock } from "../../../shared/domain/clock.js"
import { protectionPredicate, runDataRetention } from "../application/run-data-retention.js"
import { RETENTION_CATALOG, retentionTargetOf } from "../domain/retention-catalog.js"

/**
 * PROVA no banco de TESTE real do mecanismo de retenção (migration 140; docs/dev/escala-read-model-e-ciclo-de-vida.md):
 *  - todas as políticas nascem DESLIGADAS: a tarefa não apaga nada;
 *  - ligada (alertas, 30 dias): só sai o alerta RESOLVIDO mais antigo que o corte; aberto e referenciado ficam;
 *  - interação: evidência de feedback (FK, `evidences.source_id`, `feedbacks.context_snapshot`) nunca sai; a sem
 *    referência sai com transcrição e flags (CASCADE de verdade);
 *  - uso de IA: o bruto sai, o resumo diário `ai_usage_daily` fica intacto;
 *  - medições: política ligada é RECUSADA (bloqueio estrutural), nada apagado;
 *  - todo o catálogo monta o predicado de proteção contra o catálogo real do PostgreSQL.
 * Tudo dentro de uma transação revertida.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run data-retention-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const NOW = new Date("2031-06-15T12:00:00Z")
const OLD = new Date("2031-01-10T12:00:00Z")
const RECENT = new Date("2031-06-10T12:00:00Z")

let pool: pg.Pool
let client: pg.PoolClient
let db: Database

async function enable(table: string, days: number) {
  await client.query(`update data_retention_policies set retention_days = $2, enabled = true, decided_at = now(), decided_by = 'prova', note = 'prova' where table_name = $1`, [table, days])
}

describe.skipIf(!ENABLED)("retenção de dados — prova no banco de teste", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.activeDatabaseUrl, max: 1 })
    client = await pool.connect()
    db = client as unknown as Database
    await client.query("begin")
  })

  afterAll(async () => {
    await client?.query("rollback")
    client?.release()
    await pool?.end()
  })

  it("todas as políticas nascem desligadas e sem prazo; a tarefa não apaga nada", async () => {
    const policies = await client.query<{ table_name: string; enabled: boolean; retention_days: number | null }>(`select table_name, enabled, retention_days from data_retention_policies order by table_name`)
    expect(policies.rows.map((row) => row.table_name).sort()).toEqual(RETENTION_CATALOG.map((target) => target.table).sort())
    expect(policies.rows.every((row) => !row.enabled && row.retention_days === null)).toBe(true)
    expect(await runDataRetention(db, { clock: fixedClock(NOW) })).toEqual([])
  })

  it("todo o catálogo monta o predicado de proteção contra o catálogo real do PostgreSQL", async () => {
    for (const target of RETENTION_CATALOG) {
      const predicate = await protectionPredicate(db, target)
      await client.query(`select count(*) from ${target.table} t where not (${predicate}) and false`)
    }
  })

  it("alertas: só o RESOLVIDO mais antigo que o corte sai; aberto e referenciado por reconciliação ficam", async () => {
    const recipient = (await client.query<{ id: string }>(`select id from people where organization_id = $1 limit 1`, [ORG])).rows[0]!.id
    const alert = async (status: string, createdAt: Date, title: string) =>
      (
        await client.query<{ id: string }>(
          `insert into alerts (organization_id, recipient_id, alert_type, severity, title, description, status, created_at, dedupe_key) values ($1, $2, 'WORKFLOW_OUTPUT', 'INFO', $3, 'prova', $4, $5, 'prova-retencao:' || $3) returning id`,
          [ORG, recipient, title, status, createdAt.toISOString()],
        )
      ).rows[0]!.id
    const oldResolved = await alert("RESOLVED", OLD, "prova-retencao-1")
    const oldOpen = await alert("OPEN", OLD, "prova-retencao-2")
    const recentResolved = await alert("RESOLVED", RECENT, "prova-retencao-3")
    // Alertas resolvidos antigos que uma reconciliação referencia (o banco de teste é compartilhado com outras provas:
    // a prova confere linhas que ela conhece, nunca contagens globais).
    const referenced = (await client.query<{ id: string }>(`select a.id from alerts a where a.status = 'RESOLVED' and exists (select 1 from workday_reconciliations w where w.alert_id = a.id) limit 200`)).rows.map((row) => row.id)
    await enable("alerts", 30)
    const [result] = await runDataRetention(db, { clock: fixedClock(NOW) })
    expect(result).toMatchObject({ table: "alerts", outcome: "COMPLETED" })
    const left = await client.query<{ id: string }>(`select id from alerts where id = any($1::uuid[])`, [[oldResolved, oldOpen, recentResolved]])
    expect(left.rows.map((row) => row.id).sort()).toEqual([oldOpen, recentResolved].sort())
    expect(result!.deletedRows).toBeGreaterThanOrEqual(1)
    expect((await client.query(`select 1 from alerts where id = any($1::uuid[])`, [referenced])).rowCount).toBe(referenced.length)
    const run = await client.query(`select outcome, deleted_rows from data_retention_runs where table_name = 'alerts' order by id desc limit 1`)
    expect(run.rows[0]).toEqual({ outcome: "COMPLETED", deleted_rows: result!.deletedRows })
    await client.query(`update data_retention_policies set enabled = false where table_name = 'alerts'`)
  })

  it("interações: evidência (FK, evidences.source_id, context_snapshot) fica; a sem referência sai com transcrição e flags", async () => {
    const operator = (await client.query<{ id: string }>(`select id from people where organization_id = $1 and role = 'OPERATOR' limit 1`, [ORG])).rows[0]!.id
    const interaction = async (externalId: string) =>
      (
        await client.query<{ id: string }>(`insert into interactions (organization_id, operator_id, external_id, started_at, ended_at, channel, reason) values ($1, $2, $3, $4, $5, 'VOICE', 'prova') returning id`, [ORG, operator, externalId, OLD.toISOString(), new Date(OLD.getTime() + 60_000).toISOString()])
      ).rows[0]!.id
    const free = await interaction("prova-retencao-livre")
    const byEvidence = await interaction("prova-retencao-evidencia")
    const bySnapshot = await interaction("prova-retencao-snapshot")
    await client.query(`insert into transcripts (organization_id, interaction_id, version, content, language) values ($1, $2, 1, 'texto', 'pt-BR'), ($1, $3, 1, 'texto', 'pt-BR')`, [ORG, free, byEvidence])
    const caseId = (await client.query<{ id: string }>(`select id from supervision_cases where organization_id = $1 limit 1`, [ORG])).rows[0]!.id
    await client.query(`insert into evidences (organization_id, case_id, evidence_type, title, description, source_type, source_id, occurred_at, checksum) values ($1, $2, 'TRANSCRIPT', 'prova', 'prova', 'INTERACTION', $3, now(), 'x')`, [ORG, caseId, byEvidence])
    const feedback = (await client.query<{ id: string }>(`select id from feedbacks where organization_id = $1 limit 1`, [ORG])).rows[0]!.id
    await client.query(`update feedbacks set context_snapshot = context_snapshot || jsonb_build_object('interactionId', $2::text) where id = $1`, [feedback, bySnapshot])
    // O banco de teste tem outras interações antigas: a prova confere as três dela e que as interações PROTEGIDAS que ela
    // conhecia antes da rodada continuam lá.
    const protectedPredicate = await protectionPredicate(db, retentionTargetOf("interactions")!)
    const protectedSample = (await client.query<{ id: string }>(`select t.id from interactions t where ${protectedPredicate} limit 500`)).rows.map((row) => row.id)
    await enable("interactions", 30)
    const [result] = await runDataRetention(db, { clock: fixedClock(NOW) })
    expect(result).toMatchObject({ table: "interactions", outcome: "COMPLETED" })
    const left = await client.query<{ id: string }>(`select id from interactions where id = any($1::uuid[])`, [[free, byEvidence, bySnapshot]])
    expect(left.rows.map((row) => row.id).sort()).toEqual([byEvidence, bySnapshot].sort())
    expect((await client.query(`select 1 from transcripts where interaction_id = $1`, [free])).rowCount).toBe(0)
    expect((await client.query(`select 1 from transcripts where interaction_id = $1`, [byEvidence])).rowCount).toBe(1)
    expect(protectedSample.length).toBeGreaterThan(0)
    expect((await client.query(`select 1 from interactions where id = any($1::uuid[])`, [protectedSample])).rowCount).toBe(protectedSample.length)
    await client.query(`update data_retention_policies set enabled = false where table_name = 'interactions'`)
  })

  it("uso de IA: o bruto antigo sai, o resumo diário fica intacto", async () => {
    const before = await client.query(`select local_date::text, use_case, provider_key, currency, cost_sum::text, event_count, unknown_success_count from ai_usage_daily where organization_id = $1 order by 1, 2, 3, 4`, [ORG])
    await enable("ai_usage_events", 1)
    const [result] = await runDataRetention(db, { clock: fixedClock(NOW) })
    expect(result).toMatchObject({ table: "ai_usage_events", outcome: "COMPLETED" })
    expect((await client.query(`select 1 from ai_usage_events where organization_id = $1 and occurred_at < $2`, [ORG, new Date(NOW.getTime() - 86_400_000).toISOString()])).rowCount).toBe(0)
    const after = await client.query(`select local_date::text, use_case, provider_key, currency, cost_sum::text, event_count, unknown_success_count from ai_usage_daily where organization_id = $1 order by 1, 2, 3, 4`, [ORG])
    expect(after.rows).toEqual(before.rows)
    await client.query(`update data_retention_policies set enabled = false where table_name = 'ai_usage_events'`)
  })

  it("medições: política ligada é RECUSADA pelo bloqueio estrutural e nada é apagado", async () => {
    const old = (await client.query<{ id: string }>(`select id from indicator_measurements where period_start < $1 order by period_start limit 200`, [OLD.toISOString()])).rows.map((row) => row.id)
    await enable("indicator_measurements", 1)
    const [result] = await runDataRetention(db, { clock: fixedClock(NOW) })
    expect(result).toMatchObject({ table: "indicator_measurements", outcome: "REFUSED", deletedRows: 0 })
    expect(old.length).toBeGreaterThan(0)
    expect((await client.query(`select 1 from indicator_measurements where id = any($1::uuid[])`, [old])).rowCount).toBe(old.length)
  })
})
