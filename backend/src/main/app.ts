import cookieParser from "cookie-parser"
import cors from "cors"
import express, { type ErrorRequestHandler } from "express"
import helmet from "helmet"
import { ZodError } from "zod"
import { env } from "../config/env.js"
import { pool, type Database } from "../infrastructure/database/pool.js"
import { PgCaseRepository } from "../modules/supervision-cases/infrastructure/pg-case-repository.js"
import { createCaseRouter } from "../modules/supervision-cases/presentation/case-router.js"
import { loadCaseVisibility } from "../modules/supervision-cases/application/case-visibility.js"
import { createFeedbackRouter } from "../modules/feedbacks/presentation/feedback-router.js"
import { createGovernanceRouter } from "../modules/governance/presentation/governance-router.js"
import { createInterventionAdminRouter } from "../modules/interventions/presentation/intervention-admin-router.js"
import { createInterventionRouter } from "../modules/interventions/presentation/intervention-router.js"
import { createDiagnosticsRouter } from "../modules/diagnostics/presentation/diagnostics-router.js"
import { createIngestionRouter } from "../modules/ingestion/presentation/ingestion-router.js"
import { createEphemeralRealtimeSession } from "../modules/realtime/infrastructure/gemini-realtime-client.js"
import { streamTextReply } from "../modules/realtime/infrastructure/gemini-text-client.js"
import { createRealtimeRouter } from "../modules/realtime/presentation/realtime-router.js"
import { createConversationMonitoringRouter } from "../modules/assistant/presentation/conversation-monitoring-router.js"
import { createSupervisorRouter } from "../modules/reporting/presentation/supervisor-router.js"
import { createOperatorRouter } from "../modules/reporting/presentation/operator-router.js"
import { createAuthRouter } from "../modules/auth/presentation/auth-router.js"
import { createMyProfileRouter, createProfileImageRouter } from "../modules/profile-preferences/presentation/profile-preferences-router.js"
import { createIniaSceneAdminRouter, createIniaSceneRouter } from "../modules/inia-scenes/presentation/inia-scene-router.js"
import { createRequireAuth } from "../modules/auth/presentation/require-auth.js"
import { createIniaDeliveriesRouter } from "../modules/conversational-delivery/presentation/inia-deliveries-router.js"
import { createFeedbackApplicationsRouter } from "../modules/feedback-application/presentation/feedback-applications-router.js"
import { createFeedbackReadConfirmationsRouter } from "../modules/feedback-application/presentation/feedback-read-confirmations-router.js"
import { createSubjectDataExportRouter } from "../modules/data-lifecycle/presentation/subject-data-export-router.js"
import { createFeedbackContestationsRouter } from "../modules/feedback-rating/presentation/feedback-contestations-router.js"
import { createFeedbackRatingsRouter } from "../modules/feedback-rating/presentation/feedback-ratings-router.js"
import { synthesizeSpeechWithGemini } from "../modules/conversational-delivery/infrastructure/gemini-tts-client.js"
import { INIA_LIVE_MODEL, iniaVoiceName } from "../config/inia-voice.js"
import { speakWithGeminiLive } from "../modules/conversational-delivery/infrastructure/gemini-live-speech-client.js"
import { acceptedRecadoModels, createRecadoVoice } from "../modules/conversational-delivery/application/recado-voice.js"
import { requirePermission, writesRequireOrganization } from "../modules/access/presentation/require-permission.js"
import { createAccessRouter } from "../modules/access/presentation/access-router.js"
import { createKnowledgeRouter } from "../modules/knowledge/presentation/knowledge-router.js"
import { createCheckpointRegistryRouter } from "../modules/checkpoint-registry/presentation/checkpoint-registry-router.js"
import { createKnowledgeMaterialRouter } from "../modules/knowledge/presentation/knowledge-material-router.js"
import { createAgentRouter } from "../modules/agents/presentation/agent-router.js"
import { createBusinessDomainRouter } from "../modules/business-domains/presentation/business-domain-router.js"
import { createOperationalCalendarRouter } from "../modules/people/presentation/operational-calendar-router.js"
import { createOrgStructureRouter } from "../modules/org-structure/presentation/org-structure-router.js"
import { createPersonOrganizationStructureRouter } from "../modules/org-structure/presentation/person-organization-structure-router.js"
import { createTeamCalendarRouter } from "../modules/people/presentation/team-calendar-router.js"
import { createIndicatorRuleRouter } from "../modules/indicator-rules/presentation/indicator-rule-router.js"
import { createDiagnosticStrategyRouter } from "../modules/indicator-diagnosis/presentation/diagnostic-strategy-router.js"
import { createEmployeePerformanceRouter } from "../modules/indicators/presentation/employee-performance-router.js"
import { createCallExpectationRouter } from "../modules/call-expectations/presentation/call-expectation-router.js"
import { createArgumentScriptRouter } from "../modules/argument-scripts/presentation/argument-script-router.js"
import { createUserAccountRouter } from "../modules/users/presentation/user-account-router.js"
import { createChannelFlagRouter } from "../modules/channel-flags/presentation/channel-flag-router.js"
import { createWorkflowRouter } from "../modules/workflows/presentation/workflow-router.js"
import { createAssistantRouter } from "../modules/assistant/presentation/assistant-router.js"
import { createQaLabRouter } from "../modules/qa-lab/presentation/qa-lab-router.js"
import { createAnalyticsRouter } from "../modules/performance-analytics/presentation/analytics-router.js"
import { createLeadershipRouter } from "../modules/leadership-analytics/presentation/leadership-router.js"
import { createReportsRouter } from "../modules/reports/presentation/reports-router.js"
import { createPendingActionsRouter } from "../modules/pending-actions/presentation/pending-actions-router.js"
import { createFeedbackReviewRouter } from "../modules/interaction-feedback/presentation/feedback-review-router.js"
import { createFeedbackDeliveryRouter } from "../modules/interaction-feedback/presentation/feedback-delivery-router.js"
import { createNotificationsRouter } from "../modules/notifications/presentation/notifications-router.js"
import { createDataHubRouter } from "../modules/data-hub/presentation/data-hub-router.js"
import { createDataIngestionRouter } from "../modules/data-hub/presentation/data-ingestion-router.js"
import { DomainError } from "../shared/domain/domain-error.js"
import { DataRunError } from "../modules/data-hub/domain/error-codes.js"
import { createResponseCompression } from "../shared/presentation/compression.js"
import { createOriginGuard } from "../shared/presentation/origin-guard.js"
import { accountKey, clientIpAndEmailKey, clientIpKey, createRateLimiter, sessionCookieKey, type RateLimitRule } from "../shared/presentation/rate-limit.js"
import { createMemoryRateLimitStore, type RateLimitStore } from "../shared/application/rate-limit/rate-limit-store.js"
import { createReadiness, type Readiness } from "./readiness.js"
import { isInternalRequest, type RuntimeMetrics } from "./runtime-metrics.js"
import { SESSION_COOKIE_NAME } from "../modules/auth/presentation/session-cookie.js"
import { createLogger } from "../shared/infrastructure/logging/logger.js"
import { createChatStreamer, createRoutedSpeechSynthesizer, createSpeechSynthesizer, createVoiceSessionStarter, speechCacheIdentity } from "../shared/application/model-routing/llm-gateway.js"
import { registerAiRuntime } from "../shared/application/model-routing/ai-runtime.js"
import { createAiRuntime } from "../modules/ai-management/application/ai-runtime-service.js"
import { createAdapterRegistry } from "../modules/ai-management/infrastructure/adapters/adapter-registry.js"
import { createAiManagementRouter } from "../modules/ai-management/presentation/ai-management-router.js"
import { createUsageEventsRouter } from "../modules/usage-analytics/presentation/usage-events-router.js"
import { createUsabilityRouter } from "../modules/usage-analytics/presentation/usability-router.js"
import { mountUsageServerTaps } from "../modules/usage-analytics/presentation/server-fact-taps.js"

export type CreateAppOptions = {
  /** true só no servidor real: o gateway de IA passa a consultar a policy/uso/orçamento da organização
   * (testes e scripts ficam no caminho legado — exatamente o comportamento anterior). */
  registerAiRuntime?: boolean
  /** Revisão humana do feedback por interação (V1.5.4). Padrão = INIA_INTERACTION_FEEDBACK_PIPELINE (OFF): com OFF a rota
   * nem é montada e cai no 404 genérico — nada é exposto. Os testes passam explicitamente. */
  interactionFeedbackReview?: boolean
  /** Monitoria de usabilidade: coleta (ingestão + fatos de servidor) e painel. Padrão = INIA_USAGE_COLLECTION / INIA_USABILITY_PANEL. */
  usageCollection?: boolean
  usabilityPanel?: boolean
  /** Limites de requisições (padrão ligados). Os testes de abuso passam valores pequenos; `false` desliga todos. */
  rateLimits?: Partial<RateLimitSettings> | false
  /** Onde os limites contam. O servidor real passa a do PostgreSQL (todos os processos de API dividem o contador); sem ela,
   * memória deste app (testes e scripts). */
  rateLimitStore?: RateLimitStore
  /** Central de Dados com o processamento em OUTRO processo (papel `api`): a carga enfileirada só avisa o worker. Ausente =
   * processa aqui mesmo, fora do request (papel `all`, testes). */
  dataHubWakeWorker?: () => void
  /** Prontidão para o balanceador (`/ready`): o servidor passa a dele (desligamento → 503). Ausente = confere só o banco. */
  readiness?: Readiness
  /** Métricas do processo: mede cada request e expõe `GET /internal/metrics` (só da própria máquina, nunca pelo proxy). */
  metrics?: RuntimeMetrics
}

/** Tetos por janela — generosos para o uso humano, baixos para laço/automação abusiva. Ver docs/security/configuracao-segura.md. */
export type RateLimitSettings = {
  /** Login por IP + e-mail a cada 5 min (a trava por e-mail continua: 5 falhas/15 min). */
  loginPerIpAndEmail: number
  /** Logins RECUSADOS por IP a cada 5 min (anti "uma senha em muitas contas"); login certo não conta. */
  loginPerIp: number
  /** Criação de senha do primeiro acesso: tentativas RECUSADAS por IP a cada 15 min (contra enxurrada anônima). */
  firstPasswordPerIp: number
  /**
   * Criação de senha do primeiro acesso por SESSÃO a cada 15 min — no dia da liberação centenas de pessoas criam a senha pelo
   * mesmo IP (Citrix/NAT): cada uma tem o seu contador (achado AUTH-14 da auditoria de 17/10/2026).
   */
  firstPasswordPerSession: number
  /** Confirmações de ciência com senha que FALHARAM, por conta, a cada 15 min. */
  readConfirmationFailuresPerAccount: number
  /** API Push: requisições recusadas (token/payload inválido) por IP a cada 15 min. */
  pushIngestionFailuresPerIp: number
  /** API Push: requisições por IP por minuto (aceitas ou não). */
  pushIngestionPerIp: number
  /** IA conversacional (chat, voz, ferramentas, apresentação e recados falados) por conta, por minuto. */
  aiInteractivePerAccount: number
  /** Novas sessões de voz (credencial efêmera do provedor) por conta, por minuto. */
  voiceSessionsPerAccount: number
  /**
   * Novas sessões de voz por conta a cada 30 minutos — a sessão Live vale até 30 min e fala direto com o provedor: este teto
   * limita quantas a mesma conta mantém vivas ao mesmo tempo (achado AI-09 da auditoria de 17/10/2026).
   */
  voiceSessionsPerAccountHalfHour: number
  /** Ações administrativas que chamam IA ou abrem conexão externa (testar Agent/modelo/conexão, simular, QA Lab, executar agora), por conta, por minuto. */
  adminCostlyActionsPerAccount: number
  /** Envio de foto/capa do perfil (até 2 imagens de 8 MB em memória cada) por conta, por minuto (AUTH-17). */
  profileWritesPerAccount: number
}

const DEFAULT_RATE_LIMITS: RateLimitSettings = {
  loginPerIpAndEmail: env.LOGIN_RATE_LIMIT_PER_IP_EMAIL,
  loginPerIp: env.LOGIN_RATE_LIMIT_PER_IP,
  firstPasswordPerIp: 300,
  firstPasswordPerSession: 10,
  readConfirmationFailuresPerAccount: 10,
  pushIngestionFailuresPerIp: 30,
  pushIngestionPerIp: 600,
  aiInteractivePerAccount: 90,
  voiceSessionsPerAccount: 12,
  voiceSessionsPerAccountHalfHour: 60,
  adminCostlyActionsPerAccount: 30,
  profileWritesPerAccount: 20,
}

const httpLog = createLogger("http")

/**
 * Caminho como o roteador do Express o casa: sem diferenciar maiúsculas e sem a barra final. Todo limite montado por caminho
 * compara com ESTE valor, nunca com `request.path` cru — `/x/TEST` e `/x/test/` chegam à mesma rota de `/x/test` e,
 * comparados crus, passavam sem o limite (achado INFRA-1 da auditoria de 17/10/2026).
 */
export function routePath(request: Pick<express.Request, "path">): string {
  const lowered = request.path.toLowerCase()
  const trimmed = lowered.replace(/\/+$/, "")
  return trimmed.length > 0 ? trimmed : "/"
}

/** TRUST_PROXY (sintaxe do Express): `false`, número de saltos ou lista de endereços/sub-redes/apelidos (loopback…). */
export function parseTrustProxy(value: string): boolean | number | string {
  const normalized = value.trim()
  if (normalized.toLowerCase() === "false") return false
  if (/^\d+$/.test(normalized)) return Number(normalized)
  return normalized
}

export function createApp(database: Database = pool, options: CreateAppOptions = {}) {
  const app = express()
  // Módulos ligados neste ambiente — projetados no /auth/me como `features` (V1.5.8a): o frontend nunca deduz "módulo
  // desligado" de um 404, nem confunde isso com falta de permissão (403).
  const interactionFeedbackEnabled = options.interactionFeedbackReview ?? env.INIA_INTERACTION_FEEDBACK_PIPELINE === "ON"
  const usageCollectionEnabled = options.usageCollection ?? env.INIA_USAGE_COLLECTION === "ON"
  const usabilityPanelEnabled = options.usabilityPanel ?? env.INIA_USABILITY_PANEL === "ON"
  // Providers, Modelos, Roteamento e Custos de IA: a MESMA instância atende o gateway e o admin
  // (escrita administrativa invalida o cache na hora — sem restart).
  const aiAdapters = createAdapterRegistry()
  const aiRuntime = createAiRuntime(database, { adapters: aiAdapters })
  if (options.registerAiRuntime) registerAiRuntime(aiRuntime)
  app.disable("x-powered-by")
  if (options.metrics) app.use(options.metrics.middleware)
  // IP real do cliente atrás do IIS/proxy (limites de tentativas) — só de proxies explicitamente confiáveis.
  app.set("trust proxy", parseTrustProxy(env.TRUST_PROXY))
  app.use(helmet())
  // JSON e texto da API comprimidos (o IIS não comprime para não segurar o streaming do chat) — nunca o SSE.
  app.use(createResponseCompression())
  // content-disposition não é safelisted no CORS — sem expor, o browser esconde o nome do arquivo
  // do download da base de conhecimento.
  app.use(cors({ origin: env.allowedOrigins, credentials: true, exposedHeaders: ["content-disposition"] }))
  // JSON de 1 MB para a API; o API Push (lotes de registros do cliente) tem o próprio parser de 10 MB no router — o global
  // não roda ali, senão o limite dele nunca valeria (413 acima de 1 MB).
  const jsonBody = express.json({ limit: "1mb" })
  app.use((request, response, next) => (routePath(request).startsWith("/api/v1/data-ingestion/") ? next() : jsonBody(request, response, next)))
  app.use(cookieParser())
  // CSRF: escrita com o cookie de sessão só de origem autorizada (ver origin-guard.ts).
  app.use(createOriginGuard({ allowedOrigins: env.allowedOrigins, sessionCookieName: SESSION_COOKIE_NAME }))
  // Respostas da API são dados de uma sessão: nenhum cache (navegador, proxy) guarda — a rota que serve arquivo público
  // da própria sessão (imagens) sobrescreve com o próprio Cache-Control.
  app.use("/api", (_request, response, next) => {
    response.set("Cache-Control", "no-store")
    next()
  })
  const limits: RateLimitSettings | null = options.rateLimits === false ? null : { ...DEFAULT_RATE_LIMITS, ...options.rateLimits }
  const rateLimitStore = options.rateLimitStore ?? createMemoryRateLimitStore()
  const limit = (rule: Omit<RateLimitRule, "max"> & { max: keyof RateLimitSettings }) =>
    limits ? createRateLimiter({ ...rule, max: limits[rule.max] }, rateLimitStore) : (_request: express.Request, _response: express.Response, next: express.NextFunction) => next()
  const onlyMethods = (methods: readonly string[], handler: express.RequestHandler): express.RequestHandler => (request, response, next) =>
    methods.includes(request.method) ? handler(request, response, next) : next()
  // Login: por IP + e-mail (cada pessoa com o seu contador, mesmo atrás de um NAT) e um teto de RECUSAS por IP.
  app.post("/api/v1/auth/login", limit({ name: "login-ip-email", windowMs: 5 * 60_000, max: "loginPerIpAndEmail", key: clientIpAndEmailKey, message: "Muitas tentativas de acesso com este e-mail. Aguarde alguns minutos e tente novamente." }))
  app.post("/api/v1/auth/login", limit({ name: "login-ip-failures", windowMs: 5 * 60_000, max: "loginPerIp", key: clientIpKey, countOnlyFailures: true, message: "Muitas tentativas de acesso recusadas deste endereço. Aguarde alguns minutos e tente novamente." }))
  app.post("/api/v1/auth/password", limit({ name: "first-password-ip", windowMs: 15 * 60_000, max: "firstPasswordPerIp", key: clientIpKey, countOnlyFailures: true }))
  app.post("/api/v1/auth/password", limit({ name: "first-password-session", windowMs: 15 * 60_000, max: "firstPasswordPerSession", key: sessionCookieKey(SESSION_COOKIE_NAME) }))
  app.use("/api/v1/data-ingestion", limit({ name: "push-ip", windowMs: 60_000, max: "pushIngestionPerIp", key: clientIpKey }))
  app.use("/api/v1/data-ingestion", limit({ name: "push-failures-ip", windowMs: 15 * 60_000, max: "pushIngestionFailuresPerIp", key: clientIpKey, countOnlyFailures: true, message: "Muitas requisições recusadas deste endereço. Aguarde e confira o token e o formato do envio." }))
  // Por CONTA (montados depois do requireAuth de cada rota, abaixo): custo de IA e confirmação com senha.
  const aiPerAccount = limit({ name: "ai-account", windowMs: 60_000, max: "aiInteractivePerAccount", key: accountKey, message: "Muitas solicitações à INIA em pouco tempo. Aguarde um instante." })
  const voiceSessionsPerMinute = limit({ name: "voice-session-account", windowMs: 60_000, max: "voiceSessionsPerAccount", key: accountKey, message: "Muitas conversas por voz iniciadas em pouco tempo. Aguarde um instante." })
  const voiceSessionsPerHalfHour = limit({ name: "voice-session-account-30m", windowMs: 30 * 60_000, max: "voiceSessionsPerAccountHalfHour", key: accountKey, message: "Muitas conversas por voz abertas nesta meia hora. Encerre as que não está usando e aguarde alguns minutos." })
  const voiceSessionsPerAccount: express.RequestHandler = (request, response, next) => voiceSessionsPerMinute(request, response, (error?: unknown) => (error ? next(error) : voiceSessionsPerHalfHour(request, response, next)))
  // Um balde por conta para TODAS as ações administrativas caras (achado A-F06): cada uma é custo de IA ou conexão a um
  // destino externo (sondagem de rede). Montado depois do guard de cada área (precisa da conta da sessão).
  const adminCostlyLimiter = limit({ name: "admin-costly-account", windowMs: 60_000, max: "adminCostlyActionsPerAccount", key: accountKey, message: "Muitos testes e simulações em pouco tempo. Aguarde um instante." })
  const costly = (pattern: RegExp): express.RequestHandler => (request, response, next) => (request.method === "POST" && pattern.test(routePath(request)) ? adminCostlyLimiter(request, response, next) : next())
  const readConfirmationFailures = limit({ name: "read-confirmation-account", windowMs: 15 * 60_000, max: "readConfirmationFailuresPerAccount", key: accountKey, countOnlyFailures: true, message: "Muitas tentativas de confirmação. Aguarde alguns minutos e tente novamente." })
  // Monitoria de usabilidade: fatos de servidor observados na RESPOSTA 2xx das rotas existentes (login, voz, aplicação,
  // notificação) — montados antes delas e só com a coleta ligada; nunca alteram a resposta.
  if (usageCollectionEnabled) mountUsageServerTaps(app, database)

  // V1.5.7: cada área administrativa exige a PERMISSÃO dela (papéis explícitos + escopo), nunca cargo/`people.role`.
  const can = (permission: Parameters<typeof requirePermission>[1], options?: Parameters<typeof requirePermission>[2]) => requirePermission(database, permission, options)
  // Sessão conferida NO BANCO a cada request (conta habilitada, versão de sessão, troca de senha pendente) — ver require-auth.ts.
  const requireAuth = createRequireAuth(database)
  // Central de Dados: aviso ao processamento (papel `api`) e o limite por token do API Push na MESMA loja dos outros limites.
  const dataHubOverrides = { pushRateLimits: rateLimitStore, ...(options.dataHubWakeWorker ? { wakeWorker: options.dataHubWakeWorker } : {}) }

  // /health = o processo está de pé (sempre ok). /ready = pode receber tráfego: banco respondendo e não está desligando — é o
  // que o health check da web farm do ARR consulta (deploy/windows/iis), procurando "ready" no corpo: a resposta de "não
  // pronto" nunca contém essa palavra.
  app.get("/health", (_request, response) => response.json({ status: "ok" }))
  const readiness = options.readiness ?? createReadiness(database)
  app.get("/ready", async (_request, response) => {
    const result = await readiness.check()
    response.set("Cache-Control", "no-store")
    response.status(result.ready ? 200 : 503).json(result.ready ? { status: "ready" } : { status: "unavailable", reason: result.reason })
  })
  // Métricas internas: só quem está na própria máquina e não veio pelo IIS (o web.config nunca encaminha /internal). Fora disso,
  // o mesmo 404 de qualquer rota inexistente.
  if (options.metrics) {
    const metrics = options.metrics
    app.get("/internal/metrics", (request, response, next) => {
      if (!isInternalRequest(request, env.INIA_METRICS_TOKEN)) return next()
      response.set("Cache-Control", "no-store")
      response.json(metrics.snapshot())
    })
  }
  app.use("/api/v1/auth", createAuthRouter(database, { features: { interactionFeedbackQa: interactionFeedbackEnabled, usageCollection: usageCollectionEnabled, usabilityPanel: usabilityPanelEnabled } }))
  // Preferências pessoais do perfil (nome de tratamento, foto, capa) — sempre da pessoa da sessão; imagens da mesma organização.
  const profileWrites = limit({ name: "profile-writes-account", windowMs: 60_000, max: "profileWritesPerAccount", key: accountKey, message: "Muitas alterações de perfil em pouco tempo. Aguarde um instante." })
  app.use("/api/v1/me/profile", requireAuth, onlyMethods(["PUT", "POST", "PATCH", "DELETE"], profileWrites), createMyProfileRouter(database))
  app.use("/api/v1/profile-images", requireAuth, createProfileImageRouter(database))
  // Cenário da INIA (fundo atrás do avatar): qualquer pessoa autenticada vê o que vale hoje; só o Administrador geral configura.
  app.use("/api/v1/inia-scenes", requireAuth, createIniaSceneRouter(database))
  app.use("/api/v1/supervision-cases", requireAuth, createCaseRouter(new PgCaseRepository(database), (request) => loadCaseVisibility(database, request.user!)))
  app.use("/api/v1/feedbacks", requireAuth, createFeedbackRouter(database))
  app.use("/api/v1/admin/access", requireAuth, createAccessRouter(database))
  app.use("/api/v1/admin/knowledge", can("knowledge.manage"), createKnowledgeRouter(database))
  // Checkpoint Registry — checkpoints derivados da Base de Conhecimento, governados pelo administrador (regra oficial read-only).
  app.use("/api/v1/admin/checkpoints", can("knowledge.manage"), createCheckpointRegistryRouter(database))
  // Leitor de material para qualquer usuário autenticado — acesso pelo alcance da base (backend é a autoridade).
  app.use("/api/v1/knowledge-materials", requireAuth, createKnowledgeMaterialRouter(database))
  app.use("/api/v1/admin/agents", can("agents.manage"), costly(/^\/[^/]+\/test$/), createAgentRouter(database))
  // Catálogo administrável de domínios de negócio (classifica Agents DOMAIN e restringe Orquestradores DOMAINS).
  // Catálogos da organização inteira: lê com a permissão em qualquer escopo, altera só com escopo de organização.
  const orgWideWrites = writesRequireOrganization("configuration.manage")
  app.use("/api/v1/admin/business-domains", can("configuration.manage"), orgWideWrites, createBusinessDomainRouter(database))
  app.use("/api/v1/admin/operational-calendar", can("configuration.manage"), orgWideWrites, createOperationalCalendarRouter(database))
  app.use("/api/v1/admin/org-structure", can("configuration.manage"), createOrgStructureRouter(database))
  app.use("/api/v1/admin/indicator-rules", can("configuration.manage"), createIndicatorRuleRouter(database))
  // V1.6.2 — estratégia de diagnóstico do indicador (versionada; a tela de Indicadores configura, o runtime da V1.6.1 executa).
  app.use("/api/v1/admin/indicator-diagnostic-strategies", can("configuration.manage"), costly(/\/simulate$/), createDiagnosticStrategyRouter(database))
  app.use("/api/v1/admin/employee-performance", can("configuration.manage"), createEmployeePerformanceRouter(database))
  // Argumentários (evolução das Regras de chamada): cadastro estruturado/versionado; a rota antiga fica só leitura (transição).
  app.use("/api/v1/admin/argument-scripts", can("configuration.manage"), createArgumentScriptRouter(database))
  app.use("/api/v1/admin/call-expectations", can("configuration.manage"), createCallExpectationRouter(database))
  app.use("/api/v1/admin/users", can("people.manage"), createUserAccountRouter(database))
  app.use("/api/v1/admin/channel-flags", can("configuration.manage"), orgWideWrites, createChannelFlagRouter(database))
  app.use("/api/v1/admin/workflows", can("workflows.manage"), costly(/^\/[^/]+\/manual-runs$/), createWorkflowRouter(database))
  app.use("/api/v1/admin/assistant-orchestrators", can("agents.manage"), createAssistantRouter(database))
  // Conversas com a INIA (somente leitura) — permissão própria (montada ANTES do `/api/v1/admin` da governança, que exige configuration.manage); não abre nenhum outro módulo da Administração.
  app.use("/api/v1/admin/assistant-conversations", can("assistant_conversations.view"), createConversationMonitoringRouter(database))
  // Contestações de feedback (revisão humana, LGPD art. 20): fila e resposta no escopo de quem revisa.
  app.use("/api/v1/admin/feedback-contestations", can("feedback_contestations.review"), createFeedbackContestationsRouter(database))
  // Pedido do titular (LGPD art. 18): exportação de tudo o que está ligado a uma pessoa — só com escopo de organização.
  app.use("/api/v1/admin/people", can("privacy.subject_data.export", { organizationWide: true }), createSubjectDataExportRouter(database))
  // Monitoria de usabilidade — permissão própria (como as conversas: montada ANTES do `/api/v1/admin` da governança); cada rota
  // aplica a permissão granular e o escopo. Ingestão do navegador: qualquer conta autenticada, só com a coleta ligada.
  if (usabilityPanelEnabled) app.use("/api/v1/admin/usability", can("usability.view"), createUsabilityRouter(database))
  if (usageCollectionEnabled) app.use("/api/v1/usage", requireAuth, createUsageEventsRouter(database))
  // Cenário da INIA — recurso do tenant inteiro: `inia_experience.manage` com escopo de ORGANIZAÇÃO (só o Administrador geral).
  app.use("/api/v1/admin/inia-scenes", can("inia_experience.manage", { organizationWide: true }), createIniaSceneAdminRouter(database))
  // IA: permissões derivadas dentro do router (ai.manage na organização = escrita; ai.view = leitura; sem papel = 403).
  app.use("/api/v1/admin/ai", requireAuth, costly(/\/test$/), createAiManagementRouter({ db: database, runtime: aiRuntime, adapters: aiAdapters, now: () => new Date() }))
  // QA Lab: `qa_lab.use` com escopo de ORGANIZAÇÃO (Administrador geral) — administrador escopado não passa daqui.
  app.use("/api/v1/admin/qa-lab", can("qa_lab.use", { organizationWide: true }), costly(/^\/runs(\/|$)/), createQaLabRouter(database))
  // Central de Dados — porta única de entrada dos dados do cliente (admin) e endpoint inbound do
  // API Push (autenticado por token de push, nunca por sessão de usuário).
  // Os dados da Central valem para a organização inteira (pessoas, hierarquia, e-mail de login, medições) e os conectores
  // carregam credenciais dos sistemas do cliente: só quem tem `data_hub.manage` com escopo de ORGANIZAÇÃO (achado I-F1).
  // Teto das ações caras: teste de conexão, amostras e listagem do SFTP (abrem conexão com o destino) e criação de conjunto (o de
  // banco conecta para validar) — achado DATA-9.
  app.use("/api/v1/admin/data-hub", can("data_hub.manage", { organizationWide: true }), costly(/^\/(database\/test|sources\/[^/]+\/(test-connection|preview|sample|sftp-files|feeds)|feeds\/[^/]+\/(preview|sample))$/), createDataHubRouter(database, dataHubOverrides))
  // Políticas de acompanhamento e intervenções — permissões próprias (editar/simular/publicar/auditar; `workflows.manage` lê o
  // resumo publicado para o nó do Workflow e simula). Cada rota confere a permissão e o escopo. Montada ANTES da governança.
  app.use("/api/v1/admin/intervention-policies", requireAuth, costly(/\/simulate$/), createInterventionAdminRouter(database))
  // Experiência do líder: pendências, caso, ficha, relatório e comandos — autorização pela relação com a intervenção.
  app.use("/api/v1/interventions", requireAuth, costly(/\/(narrative|ai-draft)$/), createInterventionRouter(database))
  // Governança (assuntos proibidos, glossário) no prefixo raiz da Administração: montada DEPOIS das áreas específicas para o
  // guard dela não interceptar as outras rotas /admin/*.
  app.use("/api/v1/admin", can("configuration.manage"), orgWideWrites, createGovernanceRouter(database))
  app.use("/api/v1/data-ingestion", createDataIngestionRouter(database, dataHubOverrides))
  app.use("/api/v1/diagnostics", requireAuth, createDiagnosticsRouter(database))
  app.use("/api/v1/ingestion", can("data_hub.manage", { organizationWide: true }), createIngestionRouter(database))
  app.use(
    "/api/v1/realtime",
    requireAuth,
    onlyMethods(["POST"], aiPerAccount),
    (request, response, next) => (request.method === "POST" && routePath(request) === "/sessions" ? voiceSessionsPerAccount(request, response, next) : next()),
    createRealtimeRouter(database, createVoiceSessionStarter(createEphemeralRealtimeSession), createChatStreamer(streamTextReply)),
  )
  // Workflow Outputs V1 — recados de voz (aceite → fala) e conversas de Workflow do PRÓPRIO destinatário.
  // Voz da INIA para falas prontas (recado do avatar e apresentação do feedback): a MESMA da conversa, conferida contra o texto.
  // Com policy de "Voz do recado do avatar" (SPEECH_SYNTHESIS) na organização, o modelo/voz dela; o cache aceita a identidade da rota em vigor.
  const legacyRecadoVoice = createRecadoVoice({ speakLikeConversation: createSpeechSynthesizer(speakWithGeminiLive), readWithTts: createSpeechSynthesizer(synthesizeSpeechWithGemini), onFallback: (info) => console.warn("[recado] voz da conversa não usada; leitura do TTS", { reason: info.reason, errorCode: info.errorCode, fidelity: info.fidelity && { reasons: info.fidelity.reasons, errorRate: info.fidelity.errorRate } }) })
  const legacySpeechIdentity = { voice: iniaVoiceName(), models: acceptedRecadoModels(INIA_LIVE_MODEL, env.INIA_AVATAR_TTS_MODEL) }
  const iniaSpeech = { synthesize: createRoutedSpeechSynthesizer(legacyRecadoVoice), accepted: () => speechCacheIdentity(legacySpeechIdentity) }
  // Áudio do recado/apresentação = síntese de voz no provedor (custo): mesmo teto por conta da IA conversacional.
  const audioPerAccount: express.RequestHandler = (request, response, next) => (request.method === "GET" && routePath(request).endsWith("/audio") ? aiPerAccount(request, response, next) : next())
  app.use("/api/v1/inia-deliveries", requireAuth, audioPerAccount, createIniaDeliveriesRouter(database, { synthesizeSpeech: iniaSpeech }))
  // Aplicação de feedback conversacional — a INIA apresenta UM feedback publicado ao próprio destinatário e conversa sobre ele.
  app.use("/api/v1/feedback-applications", requireAuth, audioPerAccount, onlyMethods(["POST"], aiPerAccount), createFeedbackApplicationsRouter(database, { synthesizeSpeech: iniaSpeech }))
  // Ciência = o próprio destinatário confirma com login e senha que leu o feedback (Acompanhamento ou sessão com a INIA).
  app.use("/api/v1/feedback-read-confirmations", requireAuth, onlyMethods(["POST"], readConfirmationFailures), createFeedbackReadConfirmationsRouter(database))
  // "Este conteúdo foi útil?" — avaliação do feedback pelo próprio destinatário (descurtir = motivo + descrição).
  app.use("/api/v1/feedback-ratings", requireAuth, createFeedbackRatingsRouter(database))
  app.use("/api/v1/supervisor", requireAuth, createSupervisorRouter(database))
  app.use("/api/v1/operator", requireAuth, createOperatorRouter(database))
  // Indicadores e Equipe/Estrutura — escopo por papel resolvido no backend a cada request.
  app.use("/api/v1/analytics", requireAuth, createAnalyticsRouter(database))
  // Leituras determinísticas da liderança (as mesmas das ferramentas do chat) — escopo da sessão, sem IA.
  app.use("/api/v1/leadership", requireAuth, createLeadershipRouter(database))
  // Reports recorrentes: permissões (líder × papel Report) e escopo de cada destinatário decididos no serviço, a cada pedido.
  // Prévia (roda a consulta), "Executar agora" e nova tentativa da análise (IA) entram no teto das ações caras (achado SCOPE-04).
  app.use("/api/v1/reports", requireAuth, costly(/^\/(preview|[^/]+\/run|deliveries\/[^/]+\/analysis\/retry)$/), createReportsRouter(database))
  // Aba Estrutura do perfil — posição na hierarquia real, mesma autoridade de escopo de analytics.
  app.use("/api/v1/people", requireAuth, createPersonOrganizationStructureRouter(database))
  // Pendências (ação requerida) e Sino (algo novo aconteceu) — sempre do viewer da sessão.
  app.use("/api/v1/pending-actions", requireAuth, createPendingActionsRouter(database))
  app.use("/api/v1/team-calendar", requireAuth, createTeamCalendarRouter(database))
  app.use("/api/v1/notifications", requireAuth, createNotificationsRouter(database))
  // QA de feedback (QA Lab › Feedbacks) + concessão da capability FEEDBACK_QUALITY_REVIEW — só com a flag do pipeline ligada;
  // sem entrega ao colaborador. Avaliar exige o papel QA_DE_FEEDBACK (modelo geral de acesso, V1.5.7).
  if (interactionFeedbackEnabled) {
    app.use("/api/v1/feedback-quality-reviews", requireAuth, createFeedbackReviewRouter(database))
    // Feedback de atendimento entregue — Acompanhamento do próprio colaborador (V1.5.6).
    app.use("/api/v1/feedback-deliveries", requireAuth, createFeedbackDeliveryRouter(database))
  }
  app.use((_request, response) => response.status(404).json({ error: { code: "NOT_FOUND", message: "Recurso não encontrado." } }))

  const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
    if (response.headersSent) return next(error)
    if (error instanceof DomainError) {
      response.status(error.statusCode).json({ error: { code: error.code, message: error.message, details: error.details } })
      return
    }
    if (error instanceof ZodError) {
      response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: error.issues } })
      return
    }
    // Erro de conector da Central de Dados numa rota síncrona (amostra, prévia): código estável em vez de 500 (R-29).
    // Origem fora do ar/lenta = 502; o resto (credencial, formato, mapeamento) é corrigível por quem configura = 422.
    if (error instanceof DataRunError) {
      response.status(error.transient ? 502 : 422).json({ error: { code: error.code, message: error.message } })
      return
    }
    const clientError = describeClientError(error)
    if (clientError) {
      response.status(clientError.status).json({ error: { code: clientError.code, message: clientError.message } })
      return
    }
    // Falha inesperada: registrada no servidor (sem corpo, cookies nem query — podem ter dado pessoal ou segredo) e
    // devolvida sem detalhe interno.
    httpLog.error({ method: request.method, path: request.path, err: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) }, "erro não tratado na API")
    response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erro interno." } })
  }
  app.use(errorHandler)
  return app
}

/**
 * Erros de ENTRADA levantados antes do router (corpo JSON malformado ou grande demais, upload acima do limite): respondem como
 * erro do cliente (4xx) — antes caíam no 500 genérico, escondendo do usuário o que corrigir e poluindo o alarme de erro interno.
 */
function describeClientError(error: unknown): { status: number; code: string; message: string } | null {
  if (typeof error !== "object" || error === null) return null
  const candidate = error as { type?: unknown; status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown; severity?: unknown }
  // PostgreSQL recusou o FORMATO de um valor vindo da requisição (ex.: id que não é uuid em `/:id`): erro do cliente, sem
  // ecoar a mensagem do banco (achado A-F14 — antes virava 500 em dezenas de rotas).
  if (typeof candidate.severity === "string" && (candidate.code === "22P02" || candidate.code === "22007" || candidate.code === "22008")) return { status: 400, code: "INVALID_IDENTIFIER", message: "Identificador ou valor em formato inválido." }
  if (candidate.type === "entity.parse.failed") return { status: 400, code: "INVALID_JSON", message: "Corpo da requisição não é um JSON válido." }
  if (candidate.type === "entity.too.large") return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "Corpo da requisição grande demais." }
  if (candidate.name === "MulterError") {
    if (candidate.code === "LIMIT_FILE_SIZE") return { status: 413, code: "FILE_TOO_LARGE", message: "Arquivo acima do tamanho permitido." }
    return { status: 400, code: "INVALID_UPLOAD", message: "Envio de arquivo inválido." }
  }
  const status = typeof candidate.status === "number" ? candidate.status : typeof candidate.statusCode === "number" ? candidate.statusCode : null
  if (status !== null && status >= 400 && status < 500) return { status, code: "BAD_REQUEST", message: "Requisição inválida." }
  return null
}
