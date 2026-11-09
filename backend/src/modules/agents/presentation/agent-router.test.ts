import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { legacyAccessQuery } from "../../access/testing/legacy-admin-fixture.js"
import { AGENT_LIVE_COLUMNS } from "../domain/agent-config.js"

// Escopo Administrativo (Parte 32/33 do pedido): fecha o gap real encontrado na auditoria —
// agent-router.ts só filtrava a listagem, nunca checava canManageScope em get/:id, patch/:id,
// delete/:id nem no create. Estes testes travam a correção (mesmo harness fakeDatabase já
// usado em workflow-router.test.ts, adaptado pra `agents`).

const TEAM_A = "11111111-1111-4111-8111-111111111111"
const TEAM_B = "22222222-2222-4222-8222-222222222222"

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

const AGENT_TEAM_A = {
  id: "agent-a",
  name: "Agente FATURAS",
  agentType: "DIAGNOSTICS",
  objective: "obj",
  description: "desc",
  contextPrompt: "prompt",
  active: true,
  createdAt: new Date().toISOString(),
  scopeType: "TEAM",
  teamId: TEAM_A,
  teamName: "FATURAS",
  subteamId: null,
  subteamName: null,
  usageCount: 0,
  createdByName: null,
  knowledgeDocuments: [],
  actionLimitsEnabled: false,
  actionLimits: null as string | null,
}
const AGENT_TEAM_B = { ...AGENT_TEAM_A, id: "agent-b", name: "Agente RETENÇÃO", teamId: TEAM_B, teamName: "RETENÇÃO" }

type AgentFixture = { id: string; name: string; agentType: string; objective: string; description: string; contextPrompt: string; active: boolean; scopeType: string; teamId: string | null; subteamId: string | null; actionLimitsEnabled: boolean; actionLimits: string | null }

/** Colunas vivas de `agents` (`AGENT_LIVE_COLUMNS` — a versão vigente; num agente nunca publicado, o cadastro que acompanha o rascunho). */
function liveRowOf(agent: AgentFixture, overrides: Record<string, unknown> = {}) {
  return {
    name: agent.name, agent_type: agent.agentType, objective: agent.objective, description: agent.description, context_prompt: agent.contextPrompt,
    scope_type: agent.scopeType, team_id: agent.teamId, subteam_id: agent.subteamId, specialty: null, specialty_kind: null, domain: null, capability: null,
    consolidated_input: false, business_domain_id: null, recommend_support_materials: false, investigation_capabilities: [],
    action_limits_enabled: agent.actionLimitsEnabled, action_limits: agent.actionLimits, ...overrides,
  }
}

/** Estado de ciclo de vida (`loadAgentLifecycle`, migration 164): por padrão o agente já tem versão publicada e nenhum rascunho. */
function lifecycleRowOf(agent: AgentFixture, overrides: Record<string, unknown> = {}) {
  return {
    id: agent.id, organizationId: ACCOUNT.organization_id, active: agent.active, currentVersionId: `${agent.id}-v1`, currentVersionNumber: 1,
    draftConfig: null, draftRevision: 0, draftUpdatedAt: null, draftUpdatedByName: null, scopeType: agent.scopeType, teamId: agent.teamId, subteamId: agent.subteamId, ...overrides,
  }
}

function fakeDatabase(
  roleAssignmentRows: unknown[],
  passwordHash: string,
  extra?: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount: number } | undefined,
): Database {
  async function routedQuery(sql: string, params?: unknown[]) {
    const extraResult = extra?.(sql, params)
    if (extraResult) return extraResult
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
    const byId = (id: unknown) => [AGENT_TEAM_A, AGENT_TEAM_B].find((row) => row.id === id)
    // Ciclo de vida (agent-versions.ts › loadAgentLifecycle) busca por `a.id = $1` — antes do AGENT_SELECT, que também lê `from agents a`.
    if (sql.includes('a.draft_config "draftConfig"')) {
      const agent = byId(params?.[0])
      return { rows: agent ? [lifecycleRowOf(agent)] : [], rowCount: agent ? 1 : 0 }
    }
    // Configuração viva (base da edição quando não há rascunho).
    if (sql.includes(AGENT_LIVE_COLUMNS) && sql.includes("from agents where id = $1")) {
      const agent = byId(params?.[0])
      return { rows: agent ? [liveRowOf(agent)] : [], rowCount: agent ? 1 : 0 }
    }
    // Salvar o rascunho devolve a revisão nova (PEN-050).
    if (sql.includes('returning draft_revision "revision"')) return { rows: [{ revision: 1 }], rowCount: 1 }
    // AGENT_SELECT busca por `and a.id = $2` (get/patch fluxos) — decide qual agente
    // devolver a partir do id pedido, nunca uma lista.
    if (sql.includes("from agents a") && params && params.length >= 2) {
      const id = params[1]
      const agent = [AGENT_TEAM_A, AGENT_TEAM_B].find((row) => row.id === id)
      return { rows: agent ? [agent] : [], rowCount: agent ? 1 : 0 }
    }
    if (sql.includes("select scope_type") && sql.includes("from agents where id")) {
      const id = params?.[0]
      const agent = [AGENT_TEAM_A, AGENT_TEAM_B].find((row) => row.id === id)
      return agent ? { rows: [{ scopeType: agent.scopeType, teamId: agent.teamId, subteamId: agent.subteamId, active: agent.active }], rowCount: 1 } : { rows: [], rowCount: 0 }
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

describe("agent-router — Escopo Administrativo", () => {
  it("um admin restrito ao TEAM_A consegue ler um agente do TEAM_A", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], passwordHash)
    const agent = await loginAgent(database)
    const response = await agent.get("/api/v1/admin/agents/agent-a")
    expect(response.status).toBe(200)
    expect(response.body.data.id).toBe("agent-a")
  })

  it("um admin restrito ao TEAM_A recebe 404 (nunca 403) ao tentar ler um agente do TEAM_B", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], passwordHash)
    const agent = await loginAgent(database)
    const response = await agent.get("/api/v1/admin/agents/agent-b")
    expect(response.status).toBe(404)
  })

  it("mesma regra pra PATCH — não revela nem permite editar um agente de outro grupo", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], passwordHash)
    const agent = await loginAgent(database)
    const response = await agent.patch("/api/v1/admin/agents/agent-b").send({ name: "Tentativa" })
    expect(response.status).toBe(404)
  })

  it("mesma regra pra DELETE", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], passwordHash)
    const agent = await loginAgent(database)
    const response = await agent.delete("/api/v1/admin/agents/agent-b")
    expect(response.status).toBe(404)
  })

  it("mesma regra pras sub-rotas (history/runs/preview-prompt/test)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], passwordHash)
    const agent = await loginAgent(database)
    const [history, runs, preview] = await Promise.all([
      agent.get("/api/v1/admin/agents/agent-b/history"),
      agent.get("/api/v1/admin/agents/agent-b/runs"),
      agent.get("/api/v1/admin/agents/agent-b/preview-prompt"),
    ])
    expect(history.status).toBe(404)
    expect(runs.status).toBe(404)
    expect(preview.status).toBe(404)
  })

  it("rejeita criar um agente num escopo que o admin não gerencia (403, mensagem clara — não é 'não encontrado')", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], passwordHash)
    const agent = await loginAgent(database)
    const response = await agent.post("/api/v1/admin/agents").send({
      name: "Novo agente",
      agentType: "DIAGNOSTICS",
      objective: "objetivo válido",
      description: "descrição válida",
      contextPrompt: "prompt com mais de dez caracteres",
      scopeType: "TEAM",
      teamId: TEAM_B,
    })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe("AGENT_SCOPE_FORBIDDEN")
  })

  it("recusa texto acima do limite (400 VALIDATION_ERROR com o campo) na criação e na edição", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], passwordHash)
    const agent = await loginAgent(database)
    const created = await agent.post("/api/v1/admin/agents").send({
      name: "Novo agente",
      agentType: "DIAGNOSTICS",
      objective: "objetivo válido",
      description: "descrição válida",
      contextPrompt: "a".repeat(12_001),
      scopeType: "TEAM",
      teamId: TEAM_A,
    })
    expect(created.status).toBe(400)
    expect(created.body.error.code).toBe("VALIDATION_ERROR")
    expect(created.body.error.details[0].path).toEqual(["contextPrompt"])
    const updated = await agent.patch("/api/v1/admin/agents/agent-a").send({ objective: "a".repeat(1_001) })
    expect(updated.status).toBe(400)
    expect(updated.body.error.details[0].path).toEqual(["objective"])
  })

  it("um admin irrestrito (sem linhas em user_role_assignments) continua acessando qualquer grupo", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([], passwordHash)
    const agent = await loginAgent(database)
    const response = await agent.get("/api/v1/admin/agents/agent-b")
    expect(response.status).toBe(200)
  })

  it("um admin multi-grupo (TEAM_A + TEAM_B) acessa os dois, mas nenhum outro", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase(
      [
        { scope_type: "TEAM", team_id: TEAM_A, subteam_id: null },
        { scope_type: "TEAM", team_id: TEAM_B, subteam_id: null },
      ],
      passwordHash,
    )
    const agent = await loginAgent(database)
    const [a, b] = await Promise.all([agent.get("/api/v1/admin/agents/agent-a"), agent.get("/api/v1/admin/agents/agent-b")])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
  })
})

describe("agent-router — Agent DOMAIN referencia um Domínio de negócio do catálogo (migration 060)", () => {
  /** Catálogo como DADO: inclui um domínio que não existe em enum algum (LOGISTICA) e um desativado. */
  const DOMAINS = [
    { id: "d0000000-0000-4000-8000-000000000001", code: "FATURAMENTO", name: "Faturamento", active: true },
    { id: "d0000000-0000-4000-8000-000000000005", code: "LOGISTICA", name: "Logística", active: true },
    { id: "d0000000-0000-4000-8000-000000000006", code: "BACKOFFICE", name: "Backoffice", active: false },
  ]
  const baseBody = { name: "Agent · Entregas", agentType: "CUSTOM", objective: "objetivo válido", description: "descrição válida", contextPrompt: "prompt com mais de dez caracteres", scopeType: "ALL_TEAMS" }
  /**
   * `inserts` = as gravações das colunas vivas (`writeLiveAgentConfig`): agente novo nasce como rascunho não publicado (PEN-002)
   * e a linha viva acompanha o rascunho — é nela que ficam a FK e o dual-write. `drafts` = o rascunho gravado na criação.
   */
  function catalogDatabase(passwordHash: string, inserts: unknown[][], current?: { specialty_kind: string | null; domain: string | null; business_domain_id: string | null }, drafts: Record<string, unknown>[] = []) {
    return fakeDatabase([], passwordHash, (sql, params) => {
      if (sql.includes("from business_domains where organization_id = $1 and (id = any($2::uuid[]) or code = any($3::text[]))")) {
        const ids = (params?.[1] as string[]) ?? []
        const codes = (params?.[2] as string[]) ?? []
        const rows = DOMAINS.filter((domain) => ids.includes(domain.id) || codes.includes(domain.code))
        return { rows, rowCount: rows.length }
      }
      // Domínio da configuração em edição (rascunho/versão), lido do catálogo pelo id.
      if (sql.includes("from business_domains where id = $1")) {
        const rows = DOMAINS.filter((domain) => domain.id === params?.[0])
        return { rows, rowCount: rows.length }
      }
      if (sql.trim().startsWith("insert into agents")) {
        // $11 = draft_config (agente nasce como rascunho, sem versão publicada).
        drafts.push(JSON.parse(String(params?.[10])) as Record<string, unknown>)
        return { rows: [{ id: AGENT_TEAM_A.id }], rowCount: 1 }
      }
      if (current && sql.includes(AGENT_LIVE_COLUMNS) && sql.includes("from agents where id = $1")) {
        return { rows: [liveRowOf(AGENT_TEAM_A, { scope_type: "ALL_TEAMS", team_id: null, specialty: current.domain, specialty_kind: current.specialty_kind, domain: current.domain, business_domain_id: current.business_domain_id })], rowCount: 1 }
      }
      if (sql.trim().startsWith("update agents set name = $3")) {
        inserts.push(params ?? [])
        return { rows: [], rowCount: 1 }
      }
      return undefined
    })
  }

  it("DOMAIN exige domínio (422 AGENT_SPECIALTY_INVALID); domínio inexistente no catálogo é recusado (422 BUSINESS_DOMAIN_NOT_FOUND) — por id ou por código", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const agent = await loginAgent(catalogDatabase(passwordHash, []))
    const missing = await agent.post("/api/v1/admin/agents").send({ ...baseBody, specialtyKind: "DOMAIN" })
    expect(missing.status).toBe(422)
    expect(missing.body.error.code).toBe("AGENT_SPECIALTY_INVALID")
    const unknownId = await agent.post("/api/v1/admin/agents").send({ ...baseBody, specialtyKind: "DOMAIN", businessDomainId: "d0000000-0000-4000-8000-000000000099" })
    expect(unknownId.status).toBe(422)
    expect(unknownId.body.error.code).toBe("BUSINESS_DOMAIN_NOT_FOUND")
    const unknownCode = await agent.post("/api/v1/admin/agents").send({ ...baseBody, specialtyKind: "DOMAIN", domain: "COBRANCA" })
    expect(unknownCode.status).toBe(422)
    expect(unknownCode.body.error.code).toBe("BUSINESS_DOMAIN_NOT_FOUND")
  })

  it("domínio criado pelo catálogo (LOGISTICA) funciona sem mudança no código: grava a FK e faz dual-write do código em `domain` e `specialty`", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const inserts: unknown[][] = []
    const drafts: Record<string, unknown>[] = []
    const agent = await loginAgent(catalogDatabase(passwordHash, inserts, undefined, drafts))
    const byId = await agent.post("/api/v1/admin/agents").send({ ...baseBody, specialtyKind: "DOMAIN", businessDomainId: "d0000000-0000-4000-8000-000000000005" })
    expect(byId.status).toBe(201)
    // colunas vivas: … $11 specialty, $12 specialty_kind, $13 domain, $14 capability, $15 consolidated_input, $16 business_domain_id, $17 recommend_support_materials (padrão false), $18 capacidades
    expect(inserts[0]!.slice(10, 18)).toEqual(["LOGISTICA", "DOMAIN", "LOGISTICA", null, false, "d0000000-0000-4000-8000-000000000005", false, []])
    // O rascunho criado (PEN-002) carrega a MESMA especialidade.
    expect(drafts[0]).toMatchObject({ specialty: "LOGISTICA", specialtyKind: "DOMAIN", domain: "LOGISTICA", businessDomainId: "d0000000-0000-4000-8000-000000000005" })
    // Forma de compatibilidade (só o código): resolve para a MESMA FK.
    const byCode = await agent.post("/api/v1/admin/agents").send({ ...baseBody, name: "Agent · Entregas 2", specialtyKind: "DOMAIN", domain: "logistica" })
    expect(byCode.status).toBe(201)
    expect(inserts[1]!.slice(10, 18)).toEqual(["LOGISTICA", "DOMAIN", "LOGISTICA", null, false, "d0000000-0000-4000-8000-000000000005", false, []])
    // Legado puro (`specialty` = código) também resolve para a FK — dual-read na entrada.
    const legacy = await agent.post("/api/v1/admin/agents").send({ ...baseBody, name: "Agent · Faturamento", specialty: "FATURAMENTO" })
    expect(legacy.status).toBe(201)
    expect(inserts[2]!.slice(10, 18)).toEqual(["FATURAMENTO", "DOMAIN", "FATURAMENTO", null, false, "d0000000-0000-4000-8000-000000000001", false, []])
  })

  it("CROSS_CUTTING/PERFORMANCE/SYNTHESIS não exigem nem aceitam domínio; domínio DESATIVADO não entra num Agent novo, mas um Agent existente que já o tinha continua salvando", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const inserts: unknown[][] = []
    const agent = await loginAgent(catalogDatabase(passwordHash, inserts, { specialty_kind: "DOMAIN", domain: "BACKOFFICE", business_domain_id: "d0000000-0000-4000-8000-000000000006" }))
    for (const specialtyKind of ["CROSS_CUTTING", "PERFORMANCE", "SYNTHESIS"]) {
      const ok = await agent.post("/api/v1/admin/agents").send({ ...baseBody, specialtyKind })
      expect(ok.status, specialtyKind).toBe(201)
    }
    expect(inserts.map((params) => params[15])).toEqual([null, null, null])
    const inactive = await agent.post("/api/v1/admin/agents").send({ ...baseBody, specialtyKind: "DOMAIN", domain: "BACKOFFICE" })
    expect(inactive.status).toBe(422)
    expect(inactive.body.error.code).toBe("BUSINESS_DOMAIN_INACTIVE")
    // Edição de um Agent que JÁ estava em BACKOFFICE (desativado depois): renomear mantém o domínio e salva.
    const rename = await agent.patch(`/api/v1/admin/agents/${AGENT_TEAM_A.id}`).send({ name: "Agent · Backoffice (renomeado)", specialtyKind: "DOMAIN", businessDomainId: "d0000000-0000-4000-8000-000000000006" })
    expect(rename.status).toBe(200)
  })
})

describe("agent-router — Limites de atuação (migration 124)", () => {
  const body = { name: "Agent · Faturamento", agentType: "CUSTOM", objective: "objetivo válido", description: "descrição válida", contextPrompt: "prompt com mais de dez caracteres", scopeType: "ALL_TEAMS" }
  /**
   * O agente editado ainda não foi publicado: a edição grava o rascunho (PEN-002) e a linha viva o acompanha — as colunas vivas
   * (`update agents set name = $3 …`, `action_limits_enabled`/`action_limits` por último) são onde os limites ficam gravados.
   */
  function limitsDatabase(passwordHash: string, writes: { sql: string; params: unknown[] }[], before: AgentFixture = { ...AGENT_TEAM_A, scopeType: "ALL_TEAMS", teamId: null }) {
    return fakeDatabase([], passwordHash, (sql, params) => {
      if (sql.trim().startsWith("insert into agents") || sql.trim().startsWith("update agents set") || sql.includes("insert into agent_history")) {
        writes.push({ sql, params: params ?? [] })
        return { rows: [{ id: AGENT_TEAM_A.id, revision: 1 }], rowCount: 1 }
      }
      if (sql.includes('a.draft_config "draftConfig"')) return { rows: [lifecycleRowOf(before, { currentVersionId: null, currentVersionNumber: null })], rowCount: 1 }
      if (sql.includes(AGENT_LIVE_COLUMNS) && sql.includes("from agents where id = $1")) return { rows: [liveRowOf(before)], rowCount: 1 }
      return undefined
    })
  }
  const liveWrites = (writes: { sql: string; params: unknown[] }[]) => writes.filter((write) => write.sql.trim().startsWith("update agents set name = $3"))
  const draftOf = (write: { params: unknown[] } | undefined, index: number) => JSON.parse(String(write!.params[index])) as Record<string, unknown>

  it("criar: desligado por padrão; ligado grava o texto aparado; ligado sem texto = 422 sem gravar nada", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const writes: { sql: string; params: unknown[] }[] = []
    const agent = await loginAgent(limitsDatabase(passwordHash, writes))
    expect((await agent.post("/api/v1/admin/agents").send(body)).status).toBe(201)
    expect(liveWrites(writes)[0]!.params.slice(-2)).toEqual([false, null])
    expect((await agent.post("/api/v1/admin/agents").send({ ...body, actionLimitsEnabled: true, actionLimits: "  Só faturamento e cobrança.  " })).status).toBe(201)
    expect(liveWrites(writes).at(-1)!.params.slice(-2)).toEqual([true, "Só faturamento e cobrança."])
    // O rascunho criado ($11 do insert) guarda o mesmo texto aparado.
    expect(draftOf(writes.filter((write) => write.sql.trim().startsWith("insert into agents")).at(-1), 10)).toMatchObject({ actionLimitsEnabled: true, actionLimits: "Só faturamento e cobrança." })
    const before = writes.length
    const missing = await agent.post("/api/v1/admin/agents").send({ ...body, actionLimitsEnabled: true, actionLimits: "   " })
    expect(missing.status).toBe(422)
    expect(missing.body.error.code).toBe("AGENT_ACTION_LIMITS_REQUIRED")
    expect(writes).toHaveLength(before)
    const tooLong = await agent.post("/api/v1/admin/agents").send({ ...body, actionLimitsEnabled: true, actionLimits: "a".repeat(1_001) })
    expect(tooLong.status).toBe(400)
  })

  it("editar: ligar reaproveita o texto guardado e entra no histórico; desligar guarda o texto; ligar sem texto = 422", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const writes: { sql: string; params: unknown[] }[] = []
    const stored = { ...AGENT_TEAM_A, scopeType: "ALL_TEAMS", teamId: null, actionLimitsEnabled: false, actionLimits: "Só faturamento." }
    const agent = await loginAgent(limitsDatabase(passwordHash, writes, stored))
    expect((await agent.patch("/api/v1/admin/agents/agent-a").send({ actionLimitsEnabled: true })).status).toBe(200)
    const update = liveWrites(writes)[0]!
    expect(update.params.slice(-2)).toEqual([true, "Só faturamento."])
    // O rascunho salvo ($3 de `set draft_config`) leva o mesmo estado.
    expect(draftOf(writes.find((write) => write.sql.includes("set draft_config")), 2)).toMatchObject({ actionLimitsEnabled: true, actionLimits: "Só faturamento." })
    const history = JSON.parse(String(writes.find((write) => write.sql.includes("insert into agent_history"))!.params[5]))
    // Com o alcance da configuração anterior e da nova: decide quem lê os valores (agent-router.config-scope.test.ts).
    const allTeams = { scopeType: "ALL_TEAMS", teamId: null, subteamId: null }
    expect(history).toEqual([{ field: "actionLimits", label: "Limites de atuação", from: "Desligados — Só faturamento.", to: "Ligados — Só faturamento.", configScopes: [allTeams, allTeams] }])

    writes.length = 0
    expect((await agent.patch("/api/v1/admin/agents/agent-a").send({ actionLimitsEnabled: false, actionLimits: "Só faturamento." })).status).toBe(200)
    expect(liveWrites(writes)[0]!.params.slice(-2)).toEqual([false, "Só faturamento."])

    const empty = await agent.patch("/api/v1/admin/agents/agent-a").send({ actionLimitsEnabled: true, actionLimits: "" })
    expect(empty.status).toBe(422)
    expect(empty.body.error.code).toBe("AGENT_ACTION_LIMITS_REQUIRED")
  })
})
