/**
 * PROVA no banco de TESTE real: reenviar a MESMA interação pela ingestão em tempo real (`POST /ingestion/interactions`) não
 * rematricula os Workflows da flag quando a flag chega com o MESMO valor — só flag nova ou com valor alterado matricula, a mesma
 * regra da Central de Dados (`interaction-writers.ts`). Antes cada reenvio criava outra execução em cada Workflow e duplicava
 * escalonamentos e avisos (validação funcional de 20/10/2026, D4). Dados COMMITADOS (a rota abre a própria transação) e apagados.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run flag-reingestion-proof
 */
import express from "express"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createIngestionRouter } from "../presentation/ingestion-router.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATION = "00000000-0000-4000-8000-000000000010"
const GRAPH = { nodes: [{ id: "trigger", type: "trigger", label: "Flag", position: { x: 0, y: 0 }, config: {} }], edges: [] }
const created = { team: null as string | null, person: null as string | null, flag: null as string | null, workflows: [] as string[], externalId: `PROOF-REINGEST-${Date.now()}` }
let pool: pg.Pool

describe.skipIf(!ENABLED)("Ingestão: reenvio da mesma interação não rematricula (banco real)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 })
    created.team = (await pool.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, $3) returning id", [ORG, OPERATION, `Proof Reingest ${Date.now()}`])).rows[0]!.id
    created.person = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, 'Proof Reingest Operadora', 'OPERATOR', $2) returning id", [ORG, created.team])).rows[0]!.id
    created.flag = (await pool.query<{ id: string }>("insert into channel_flags (organization_id, channel, flag_name, value_type) values ($1, 'VOICE', $2, 'BOOLEAN') returning id", [ORG, `proof_reingest_${Date.now()}`])).rows[0]!.id
    for (const name of ["Proof Reingest A", "Proof Reingest B"]) {
      const id = (await pool.query<{ id: string }>("insert into workflows (organization_id, name, scope_type, team_id, trigger_config) values ($1, $2, 'TEAM', $3, $4) returning id", [ORG, name, created.team, JSON.stringify({ kind: "channel_flag", channelFlagId: created.flag })])).rows[0]!.id
      const version = (await pool.query<{ id: string }>("insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id", [id, JSON.stringify(GRAPH)])).rows[0]!.id
      await pool.query("update workflows set active_version_id = $2 where id = $1", [id, version])
      created.workflows.push(id)
    }
  })

  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from workflow_enrollments where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("update workflows set active_version_id = null where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflow_versions where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflows where id = any($1::uuid[])", [created.workflows])
    const interactions = (await pool.query<{ id: string }>("select id from interactions where organization_id = $1 and external_id = $2", [ORG, created.externalId])).rows.map((row) => row.id)
    await pool.query("delete from interaction_flags where interaction_id = any($1::uuid[])", [interactions])
    await pool.query("delete from transcripts where interaction_id = any($1::uuid[])", [interactions])
    await pool.query("delete from interactions where id = any($1::uuid[])", [interactions])
    await pool.query("delete from channel_flags where id = $1", [created.flag])
    await pool.query("delete from people where id = $1", [created.person])
    await pool.query("delete from teams where id = $1", [created.team])
    await pool.end()
  })

  it("mesma flag e mesmo valor = nenhuma matrícula nova; valor alterado = uma nova em cada Workflow", async () => {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { req.user = { sub: "proof", personId: created.person!, organizationId: ORG, role: "ADMIN", name: "Prova", email: "proof@inia.local", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }; next() })
    app.use("/ingestion", createIngestionRouter(pool as unknown as Database))
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- o Express só trata como manipulador de erro com 4 parâmetros
    app.use((error: { statusCode?: number; code?: string; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error.statusCode ?? 500).json({ error: { code: error.code, message: error.message } }) })

    const flagName = (await pool.query<{ flag_name: string }>("select flag_name from channel_flags where id = $1", [created.flag])).rows[0]!.flag_name
    const send = (value: boolean) => request(app).post("/ingestion/interactions").send({
      externalId: created.externalId, operatorId: created.person, reason: "Prova de reenvio", channel: "VOICE",
      startedAt: "2026-10-20T13:00:00.000Z", endedAt: "2026-10-20T13:05:00.000Z", transcript: { content: "Operador: bom dia. Cliente: bom dia." }, flags: { [flagName]: value },
    })
    const enrollments = async () => (await pool.query<{ n: number }>("select count(*)::int n from workflow_enrollments where workflow_id = any($1::uuid[])", [created.workflows])).rows[0]!.n

    expect((await send(true)).status).toBe(202)
    expect(await enrollments()).toBe(2)
    expect((await send(true)).status).toBe(202)
    expect(await enrollments()).toBe(2)
    expect((await send(false)).status).toBe(202)
    expect(await enrollments()).toBe(4)
    expect((await send(false)).status).toBe(202)
    expect(await enrollments()).toBe(4)
    const values = (await pool.query<{ matched_value_boolean: boolean }>("select matched_value_boolean from workflow_enrollments where workflow_id = any($1::uuid[]) order by created_at", [created.workflows])).rows.map((row) => row.matched_value_boolean)
    expect(values).toEqual([true, true, false, false])
  })
})
