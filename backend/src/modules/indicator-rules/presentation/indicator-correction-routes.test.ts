import request from "supertest"
import { beforeAll, describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { legacyAccessQuery } from "../../access/testing/legacy-admin-fixture.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"

/**
 * Contrato HTTP da correção controlada, com banco fake (mesmo harness dos outros routers): quem pode, formato do corpo, recusa
 * com o motivo, e transação com trava e auditoria. Regra e números reais contra o banco: testing/indicator-correction-proof.test.ts.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const INDICATOR = "11111111-1111-4111-8111-111111111111"
const TEAM = "22222222-2222-4222-8222-222222222222"
const ACCOUNT = { id: "acc-1", organization_id: ORG, person_id: "33333333-3333-4333-8333-333333333333", name: "Admin", role: "ADMIN", email: "admin@inia.com", avatar_url: null, job_title: null, team_id: null, team_name: null }
const DEFINITION = { id: INDICATOR, code: "QA_CORRECAO", name: "Indicador da prova", unit: "COUNT", desiredDirection: "HIGHER", dailySupported: true, operationalAggregation: "SUM", minimumSampleSize: null, minimumCoverage: null, officialClosureSupported: true, provesWorkActivity: false, unjustifiedAbsencePolicy: "NO_SAMPLE", availabilityPolicy: null, iconKey: null, active: true }

let passwordHash = ""
beforeAll(async () => {
  passwordHash = await hashPassword("Inia@123")
})

type Options = { measurements?: { id: string; subject_id: string; period_start: Date; value: string; numerator: string | null; denominator: string | null }[]; scopedToTeam?: boolean }

function fakeDatabase(options: Options = {}) {
  const calls: { sql: string; params: unknown[] }[] = []
  const definition = { ...DEFINITION }
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    if (sql.includes("from user_accounts ua")) return { rows: [{ ...ACCOUNT, password_hash: passwordHash, active: true }], rowCount: 1 }
    const access = legacyAccessQuery(sql, ACCOUNT.role, options.scopedToTeam ? [{ scope_type: "TEAM", team_id: TEAM, subteam_id: null }] : [])
    if (access) return access
    if (sql.includes("for update")) return { rows: [{ id: INDICATOR }], rowCount: 1 }
    if (sql.includes("from indicator_definitions where id = $1")) return { rows: params[0] === INDICATOR ? [definition] : [], rowCount: 1 }
    if (sql.includes("from indicator_measurements") && sql.includes("order by id")) {
      const rows = params[2] ? [] : (options.measurements ?? [])
      return { rows, rowCount: rows.length }
    }
    if (sql.includes("(select count(*) from indicator_measurements")) return { rows: [{ measurements: String(options.measurements?.length ?? 0), goals: "0", official_closures: "0" }], rowCount: 1 }
    if (sql.trim().startsWith("update indicator_definitions")) {
      Object.assign(definition, { unit: params[0], desiredDirection: params[1], operationalAggregation: params[2], unjustifiedAbsencePolicy: params[3] })
      return { rows: [], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  }
  return { db: { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Database, calls }
}

async function loggedIn(db: Database) {
  const agent = request.agent(createApp(db))
  await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
  return agent
}

const PREVIEW = `/api/v1/admin/indicator-rules/definitions/${INDICATOR}/correction/preview`
const APPLY = `/api/v1/admin/indicator-rules/definitions/${INDICATOR}/correction`
const BODY = { unit: "SECONDS", operationalAggregation: "WEIGHTED_AVERAGE", desiredDirection: "LOWER" }
const MEASUREMENT = { id: "m-1", subject_id: "p-1", period_start: new Date("2026-09-15T03:00:00Z"), value: "450", numerator: "8100", denominator: "18" }

describe("rotas da correção controlada de indicador", () => {
  it("sem sessão é 401", async () => {
    expect((await request(createApp(fakeDatabase().db)).post(PREVIEW).send(BODY)).status).toBe(401)
  })

  it("só com escopo de organização: quem administra um Grupo recebe 403 na prévia e na aplicação", async () => {
    const { db, calls } = fakeDatabase({ measurements: [MEASUREMENT], scopedToTeam: true })
    const agent = await loggedIn(db)
    for (const response of [await agent.post(PREVIEW).send(BODY), await agent.post(APPLY).send({ ...BODY, reason: "Cadastro errado na implantação", confirmation: "QA_CORRECAO" })]) {
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe("ORGANIZATION_SCOPE_REQUIRED")
    }
    expect(calls.some(({ sql }) => sql.includes("from indicator_measurements") || sql.trim().startsWith("update indicator_definitions"))).toBe(false)
  })

  it("prévia devolve o impacto calculado no servidor, sem gravar nada", async () => {
    const { db, calls } = fakeDatabase({ measurements: [MEASUREMENT] })
    const agent = await loggedIn(db)
    const response = await agent.post(PREVIEW).send(BODY)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.data).toMatchObject({ canApply: true, history: { measurements: 1 }, indicator: { code: "QA_CORRECAO" }, workflows: { activePublished: [], outOfScope: { activePublished: 0 } } })
    expect(calls.some(({ sql }) => /^\s*(update|insert into) (indicator_definitions|audit_logs)/.test(sql))).toBe(false)
  })

  it("corpo com código ou medição operacional é recusado; indicador inexistente e id inválido são 404", async () => {
    const agent = await loggedIn(fakeDatabase().db)
    const withCode = await agent.post(PREVIEW).send({ code: "OUTRO" })
    expect(withCode.status).toBeGreaterThanOrEqual(400)
    expect(withCode.status).toBeLessThan(500)
    expect((await agent.post(PREVIEW).send({ dailySupported: false })).status).toBeLessThan(500)
    expect((await agent.post(PREVIEW).send({ dailySupported: false })).status).toBeGreaterThanOrEqual(400)
    expect((await agent.post("/api/v1/admin/indicator-rules/definitions/44444444-4444-4444-8444-444444444444/correction/preview").send(BODY)).status).toBe(404)
    expect((await agent.post("/api/v1/admin/indicator-rules/definitions/nao-e-uuid/correction/preview").send(BODY)).status).toBe(404)
    expect((await agent.post("/api/v1/admin/indicator-rules/definitions/nao-e-uuid/correction").send(BODY)).status).toBe(404)
  })

  it("aplicar: exige motivo e o código digitado; grava numa transação com trava, com auditoria de antes, depois, motivo e quem fez", async () => {
    const { db, calls } = fakeDatabase({ measurements: [MEASUREMENT] })
    const agent = await loggedIn(db)
    const withoutReason = await agent.post(APPLY).send({ ...BODY, confirmation: "QA_CORRECAO" })
    expect(withoutReason.status).toBeGreaterThanOrEqual(400)
    expect(withoutReason.status).toBeLessThan(500)
    const wrongCode = await agent.post(APPLY).send({ ...BODY, reason: "Cadastro errado na implantação", confirmation: "OUTRO" })
    expect(wrongCode.status).toBe(422)
    expect(wrongCode.body.error.code).toBe("INDICATOR_CORRECTION_CONFIRMATION_MISMATCH")
    expect(calls.some(({ sql }) => sql.trim().startsWith("update indicator_definitions"))).toBe(false)

    const response = await agent.post(APPLY).send({ ...BODY, reason: "Cadastro errado na implantação", confirmation: "qa_correcao" })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.data.definition).toMatchObject({ unit: "SECONDS", operationalAggregation: "WEIGHTED_AVERAGE", desiredDirection: "LOWER" })
    const sqls = calls.map(({ sql }) => sql)
    const begin = sqls.lastIndexOf("begin")
    expect(begin).toBeGreaterThan(-1)
    expect(sqls.findIndex((sql, index) => index > begin && sql.includes("for update"))).toBeGreaterThan(begin)
    const audit = calls.find(({ sql }) => sql.includes("INDICATOR_DEFINITION_CORRECTED"))!
    expect(audit.params.slice(0, 3)).toEqual([ORG, ACCOUNT.person_id, INDICATOR])
    expect(JSON.parse(audit.params[3] as string)).toMatchObject({ reason: "Cadastro errado na implantação", actorAccountId: ACCOUNT.id, before: { unit: "COUNT", operationalAggregation: "SUM" }, after: { unit: "SECONDS", operationalAggregation: "WEIGHTED_AVERAGE" }, impact: { history: { measurements: 1 } } })
    expect(sqls[sqls.length - 1]).toBe("commit")
  })

  it("bloqueio é 409 com o motivo e o impacto, e nada é gravado", async () => {
    const { db, calls } = fakeDatabase({ measurements: [{ ...MEASUREMENT, numerator: null, denominator: null }] })
    const agent = await loggedIn(db)
    const response = await agent.post(APPLY).send({ ...BODY, reason: "Cadastro errado na implantação", confirmation: "QA_CORRECAO" })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe("INDICATOR_CORRECTION_BLOCKED")
    expect(response.body.error.message).toMatch(/1 medição não tem numerador e denominador/)
    expect(calls.some(({ sql }) => sql.trim().startsWith("update indicator_definitions") || sql.includes("INDICATOR_DEFINITION_CORRECTED"))).toBe(false)
    expect(calls.map(({ sql }) => sql)).toContain("rollback")
  })
})
