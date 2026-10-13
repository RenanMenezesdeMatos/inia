import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { setProofAccountPassword } from "../../auth/testing/proof-account-password.js"
import { buildSystemPromptWithTrace } from "../application/build-system-prompt.js"

/**
 * PROVA (migration 124): LIMITES DE ATUAÇÃO escritos no próprio Agent. Pelo contrato do produto (API admin): ligado, o texto
 * entra nas instruções DESTE Agent (antes dos assuntos proibidos) e não nas de outro; desligado, sai das instruções e o texto
 * fica guardado; ligado sem texto é recusado pela API e pelo banco; cada mudança fica no Histórico. Limpa tudo ao final.
 *
 * Roda contra o banco de TESTE real (migrations aplicadas) quando `INIA_DB_PROOF=1`:
 *   INIA_DB_PROOF=1 npx vitest run action-limits-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const PREFIX = "QA Prova Limites · "
const LIMITS = "Só assuntos de faturamento: fatura, cobrança, segunda via e contestação de conta."

let pool: pg.Pool
let api: ReturnType<typeof request.agent>

async function cleanup() {
  await pool.query(`delete from agents where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
}

const agentBody = (name: string, extra: Record<string, unknown> = {}) => ({
  name: `${PREFIX}${name}`,
  agentType: "CUSTOM",
  objective: "Prova dos limites de atuação.",
  description: "Agent temporário criado pela prova — removido ao final.",
  contextPrompt: "Você é um especialista temporário usado numa prova automatizada.",
  scopeType: "ALL_TEAMS",
  ...extra,
})

const promptOf = async (agentId: string) => (await buildSystemPromptWithTrace(pool, agentId, { organization_id: ORG, name: "Prova", objective: "o", description: "d", context_prompt: "c" })).parts.restrictions

describe.skipIf(!ENABLED)("Limites de atuação no Agent (banco de teste real)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    api = request.agent(createApp(pool))
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    expect((await api.post("/api/v1/auth/login").send(ADMIN)).status).toBe(200)
  })

  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  let limitedId = ""
  let freeId = ""

  it("ligado: o texto entra nas instruções deste Agent, antes dos assuntos proibidos — e não nas de outro", async () => {
    const limited = await api.post("/api/v1/admin/agents").send(agentBody("Limitado", { actionLimitsEnabled: true, actionLimits: `  ${LIMITS}  ` }))
    expect(limited.status, JSON.stringify(limited.body)).toBe(201)
    expect(limited.body.data).toMatchObject({ actionLimitsEnabled: true, actionLimits: LIMITS })
    limitedId = limited.body.data.id
    const free = await api.post("/api/v1/admin/agents").send(agentBody("Livre"))
    expect(free.body.data).toMatchObject({ actionLimitsEnabled: false, actionLimits: null })
    freeId = free.body.data.id

    const limitedPrompt = await promptOf(limitedId)
    expect(limitedPrompt.startsWith("Limites de atuação deste agente")).toBe(true)
    expect(limitedPrompt).toContain(LIMITS)
    expect(limitedPrompt.indexOf(LIMITS)).toBeLessThan(limitedPrompt.indexOf("Restrições que você deve sempre respeitar"))
    expect(await promptOf(freeId)).not.toContain("Limites de atuação")
  })

  it("ligado sem texto: 422 pela API e recusado pelo banco", async () => {
    const empty = await api.patch(`/api/v1/admin/agents/${freeId}`).send({ actionLimitsEnabled: true })
    expect(empty.status).toBe(422)
    expect(empty.body.error.code).toBe("AGENT_ACTION_LIMITS_REQUIRED")
    await expect(pool.query(`update agents set action_limits_enabled = true, action_limits = '  ' where id = $1`, [freeId])).rejects.toMatchObject({ code: "23514" })
  })

  it("desligado: sai das instruções, o texto fica guardado e volta ao religar; o Histórico registra", async () => {
    expect((await api.patch(`/api/v1/admin/agents/${limitedId}`).send({ actionLimitsEnabled: false })).status).toBe(200)
    expect(await promptOf(limitedId)).not.toContain("Limites de atuação")
    const stored = await pool.query(`select action_limits_enabled, action_limits from agents where id = $1`, [limitedId])
    expect(stored.rows[0]).toEqual({ action_limits_enabled: false, action_limits: LIMITS })

    expect((await api.patch(`/api/v1/admin/agents/${limitedId}`).send({ actionLimitsEnabled: true })).status).toBe(200)
    expect(await promptOf(limitedId)).toContain(LIMITS)

    const history = await api.get(`/api/v1/admin/agents/${limitedId}/history`)
    const changes = (history.body.data as { changes: { field: string; from: string; to: string }[] }[]).flatMap((entry) => entry.changes).filter((change) => change.field === "actionLimits")
    expect(changes.map((change) => change.to)).toEqual(expect.arrayContaining([`Desligados — ${LIMITS}`, `Ligados — ${LIMITS}`]))
  })
})
