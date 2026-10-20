/**
 * PROVA contra o banco de TESTE real — registro de leitura de dados pessoais (migration 151). Fixture apagada no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run personal-data-access-log-proof
 *
 * Prova: abrir a ficha de outra pessoa pela rota de verdade registra quem viu, quem foi visto e quando; reabrir em até 10 minutos
 * não grava de novo; ler os próprios dados não é registrado; "quem viu os dados desta pessoa" responde pelo registro.
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { personalDataAccessesOf, recordPersonalDataAccess } from "../application/personal-data-access-log.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const PASSWORD = "Cajueiro-Prova-2026"
let pool: pg.Pool

describe.skipIf(!ENABLED)("Registro de leitura de dados pessoais — prova Postgres", () => {
  const people: string[] = []
  const accounts: string[] = []
  let leader: string
  let operator: string
  let leaderEmail: string

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 6 })
    const team = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at, id limit 1", [ORG])).rows[0]!.id
    leader = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, active) values ($1,'Líder Prova Acesso','SUPERVISOR',$2,true) returning id", [ORG, team])).rows[0]!.id
    operator = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, reports_to_id, active) values ($1,'Operadora Prova Acesso','OPERATOR',$2,$3,true) returning id", [ORG, team, leader])).rows[0]!.id
    people.push(operator, leader)
    leaderEmail = `lider-acesso-${leader.slice(0, 8)}@prova.inia.local`
    accounts.push((await pool.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash, active, password_change_required) values ($1,$2,$3,$4,true,false) returning id", [ORG, leader, leaderEmail, await hashPassword(PASSWORD)])).rows[0]!.id)
  })

  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from personal_data_access_log where viewer_person_id = any($1) or subject_person_id = any($1)", [people])
    await pool.query("delete from auth_login_attempts where account_id = any($1)", [accounts])
    await pool.query("delete from user_accounts where id = any($1)", [accounts])
    await pool.query("delete from people where id = any($1)", [people])
    await pool.end()
  })

  it("abrir a ficha de outra pessoa registra a leitura; reabrir em seguida não grava de novo", async () => {
    const app = createApp(pool, { rateLimits: false })
    const agent = request.agent(app)
    expect((await agent.post("/api/v1/auth/login").set("Origin", env.allowedOrigins[0]!).send({ email: leaderEmail, password: PASSWORD })).status).toBe(200)
    expect((await agent.get(`/api/v1/supervisor/operators/${operator}`)).status).toBe(200)
    expect((await agent.get(`/api/v1/supervisor/operators/${operator}`)).status).toBe(200)
    const accesses = await personalDataAccessesOf(pool, ORG, operator)
    expect(accesses).toHaveLength(1)
    expect(accesses[0]).toMatchObject({ viewerPersonId: leader, viewerName: "Líder Prova Acesso", dataKind: "EMPLOYEE_PROFILE", resourceId: null })
  })

  it("ler os próprios dados não é registrado; outro tipo de dado ou outro registro grava separado; passados 10 minutos grava de novo", async () => {
    await recordPersonalDataAccess(pool, { organizationId: ORG, viewerPersonId: operator, subjectPersonId: operator, dataKind: "ASSISTANT_CONVERSATION", resourceId: "c-1" })
    expect(await personalDataAccessesOf(pool, ORG, operator)).toHaveLength(1)
    const now = new Date()
    await recordPersonalDataAccess(pool, { organizationId: ORG, viewerPersonId: leader, subjectPersonId: operator, dataKind: "CALL_TRANSCRIPT", resourceId: "a-1", at: now })
    await recordPersonalDataAccess(pool, { organizationId: ORG, viewerPersonId: leader, subjectPersonId: operator, dataKind: "CALL_TRANSCRIPT", resourceId: "a-2", at: now })
    await recordPersonalDataAccess(pool, { organizationId: ORG, viewerPersonId: leader, subjectPersonId: operator, dataKind: "CALL_TRANSCRIPT", resourceId: "a-1", at: new Date(now.getTime() + 5 * 60_000) })
    expect((await personalDataAccessesOf(pool, ORG, operator)).filter((entry) => entry.dataKind === "CALL_TRANSCRIPT")).toHaveLength(2)
    await recordPersonalDataAccess(pool, { organizationId: ORG, viewerPersonId: leader, subjectPersonId: operator, dataKind: "CALL_TRANSCRIPT", resourceId: "a-1", at: new Date(now.getTime() + 11 * 60_000) })
    expect((await personalDataAccessesOf(pool, ORG, operator)).filter((entry) => entry.dataKind === "CALL_TRANSCRIPT")).toHaveLength(3)
  })
})
