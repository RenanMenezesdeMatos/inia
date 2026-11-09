// API simulada só para as capturas da Wiki de Workflows: dados fictícios em memória, sem banco, sem IA e sem credenciais.
// Serve os grafos dos exemplos (`demo-graphs.ts`) para abrir o editor real. O Node lê o .ts direto: o arquivo só tem dados e tipos.
import http from "node:http"

import { DEMO_GRAPHS, FICTIONAL_VARIABLE } from "../../../frontend/src/components/wiki/workflow-demo/demo-graphs.ts"
import { acompanhamentoDoColaborador } from "./dados-acompanhamento.mjs"

const PORT = Number(process.env.PORT ?? 3452)
const ORIGIN = process.env.FRONT_ORIGIN ?? "http://127.0.0.1:3451"

// Quem está logado muda o que a tela mostra: administração para o editor; colaborador para o Acompanhamento.
let viewer = "ADMIN"

const CAPABILITIES = { canAccessAdministration: true, canManageWorkflows: true, canManageAgents: true, canManageKnowledge: true, canUseQaLab: true, canManageConfiguration: true, canViewAi: true, canManagePeople: true, canViewUsers: true, canAccessInterventionPolicies: true }

const user = () => ({
  sub: "conta-ficticia",
  personId: "pessoa-ficticia",
  organizationId: "organizacao-ficticia",
  role: viewer,
  name: viewer === "ADMIN" ? "Pessoa de exemplo" : "Caio Exemplo",
  email: "exemplo@exemplo.invalid",
  avatarUrl: null,
  jobTitle: null,
  teamId: null,
  teamName: null,
  preferredName: viewer === "ADMIN" ? null : "Caio",
  displayName: viewer === "ADMIN" ? "Pessoa de exemplo" : "Caio",
  addressName: null,
  access: { permissions: [], capabilities: viewer === "ADMIN" ? CAPABILITIES : { canAccessAdministration: false }, roles: viewer === "ADMIN" ? [{ roleCode: "EXEMPLO", roleName: "Exemplo", scopeType: "ORGANIZATION" }] : [] },
  passwordChangeRequired: false,
  temporaryPasswordExpiresAt: null,
  sessionIdleTimeoutMinutes: 0,
  features: { interactionFeedbackQa: true, usageCollection: false, usageCollectionElements: null, usabilityPanel: false },
})

const TEAM = { id: "grupo-ficticio", name: "Atendimento (fictício)", operationId: "op-1", subteams: [{ id: "voz", teamId: "grupo-ficticio", name: "Voz" }, { id: "digital", teamId: "grupo-ficticio", name: "Digital" }] }

const flagFrom = (trigger, description) => ({ id: trigger.channelFlagId, channel: trigger.channel, flagName: trigger.flagName, valueType: trigger.valueType, description, label: null, iconKey: null, active: true, createdAt: "2026-09-01T10:00:00Z" })
const FLAGS = DEMO_GRAPHS.filter((definition) => definition.trigger.kind === "channel_flag").map((definition) => flagFrom(definition.trigger, "Exemplo"))

const indicator = (id, code, name, unit, desiredDirection) => ({
  id, code, name, unit, desiredDirection, active: true, operationalAggregation: "WEIGHTED_AVERAGE", dailySupported: true, minimumSampleSize: null, minimumCoverage: null, officialClosureSupported: true,
  provesWorkActivity: false, unjustifiedAbsencePolicy: "NO_SAMPLE", availabilityPolicy: null, iconKey: null, glossaryDescription: null, interpretation: null, goodPractices: null, feedbackGuidance: null, calculationRules: [],
})
const INDICATORS = [indicator("ind-tma", "TMA", "TMA", "SECONDS", "LOWER"), indicator("ind-ura", "NOTA_URA", "Nota da Pesquisa na URA", "STARS", "HIGHER")]

const PEOPLE = [{ id: "00000000-0000-4000-8000-00000000e001", name: "Diretoria de exemplo", role: "DIRECTOR", matricula: null, active: true, teamId: null, teamName: null, accountId: null, email: null, lastLoginAt: null }]

const agent = (id, name, specialtyKind, consolidatedInput = false) => ({
  id, name, agentType: "CALL_FEEDBACK", objective: "Objetivo fictício", description: "Descrição fictícia", contextPrompt: "", active: true, createdAt: "2026-09-01T10:00:00Z", createdByName: null, usageCount: 0,
  scopeType: "ALL_TEAMS", teamId: null, teamName: null, subteamId: null, subteamName: null, knowledgeDocuments: [], actionLimitsEnabled: false, actionLimits: null, specialty: null, specialtyKind, domain: null, businessDomainId: null, businessDomain: null,
  capability: null, consolidatedInput, recommendSupportMaterials: false, investigationCapabilities: [], currentVersionId: `versao-${id}`, currentVersionNumber: 3, currentVersionPublishedAt: "2026-10-01T10:00:00Z", published: true, hasDraft: false, draftRevision: 0,
})
const AGENTS = [
  agent("00000000-0000-4000-8000-00000000a001", "Especialista de Qualidade de Atendimento", "CROSS_CUTTING"),
  agent("00000000-0000-4000-8000-00000000a002", "Especialista de Experiência do Cliente", "CROSS_CUTTING"),
  agent("00000000-0000-4000-8000-00000000a003", "Especialista de Eficiência Operacional", "CROSS_CUTTING"),
  agent("00000000-0000-4000-8000-00000000a004", "Especialista de Reconhecimento", "PERFORMANCE"),
  agent("00000000-0000-4000-8000-00000000a005", "Especialista de Síntese Gerencial", "SYNTHESIS", true),
]
const ORCHESTRATORS = [{
  id: "00000000-0000-4000-8000-00000000b001", name: "Orquestrador · Atendimento multidomínio", active: true, createdAt: "2026-09-01T10:00:00Z", scopeType: "ALL_TEAMS", teamId: null, teamName: null, subteamId: null, subteamName: null,
  orchestratorAgentId: "coordenacao", orchestratorAgentName: "Coordenação", specialists: [], invocationMode: "WORKFLOW", outputInstructions: null, outputSchema: null, structuredOutput: null, structuredOutputSource: "NONE", structuredOutputReview: null, structuredOutputFields: null,
  policyKind: "MULTI_DOMAIN", policyDomains: [], routingPolicy: "OPEN", routingDomains: [], businessDomains: [], recommendSupportMaterials: false,
}]
const POLICIES = [{
  id: "00000000-0000-4000-8000-00000000c001", key: "ACOMPANHAMENTO_TMA", name: "Acompanhamento de TMA (fictícia)", active: true, scopeLabel: "Todos os grupos", inForceVersion: 2, scheduledVersions: [],
  description: "Exemplo: observa o TMA por três fechamentos antes de orientar.", indicatorCode: "TMA", matchStrategy: "FIRST_MATCH",
  rules: [{ key: "orientar", name: "TMA fora da meta com recorrência", priority: 1, actions: [{ typeKey: "ORIENTAR", effect: "RECOMMEND" }], inconclusiveActions: [] }],
  types: [{ key: "ORIENTAR", name: "Orientar", responsibleRole: "SUPERVISOR", approval: { required: false }, sensitive: false, active: true }],
}]

const workflowOf = (definition) => {
  const base = {
    id: definition.slug, name: definition.name, description: null, scopeType: "ALL_TEAMS", teamId: null, teamName: null, subteamId: null, subteamName: null, active: false, createdAt: "2026-10-20T12:00:00Z", published: false,
    trigger: definition.trigger, activeEnrollments: 0, consolidatedStructure: definition.consolidatedStructure ?? null, populationFilter: null, configurationChanges: [], draftGraph: definition.graph, publishedGraph: null,
  }
  return { ...base, draftConfiguration: { trigger: definition.trigger, scopeType: "ALL_TEAMS", teamId: null, teamName: null, subteamId: null, subteamName: null, consolidatedStructure: base.consolidatedStructure, populationFilter: null } }
}
const WORKFLOWS = new Map(DEMO_GRAPHS.map((definition) => [definition.slug, workflowOf(definition)]))

function readBody(request) {
  return new Promise((resolve) => {
    let raw = ""
    request.on("data", (chunk) => { raw += chunk })
    request.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) } })
  })
}

const send = (response, status, body) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)) }
const ok = (response, data) => send(response, 200, { data })

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`)
  const path = url.pathname
  response.setHeader("Access-Control-Allow-Origin", request.headers.origin ?? ORIGIN)
  response.setHeader("Access-Control-Allow-Credentials", "true")
  response.setHeader("Access-Control-Allow-Headers", request.headers["access-control-request-headers"] ?? "content-type,x-csrf-token")
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return }

  if (path === "/__captura/quem") { viewer = url.searchParams.get("papel") ?? "ADMIN"; return ok(response, { viewer }) }

  if (path === "/api/v1/auth/login") { response.setHeader("Set-Cookie", "inia_session=exemplo-ficticio; Path=/; HttpOnly; SameSite=Lax"); return ok(response, user()) }
  if (path === "/api/v1/auth/logout") { response.setHeader("Set-Cookie", "inia_session=; Path=/; Max-Age=0"); return ok(response, {}) }
  if (path === "/api/v1/auth/me") return ok(response, user())
  if (path === "/api/v1/admin/channel-flags") return ok(response, FLAGS)
  if (path === "/api/v1/admin/indicator-rules") return ok(response, INDICATORS)
  if (path === "/api/v1/admin/org-structure/teams") return ok(response, [TEAM])
  if (path === "/api/v1/admin/org-structure/teams/manageable") return ok(response, { teams: [TEAM], unrestricted: true })
  if (path === "/api/v1/admin/agents") return ok(response, AGENTS)
  if (path === "/api/v1/admin/agents/references") return ok(response, AGENTS.filter((item) => url.searchParams.getAll("ids").includes(item.id)).map((item) => ({ id: item.id, name: item.name, active: true, published: true })))
  if (path === "/api/v1/admin/assistant-orchestrators") return ok(response, ORCHESTRATORS)
  if (path === "/api/v1/admin/intervention-policies/published-summary") return ok(response, POLICIES)
  if (path.startsWith("/api/v1/admin/users") || path.startsWith("/api/v1/admin/user-accounts")) return ok(response, PEOPLE)
  if (path === "/api/v1/admin/workflows/schedule-preview") {
    // A prévia real vem do mesmo cálculo do agendador; aqui só projeta os horários pedidos nos próximos dias, em horário de Brasília.
    const body = await readBody(request)
    const times = body.trigger?.times?.length ? body.trigger.times : ["09:00"]
    const monthly = body.trigger?.frequency?.type === "MONTHLY"
    const now = new Date()
    const dayOffsets = monthly ? [0, 1] : [1, 2, 3]
    const occurrences = dayOffsets.flatMap((offset) =>
      times.map((time) => {
        const [hour, minute] = time.split(":").map(Number)
        const date = monthly ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + offset, body.trigger.frequency.day ?? 1, hour + 3, minute)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, hour + 3, minute))
        return date.toISOString()
      }),
    )
    return ok(response, { mode: "CALENDAR", timezone: "America/Fortaleza", occurrences, catchUpToday: [] })
  }
  if (path === "/api/v1/admin/workflows") return ok(response, url.searchParams.has("page") ? { items: [...WORKFLOWS.values()], total: WORKFLOWS.size, page: 1, pageSize: 12 } : [...WORKFLOWS.values()])

  const match = path.match(/^\/api\/v1\/admin\/workflows\/([^/]+)(\/.*)?$/)
  if (match) {
    const workflow = WORKFLOWS.get(match[1])
    const rest = match[2] ?? ""
    if (!workflow) return send(response, 404, { error: { code: "NOT_FOUND", message: "Workflow não encontrado." } })
    if (!rest) return ok(response, workflow)
    if (rest === "/variables") return ok(response, [{ id: FICTIONAL_VARIABLE, name: workflow.id === "politica-de-acompanhamento" ? "Aviso de dados" : "Recado de evolução", type: "TEXT", createdAt: "2026-10-20T12:00:00Z" }])
    if (rest === "/validate") return ok(response, { valid: true, error: null })
    if (rest === "/enrollments") return ok(response, { items: [], total: 0, page: 1, pageSize: 12 })
    if (rest === "/results") return ok(response, { items: [], total: 0, page: 1, pageSize: 20 })
    if (rest === "/results/summary") return ok(response, { period: { from: "2026-10-05", to: "2026-11-04" }, dispatches: 0, persons: 0, feedbacksProduced: 0, feedbacksSent: 0, awaitingQa: 0, blocked: 0, usage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, incomplete: false, costs: [], costUnknownCalls: 0 } })
    return ok(response, {})
  }

  const acompanhamento = acompanhamentoDoColaborador(path)
  if (acompanhamento !== undefined) return ok(response, acompanhamento)

  return ok(response, request.method === "GET" ? [] : {})
})

server.listen(PORT, "127.0.0.1", () => console.log(`API simulada das capturas em http://127.0.0.1:${PORT}`))
