import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { AGENT_LIVE_COLUMNS, type AgentConfig } from "../domain/agent-config.js"

// Nenhum provedor de IA: o teste do agente e a montagem do prompt são trocados. O assunto aqui é só QUAL configuração cada um alcança.
const runAgentMock = vi.hoisted(() => vi.fn(async () => ({ runId: "run-1", status: "COMPLETED" })))
const buildPromptMock = vi.hoisted(() => vi.fn())
vi.mock("../application/run-agent.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../application/run-agent.js")>()), runAgent: runAgentMock }))
vi.mock("../application/build-system-prompt.js", async (importOriginal) => {
  const { agentSnapshotFor } = await import("../application/agent-runtime-context.js")
  buildPromptMock.mockImplementation(async (_db: unknown, agentId: string) => `prompt montado com a configuração de alcance ${agentSnapshotFor(agentId)?.config.scopeType}`)
  return { ...(await importOriginal<typeof import("../application/build-system-prompt.js")>()), buildSystemPrompt: buildPromptMock }
})
const { createAgentRouter } = await import("./agent-router.js")
const { legacyAccessQuery } = await import("../../access/testing/legacy-admin-fixture.js")

/**
 * Rascunho e versões guardam o próprio alcance. Cenário: o agente é hoje do Grupo B (linha viva e versão 2), mas a versão 1 era
 * "todos os Grupos" com uma base do Grupo A — ou quem administra a organização preparou um rascunho assim. O administrador do
 * Grupo B lê o agente, mas não pode montar o prompt dessa configuração, testá-la, publicá-la, revertê-la nem editá-la.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const TEAM_A = "a0000000-0000-4000-8000-00000000000a"
const TEAM_B = "b0000000-0000-4000-8000-00000000000b"
const AGENT = "c0000000-0000-4000-8000-00000000000c"
const V1 = "e0000000-0000-4000-8000-000000000001"
const V2 = "e0000000-0000-4000-8000-000000000002"
const DOC_A = "d0000000-0000-4000-8000-00000000000a"
const DOC_B = "d0000000-0000-4000-8000-00000000000b"
const DOC_TEAM: Record<string, string> = { [DOC_A]: TEAM_A, [DOC_B]: TEAM_B }

const configOf = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  name: "Agente de Retenção", agentType: "CUSTOM", objective: "objetivo", description: "descrição", contextPrompt: "contexto do agente",
  scopeType: "TEAM", teamId: TEAM_B, subteamId: null, specialty: null, specialtyKind: null, domain: null, capability: null, consolidatedInput: false,
  businessDomainId: null, recommendSupportMaterials: false, investigationCapabilities: [], actionLimitsEnabled: false, actionLimits: null,
  knowledgeDocumentIds: [DOC_B], ...overrides,
})
const LIVE = configOf()
const WIDE = configOf({ scopeType: "ALL_TEAMS", teamId: null, knowledgeDocumentIds: [DOC_A, DOC_B], contextPrompt: "Responda com os procedimentos de todos os Grupos." })
const VERSIONS: Record<string, { number: number; config: AgentConfig }> = { [V1]: { number: 1, config: WIDE }, [V2]: { number: 2, config: LIVE } }

/** Leituras: versões, execuções e histórico. A execução e a alteração de uma configuração de todos os Grupos têm conteúdo do Grupo A. */
const scopeOf = (config: AgentConfig) => ({ scopeType: config.scopeType, teamId: config.teamId, subteamId: config.subteamId })
const AT = "2026-11-01T00:00:00.000Z"
const versionSummary = (id: string) => ({ id, number: VERSIONS[id]!.number, origin: "PUBLISH", revertedFromNumber: null, publishedAt: AT, publishedByName: "Administração geral", current: id === V2 })
const RUN_V1 = "f0000000-0000-4000-8000-000000000001"
const RUN_V2 = "f0000000-0000-4000-8000-000000000002"
const RUN_WIDE_DRAFT = "f0000000-0000-4000-8000-000000000003"
const runOf = (id: string, config: AgentConfig, overrides: Record<string, unknown>) => ({
  id, source: "WORKFLOW", inputContext: "Transcrição de um operador", outputText: "Feedback do agente", status: "COMPLETED", errorMessage: null, model: "modelo",
  caseId: null, createdAt: AT, completedAt: AT, agentVersionId: null, agentVersionNumber: null, runTarget: "VERSION", hasTestedConfig: false, config, ...overrides,
})
const RUNS = [
  runOf(RUN_V1, WIDE, { agentVersionId: V1, agentVersionNumber: 1, inputContext: "Transcrição de um operador do Grupo A", outputText: "Feedback com o procedimento do Grupo A", caseId: "caso-grupo-a" }),
  runOf(RUN_V2, LIVE, { agentVersionId: V2, agentVersionNumber: 2 }),
  runOf(RUN_WIDE_DRAFT, WIDE, { source: "MANUAL_TEST", runTarget: "DRAFT", hasTestedConfig: true, inputContext: "Cenário do Grupo A", outputText: "Resposta com o procedimento do Grupo A" }),
]
const change = (from: string, to: string, configs?: AgentConfig[]) => ({ field: "contextPrompt", label: "Contexto", from, to, ...(configs ? { configScopes: configs.map(scopeOf) } : {}) })
const HISTORY = [
  { id: "h-wide", action: "UPDATED", changedByName: "Administração geral", createdAt: AT, changes: [change(LIVE.contextPrompt, WIDE.contextPrompt, [LIVE, WIDE])] },
  { id: "h-own", action: "UPDATED", changedByName: "Administração do Grupo B", createdAt: AT, changes: [change(LIVE.contextPrompt, "contexto revisado", [LIVE, LIVE])] },
  { id: "h-legacy", action: "UPDATED", changedByName: "Administração geral", createdAt: AT, changes: [change("antes", "depois")] },
  { id: "h-publish", action: "PUBLISHED", changedByName: "Administração geral", createdAt: AT, changes: [{ field: "version", label: "Versão", from: "Versão 1", to: "Versão 2" }] },
]

/** `versionConfigs`: as configurações das versões publicadas do agente (padrão: v1 de todos os Grupos e v2 do Grupo B). */
function readAnswer(sql: string, params: unknown[], versionConfigs: AgentConfig[]): { rows: unknown[] } | null {
  if (sql.includes("select distinct") && sql.includes("from agent_versions v")) return { rows: versionConfigs.map(scopeOf) }
  if (sql.includes("from agent_versions v") && sql.includes('"scope"')) return { rows: [V2, V1].map((id) => ({ ...versionSummary(id), scope: scopeOf(VERSIONS[id]!.config) })) }
  if (sql.includes("from agent_runs r") && sql.includes("limit 50")) return { rows: RUNS.map(({ config, ...run }) => ({ ...run, configScope: scopeOf(config) })) }
  if (sql.includes("from agent_runs r") && sql.includes("where r.id = $1")) {
    const run = RUNS.find((candidate) => candidate.id === params[0])
    return { rows: run ? [{ id: run.id, source: run.source, status: run.status, createdAt: AT, completedAt: AT, runTarget: run.runTarget, agentVersionId: run.agentVersionId, agentVersionNumber: run.agentVersionNumber, testedConfig: run.config }] : [] }
  }
  if (sql.includes("from agent_history")) return { rows: HISTORY }
  return null
}

/** `draft`: o rascunho gravado — ou uma função, chamada a cada leitura (simula outra pessoa salvando no meio do pedido). */
function appFor(admin: "GROUP_B" | "ORGANIZATION", draft: AgentConfig | null | (() => AgentConfig | null) = null, versionConfigs: AgentConfig[] = [WIDE, LIVE]) {
  const writes: string[] = []
  const history: unknown[] = []
  const legacyRows = admin === "GROUP_B" ? [{ scope_type: "TEAM", team_id: TEAM_B, subteam_id: null }] : []
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const access = legacyAccessQuery(sql, "ADMIN", legacyRows)
    if (access) return access
    if (/^\s*(update|insert|delete)/i.test(sql)) writes.push(sql.trim().replace(/\s+/g, " ").slice(0, 40))
    if (sql.includes("insert into agent_history")) history.push(JSON.parse(String(params[5])))
    if (sql.includes("from user_accounts ua join people p")) return { rows: [{ id: "acc-1", person_id: "person-1" }] }
    if (sql.includes("select id from subteams where team_id")) return { rows: [] }
    if (sql.includes('a.draft_config "draftConfig"')) {
      return { rows: [{ id: AGENT, organizationId: ORG, active: true, currentVersionId: V2, currentVersionNumber: 2, draftConfig: typeof draft === "function" ? draft() : draft, draftRevision: 4, draftUpdatedAt: null, draftUpdatedByName: null, scopeType: "TEAM", teamId: TEAM_B, subteamId: null }] }
    }
    if (sql.includes('select scope_type "scopeType"')) return { rows: [{ scopeType: "TEAM", teamId: TEAM_B, subteamId: null, active: true }] }
    if (sql.includes(AGENT_LIVE_COLUMNS)) {
      return { rows: [{ name: LIVE.name, agent_type: LIVE.agentType, objective: LIVE.objective, description: LIVE.description, context_prompt: LIVE.contextPrompt, scope_type: "TEAM", team_id: TEAM_B, subteam_id: null, specialty: null, specialty_kind: null, domain: null, capability: null, consolidated_input: false, business_domain_id: null, recommend_support_materials: false, investigation_capabilities: [], action_limits_enabled: false, action_limits: null }] }
    }
    if (sql.includes("from agent_knowledge_documents where agent_id")) return { rows: [{ knowledge_document_id: DOC_B }] }
    if (sql.includes("v.config") && sql.includes("where v.id = $1")) {
      const version = VERSIONS[String(params[0])]
      return { rows: version ? [{ id: params[0], number: version.number, origin: "PUBLISH", revertedFromNumber: null, publishedAt: "2026-11-01T00:00:00.000Z", publishedByName: "Administração geral", current: params[0] === V2, config: version.config }] : [] }
    }
    const read = readAnswer(sql, params, versionConfigs)
    if (read) return read
    const ids = Array.isArray(params[0]) ? (params[0] as string[]) : []
    if (sql.includes("select id from knowledge_documents where id = any")) return { rows: ids.filter((id) => DOC_TEAM[id]).map((id) => ({ id })) }
    if (sql.includes("with agent as")) return { rows: ids.filter((id) => DOC_TEAM[id] === params[3]).map((id) => ({ id })) }
    if (sql.includes("select id, title from knowledge_documents")) return { rows: ids.map((id) => ({ id, title: id === DOC_A ? "Procedimentos do Grupo A" : "Procedimentos do Grupo B" })) }
    if (sql.includes('"next" from agent_versions')) return { rows: [{ next: 3 }] }
    if (sql.includes("insert into agent_versions")) return { rows: [{ id: "e0000000-0000-4000-8000-000000000003", number: 3 }] }
    if (sql.includes('returning draft_revision "revision"')) return { rows: [{ revision: 5 }] }
    if (sql.includes('"hasDraft"')) return { rows: [{ id: AGENT, name: LIVE.name, scopeType: "TEAM", teamId: TEAM_B }] }
    return { rows: [] }
  })
  const db = { query, connect: async () => ({ query, release: () => undefined }) }
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as unknown as { user: unknown }).user = { personId: "person-1", sub: "acc-1", organizationId: ORG, name: "Administrador" }
    next()
  })
  app.use("/", createAgentRouter(db as never))
  app.use(((error, _req, res, next) => {
    void next
    res.status(error instanceof DomainError ? error.statusCode : 500).json({ error: { code: error instanceof DomainError ? error.code : "INTERNAL", message: error instanceof Error ? error.message : String(error) } })
  }) as ErrorRequestHandler)
  return { app, writes, history }
}

const TEST_INPUT = "Cliente pediu o cancelamento da linha por causa do preço."
const FORBIDDEN = "403 AGENT_SCOPE_FORBIDDEN"
type Answer = { status: number; body: { error?: { code?: string; message?: string } } }

/** Resultado de cada pedido (status + código), todos de uma vez: a falha mostra cada rota, não só a primeira. */
async function outcomes(calls: Record<string, () => PromiseLike<Answer>>): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const [name, call] of Object.entries(calls)) {
    const response = await call()
    result[name] = `${response.status} ${response.body.error?.code ?? ""}`.trim()
  }
  return result
}

describe("Agentes — agir sobre um rascunho ou uma versão exige alcançar o alcance DELA, não só o da linha viva", () => {
  it("prévia das instruções de uma versão (ou do rascunho) de alcance maior: 403, sem montar o prompt", async () => {
    buildPromptMock.mockClear()
    const { app } = appFor("GROUP_B")
    const version = await request(app).get(`/${AGENT}/preview-prompt?versionId=${V1}`)
    expect(version.body.error, JSON.stringify(version.body)).toEqual({ code: "AGENT_SCOPE_FORBIDDEN", message: "Você não tem permissão para mover o agente para esse escopo." })
    expect(await outcomes({ versao: async () => version, rascunho: () => request(appFor("GROUP_B", WIDE).app).get(`/${AGENT}/preview-prompt`) })).toEqual({ versao: FORBIDDEN, rascunho: FORBIDDEN })
    expect(buildPromptMock).not.toHaveBeenCalled()
    // A versão do próprio Grupo continua abrindo.
    const own = await request(app).get(`/${AGENT}/preview-prompt?versionId=${V2}`)
    expect(own.status).toBe(200)
    expect(own.body.data.prompt).toBe("prompt montado com a configuração de alcance TEAM")
  })

  it("teste de uma versão (ou do rascunho) de alcance maior: 403, sem executar o agente", async () => {
    runAgentMock.mockClear()
    const { app } = appFor("GROUP_B")
    expect(await outcomes({
      versao: () => request(app).post(`/${AGENT}/test`).send({ input: TEST_INPUT, target: "VERSION", versionId: V1 }),
      rascunho: () => request(appFor("GROUP_B", WIDE).app).post(`/${AGENT}/test`).send({ input: TEST_INPUT, target: "DRAFT" }),
    })).toEqual({ versao: FORBIDDEN, rascunho: FORBIDDEN })
    expect(runAgentMock).not.toHaveBeenCalled()
    expect(await outcomes({
      versaoDoGrupo: () => request(app).post(`/${AGENT}/test`).send({ input: TEST_INPUT, target: "VERSION", versionId: V2 }),
      vigente: () => request(app).post(`/${AGENT}/test`).send({ input: TEST_INPUT }),
    })).toEqual({ versaoDoGrupo: "201", vigente: "201" })
    expect(runAgentMock).toHaveBeenCalledTimes(2)
  })

  it("prévia da publicação de uma versão (ou do rascunho) de alcance maior: 403, sem os títulos das bases de outro Grupo", async () => {
    const version = await request(appFor("GROUP_B").app).get(`/${AGENT}/publish-impact?versionId=${V1}`)
    const draft = await request(appFor("GROUP_B", WIDE).app).get(`/${AGENT}/publish-impact`)
    expect(await outcomes({ versao: async () => version, rascunho: async () => draft })).toEqual({ versao: FORBIDDEN, rascunho: FORBIDDEN })
    expect(JSON.stringify([version.body, draft.body])).not.toContain("Grupo A")
  })

  it("reverter para uma versão de alcance maior: 403, nada gravado (pelo PATCH a mesma mudança já era recusada)", async () => {
    const { app, writes } = appFor("GROUP_B")
    expect(await outcomes({
      reverter: () => request(app).post(`/${AGENT}/versions/${V1}/revert`).send({}),
      patch: () => request(app).patch(`/${AGENT}`).send({ scopeType: "ALL_TEAMS" }),
    })).toEqual({ reverter: FORBIDDEN, patch: FORBIDDEN })
    expect(writes).toEqual([])
  })

  it("publicar, salvar (sem scopeType ou mudando-o), descartar e reverter por cima de um rascunho de alcance maior: 403, nada gravado", async () => {
    const { app, writes } = appFor("GROUP_B", WIDE)
    expect(await outcomes({
      publicar: () => request(app).post(`/${AGENT}/publish`).send({}),
      salvarSemScopeType: () => request(app).patch(`/${AGENT}`).send({ contextPrompt: "Responda sobre os procedimentos de todos os Grupos." }),
      salvarMudandoScopeType: () => request(app).patch(`/${AGENT}`).send({ scopeType: "TEAM", teamId: TEAM_B, knowledgeDocumentIds: [DOC_B] }),
      descartar: () => request(app).post(`/${AGENT}/draft/discard`).send({}),
      // Reverter descartando o rascunho de alcance maior também é agir sobre ele.
      reverterDescartando: () => request(app).post(`/${AGENT}/versions/${V2}/revert`).send({ discardDraft: true }),
    })).toEqual({ publicar: FORBIDDEN, salvarSemScopeType: FORBIDDEN, salvarMudandoScopeType: FORBIDDEN, descartar: FORBIDDEN, reverterDescartando: FORBIDDEN })
    expect(writes).toEqual([])
  })

  it("o administrador do Grupo continua editando, publicando e revertendo o que é do Grupo dele", async () => {
    const { app } = appFor("GROUP_B", configOf({ contextPrompt: "contexto revisado" }))
    expect(await outcomes({
      salvar: () => request(app).patch(`/${AGENT}`).send({ objective: "objetivo revisado" }),
      previaDaPublicacao: () => request(app).get(`/${AGENT}/publish-impact`),
      publicar: () => request(app).post(`/${AGENT}/publish`).send({}),
      descartar: () => request(app).post(`/${AGENT}/draft/discard`).send({}),
      reverter: () => request(appFor("GROUP_B").app).post(`/${AGENT}/versions/${V2}/revert`).send({}),
    })).toEqual({ salvar: "200", previaDaPublicacao: "200", publicar: "201", descartar: "200", reverter: "201" })
  })

  it("quem administra a organização continua podendo tudo, inclusive sobre a configuração de todos os Grupos", async () => {
    runAgentMock.mockClear()
    const { app } = appFor("ORGANIZATION")
    expect((await request(app).get(`/${AGENT}/preview-prompt?versionId=${V1}`)).body.data.prompt).toBe("prompt montado com a configuração de alcance ALL_TEAMS")
    const withDraft = appFor("ORGANIZATION", WIDE).app
    expect(await outcomes({
      testarVersao: () => request(app).post(`/${AGENT}/test`).send({ input: TEST_INPUT, target: "VERSION", versionId: V1 }),
      previaDaPublicacao: () => request(app).get(`/${AGENT}/publish-impact?versionId=${V1}`),
      reverter: () => request(app).post(`/${AGENT}/versions/${V1}/revert`).send({}),
      salvarRascunho: () => request(withDraft).patch(`/${AGENT}`).send({ contextPrompt: "Responda sobre os procedimentos de todos os Grupos." }),
      publicarRascunho: () => request(withDraft).post(`/${AGENT}/publish`).send({}),
      descartarRascunho: () => request(withDraft).post(`/${AGENT}/draft/discard`).send({}),
    })).toEqual({ testarVersao: "201", previaDaPublicacao: "200", reverter: "201", salvarRascunho: "200", publicarRascunho: "201", descartarRascunho: "200" })
    expect(runAgentMock).toHaveBeenCalledTimes(1)
  })
})

describe("Agentes — ler um rascunho, uma versão ou uma execução de outro alcance mostra só número, situação, datas e autor", () => {
  const leaks = (body: unknown) => {
    const text = JSON.stringify(body)
    return [WIDE.contextPrompt, DOC_A, "Grupo A"].filter((secret) => text.includes(secret))
  }

  it("o agente: o rascunho de todos os Grupos sai sem a configuração (restricted); o do próprio Grupo, inteiro", async () => {
    const wide = await request(appFor("GROUP_B", WIDE).app).get(`/${AGENT}`)
    expect(wide.status).toBe(200)
    expect(wide.body.data.draft).toEqual({ config: null, revision: 4, updatedAt: null, updatedByName: null, restricted: true })
    expect(leaks(wide.body)).toEqual([])
    const own = await request(appFor("GROUP_B", configOf({ contextPrompt: "contexto revisado" })).app).get(`/${AGENT}`)
    expect(own.body.data.draft).toMatchObject({ config: { contextPrompt: "contexto revisado" }, restricted: false })
    const organization = await request(appFor("ORGANIZATION", WIDE).app).get(`/${AGENT}`)
    expect(organization.body.data.draft).toMatchObject({ config: WIDE, restricted: false })
  })

  it("as versões: a lista marca a de outro alcance, e abri-la não traz contexto, bases, ferramentas nem limites", async () => {
    const { app } = appFor("GROUP_B")
    const list = await request(app).get(`/${AGENT}/versions`)
    expect(list.body.data).toEqual([{ ...versionSummary(V2), restricted: false }, { ...versionSummary(V1), restricted: true }])
    const restricted = await request(app).get(`/${AGENT}/versions/${V1}`)
    expect(restricted.status).toBe(200)
    expect(restricted.body.data).toEqual({ ...versionSummary(V1), config: null, restricted: true })
    expect(leaks(restricted.body)).toEqual([])
    expect((await request(app).get(`/${AGENT}/versions/${V2}`)).body.data).toEqual({ ...versionSummary(V2), config: LIVE, restricted: false })
    expect((await request(appFor("ORGANIZATION").app).get(`/${AGENT}/versions/${V1}`)).body.data).toMatchObject({ config: WIDE, restricted: false })
  })

  it("as execuções: a de uma versão ou rascunho de outro alcance sai sem entrada, saída e conteúdo testado", async () => {
    const { app } = appFor("GROUP_B")
    const list = await request(app).get(`/${AGENT}/runs`)
    expect(list.body.data.map((run: { id: string; restricted: boolean }) => [run.id, run.restricted])).toEqual([[RUN_V1, true], [RUN_V2, false], [RUN_WIDE_DRAFT, true]])
    expect(list.body.data[0]).toEqual({ id: RUN_V1, source: "WORKFLOW", inputContext: null, outputText: null, status: "COMPLETED", errorMessage: null, model: null, caseId: null, createdAt: AT, completedAt: AT, agentVersionId: V1, agentVersionNumber: 1, runTarget: "VERSION", hasTestedConfig: false, restricted: true })
    expect(list.body.data[1]).toMatchObject({ inputContext: "Transcrição de um operador", outputText: "Feedback do agente" })
    expect(leaks(list.body)).toEqual([])
    expect(JSON.stringify(list.body)).not.toContain("configScope")

    const detail = await request(app).get(`/${AGENT}/runs/${RUN_WIDE_DRAFT}`)
    expect(detail.body.data).toEqual({ id: RUN_WIDE_DRAFT, source: "MANUAL_TEST", status: "COMPLETED", createdAt: AT, completedAt: AT, runTarget: "DRAFT", agentVersionId: null, agentVersionNumber: null, testedConfig: null, restricted: true })
    expect((await request(app).get(`/${AGENT}/runs/${RUN_V2}`)).body.data).toMatchObject({ testedConfig: LIVE, restricted: false })
    const organization = appFor("ORGANIZATION").app
    expect((await request(organization).get(`/${AGENT}/runs/${RUN_V1}`)).body.data).toMatchObject({ testedConfig: WIDE, restricted: false })
    expect((await request(organization).get(`/${AGENT}/runs`)).body.data.every((run: { restricted: boolean }) => !run.restricted)).toBe(true)
  })

  it("o histórico: a alteração feita numa configuração de outro alcance mostra quem, quando e o campo, sem os valores", async () => {
    const { app } = appFor("GROUP_B")
    const entries = (await request(app).get(`/${AGENT}/history`)).body.data
    expect(entries[0]).toEqual({ id: "h-wide", action: "UPDATED", changedByName: "Administração geral", createdAt: AT, changes: [{ field: "contextPrompt", label: "Contexto", from: "", to: "" }], restricted: true })
    expect(entries.slice(1).map((entry: { restricted: boolean; changes: { to: string }[] }) => [entry.restricted, entry.changes[0]!.to])).toEqual([[false, "contexto revisado"], [true, ""], [false, "Versão 2"]])
    expect(leaks(entries)).toEqual([])
    expect(JSON.stringify(entries)).not.toContain("configScopes")
    const organization = (await request(appFor("ORGANIZATION").app).get(`/${AGENT}/history`)).body.data
    expect(organization.map((entry: { restricted: boolean }) => entry.restricted)).toEqual([false, false, false, false])
    expect(organization[0]).toMatchObject({ changes: [{ to: WIDE.contextPrompt }] })
  })

  it("registro antigo (sem o alcance gravado): falha fechado só se o agente já teve um alcance que quem lê não alcança", async () => {
    const legacy = async (app: Parameters<typeof request>[0]) => {
      const entries = (await request(app).get(`/${AGENT}/history`)).body.data as { id: string; restricted: boolean; changes: { to: string }[] }[]
      return entries.find((entry) => entry.id === "h-legacy")!
    }
    // Já foi "todos os Grupos" numa versão: o valor antigo pode ser dessa configuração.
    expect(await legacy(appFor("GROUP_B").app)).toMatchObject({ restricted: true, changes: [{ to: "" }] })
    // Sempre foi do Grupo B (versões e linha viva): quem o administra vê tudo.
    expect(await legacy(appFor("GROUP_B", null, [LIVE]).app)).toMatchObject({ restricted: false, changes: [{ to: "depois" }] })
    // Versões do Grupo B, mas o rascunho em andamento é de todos os Grupos.
    expect(await legacy(appFor("GROUP_B", WIDE, [LIVE]).app)).toMatchObject({ restricted: true })
  })

  it("salvar o rascunho grava no histórico o alcance da configuração anterior e da nova", async () => {
    const { app, history } = appFor("ORGANIZATION")
    expect((await request(app).patch(`/${AGENT}`).send({ scopeType: "ALL_TEAMS", contextPrompt: WIDE.contextPrompt })).status).toBe(200)
    expect(history).toEqual([expect.arrayContaining([expect.objectContaining({ field: "contextPrompt", configScopes: [scopeOf(LIVE), { scopeType: "ALL_TEAMS", teamId: null, subteamId: null }] })])])
  })
})

describe("Agentes — o teste do rascunho executa exatamente o rascunho conferido", () => {
  it("outra pessoa salva um rascunho de todos os Grupos logo depois da conferência: a execução recebe o rascunho conferido, não o novo", async () => {
    runAgentMock.mockClear()
    const OWN_DRAFT = configOf({ contextPrompt: "rascunho do Grupo B" })
    // 1ª leitura do rascunho: a escolha do alvo; 2ª: a conferência do alcance. Daí em diante o rascunho gravado é outro.
    let reads = 0
    const { app } = appFor("GROUP_B", () => (++reads <= 2 ? OWN_DRAFT : WIDE))
    expect((await request(app).post(`/${AGENT}/test`).send({ input: TEST_INPUT, target: "DRAFT" })).status).toBe(201)
    expect(runAgentMock).toHaveBeenCalledTimes(1)
    expect(runAgentMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "MANUAL_TEST", target: { kind: "DRAFT", config: OWN_DRAFT } }))
  })
})
