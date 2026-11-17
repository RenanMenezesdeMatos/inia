/**
 * PROVA contra um banco real (migrations até a 207): correções da revisão do universo de atuação (auditoria run-4, delta-universo).
 * Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run operating-universe-review-proof
 * UB-01 exceção limpa pela carga (coluna mapeada e vazia) e pela ficha; exceção redundante da 204 sai na 207 · UB-02 operador que já
 * existe não fica pendente ao mudar de Grupo/nível (carga e ficha) · UB-03 Subgrupo sem universo com operadores órfãos · UB-04 ninguém
 * reclassifica a unidade de onde herda o próprio universo · UB-05 data inexistente/futura · UB-06 vigência retroativa sem período de
 * duração zero, e a leitura ignora os que já existem · UB-11 a 204 e a 207 reaplicam sem erro.
 */
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { MIGRATIONS_DIRECTORY } from "../../../infrastructure/database/run-migrations.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { employeesWriter } from "../../data-hub/application/writers/master-data-writers.js"
import type { CanonicalRecord } from "../../data-hub/domain/data-contract.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient
// Estado compartilhado entre os passos (mesma transação, em ordem).
let org: string
let tag: string
let teamA: string, teamB: string, teamN: string, subS: string
let p3: string, p4: string
let asAdmin: ReturnType<typeof request.agent>
type Person = { operating_universe: string | null; operating_universe_override: string | null; team_id: string; role: string; name: string }
const person = async (matricula: string | null, role: string, teamId: string, override: string | null, subteamId: string | null = null) =>
  (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id, subteam_id, matricula, operating_universe_override) values ($1,$2,$3,$4,$5,$6,$7) returning id", [org, `Proof Revisao ${matricula ?? randomUUID().slice(0, 6)}`, role, teamId, subteamId, matricula ? `${tag}-${matricula}` : null, override])).rows[0]!.id
const universeOf = async (id: string) => (await client.query<Person>("select operating_universe, operating_universe_override, team_id, role, name from people where id = $1", [id])).rows[0]!
/** Carga de Colaboradores pelo writer real (sem o resto do pipeline). */
const load = async (rows: CanonicalRecord[], universeMapped: boolean) => {
  const targets = ["externalEmployeeId", "name", "role", "groupExternalCode", ...(universeMapped ? ["operatingUniverse"] : [])]
  const context = {
    ctx: { db: client, clock: { now: () => new Date() } },
    organizationId: org,
    timeZone: "America/Sao_Paulo",
    feed: { id: randomUUID(), contractKey: "EMPLOYEES", contractVersion: 1, authoritative: false, mapping: { fields: targets.map((target) => ({ target, source: target, transforms: [] })) } },
    runId: randomUUID(),
    sourceNamespace: "PROOF",
  } as never
  const records = rows.map((record, index) => ({ recordNumber: index + 1, sourceRecordKey: String(record.externalEmployeeId), record: { ...record, externalEmployeeId: `${tag}-${record.externalEmployeeId}`, groupExternalCode: record.groupExternalCode ? `PRUB-${tag}-${record.groupExternalCode}` : null } }))
  const { ready, rejections } = await employeesWriter.prepare(context, records)
  await employeesWriter.apply(context, client as never, ready)
  return rejections.map((rejection) => [String(rejection.sourceRecordKey), rejection.error.code])
}

describe.skipIf(!ENABLED)("Universo de atuação — revisão (auditoria run-4) — prova Postgres", () => {
  beforeAll(async () => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL }); client = await pool.connect(); await client.query("begin") })
  afterAll(async () => { if (client) { await client.query("rollback"); client.release() } if (pool) await pool.end() })

  it("UB-01/UB-11: a 207 limpa só a exceção redundante; 204 e 207 reaplicam sem erro", async () => {
    org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!.id
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [org])).rows[0]!.id
    tag = randomUUID().slice(0, 8)
    const team = async (code: string, universe: string | null) => (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name, external_code, operating_universe) values ($1,$2,$3,$3,$4) returning id", [org, operation, `PRUB-${tag}-${code}`, universe])).rows[0]!.id
    teamA = await team("A", "B2C")
    teamB = await team("B", "B2B")
    teamN = await team("N", null)
    subS = (await client.query<{ id: string }>("insert into subteams (organization_id, team_id, name, external_code, operating_universe) values ($1,$2,$3,$3,'B2X') returning id", [org, teamN, `PRUB-${tag}-N/S`])).rows[0]!.id
    // UB-01 (207): exceção igual ao universo herdado é redundante e sai; exceção diferente continua. Reaplicar a 207 não falha.
    const redundant = await person("M6", "OPERATOR", teamA, "B2C")
    const real = await person("M7", "OPERATOR", teamA, "B2X")
    await client.query(await readFile(join(MIGRATIONS_DIRECTORY, "207_operating_universe_review_fixes.sql"), "utf8"))
    expect(await universeOf(redundant)).toMatchObject({ operating_universe: "B2C", operating_universe_override: null })
    expect(await universeOf(real)).toMatchObject({ operating_universe: "B2X", operating_universe_override: "B2X" })

    // UB-11: a 204 reaplica sem erro (e sem refazer o legado — a exceção limpa acima continua limpa).
    await client.query("savepoint rerun_204")
    await client.query(await readFile(join(MIGRATIONS_DIRECTORY, "204_operating_universe_by_group.sql"), "utf8"))
    expect((await universeOf(redundant)).operating_universe_override).toBeNull()
    await client.query("rollback to savepoint rerun_204")
    // Exigência ativa daqui em diante.
    await client.query("update organizations set operating_universe_enforced_at = now() where id = $1", [org])
  })

  it("UB-01 (carga): coluna mapeada e vazia limpa a exceção; não mapeada mantém", async () => {
    // UB-01: coluna do universo mapeada e vazia = sem exceção (herda do Grupo); coluna não mapeada = mantém a exceção.
    const p1 = await person("M1", "OPERATOR", teamA, "B2B")
    const p2 = await person("M2", "OPERATOR", teamA, "B2B")
    expect(await load([{ externalEmployeeId: "M1", name: "Proof Revisao M1", role: "OPERATOR", groupExternalCode: "A", operatingUniverse: null }], true)).toEqual([])
    expect(await universeOf(p1)).toMatchObject({ operating_universe: "B2C", operating_universe_override: null })
    expect(await load([{ externalEmployeeId: "M2", name: "Proof Revisao M2", role: "OPERATOR", groupExternalCode: "A", operatingUniverse: null }], false)).toEqual([])
    expect(await universeOf(p2)).toMatchObject({ operating_universe: "B2B", operating_universe_override: "B2B" })
  })

  it("UB-02 (carga): operador existente não fica pendente ao mudar de Grupo ou de nível", async () => {
    // UB-02 (carga): operador que já existe indo para Grupo sem universo, e supervisor virando operador nele, vão para a quarentena e
    // o cadastro fica como estava; operador já pendente em que só o nome muda continua passando.
    p3 = await person("M3", "OPERATOR", teamA, null)
    p4 = await person("M4", "SUPERVISOR", teamN, null)
    const p5 = await person("M5", "OPERATOR", teamN, null)
    const rejected = await load([
      { externalEmployeeId: "M3", name: "Proof Revisao M3", role: "OPERATOR", groupExternalCode: "N" },
      { externalEmployeeId: "M4", name: "Proof Revisao M4", role: "OPERATOR", groupExternalCode: "N" },
      { externalEmployeeId: "M5", name: "Proof Revisao M5 novo nome", role: "OPERATOR", groupExternalCode: "N" },
    ], false)
    expect(rejected).toEqual([["M3", "DATA_OPERATING_UNIVERSE_REQUIRED"], ["M4", "DATA_OPERATING_UNIVERSE_REQUIRED"]])
    expect(await universeOf(p3)).toMatchObject({ team_id: teamA, operating_universe: "B2C" })
    expect(await universeOf(p4)).toMatchObject({ role: "SUPERVISOR" })
    expect(await universeOf(p5)).toMatchObject({ name: "Proof Revisao M5 novo nome", operating_universe: null })
  })

  it("UB-01/UB-02 (ficha): limpa a exceção; recusa deixar operador pendente", async () => {
    // Ficha e Grupos/Subgrupos pela API, com um administrador da organização que herda o universo do Grupo B.
    const hash = await hashPassword("Proof@12345")
    const admin = await person(null, "ADMIN", teamB, null)
    const email = `admin-${tag}@proof-universo-revisao.inia.local`
    const account = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,$4) returning id", [org, admin, email, hash])).rows[0]!.id
    await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1,$2,'ADMINISTRADOR_GERAL','ORGANIZATION',now())", [org, account])
    asAdmin = request.agent(createApp(client as never))
    expect((await asAdmin.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)

    // UB-01 (ficha): sem feed mandando no campo, "sem exceção" limpa a exceção e a pessoa volta a herdar.
    const p8 = await person(null, "OPERATOR", teamA, "B2B")
    expect((await asAdmin.patch(`/api/v1/admin/users/${p8}`).send({ operatingUniverse: null })).status).toBe(200)
    expect(await universeOf(p8)).toMatchObject({ operating_universe: "B2C", operating_universe_override: null })
    // UB-02 (ficha): mover operador para Grupo sem universo, ou passar supervisor a operador nele, é recusado.
    const moved = await asAdmin.patch(`/api/v1/admin/users/${p3}`).send({ teamId: teamN })
    expect([moved.status, moved.body.error?.code]).toEqual([422, "OPERATING_UNIVERSE_REQUIRED"])
    const demoted = await asAdmin.patch(`/api/v1/admin/users/${p4}`).send({ role: "OPERATOR" })
    expect([demoted.status, demoted.body.error?.code]).toEqual([422, "OPERATING_UNIVERSE_REQUIRED"])
    // Para Grupo com universo, passa.
    expect((await asAdmin.patch(`/api/v1/admin/users/${p3}`).send({ teamId: teamB })).status).toBe(200)
    expect((await universeOf(p3)).operating_universe).toBe("B2B")
  })

  it("UB-03/UB-04/UB-05: Grupos e Subgrupos — órfãos do Subgrupo, o próprio universo, datas", async () => {
    // UB-03: tirar o universo do Subgrupo com operadores que voltariam a herdar de um Grupo sem universo é recusado.
    await person(null, "OPERATOR", teamN, null, subS)
    const orphan = await asAdmin.put(`/api/v1/admin/operating-universe/units/SUBTEAM/${subS}`).send({ operatingUniverse: null })
    expect([orphan.status, orphan.body.error?.code]).toEqual([422, "OPERATING_UNIVERSE_REQUIRED"])
    // UB-04: o administrador herda do Grupo B — reclassificá-lo mudaria o próprio universo.
    const self = await asAdmin.put(`/api/v1/admin/operating-universe/units/TEAM/${teamB}`).send({ operatingUniverse: "B2C" })
    expect([self.status, self.body.error?.code]).toEqual([403, "PEOPLE_SELF_CHANGE_FORBIDDEN"])
    // UB-05: data inexistente no calendário = 400 de validação (não 500); data futura = 422.
    expect((await asAdmin.put(`/api/v1/admin/operating-universe/units/TEAM/${teamA}`).send({ operatingUniverse: "B2B", effectiveFrom: "2026-02-30" })).body.error?.code).toBe("VALIDATION_ERROR")
    const future = await asAdmin.put(`/api/v1/admin/operating-universe/units/TEAM/${teamA}`).send({ operatingUniverse: "B2B", effectiveFrom: "2999-01-01" })
    expect([future.status, future.body.error?.code]).toEqual([422, "OPERATING_UNIVERSE_EFFECTIVE_FROM_FUTURE"])
  })

  it("UB-06: vigência retroativa sem período de duração zero; a leitura ignora os que já existem", async () => {
    // UB-06: vigência informada antes do início do período aberto troca o universo do período aberto (nenhum período de duração zero).
    const p9 = await person("M9", "OPERATOR", teamN, "B2C")
    await client.query("update people set operating_universe_override = 'B2B' where id = $1", [p9])
    await client.query("update people set operating_universe_override = 'B2X', operating_universe_effective_from = '2020-01-01' where id = $1", [p9])
    const history = (await client.query<{ operating_universe: string; zero: boolean; open: boolean }>("select operating_universe, valid_until = valid_from zero, valid_until is null open from person_operating_universe_history where person_id = $1 order by valid_from", [p9])).rows
    expect(history).toEqual([{ operating_universe: "B2C", zero: false, open: false }, { operating_universe: "B2X", zero: null, open: true }])
    // E um período de duração zero que já exista (antes da 207) não conta para a competência na leitura dos indicadores.
    await client.query("insert into person_operating_universe_history (organization_id, person_id, operating_universe, valid_from, valid_until) values ($1,$2,'B2B','2020-01-15','2020-01-15')", [org, p9])
    const indicator = (await client.query<{ id: string }>("insert into indicator_definitions (organization_id, code, name, unit, desired_direction, operating_universe) values ($1,$2,$2,'PERCENT','HIGHER','B2B') returning id", [org, `PRUB_${tag.toUpperCase()}`])).rows[0]!.id
    await client.query("insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, source) values ($1,$2,$3,'2020-01',50,'PROOF')", [org, p9, indicator])
    expect(await new PgAnalyticsReadRepository(client as never).loadIndicatorPerformance(org, [p9], ["2020-01"])).toEqual([])
  })
})
