// API simulada, só para a auditoria de UX de Workflows: dados fictícios em memória, nenhum acesso ao banco nem a credenciais.
import http from "node:http"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"

const REPO = new URL("../../../../", import.meta.url).pathname
const ORIGIN = process.env.FRONT_ORIGIN ?? "http://127.0.0.1:3411"
const PORT = Number(process.env.PORT ?? 3412)

const models = JSON.parse(readFileSync(`${REPO}backend/src/modules/workflows/testing/official-model-workflows.json`, "utf8"))
const catalog = JSON.parse(readFileSync(`${REPO}backend/src/modules/workflows/testing/official-ai-catalog.json`, "utf8"))

const state = { access: "geral", failNext: {}, slowMs: 0, validateError: null, impact: null, requests: [] }

const TEAM = { id: "team-b2c", name: "B2C · Atendimento (fictício)", operationId: "op-1", subteams: [{ id: "sub-voz", teamId: "team-b2c", name: "Voz" }, { id: "sub-digital", teamId: "team-b2c", name: "Digital" }] }
const TEAM2 = { id: "team-b2b", name: "B2B · Contas (fictício)", operationId: "op-1", subteams: [] }

const CAPS_GERAL = { canAccessAdministration: true, canManageWorkflows: true, canManageAgents: true, canManageKnowledge: true, canUseQaLab: true, canManageConfiguration: true, canViewAi: true, canManagePeople: true, canViewUsers: true, canAccessInterventionPolicies: true }
const CAPS_GRUPO = { canAccessAdministration: true, canManageWorkflows: true, canManageAgents: true }
const CAPS_NONE = { canAccessAdministration: false }

function user() {
  const capabilities = state.access === "geral" ? CAPS_GERAL : state.access === "grupo" ? CAPS_GRUPO : CAPS_NONE
  return {
    sub: "acc-qa", personId: "person-qa", organizationId: "org-qa", role: "ADMIN", name: "Pessoa de teste", email: "teste@exemplo.invalid",
    avatarUrl: null, jobTitle: null, teamId: null, teamName: null, preferredName: null, displayName: "Pessoa de teste", addressName: null,
    access: { permissions: [], capabilities, roles: [{ roleCode: "TESTE", roleName: "Teste", scopeType: "ORGANIZATION" }] },
    passwordChangeRequired: false, temporaryPasswordExpiresAt: null, sessionIdleTimeoutMinutes: 0,
    features: { interactionFeedbackQa: false, usageCollection: false, usageCollectionElements: null, usabilityPanel: false },
  }
}

const FLAGS = [
  { id: "flag-rechamada", channel: "VOICE", flagName: "rechamada", valueType: "BOOLEAN", description: "Cliente ligou de novo", label: null, iconKey: null, active: true, createdAt: "2026-09-01T10:00:00Z" },
  { id: "flag-nota", channel: "VOICE", flagName: "nota_ura", valueType: "NUMERIC", description: "Nota na URA", label: null, iconKey: null, active: true, createdAt: "2026-09-01T10:00:00Z" },
]
const INDICATORS = [
  { id: "ind-1", code: "TMA", name: "Tempo médio de atendimento", unit: "SECONDS", desiredDirection: "LOWER", active: true, operationalAggregation: "WEIGHTED_AVERAGE", dailySupported: true, officialClosureSupported: true, rules: [] },
  { id: "ind-2", code: "MONITORIA_QUALIDADE", name: "Monitoria de qualidade", unit: "POINTS", desiredDirection: "HIGHER", active: true, operationalAggregation: "WEIGHTED_AVERAGE", dailySupported: true, officialClosureSupported: true, rules: [] },
]
const AGENTS = catalog.agents.map((agent) => ({
  id: agent.id, name: agent.name, agentType: agent.agentType, objective: "Objetivo fictício", description: "Descrição fictícia", contextPrompt: "", active: agent.active, createdAt: "2026-09-01T10:00:00Z",
  createdByName: null, usageCount: 0, scopeType: agent.scopeType, teamId: null, teamName: null, subteamId: null, subteamName: null, knowledgeDocuments: [], actionLimitsEnabled: false, actionLimits: null,
  specialty: agent.specialty, specialtyKind: agent.specialtyKind, domain: agent.domain, businessDomainId: null, businessDomain: null, capability: agent.capability, consolidatedInput: agent.consolidatedInput,
  recommendSupportMaterials: false, investigationCapabilities: [], currentVersionId: `ver-${agent.id}`, currentVersionNumber: 3, currentVersionPublishedAt: "2026-10-01T10:00:00Z", published: true, hasDraft: false, draftRevision: 0,
}))
const ORCHESTRATORS = catalog.orchestrators.map((o) => ({
  id: o.id, name: o.name, active: o.active, createdAt: "2026-09-01T10:00:00Z", scopeType: o.scopeType, teamId: null, teamName: null, subteamId: null, subteamName: null,
  orchestratorAgentId: o.coordinatorAgentId, orchestratorAgentName: "Coordenação", specialists: [], invocationMode: o.invocationMode, outputInstructions: null, outputSchema: null,
  structuredOutput: null, structuredOutputSource: "NONE", structuredOutputReview: null, structuredOutputFields: null, policyKind: o.policyKind, policyDomains: o.policyDomains ?? [], routingPolicy: o.routingPolicy, routingDomains: o.routingDomains ?? [], businessDomains: [], recommendSupportMaterials: false,
}))
const PEOPLE = Array.from({ length: 40 }, (_, index) => ({
  id: `person-${index}`, name: `Colaboradora Fictícia ${String(index + 1).padStart(2, "0")}`, role: index % 8 === 0 ? "SUPERVISOR" : "OPERATOR", matricula: `F${index}`, active: true,
  teamId: "team-b2c", teamName: TEAM.name, accountId: `acc-${index}`, email: `pessoa${index}@exemplo.invalid`, lastLoginAt: null,
}))

function readTrigger(raw) {
  if (raw.kind === "channel_flag") {
    const flag = FLAGS.find((f) => f.id === raw.channelFlagId) ?? FLAGS[0]
    return { kind: "channel_flag", channelFlagId: raw.channelFlagId, channel: flag.channel, flagName: flag.flagName, valueType: flag.valueType }
  }
  if (raw.kind === "indicator") {
    const indicator = INDICATORS.find((i) => i.code === raw.indicatorCode) ?? INDICATORS[0]
    return { kind: "indicator", indicatorCode: indicator.code, indicatorName: indicator.name, unit: indicator.unit, valueType: "NUMERIC" }
  }
  if (raw.kind === "manual" && raw.context === "INDICATOR_MEASUREMENT") return { ...raw, indicatorName: "Tempo médio de atendimento", unit: "SECONDS" }
  return raw
}

function makeWorkflow(input) {
  const trigger = readTrigger(input.trigger)
  const base = {
    id: input.id ?? randomUUID(), name: input.name, description: input.description ?? null, scopeType: input.scopeType ?? "ALL_TEAMS", teamId: input.teamId ?? null, teamName: input.teamName ?? null,
    subteamId: null, subteamName: null, active: input.active ?? true, createdAt: "2026-10-20T12:00:00Z", published: Boolean(input.publishedGraph), trigger, activeEnrollments: input.activeEnrollments ?? 0,
    consolidatedStructure: input.consolidatedStructure ?? null, populationFilter: input.populationFilter ?? null, configurationChanges: input.configurationChanges ?? [], draftGraph: input.graph, publishedGraph: input.publishedGraph ?? null,
  }
  base.draftConfiguration = {
    trigger: input.draftTrigger ? readTrigger(input.draftTrigger) : trigger, scopeType: base.scopeType, teamId: base.teamId, teamName: base.teamName, subteamId: null, subteamName: null,
    consolidatedStructure: base.consolidatedStructure, populationFilter: base.populationFilter,
  }
  return base
}

const clone = (value) => JSON.parse(JSON.stringify(value))
const starter = () => ({
  nodes: [
    { id: "trigger", type: "trigger", label: "Início", position: { x: 0, y: 0 }, config: {} },
    { id: "end", type: "end", label: "Fim", position: { x: 0, y: 200 }, config: {} },
  ],
  edges: [{ id: "e-trigger-end", source: "trigger", sourceHandle: "always", target: "end" }],
})

const workflows = new Map()
function add(input) {
  const workflow = makeWorkflow(input)
  workflows.set(workflow.id, workflow)
  return workflow
}

const FLAG_MODEL = models.find((m) => m.key === "02") ?? models[0]
for (const model of models) {
  const trigger = model.trigger.kind === "channel_flag" ? { kind: "channel_flag", channelFlagId: "flag-rechamada" } : model.trigger
  add({ id: `modelo-${model.key}`, name: model.name, trigger, scopeType: model.teamId ? "TEAM" : model.scopeType, teamId: model.teamId ? TEAM.id : null, teamName: model.teamId ? TEAM.name : null, consolidatedStructure: model.consolidatedStructure, populationFilter: model.populationFilter, graph: clone(model.graph) })
}
add({ id: "qa-novo", name: "QA · Novo workflow (Flag)", trigger: { kind: "channel_flag", channelFlagId: "flag-rechamada" }, graph: starter() })
const liveGraph = clone(FLAG_MODEL.graph)
add({ id: "qa-no-ar", name: "QA · No ar por Flag", trigger: { kind: "channel_flag", channelFlagId: "flag-rechamada" }, graph: clone(liveGraph), publishedGraph: clone(liveGraph), activeEnrollments: 4 })
const edited = clone(liveGraph)
edited.nodes[1].label = `${edited.nodes[1].label} (editado)`
add({ id: "qa-alterado", name: "QA · No ar com fluxo alterado", trigger: { kind: "channel_flag", channelFlagId: "flag-rechamada" }, graph: edited, publishedGraph: clone(liveGraph), activeEnrollments: 2 })
add({ id: "qa-config", name: "QA · Configuração não publicada", trigger: { kind: "manual", context: "COLLABORATOR" }, draftTrigger: { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, frequency: { type: "DAILY" } }, configurationChanges: ["TRIGGER"], graph: clone(models.find((m) => m.key === "03").graph), publishedGraph: clone(models.find((m) => m.key === "03").graph) })
add({ id: "qa-desligado", name: "QA · Publicado e desativado", active: false, trigger: { kind: "manual", context: "INTERACTION" }, graph: clone(liveGraph), publishedGraph: clone(liveGraph) })

// Fluxo com problemas: Condição sem "Não", Output sem conteúdo, nó solto, nó sem rótulo.
const broken = { nodes: [
  { id: "trigger", type: "trigger", label: "Início", position: { x: 0, y: 0 }, config: {} },
  { id: "c1", type: "condition", label: "", position: { x: 0, y: 160 }, config: { comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null } },
  { id: "a1", type: "action", label: "", position: { x: 0, y: 360 }, config: { actionType: "CALL_AGENT", agentId: "" } },
  { id: "o1", type: "output", label: "", position: { x: 0, y: 560 }, config: { target: { type: "USER", userId: "" }, surfaces: ["INBOX"], source: "" } },
  { id: "w1", type: "wait", label: "Aguardar (solto)", position: { x: 420, y: 160 }, config: { durationMs: 3600000 } },
  { id: "end", type: "end", label: "Fim", position: { x: 0, y: 780 }, config: {} },
], edges: [
  { id: "e1", source: "trigger", sourceHandle: "always", target: "c1" },
  { id: "e2", source: "c1", sourceHandle: "true", target: "a1" },
  { id: "e3", source: "a1", sourceHandle: "always", target: "o1" },
  { id: "e4", source: "o1", sourceHandle: "always", target: "end" },
] }
add({ id: "qa-problemas", name: "QA · Com problemas de configuração", trigger: { kind: "channel_flag", channelFlagId: "flag-rechamada" }, graph: broken })

// Fluxo grande sintético: 42 nós em ramos, para avaliar enquadramento e legibilidade.
const large = { nodes: [{ id: "trigger", type: "trigger", label: "Início", position: { x: 0, y: 0 }, config: {} }], edges: [] }
let previous = "trigger"
for (let i = 1; i <= 13; i += 1) {
  const c = `c${i}`, w = `w${i}`, a = `a${i}`
  large.nodes.push({ id: c, type: "condition", label: `Condição ${i}`, position: { x: 0, y: i * 260 }, config: { comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null } })
  large.nodes.push({ id: w, type: "wait", label: `Espera ${i}`, position: { x: -340, y: i * 260 + 130 }, config: { durationMs: 3600000 } })
  large.nodes.push({ id: a, type: "output", label: `Entrega ${i}`, position: { x: 340, y: i * 260 + 130 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["NOTIFICATION"], source: "" } })
  large.edges.push({ id: `e-${previous}-${c}`, source: previous, sourceHandle: previous === "trigger" || previous.startsWith("w") ? "always" : "false", target: c })
  large.edges.push({ id: `e-${c}-${w}`, source: c, sourceHandle: "false", target: w })
  large.edges.push({ id: `e-${c}-${a}`, source: c, sourceHandle: "true", target: a })
  previous = w
}
large.nodes.push({ id: "end", type: "end", label: "Fim", position: { x: 0, y: 14 * 260 }, config: {} })
large.edges.push({ id: "e-last-end", source: previous, sourceHandle: "always", target: "end" })
for (let i = 1; i <= 13; i += 1) large.edges.push({ id: `e-a${i}-end`, source: `a${i}`, sourceHandle: "always", target: "end" })
add({ id: "qa-grande", name: "QA · Fluxo grande (42 nós)", trigger: { kind: "channel_flag", channelFlagId: "flag-rechamada" }, graph: large })

function enrollmentsFor(workflow) {
  const nodes = (workflow.publishedGraph ?? workflow.draftGraph).nodes
  const review = nodes.find((n) => n.type === "human_review") ?? nodes[1]
  const agent = nodes.find((n) => n.type === "action") ?? nodes[1]
  const base = { versionId: "ver-3", versionNumber: 3, blockedAt: null, blockedNodeId: null, blockedReason: null, blockedDetails: null, retryOfEnrollmentId: null, retryRequestedByName: null, retryRequestedAt: null, retryAgents: [], retries: [], agentRuns: [], manualRun: null }
  const ev = (nodeId, eventType, min, payload = {}) => ({ nodeId, eventType, payload, createdAt: new Date(Date.now() - min * 60000).toISOString() })
  return [
    { ...base, id: "aaaaaaaa-0000-4000-8000-000000000001", currentNodeId: review.id, status: "waiting", nextEvalAt: new Date(Date.now() + 3600000).toISOString(), createdAt: new Date(Date.now() - 3600000).toISOString(), updatedAt: new Date().toISOString(), events: [ev("trigger", "node_advanced", 60), ev(agent.id, "action_executed", 58, { actionType: "CALL_AGENT" }), ev(review.id, "human_review_requested", 57)] },
    { ...base, id: "aaaaaaaa-0000-4000-8000-000000000002", currentNodeId: agent.id, status: "active", nextEvalAt: new Date(Date.now() + 60000).toISOString(), createdAt: new Date(Date.now() - 300000).toISOString(), updatedAt: new Date().toISOString(), events: [ev("trigger", "node_advanced", 5)] },
    { ...base, id: "aaaaaaaa-0000-4000-8000-000000000003", currentNodeId: "end", status: "completed", nextEvalAt: new Date(Date.now() - 7200000).toISOString(), createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString(), events: [ev("trigger", "node_advanced", 1440), ev(agent.id, "action_executed", 1438, { actionType: "CALL_AGENT" }), ev("end", "flow_completed", 1437)] },
    { ...base, id: "aaaaaaaa-0000-4000-8000-000000000004", currentNodeId: agent.id, status: "dead", nextEvalAt: new Date(Date.now() - 7200000).toISOString(), createdAt: new Date(Date.now() - 172800000).toISOString(), updatedAt: new Date().toISOString(), events: [ev("trigger", "node_advanced", 2880), ev(agent.id, "node_failed", 2870, { error: "O provedor de IA não respondeu no tempo limite." }), ev(agent.id, "flow_dead", 2860, { error: "Tentativas esgotadas." })] },
    { ...base, id: "aaaaaaaa-0000-4000-8000-000000000005", currentNodeId: agent.id, blockedNodeId: agent.id, status: "blocked", blockedAt: new Date().toISOString(), blockedReason: "AGENT_INACTIVE", blockedDetails: { agentId: "x", agentName: "Especialista fictício", agentVersionId: "v", agentVersionNumber: 2, denial: null }, nextEvalAt: new Date().toISOString(), createdAt: new Date(Date.now() - 7200000).toISOString(), updatedAt: new Date().toISOString(), events: [ev(agent.id, "node_blocked", 100, { agentName: "Especialista fictício", agentVersionNumber: 2, reason: "AGENT_INACTIVE" })] },
  ]
}

function listRow(workflow) {
  const { draftGraph, publishedGraph, ...row } = workflow
  return row
}

function impactFor(workflow) {
  const kind = workflow.draftConfiguration.trigger.kind
  const schedule = kind === "schedule" && workflow.active ? {
    mode: "CALENDAR", evaluation: workflow.consolidatedStructure ? "CONSOLIDATED" : "INDIVIDUAL", population: 2264, enrollmentsPerOccurrence: workflow.consolidatedStructure ? 1 : 2264,
    immediate: { enrollments: 2264, alreadyEnrolled: 0, scheduledFor: [new Date(Date.now() - 3600000).toISOString()] }, firstFireAt: new Date(Date.now() - 3600000).toISOString(), firesImmediately: true, timezone: "America/Fortaleza",
  } : null
  const reasons = schedule ? ["IMMEDIATE_CATCH_UP", "LARGE_POPULATION"] : []
  return { reason: "PUBLISH", triggerKind: kind, goesLive: workflow.active, firstPublication: !workflow.published, configurationChanges: workflow.configurationChanges, schedule, requiresConfirmation: reasons.length > 0, reasons, threshold: 50, fingerprint: `fp-${workflow.id}-${workflow.configurationChanges.length}` }
}

const send = (response, status, body) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)) }
const ok = (response, data, status = 200) => send(response, status, { data })
const fail = (response, status, code, message, details) => send(response, status, { error: { code, message, details } })

function readBody(request) {
  return new Promise((resolve) => {
    let raw = ""
    request.on("data", (chunk) => { raw += chunk })
    request.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) } })
  })
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`)
  const path = url.pathname
  response.setHeader("Access-Control-Allow-Origin", request.headers.origin ?? ORIGIN)
  response.setHeader("Access-Control-Allow-Credentials", "true")
  response.setHeader("Access-Control-Allow-Headers", request.headers["access-control-request-headers"] ?? "content-type,x-csrf-token")
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return }

  // Controle da simulação: `/__mock/set?failNext=draft&slowMs=1500&validateError=...&access=grupo`
  if (path === "/__mock/set") {
    for (const [key, value] of url.searchParams) {
      if (key === "failNext") state.failNext[value] = true
      else if (key === "slowMs") state.slowMs = Number(value)
      else if (key === "access") state.access = value
      else if (key === "validateError") state.validateError = value || null
    }
    return ok(response, { failNext: state.failNext, slowMs: state.slowMs, access: state.access, validateError: state.validateError })
  }
  if (path === "/__mock/requests") return ok(response, state.requests.slice(-60))

  const body = request.method === "GET" ? {} : await readBody(request)
  state.requests.push({ method: request.method, path, at: new Date().toISOString() })
  if (state.slowMs) await new Promise((resolve) => setTimeout(resolve, state.slowMs))

  if (path === "/api/v1/auth/login") { response.setHeader("Set-Cookie", "inia_session=teste-ficticio; Path=/; HttpOnly; SameSite=Lax"); return ok(response, user()) }
  if (path === "/api/v1/auth/logout") { response.setHeader("Set-Cookie", "inia_session=; Path=/; Max-Age=0"); return ok(response, {}) }
  if (path === "/api/v1/auth/me") return (request.headers.cookie ?? "").includes("inia_session=") ? ok(response, user()) : fail(response, 401, "UNAUTHENTICATED", "Sessão expirada.")
  if (path === "/api/v1/admin/channel-flags") return ok(response, FLAGS)
  if (path === "/api/v1/admin/indicator-rules") return ok(response, INDICATORS)
  if (path === "/api/v1/admin/org-structure/teams") return ok(response, [TEAM, TEAM2])
  if (path === "/api/v1/admin/org-structure/teams/manageable") return ok(response, state.access === "grupo" ? { teams: [TEAM], unrestricted: false } : { teams: [TEAM, TEAM2], unrestricted: true })
  if (path === "/api/v1/admin/agents") return ok(response, AGENTS)
  if (path === "/api/v1/admin/agents/references") return ok(response, AGENTS.filter((a) => url.searchParams.getAll("ids").includes(a.id)).map((a) => ({ id: a.id, name: a.name, active: a.active, published: true })))
  if (path === "/api/v1/admin/assistant-orchestrators") return ok(response, ORCHESTRATORS)
  if (path.startsWith("/api/v1/admin/users") || path.startsWith("/api/v1/admin/user-accounts")) return ok(response, PEOPLE)

  if (path === "/api/v1/admin/workflows/schedule-preview") {
    const now = Date.now()
    return ok(response, { mode: "CALENDAR", occurrences: [1, 2, 3, 4, 5].map((d) => new Date(now + d * 86400000).toISOString()), catchUpToday: [] })
  }
  if (path === "/api/v1/admin/workflows" && request.method === "GET") {
    if (url.searchParams.has("page")) {
      const search = (url.searchParams.get("search") ?? "").toLowerCase()
      const rows = [...workflows.values()].filter((w) => !search || w.name.toLowerCase().includes(search)).reverse()
      const page = Number(url.searchParams.get("page") ?? 1), pageSize = Number(url.searchParams.get("pageSize") ?? 12)
      return ok(response, { items: rows.slice((page - 1) * pageSize, page * pageSize).map(listRow), total: rows.length, page, pageSize })
    }
    return ok(response, [...workflows.values()].map(listRow))
  }
  if (path === "/api/v1/admin/workflows" && request.method === "POST") {
    if (state.failNext.create) { delete state.failNext.create; return fail(response, 500, "INTERNAL", "Erro interno.") }
    const workflow = add({ name: body.name, trigger: body.trigger, scopeType: body.scopeType, teamId: body.teamId ?? null, teamName: body.teamId ? TEAM.name : null, graph: starter() })
    return ok(response, listRow(workflow), 201)
  }

  const match = path.match(/^\/api\/v1\/admin\/workflows\/([^/]+)(\/.*)?$/)
  if (match) {
    const workflow = workflows.get(match[1])
    const rest = match[2] ?? ""
    if (!workflow) return fail(response, 404, "NOT_FOUND", "Workflow não encontrado.")
    if (!rest && request.method === "GET") return ok(response, workflow)
    if (!rest && request.method === "DELETE") { workflows.delete(workflow.id); response.writeHead(204); response.end(); return }
    if (!rest && request.method === "PATCH") {
      if (state.failNext.patch) { delete state.failNext.patch; return fail(response, 500, "INTERNAL", "Erro interno.") }
      if (body.name) workflow.name = body.name
      if (typeof body.active === "boolean") {
        const needsConfirmation = body.active && !workflow.active && workflow.published && workflow.trigger.kind === "schedule"
        if (needsConfirmation && !body.confirmation) return fail(response, 409, "WORKFLOW_ACTIVATION_CONFIRMATION_REQUIRED", "Confirme.", { impact: { ...impactFor(workflow), reason: "ACTIVATE" } })
        workflow.active = body.active
      }
      if (body.trigger) { workflow.draftConfiguration.trigger = readTrigger(body.trigger); if (workflow.published && !workflow.configurationChanges.includes("TRIGGER")) workflow.configurationChanges.push("TRIGGER"); if (!workflow.published) workflow.trigger = workflow.draftConfiguration.trigger }
      return ok(response, listRow(workflow))
    }
    if (rest === "/draft") {
      if (state.failNext.draft) { delete state.failNext.draft; return fail(response, 500, "INTERNAL", "Não foi possível salvar: erro interno do servidor.") }
      workflow.draftGraph = body.graph
      return ok(response, { id: workflow.id })
    }
    if (rest === "/validate") {
      if (state.failNext.validate) { delete state.failNext.validate; return fail(response, 503, "UNAVAILABLE", "Indisponível.") }
      if (state.validateError) { const [code, nodeId] = state.validateError.split(":"); return ok(response, { valid: false, error: { code, message: "Não encontramos exatamente um Supervisor para receber este conteúdo: a estrutura escolhida tem dois responsáveis.", nodeId: nodeId ?? null } }) }
      return ok(response, { valid: true, error: null })
    }
    if (rest === "/publish-impact") return ok(response, impactFor(workflow))
    if (rest === "/publish") {
      if (state.failNext.publish) { delete state.failNext.publish; return fail(response, 500, "INTERNAL", "Não foi possível publicar: erro interno do servidor.") }
      const impact = impactFor(workflow)
      if (impact.requiresConfirmation && body.confirmation !== impact.fingerprint) return fail(response, 409, "WORKFLOW_PUBLISH_CONFIRMATION_REQUIRED", "Confirme o impacto.", { impact })
      workflow.publishedGraph = clone(workflow.draftGraph)
      workflow.published = true
      workflow.trigger = workflow.draftConfiguration.trigger
      workflow.configurationChanges = []
      return ok(response, listRow(workflow))
    }
    if (rest === "/configuration/discard") { workflow.draftConfiguration.trigger = workflow.trigger; workflow.configurationChanges = []; return ok(response, listRow(workflow)) }
    if (rest === "/analysis-config") return ok(response, listRow(workflow))
    if (rest === "/variables") return ok(response, [])
    if (rest === "/enrollments") {
      const items = workflow.published ? enrollmentsFor(workflow) : []
      return ok(response, { items, total: items.length, page: 1, pageSize: 12 })
    }
    if (rest.endsWith("/decision")) { state.requests.push({ decision: body.decision }); return ok(response, {}) }
    if (rest === "/results/summary") return ok(response, { period: { from: "2026-10-05", to: "2026-11-04" }, dispatches: 0, persons: 0, feedbacksProduced: 0, feedbacksSent: 0, awaitingQa: 0, blocked: 0, usage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, incomplete: false, costs: [], costUnknownCalls: 0 } })
    if (rest === "/results") return ok(response, { items: [], total: 0, page: 1, pageSize: 20 })
    if (rest === "/manual-run") return ok(response, { context: workflow.trigger.context ?? "COLLABORATOR", blockers: [], recentRuns: [] })
    if (rest.startsWith("/manual-run/")) return ok(response, rest.includes("collaborators") ? { items: PEOPLE.slice(0, 8).map((p) => ({ id: p.id, name: p.name, teamName: p.teamName, subteamName: null, matricula: p.matricula })), total: 8 } : [])
  }

  if (request.method === "GET") return ok(response, [])
  return ok(response, {})
})

server.listen(PORT, "127.0.0.1", () => console.log(`API simulada em http://127.0.0.1:${PORT}`))
