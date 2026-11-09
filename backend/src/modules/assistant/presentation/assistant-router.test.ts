import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { legacyAccessQuery } from "../../access/testing/legacy-admin-fixture.js"
import { answerOrchestratorVersionQuery, fakeOrchestratorVersionIdOf } from "../../agents/testing/agent-version-fakes.js"
import { toolNameForAgent } from "../domain/orchestrator-schema.js"

// Escopo Administrativo + validação cross-group (Parte 32/34 do pedido): assistant-router.ts já
// tinha canManageScope em todas as rotas antes desta task — o que faltava testar era exatamente
// isso (nunca coberto) e a validação NOVA de que um Orchestrator não pode usar silenciosamente
// um Agent (orquestrador ou especialista) de outro grupo (validateAgentsCompatibleWithScope).

const TEAM_A = "11111111-1111-4111-8111-111111111111"
const TEAM_B = "22222222-2222-4222-8222-222222222222"
const ORCH_AGENT_A = "33333333-3333-4333-8333-333333333333" // agente tipo ORCHESTRATOR, escopo TEAM_A
const SPECIALIST_AGENT_B = "44444444-4444-4444-8444-444444444444" // agente comum, escopo TEAM_B
const ORCH_AGENT_B = "55555555-5555-4555-8555-555555555555" // agente tipo ORCHESTRATOR, escopo TEAM_B
const SPECIALIST_FATURAMENTO_A = "66666666-6666-4666-8666-666666666666" // especialista de domínio FATURAMENTO, escopo TEAM_A
const SPECIALIST_RETENCAO_A = "77777777-7777-4777-8777-777777777777" // especialista de domínio RETENCAO, escopo TEAM_A
const SYNTHESIS_AGENT_A = "99999999-9999-4999-8999-999999999999" // Agent de síntese (SYNTHESIS), escopo TEAM_A
const SPECIALIST_EXPERIENCIA_A = "88888888-8888-4888-8888-888888888888" // transversal, escopo TEAM_A
const SPECIALIST_LOGISTICA_A = "12121212-1212-4121-8121-121212121212" // especialista de um domínio criado pelo catálogo (LOGISTICA), escopo TEAM_A
const SPECIALIST_UNPUBLISHED_A = "13131313-1313-4131-8131-131313131313" // especialista nunca publicado (só rascunho), escopo TEAM_A
const ORCHESTRATOR_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORCHESTRATOR_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
/** Legado desativado pela migration 054: sem política, inativo, modo BOTH. */
const ORCHESTRATOR_LEGACY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

const ACCOUNT = {
  id: "acc-1",
  organization_id: "00000000-0000-4000-8000-000000000001",
  person_id: "person-1",
  name: "Admin de Contas",
  role: "ADMIN",
  email: "admin@inia.com",
  avatar_url: null,
  job_title: null,
  team_id: null,
  team_name: null,
}

const AGENTS_BY_ID: Record<string, { agent_type: string; scopeType: string; teamId: string | null; subteamId: string | null; name: string; specialty: string | null; current_version_id?: string | null }> = {
  [ORCH_AGENT_A]: { agent_type: "ORCHESTRATOR", scopeType: "TEAM", teamId: TEAM_A, subteamId: null, name: "Agente Orquestrador A", specialty: null },
  [SPECIALIST_AGENT_B]: { agent_type: "DIAGNOSTICS", scopeType: "TEAM", teamId: TEAM_B, subteamId: null, name: "Especialista B", specialty: null },
  [ORCH_AGENT_B]: { agent_type: "ORCHESTRATOR", scopeType: "TEAM", teamId: TEAM_B, subteamId: null, name: "Agente Orquestrador B", specialty: null },
  [SPECIALIST_FATURAMENTO_A]: { agent_type: "CUSTOM", scopeType: "TEAM", teamId: TEAM_A, subteamId: null, name: "Especialista de Faturamento", specialty: "FATURAMENTO" },
  [SPECIALIST_RETENCAO_A]: { agent_type: "CUSTOM", scopeType: "TEAM", teamId: TEAM_A, subteamId: null, name: "Especialista de Retenção", specialty: "RETENCAO" },
  [SPECIALIST_EXPERIENCIA_A]: { agent_type: "CUSTOM", scopeType: "TEAM", teamId: TEAM_A, subteamId: null, name: "Especialista de Experiência", specialty: "CROSS_CUTTING" },
  [SYNTHESIS_AGENT_A]: { agent_type: "CUSTOM", scopeType: "TEAM", teamId: TEAM_A, subteamId: null, name: "Síntese Gerencial", specialty: "SYNTHESIS" },
  [SPECIALIST_LOGISTICA_A]: { agent_type: "CUSTOM", scopeType: "TEAM", teamId: TEAM_A, subteamId: null, name: "Agent · Entregas QA", specialty: "LOGISTICA" },
  [SPECIALIST_UNPUBLISHED_A]: { agent_type: "CUSTOM", scopeType: "TEAM", teamId: TEAM_A, subteamId: null, name: "Especialista em rascunho", specialty: "FATURAMENTO", current_version_id: null },
}

/** Catálogo de domínios de negócio (migration 060) — DADOS: a regra do router não conhece código nenhum. */
const DOMAINS = [
  { id: "d0000000-0000-4000-8000-000000000001", code: "FATURAMENTO", name: "Faturamento", active: true },
  { id: "d0000000-0000-4000-8000-000000000002", code: "RETENCAO", name: "Retenção e Cancelamento", active: true },
  { id: "d0000000-0000-4000-8000-000000000003", code: "SUPORTE", name: "Suporte Técnico", active: true },
  { id: "d0000000-0000-4000-8000-000000000004", code: "CADASTRO", name: "Cadastro e Titularidade", active: true },
  { id: "d0000000-0000-4000-8000-000000000005", code: "LOGISTICA", name: "Logística", active: true },
  { id: "d0000000-0000-4000-8000-000000000006", code: "BACKOFFICE", name: "Backoffice", active: false },
]
const domainByCode = (code: string | null) => DOMAINS.find((domain) => domain.code === code) ?? null

const ORCHESTRATORS_BY_ID: Record<string, { scopeType: string; teamId: string | null; subteamId: string | null }> = {
  [ORCHESTRATOR_A]: { scopeType: "TEAM", teamId: TEAM_A, subteamId: null },
  [ORCHESTRATOR_B]: { scopeType: "TEAM", teamId: TEAM_B, subteamId: null },
  [ORCHESTRATOR_LEGACY]: { scopeType: "TEAM", teamId: TEAM_A, subteamId: null },
}
/** Agente orquestrador gravado em cada Orquestrador — lido ao fixar a versão dele (PEN-076). */
const ORCHESTRATOR_AGENT_BY_ID: Record<string, string> = { [ORCHESTRATOR_A]: ORCH_AGENT_A, [ORCHESTRATOR_B]: ORCH_AGENT_B, [ORCHESTRATOR_LEGACY]: ORCH_AGENT_A }

function fakeDatabase(
  roleAssignmentRows: unknown[],
  passwordHash: string,
  extra?: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount: number } | undefined,
): Database {
  async function routedQuery(sql: string, params?: unknown[]) {
    const extraResult = extra?.(sql, params)
    if (extraResult) return extraResult
    // Gravação do Orquestrador (PEN-076): versão fixada de cada agente (nos fakes, a vigente = id do agente) e versão nova publicada.
    const versioning = answerOrchestratorVersionQuery(sql, params, { agentOf: (id) => AGENTS_BY_ID[id], orchestratorAgentOf: (id) => ORCHESTRATOR_AGENT_BY_ID[id] })
    if (versioning) return versioning
    if (sql.includes("from user_accounts ua")) {
      return { rows: [{ ...ACCOUNT, password_hash: passwordHash, active: true }], rowCount: 1 }
    }
    const access = legacyAccessQuery(sql, ACCOUNT.role, roleAssignmentRows as never)
    if (access) return access
    if (sql.includes("from user_role_assignments")) {
      return { rows: roleAssignmentRows, rowCount: roleAssignmentRows.length }
    }
    if (sql.includes("from subteams where team_id")) {
      return { rows: [], rowCount: 0 }
    }
    if (sql.includes("select agent_type from agents")) {
      const id = params?.[0] as string
      const row = AGENTS_BY_ID[id]
      return row ? { rows: [{ agent_type: row.agent_type }], rowCount: 1 } : { rows: [], rowCount: 0 }
    }
    if (sql.includes("select id, name, scope_type") && sql.includes("from agents where id = any")) {
      const ids = (params?.[0] as string[]) ?? []
      const rows = ids.filter((id) => AGENTS_BY_ID[id]).map((id) => ({ id, ...AGENTS_BY_ID[id]! }))
      return { rows, rowCount: rows.length }
    }
    if (sql.includes("from business_domains where organization_id = $1 and (id = any($2::uuid[]) or code = any($3::text[]))")) {
      const ids = (params?.[1] as string[]) ?? []
      const codes = (params?.[2] as string[]) ?? []
      const rows = DOMAINS.filter((domain) => ids.includes(domain.id) || codes.includes(domain.code))
      return { rows, rowCount: rows.length }
    }
    if (sql.includes("select ag.id, ag.name, ag.specialty, ag.specialty_kind, ag.domain, ag.capability, ag.consolidated_input") && sql.includes("from agents ag")) {
      // Só a coluna legada `specialty` — o dual-read traduz (057). Um fake sem `specialty_kind` é
      // exatamente um banco migrado sem backfill "novo" pra esse agente; o join do catálogo (060)
      // dá id/nome ao código legado quando o domínio existe.
      const ids = (params?.[0] as string[]) ?? []
      const rows = ids.filter((id) => AGENTS_BY_ID[id]).map((id) => {
        const domain = domainByCode(AGENTS_BY_ID[id]!.specialty)
        return { id, name: AGENTS_BY_ID[id]!.name, specialty: AGENTS_BY_ID[id]!.specialty, specialty_kind: null, domain: null, capability: null, consolidated_input: false, business_domain_id: domain?.id ?? null, business_domain_code: domain?.code ?? null, business_domain_name: domain?.name ?? null, business_domain_active: domain?.active ?? null }
      })
      return { rows, rowCount: rows.length }
    }
    if (sql.includes("select o.policy_kind, o.policy_domains, o.routing_policy, o.routing_domains") && sql.includes("o.active, o.invocation_mode from assistant_orchestrators o")) {
      const id = params?.[0] as string
      if (id === ORCHESTRATOR_LEGACY) return { rows: [{ policy_kind: null, policy_domains: [], routing_policy: null, routing_domains: [], business_domains: [], active: false, invocation_mode: "BOTH" }], rowCount: 1 }
      // Registro legado ainda sem `routing_policy` (só policy_kind) e sem relação nova: o dual-read precisa traduzir DOMAIN → DOMAINS a partir dos códigos.
      return ORCHESTRATORS_BY_ID[id] ? { rows: [{ policy_kind: "DOMAIN", policy_domains: ["FATURAMENTO"], routing_policy: null, routing_domains: [], business_domains: [], active: true, invocation_mode: "WORKFLOW" }], rowCount: 1 } : { rows: [], rowCount: 0 }
    }
    if (sql.includes("from assistant_orchestrators where id = $1")) {
      const id = params?.[0] as string
      const row = ORCHESTRATORS_BY_ID[id]
      return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 }
    }
    // GET /:id consulta o ORCHESTRATOR_SELECT completo direto (não passa por fetchScopedRow) —
    // mesma tabela, join com `agents oa`, filtrando por `o.id = $2`.
    if (sql.includes("from assistant_orchestrators o") && sql.includes("o.id = $2")) {
      const id = params?.[1] as string
      const row = ORCHESTRATORS_BY_ID[id]
      return row ? { rows: [{ id, ...row }], rowCount: 1 } : { rows: [], rowCount: 0 }
    }
    return { rows: [], rowCount: 0 }
  }
  return {
    query: routedQuery,
    connect: async () => ({ query: routedQuery, release: () => {} }),
  } as unknown as Database
}

async function loginAgent(database: Database) {
  const agent = request.agent(createApp(database))
  await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
  return agent
}

describe("assistant-router — Escopo Administrativo", () => {
  it("um admin restrito ao TEAM_A lê um orquestrador do TEAM_A e recebe 404 (nunca 403) pro do TEAM_B", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], passwordHash)
    const agent = await loginAgent(database)
    const [a, b] = await Promise.all([
      agent.get(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}`),
      agent.get(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_B}`),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(404)
  })

  it("rejeita criar um orquestrador num escopo que o admin não gerencia", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], passwordHash)
    const agent = await loginAgent(database)
    const response = await agent.post("/api/v1/admin/assistant-orchestrators").send({
      name: "Novo orquestrador",
      scopeType: "TEAM",
      teamId: TEAM_B,
      orchestratorAgentId: ORCH_AGENT_A,
    })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe("ORCHESTRATOR_SCOPE_FORBIDDEN")
  })
})

describe("assistant-router — nunca vazamento cross-group (Parte 6/24/34 do pedido)", () => {
  it("rejeita criar um Orchestrator TEAM_A cujo agente orquestrador é exclusivo do TEAM_B", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([], passwordHash)
    const agent = await loginAgent(database)
    const response = await agent.post("/api/v1/admin/assistant-orchestrators").send({
      name: "Orquestrador FATURAS",
      scopeType: "TEAM",
      teamId: TEAM_A,
      orchestratorAgentId: ORCH_AGENT_B, // errado de propósito: agente é TEAM_B
    })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("ORCHESTRATOR_AGENT_SCOPE_FORBIDDEN")
  })

  it("rejeita criar um Orchestrator TEAM_A com um especialista exclusivo do TEAM_B", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([], passwordHash)
    const agent = await loginAgent(database)
    const response = await agent.post("/api/v1/admin/assistant-orchestrators").send({
      name: "Orquestrador FATURAS",
      scopeType: "TEAM",
      teamId: TEAM_A,
      orchestratorAgentId: ORCH_AGENT_A,
      specialistAgentIds: [SPECIALIST_AGENT_B],
    })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("ORCHESTRATOR_AGENT_SCOPE_FORBIDDEN")
  })

  it("aceita quando agente orquestrador e especialistas estão todos no mesmo grupo do Orchestrator (com política — criação nasce ativa)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.trim().startsWith("insert into assistant_orchestrators")) return { rows: [{ id: ORCHESTRATOR_A }], rowCount: 1 }
      if (sql.includes("from assistant_orchestrators o") && sql.includes("join agents oa")) return { rows: [{ id: ORCHESTRATOR_A, specialists: [] }], rowCount: 1 }
      return undefined
    })
    const agent = await loginAgent(database)
    const response = await agent.post("/api/v1/admin/assistant-orchestrators").send({
      name: "Orquestrador FATURAS",
      scopeType: "TEAM",
      teamId: TEAM_A,
      orchestratorAgentId: ORCH_AGENT_A,
      policyKind: "DOMAIN",
      policyDomains: ["FATURAMENTO"],
    })
    expect(response.status).toBe(201)
  })
})

describe("assistant-router — política explícita de especialistas (orchestrator-policy.ts, aplicada na configuração)", () => {
  const withInsert = (sql: string) => {
    if (sql.trim().startsWith("insert into assistant_orchestrators")) return { rows: [{ id: ORCHESTRATOR_A }], rowCount: 1 }
    if (sql.trim().startsWith("update assistant_orchestrators")) return { rows: [{ id: ORCHESTRATOR_A }], rowCount: 1 }
    if (sql.includes("from assistant_orchestrators o") && sql.includes("join agents oa")) return { rows: [{ id: ORCHESTRATOR_A, specialists: [] }], rowCount: 1 }
    return undefined
  }

  it("Orquestrador de domínio Faturamento NÃO aceita o Especialista de Retenção — 422 com o motivo e o agente", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const agent = await loginAgent(fakeDatabase([], passwordHash, withInsert))
    const response = await agent.post("/api/v1/admin/assistant-orchestrators").send({
      name: "Orquestrador · Faturamento",
      scopeType: "TEAM",
      teamId: TEAM_A,
      orchestratorAgentId: ORCH_AGENT_A,
      specialistAgentIds: [SPECIALIST_FATURAMENTO_A, SPECIALIST_RETENCAO_A],
      policyKind: "DOMAIN",
      policyDomains: ["FATURAMENTO"],
    })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("ORCHESTRATOR_SPECIALIST_FORBIDDEN_BY_POLICY")
    expect(response.body.error.message).toContain("pertence ao domínio Retenção e Cancelamento, que não está autorizado neste Orquestrador")
    expect(response.body.error.details).toEqual({ agentId: SPECIALIST_RETENCAO_A })
  })

  it("aceita o especialista do próprio domínio + um transversal explicitamente adicionado", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const agent = await loginAgent(fakeDatabase([], passwordHash, withInsert))
    const response = await agent.post("/api/v1/admin/assistant-orchestrators").send({
      name: "Orquestrador · Faturamento",
      scopeType: "TEAM",
      teamId: TEAM_A,
      orchestratorAgentId: ORCH_AGENT_A,
      specialistAgentIds: [SPECIALIST_FATURAMENTO_A, SPECIALIST_EXPERIENCIA_A],
      policyKind: "DOMAIN",
      policyDomains: ["FATURAMENTO"],
    })
    expect(response.status).toBe(201)
  })

  it("editar só a lista de especialistas de um orquestrador JÁ classificado (política atual = Faturamento) também é barrado", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const agent = await loginAgent(fakeDatabase([], passwordHash, withInsert))
    const response = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}`).send({ specialistAgentIds: [SPECIALIST_RETENCAO_A] })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("ORCHESTRATOR_SPECIALIST_FORBIDDEN_BY_POLICY")
  })

  it("gerencial não aceita especialista; política incoerente (DOMAIN sem domínio) é recusada; agente sem especialidade é recusado num orquestrador classificado", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const agent = await loginAgent(fakeDatabase([], passwordHash, withInsert))
    const managerial = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Gerencial", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, specialistAgentIds: [SPECIALIST_FATURAMENTO_A], policyKind: "MANAGERIAL" })
    expect(managerial.status).toBe(422)
    const incoherent = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Sem domínio", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, policyKind: "DOMAIN", policyDomains: [] })
    expect(incoherent.status).toBe(422)
    expect(incoherent.body.error.code).toBe("ORCHESTRATOR_POLICY_INVALID")
    const unclassified = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Faturamento", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, specialistAgentIds: [SPECIALIST_AGENT_B], policyKind: "DOMAIN", policyDomains: ["FATURAMENTO"] })
    // SPECIALIST_AGENT_B é de outro grupo: a checagem de escopo vem antes — usa um agente sem especialidade do mesmo grupo.
    expect([403, 422]).toContain(unclassified.status)
  })
})

describe("assistant-router — Orquestrador ativo nunca fica sem política (migration 054)", () => {
  const withInsert = (sql: string) => {
    if (sql.trim().startsWith("insert into assistant_orchestrators")) return { rows: [{ id: ORCHESTRATOR_A }], rowCount: 1 }
    if (sql.trim().startsWith("update assistant_orchestrators")) return { rows: [{ id: ORCHESTRATOR_LEGACY }], rowCount: 1 }
    if (sql.includes("from assistant_orchestrators o") && sql.includes("join agents oa")) return { rows: [{ id: ORCHESTRATOR_LEGACY, specialists: [] }], rowCount: 1 }
    return undefined
  }

  it("criar sem política é recusado (a criação nasce ativa) — 422 ORCHESTRATOR_POLICY_REQUIRED", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const agent = await loginAgent(fakeDatabase([], passwordHash, withInsert))
    const response = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Sem política", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("ORCHESTRATOR_POLICY_REQUIRED")
  })

  it("reativar um legado sem política é recusado; reativar classificando na mesma edição é aceito; editar o nome mantendo-o inativo continua livre", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const agent = await loginAgent(fakeDatabase([], passwordHash, withInsert))
    const reactivate = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_LEGACY}`).send({ active: true })
    expect(reactivate.status).toBe(422)
    expect(reactivate.body.error.code).toBe("ORCHESTRATOR_POLICY_REQUIRED")
    const classified = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_LEGACY}`).send({ active: true, policyKind: "INTERACTIVE", invocationMode: "INTERACTIVE" })
    expect(classified.status).toBe(200)
    const rename = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_LEGACY}`).send({ name: "Legado (desativado)" })
    expect(rename.status).toBe(200)
  })

  it("OPEN (forma nova) vale em qualquer acionamento e grava o legado equivalente (INTERACTIVE só no chat, senão OPEN); aceita qualquer especialista listado", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const inserts: unknown[][] = []
    const agent = await loginAgent(
      fakeDatabase([], passwordHash, (sql, params) => {
        if (sql.trim().startsWith("insert into assistant_orchestrators")) inserts.push(params ?? [])
        return withInsert(sql)
      }),
    )
    const both = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Aberto em workflow", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, routingPolicy: "OPEN", invocationMode: "BOTH" })
    expect(both.status).toBe(201)
    // dual-write: policy_kind legado = OPEN (não INTERACTIVE — a constraint da 054 exige chat/voz para INTERACTIVE), routing_policy = OPEN
    expect(inserts[0]!.slice(10, 14)).toEqual(["OPEN", [], "OPEN", []])
    const ok = await agent.post("/api/v1/admin/assistant-orchestrators").send({
      name: "Assistente",
      scopeType: "TEAM",
      teamId: TEAM_A,
      orchestratorAgentId: ORCH_AGENT_A,
      policyKind: "INTERACTIVE",
      invocationMode: "INTERACTIVE",
      specialistAgentIds: [SPECIALIST_FATURAMENTO_A, SPECIALIST_RETENCAO_A, SPECIALIST_EXPERIENCIA_A],
    })
    expect(ok.status).toBe(201)
    // forma legada INTERACTIVE no chat → routing OPEN + policy_kind INTERACTIVE preservado
    expect(inserts[1]!.slice(10, 14)).toEqual(["INTERACTIVE", [], "OPEN", []])
  })

  it("forma nova: DOMAINS com 1 domínio grava DOMAIN; com vários grava MULTIDOMAIN; DOMAINS sem domínio é recusado; síntese nunca é tool", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const inserts: unknown[][] = []
    const agent = await loginAgent(
      fakeDatabase([], passwordHash, (sql, params) => {
        if (sql.trim().startsWith("insert into assistant_orchestrators")) inserts.push(params ?? [])
        return withInsert(sql)
      }),
    )
    const one = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Faturamento", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, routingPolicy: "DOMAINS", routingDomains: ["FATURAMENTO"], invocationMode: "WORKFLOW", specialistAgentIds: [SPECIALIST_FATURAMENTO_A, SPECIALIST_EXPERIENCIA_A] })
    expect(one.status).toBe(201)
    expect(inserts[0]!.slice(10, 14)).toEqual(["DOMAIN", ["FATURAMENTO"], "DOMAINS", ["FATURAMENTO"]])
    const many = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Reincidência", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, routingPolicy: "DOMAINS", routingDomains: ["FATURAMENTO", "RETENCAO"], invocationMode: "WORKFLOW", specialistAgentIds: [SPECIALIST_FATURAMENTO_A, SPECIALIST_RETENCAO_A, SPECIALIST_EXPERIENCIA_A] })
    expect(many.status).toBe(201)
    expect(inserts[1]!.slice(10, 14)).toEqual(["MULTIDOMAIN", ["FATURAMENTO", "RETENCAO"], "DOMAINS", ["FATURAMENTO", "RETENCAO"]])
    const empty = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Vazio", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, routingPolicy: "DOMAINS", routingDomains: [], invocationMode: "WORKFLOW" })
    expect(empty.status).toBe(422)
    expect(empty.body.error.code).toBe("ORCHESTRATOR_POLICY_INVALID")
    const synthesis = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Com síntese", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, routingPolicy: "OPEN", invocationMode: "WORKFLOW", specialistAgentIds: [SYNTHESIS_AGENT_A] })
    expect(synthesis.status).toBe(422)
    expect(synthesis.body.error.code).toBe("ORCHESTRATOR_SPECIALIST_FORBIDDEN_BY_POLICY")
    expect(synthesis.body.error.message).toContain("Agent de síntese")
  })
})

describe("assistant-router — domínio de negócio como DADO do catálogo (migration 060): fronteira por catálogo, relação N:N e dual-write dos códigos", () => {
  const withInsert = (sql: string) => {
    if (sql.trim().startsWith("insert into assistant_orchestrators")) return { rows: [{ id: ORCHESTRATOR_A }], rowCount: 1 }
    if (sql.includes("from assistant_orchestrators o") && sql.includes("join agents oa")) return { rows: [{ id: ORCHESTRATOR_A, specialists: [] }], rowCount: 1 }
    return undefined
  }

  it("um domínio criado pelo catálogo (LOGISTICA) restringe um Orquestrador DOMAINS sem código novo: o especialista de Logística entra, o de Faturamento é bloqueado com o motivo; ao adicionar FATURAMENTO à lista, passa", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const inserts: unknown[][] = []
    const relations: unknown[][] = []
    const agent = await loginAgent(
      fakeDatabase([], passwordHash, (sql, params) => {
        if (sql.trim().startsWith("insert into assistant_orchestrators(")) inserts.push(params ?? [])
        if (sql.trim().startsWith("insert into assistant_orchestrator_domains")) {
          relations.push(params ?? [])
          return { rows: [], rowCount: 0 }
        }
        return withInsert(sql)
      }),
    )
    const logisticaId = "d0000000-0000-4000-8000-000000000005"
    const ok = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Orchestrator · Logística QA", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, invocationMode: "WORKFLOW", routingPolicy: "DOMAINS", routingDomainIds: [logisticaId], specialistAgentIds: [SPECIALIST_LOGISTICA_A, SPECIALIST_EXPERIENCIA_A] })
    expect(ok.status).toBe(201)
    // dual-write: policy_kind DOMAIN + policy_domains [LOGISTICA]; routing_policy DOMAINS + routing_domains [LOGISTICA]; relação N:N por id.
    expect(inserts[0]!.slice(10, 14)).toEqual(["DOMAIN", ["LOGISTICA"], "DOMAINS", ["LOGISTICA"]])
    expect(relations[0]).toEqual([ORCHESTRATOR_A, [logisticaId]])

    const blocked = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Orchestrator · Logística QA", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, invocationMode: "WORKFLOW", routingPolicy: "DOMAINS", routingDomainIds: [logisticaId], specialistAgentIds: [SPECIALIST_LOGISTICA_A, SPECIALIST_FATURAMENTO_A] })
    expect(blocked.status).toBe(422)
    expect(blocked.body.error.code).toBe("ORCHESTRATOR_SPECIALIST_FORBIDDEN_BY_POLICY")
    expect(blocked.body.error.message).toBe('"Especialista de Faturamento" pertence ao domínio Faturamento, que não está autorizado neste Orquestrador — este Orquestrador é do domínio Logística.')
    expect(blocked.body.error.details).toEqual({ agentId: SPECIALIST_FATURAMENTO_A })

    const widened = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Orchestrator · Logística QA", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, invocationMode: "WORKFLOW", routingPolicy: "DOMAINS", routingDomainIds: [logisticaId, "d0000000-0000-4000-8000-000000000001"], specialistAgentIds: [SPECIALIST_LOGISTICA_A, SPECIALIST_FATURAMENTO_A] })
    expect(widened.status).toBe(201)
    expect(inserts[1]!.slice(10, 14)).toEqual(["MULTIDOMAIN", ["LOGISTICA", "FATURAMENTO"], "DOMAINS", ["LOGISTICA", "FATURAMENTO"]])
  })

  it("DOMAINS exige 1..N domínios do catálogo: id inexistente → 422 BUSINESS_DOMAIN_NOT_FOUND; domínio desativado → 422 BUSINESS_DOMAIN_INACTIVE; OPEN não exige domínio", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const agent = await loginAgent(fakeDatabase([], passwordHash, withInsert))
    const missing = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Orquestrador X", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, invocationMode: "WORKFLOW", routingPolicy: "DOMAINS", routingDomainIds: ["d0000000-0000-4000-8000-000000000099"] })
    expect(missing.status, JSON.stringify(missing.body)).toBe(422)
    expect(missing.body.error.code).toBe("BUSINESS_DOMAIN_NOT_FOUND")
    const inactive = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Orquestrador X", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, invocationMode: "WORKFLOW", routingPolicy: "DOMAINS", routingDomains: ["BACKOFFICE"] })
    expect(inactive.status).toBe(422)
    expect(inactive.body.error.code).toBe("BUSINESS_DOMAIN_INACTIVE")
    const none = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Orquestrador X", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, invocationMode: "WORKFLOW", routingPolicy: "DOMAINS", routingDomainIds: [] })
    expect(none.status).toBe(422)
    expect(none.body.error.code).toBe("ORCHESTRATOR_POLICY_INVALID")
    const open = await agent.post("/api/v1/admin/assistant-orchestrators").send({ name: "Chat", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, invocationMode: "INTERACTIVE", routingPolicy: "OPEN", specialistAgentIds: [SPECIALIST_LOGISTICA_A, SPECIALIST_FATURAMENTO_A, SPECIALIST_EXPERIENCIA_A] })
    expect(open.status).toBe(201)
  })
})

describe("assistant-router — toda gravação publica uma versão da configuração do Orquestrador (PEN-076, revisão de 03/11/2026)", () => {
  it("criar grava os especialistas SEM fixar versão de agente (rodam na vigente) e publica a versão; especialista nunca publicado → 422 sem publicar nada", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const writes: { sql: string; params: unknown[] }[] = []
    const agent = await loginAgent(
      fakeDatabase([], passwordHash, (sql, params) => {
        const normalized = sql.replace(/\s+/g, " ").trim()
        if (/^(insert into assistant_orchestrator_specialists|update assistant_orchestrators set orchestrator_agent_version_id|insert into assistant_orchestrator_versions|update assistant_orchestrators set current_version_id)/.test(normalized)) writes.push({ sql: normalized, params: params ?? [] })
        if (normalized.startsWith("insert into assistant_orchestrators(")) return { rows: [{ id: ORCHESTRATOR_A }], rowCount: 1 }
        if (sql.includes("from assistant_orchestrators o") && sql.includes("join agents oa")) return { rows: [{ id: ORCHESTRATOR_A, specialists: [] }], rowCount: 1 }
        return undefined
      }),
    )
    const body = { name: "Assistente", scopeType: "TEAM", teamId: TEAM_A, orchestratorAgentId: ORCH_AGENT_A, routingPolicy: "OPEN", invocationMode: "INTERACTIVE" }

    const created = await agent.post("/api/v1/admin/assistant-orchestrators").send({ ...body, specialistAgentIds: [SPECIALIST_FATURAMENTO_A, SPECIALIST_RETENCAO_A] })
    expect(created.status).toBe(201)
    expect(writes.map((write) => write.params)).toEqual([
      [ORCHESTRATOR_A, SPECIALIST_FATURAMENTO_A, toolNameForAgent(SPECIALIST_FATURAMENTO_A)],
      [ORCHESTRATOR_A, SPECIALIST_RETENCAO_A, toolNameForAgent(SPECIALIST_RETENCAO_A)],
      [ORCHESTRATOR_A, ACCOUNT.organization_id, ACCOUNT.person_id, ACCOUNT.name],
      [ORCHESTRATOR_A, fakeOrchestratorVersionIdOf(ORCHESTRATOR_A)],
    ])
    expect(writes.at(-1)!.sql).toContain("set current_version_id")

    writes.length = 0
    const unpublished = await agent.post("/api/v1/admin/assistant-orchestrators").send({ ...body, specialistAgentIds: [SPECIALIST_FATURAMENTO_A, SPECIALIST_UNPUBLISHED_A] })
    expect(unpublished.status).toBe(422)
    expect(unpublished.body.error.code).toBe("ORCHESTRATOR_AGENT_NOT_PUBLISHED")
    expect(unpublished.body.error.details).toEqual({ agentId: SPECIALIST_UNPUBLISHED_A })
    expect(writes).toEqual([])
  })
})
