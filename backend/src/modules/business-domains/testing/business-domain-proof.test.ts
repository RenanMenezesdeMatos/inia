import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { setProofAccountPassword } from "../../auth/testing/proof-account-password.js"

/**
 * PROVA ARQUITETURAL (Parte L do pedido): um domínio de negócio que NÃO existe no código-fonte
 * (LOGISTICA_QA), criado pelo MESMO contrato do produto (API admin), precisa funcionar
 * imediatamente como domínio de um Agent DOMAIN, como fronteira de um Orquestrador DOMAINS e na
 * validação de política — sem enum, sem switch, sem alteração de código. Depois, dependências,
 * bloqueio de exclusão, desativação (referência existente sobrevive; nova é recusada) e limpeza:
 * o banco volta ao estado anterior.
 *
 * Roda contra o banco de TESTE real (migrations aplicadas) quando `INIA_DB_PROOF=1`:
 *   INIA_DB_PROOF=1 npx vitest run business-domain-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const CODE = "LOGISTICA_QA"
const PREFIX = "QA Prova · "

let pool: pg.Pool
let api: ReturnType<typeof request.agent>
let baseline: { domains: number; agents: number; orchestrators: number; relations: number }

async function counts() {
  const result = await pool.query<{ domains: string; agents: string; orchestrators: string; relations: string }>(
    `select (select count(*) from business_domains where organization_id = $1)::text domains,
            (select count(*) from agents where organization_id = $1)::text agents,
            (select count(*) from assistant_orchestrators where organization_id = $1)::text orchestrators,
            (select count(*) from assistant_orchestrator_domains od join assistant_orchestrators o on o.id = od.orchestrator_id)::text relations`,
    [ORG],
  )
  const row = result.rows[0]!
  return { domains: Number(row.domains), agents: Number(row.agents), orchestrators: Number(row.orchestrators), relations: Number(row.relations) }
}

async function cleanup() {
  // Na tabela real: excluir pela rota é lógico, e `delete` pela visão não alcança o que ficou guardado.
  await pool.query(`delete from assistant_orchestrators_all where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
  await pool.query(`delete from agents_all where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
  await pool.query(`delete from business_domains_all where organization_id = $1 and code = $2`, [ORG, CODE])
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return entry === "node_modules" || entry === "dist" ? [] : listSourceFiles(path)
    return /\.(ts|tsx|sql|json)$/.test(entry) ? [path] : []
  })
}

const agentBody = (name: string, extra: Record<string, unknown>) => ({
  name: `${PREFIX}${name}`,
  agentType: "CUSTOM",
  objective: "Prova arquitetural do catálogo de domínios de negócio.",
  description: "Agent temporário criado pela prova — removido ao final.",
  contextPrompt: "Você é um especialista temporário usado numa prova automatizada.",
  scopeType: "ALL_TEAMS",
  ...extra,
})

/** Orquestrador só aceita agente publicado (PEN-047). */
async function publishAgent(id: string) {
  const published = await api.post(`/api/v1/admin/agents/${id}/publish`).send({})
  expect(published.status, JSON.stringify(published.body)).toBe(201)
}

async function createPublishedAgent(name: string, extra: Record<string, unknown>) {
  const created = await api.post("/api/v1/admin/agents").send(agentBody(name, extra))
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  await publishAgent(created.body.data.id as string)
  return created.body.data.id as string
}

describe.skipIf(!ENABLED)("Domínio de negócio dinâmico — LOGISTICA_QA sem hardcode (banco de teste real)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    baseline = await counts()
    api = request.agent(createApp(pool))
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    const login = await api.post("/api/v1/auth/login").send(ADMIN)
    expect(login.status).toBe(200)
  })

  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  let domainId = ""
  let faturamentoId = ""
  let entregasId = ""
  let faturamentoAgentId = ""
  let coordinatorId = ""
  let orchestratorId = ""

  it("o código LOGISTICA_QA não existe em nenhum arquivo funcional do backend nem do frontend (só nesta prova)", () => {
    const root = join(process.cwd(), "..")
    const hits = [...listSourceFiles(join(root, "backend", "src")), ...listSourceFiles(join(root, "backend", "migrations")), ...listSourceFiles(join(root, "frontend", "src"))]
      .filter((path) => !path.endsWith("business-domain-proof.test.ts"))
      .filter((path) => readFileSync(path, "utf8").includes(CODE))
    expect(hits).toEqual([])
  })

  it("cria o domínio pelo contrato do produto (código normalizado, ativo) e ele aparece na lista de seletores", async () => {
    const created = await api.post("/api/v1/admin/business-domains").send({ name: "Logística QA", code: "logística qa", description: "Processos relacionados a logística, rastreamento e entrega." })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.data).toMatchObject({ code: CODE, name: "Logística QA", active: true, agentCount: 0, orchestratorCount: 0 })
    domainId = created.body.data.id
    const duplicate = await api.post("/api/v1/admin/business-domains").send({ name: "Outro", code: CODE })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe("BUSINESS_DOMAIN_CODE_TAKEN")
    const invalid = await api.post("/api/v1/admin/business-domains").send({ name: "Inválido", code: "1abc" })
    expect(invalid.status).toBe(400)
    const list = await api.get("/api/v1/admin/business-domains")
    expect(list.body.data.map((domain: { code: string }) => domain.code)).toContain(CODE)
    faturamentoId = list.body.data.find((domain: { code: string }) => domain.code === "FATURAMENTO").id
    expect(faturamentoId).toBeTruthy()
  })

  it("Agent DOMAIN com businessDomainId = LOGISTICA_QA salva, reabre com o domínio resolvido e dual-escreve o código nas colunas legadas", async () => {
    const created = await api.post("/api/v1/admin/agents").send(agentBody("Entregas QA", { specialtyKind: "DOMAIN", businessDomainId: domainId }))
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    entregasId = created.body.data.id
    const reopened = await api.get(`/api/v1/admin/agents/${entregasId}`)
    expect(reopened.body.data).toMatchObject({ specialtyKind: "DOMAIN", domain: CODE, specialty: CODE, businessDomainId: domainId, businessDomain: { id: domainId, code: CODE, name: "Logística QA", active: true } })
    const row = await pool.query<{ specialty: string; domain: string; business_domain_id: string }>(`select specialty, domain, business_domain_id from agents where id = $1`, [entregasId])
    expect(row.rows[0]).toEqual({ specialty: CODE, domain: CODE, business_domain_id: domainId })
    await publishAgent(entregasId)
    const published = await api.get(`/api/v1/admin/agents/${entregasId}`)
    expect(published.body.data).toMatchObject({ specialtyKind: "DOMAIN", domain: CODE, businessDomainId: domainId })
    faturamentoAgentId = await createPublishedAgent("Faturamento QA", { specialtyKind: "DOMAIN", businessDomainId: faturamentoId })
    coordinatorId = await createPublishedAgent("Coordenação QA", { agentType: "ORCHESTRATOR" })
  })

  it("Orquestrador DOMAINS [LOGISTICA_QA] aceita o Agent Entregas QA, bloqueia o de Faturamento (422 com o motivo) e passa a aceitá-lo ao adicionar FATURAMENTO", async () => {
    const body = { name: `${PREFIX}Orchestrator Logística QA`, scopeType: "ALL_TEAMS", orchestratorAgentId: coordinatorId, invocationMode: "WORKFLOW", routingPolicy: "DOMAINS", routingDomainIds: [domainId] }
    const blocked = await api.post("/api/v1/admin/assistant-orchestrators").send({ ...body, specialistAgentIds: [entregasId, faturamentoAgentId] })
    expect(blocked.status).toBe(422)
    expect(blocked.body.error.code).toBe("ORCHESTRATOR_SPECIALIST_FORBIDDEN_BY_POLICY")
    expect(blocked.body.error.message).toContain("pertence ao domínio Faturamento, que não está autorizado neste Orquestrador")
    expect(blocked.body.error.details).toEqual({ agentId: faturamentoAgentId })

    const created = await api.post("/api/v1/admin/assistant-orchestrators").send({ ...body, specialistAgentIds: [entregasId] })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    orchestratorId = created.body.data.id
    expect(created.body.data).toMatchObject({ routingPolicy: "DOMAINS", routingDomains: [CODE], policyKind: "DOMAIN", policyDomains: [CODE] })
    expect(created.body.data.businessDomains).toEqual([{ id: domainId, code: CODE, name: "Logística QA", active: true }])
    expect(created.body.data.specialists[0]).toMatchObject({ agentId: entregasId, businessDomain: { code: CODE, name: "Logística QA" } })

    const widened = await api.patch(`/api/v1/admin/assistant-orchestrators/${orchestratorId}`).send({ routingPolicy: "DOMAINS", routingDomainIds: [domainId, faturamentoId], specialistAgentIds: [entregasId, faturamentoAgentId] })
    expect(widened.status, JSON.stringify(widened.body)).toBe(200)
    expect(widened.body.data.businessDomains.map((domain: { code: string }) => domain.code).sort()).toEqual(["FATURAMENTO", CODE])
    expect(widened.body.data.policyKind).toBe("MULTIDOMAIN")
    expect(widened.body.data.routingDomains.sort()).toEqual(["FATURAMENTO", CODE])
    const relations = await pool.query(`select business_domain_id from assistant_orchestrator_domains where orchestrator_id = $1`, [orchestratorId])
    expect(relations.rows.map((row) => row.business_domain_id).sort()).toEqual([domainId, faturamentoId].sort())
  })

  it("dependências ficam visíveis (contadores + lista), exclusão em uso é bloqueada (409) e o código fica protegido", async () => {
    const detail = await api.get(`/api/v1/admin/business-domains/${domainId}`)
    expect(detail.body.data).toMatchObject({ agentCount: 1, orchestratorCount: 1 })
    const dependencies = await api.get(`/api/v1/admin/business-domains/${domainId}/dependencies`)
    expect(dependencies.body.data.agents.map((agent: { id: string }) => agent.id)).toEqual([entregasId])
    expect(dependencies.body.data.orchestrators.map((orchestrator: { id: string }) => orchestrator.id)).toEqual([orchestratorId])
    const remove = await api.delete(`/api/v1/admin/business-domains/${domainId}`)
    expect(remove.status).toBe(409)
    expect(remove.body.error.code).toBe("BUSINESS_DOMAIN_IN_USE")
    const recode = await api.patch(`/api/v1/admin/business-domains/${domainId}`).send({ code: "LOGISTICA_QA2" })
    expect(recode.status).toBe(409)
    expect(recode.body.error.code).toBe("BUSINESS_DOMAIN_CODE_LOCKED")
    const rename = await api.patch(`/api/v1/admin/business-domains/${domainId}`).send({ name: "Logística QA (editado)", description: "Descrição editada." })
    expect(rename.status).toBe(200)
    expect(rename.body.data).toMatchObject({ code: CODE, name: "Logística QA (editado)", description: "Descrição editada." })
  })

  it("desativar não quebra o que existe: Agent/Orquestrador reabrem com '(desativado)', novo Agent é recusado, o seletor padrão não o oferece; reativar volta ao normal", async () => {
    const deactivate = await api.post(`/api/v1/admin/business-domains/${domainId}/deactivate`)
    expect(deactivate.status).toBe(200)
    expect(deactivate.body.data.active).toBe(false)
    const selectable = await api.get("/api/v1/admin/business-domains")
    expect(selectable.body.data.map((domain: { code: string }) => domain.code)).not.toContain(CODE)
    const auditable = await api.get("/api/v1/admin/business-domains?includeInactive=true")
    expect(auditable.body.data.map((domain: { code: string }) => domain.code)).toContain(CODE)
    const agent = await api.get(`/api/v1/admin/agents/${entregasId}`)
    expect(agent.status).toBe(200)
    expect(agent.body.data.businessDomain).toMatchObject({ code: CODE, active: false })
    const orchestrator = await api.get(`/api/v1/admin/assistant-orchestrators/${orchestratorId}`)
    expect(orchestrator.status).toBe(200)
    expect(orchestrator.body.data.businessDomains.find((domain: { code: string }) => domain.code === CODE)).toMatchObject({ active: false })
    // Existente continua salvando (renomear mantém o domínio desativado); novo não pode escolhê-lo.
    const keep = await api.patch(`/api/v1/admin/agents/${entregasId}`).send({ name: `${PREFIX}Entregas QA (renomeado)`, specialtyKind: "DOMAIN", businessDomainId: domainId })
    expect(keep.status, JSON.stringify(keep.body)).toBe(200)
    const fresh = await api.post("/api/v1/admin/agents").send(agentBody("Entregas QA 2", { specialtyKind: "DOMAIN", businessDomainId: domainId }))
    expect(fresh.status).toBe(422)
    expect(fresh.body.error.code).toBe("BUSINESS_DOMAIN_INACTIVE")
    const orchestratorKeep = await api.patch(`/api/v1/admin/assistant-orchestrators/${orchestratorId}`).send({ name: `${PREFIX}Orchestrator Logística QA (renomeado)` })
    expect(orchestratorKeep.status, JSON.stringify(orchestratorKeep.body)).toBe(200)
    const reactivate = await api.post(`/api/v1/admin/business-domains/${domainId}/activate`)
    expect(reactivate.body.data.active).toBe(true)
  })

  it("audit trail registra criação/edição/desativação/ativação; limpeza exclui Agents/Orquestrador temporários e o domínio, e o que está vivo volta ao estado anterior", async () => {
    const audit = await pool.query<{ action: string }>(`select action from audit_logs where entity_type = 'business_domain' and entity_id = $1 order by created_at`, [domainId])
    expect(audit.rows.map((row) => row.action)).toEqual(["BUSINESS_DOMAIN_CREATED", "BUSINESS_DOMAIN_UPDATED", "BUSINESS_DOMAIN_DEACTIVATED", "BUSINESS_DOMAIN_ACTIVATED"])
    expect((await api.delete(`/api/v1/admin/assistant-orchestrators/${orchestratorId}`)).status).toBe(204)
    for (const id of [entregasId, faturamentoAgentId, coordinatorId]) expect((await api.delete(`/api/v1/admin/agents/${id}`)).status).toBe(204)
    const removed = await api.delete(`/api/v1/admin/business-domains/${domainId}`)
    expect(removed.status).toBe(204)
    expect(await counts()).toEqual(baseline)
    await pool.query(`delete from audit_logs where entity_type = 'business_domain' and entity_id = $1`, [domainId])
  })
})
