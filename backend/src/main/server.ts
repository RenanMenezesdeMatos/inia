// PRIMEIRO import: marca o processo como servidor antes de o pool do banco nascer (limites de sessão por papel).
import "./server-database-session.js"
import type { Server } from "node:http"
import { env } from "../config/env.js"
import { databaseSession, pool } from "../infrastructure/database/pool.js"
import { createPostgresJobLockSession } from "../infrastructure/jobs/job-lock-session.js"
import { startPeriodicJobs } from "../infrastructure/jobs/periodic-jobs.js"
import { createWaiterRegistry } from "../modules/human-support/application/waiters.js"
import { readInboxVersions } from "../modules/human-support/application/inbox-versions.js"
import { dispatchAllOrganizations } from "../modules/human-support/application/dispatch.js"
import { humanSupportStats } from "../modules/human-support/application/runtime-stats.js"
import { HUMAN_SUPPORT_LIMITS } from "../modules/human-support/domain/catalogs.js"
import { processPendingKnowledgeVersions } from "../modules/knowledge/application/knowledge-versions.js"
import { processKnowledgeOcrJobs } from "../modules/knowledge/application/knowledge-ocr-jobs.js"
import { startWorkflowWorker } from "../modules/workflows/application/workflow-worker.js"
import { runScheduleCheck } from "../modules/workflows/application/schedule-check.js"
import { createDataHubContext } from "../modules/data-hub/application/data-hub-context.js"
import { runAnalyticsRollup } from "../modules/performance-analytics/application/analytics-rollup.js"
import { runDataRetention } from "../modules/data-lifecycle/application/run-data-retention.js"
import { kickWorker, runDataHubTick } from "../modules/data-hub/application/run-service.js"
import { runEmploymentStatusProjection } from "../modules/people/application/employment-status-service.js"
import { runScheduleHorizonAlerts } from "../modules/people/application/schedule-horizon-alert-service.js"
import { runWorkdayReconciliation } from "../modules/people/application/workday-reconciliation-service.js"
import { startFeedbackDeliverySweeper } from "../modules/interaction-feedback/application/feedback-delivery-sweeper.js"
import { startUsageAnalyticsWorker } from "../modules/usage-analytics/application/usage-analytics-worker.js"
import { createAiRuntime } from "../modules/ai-management/application/ai-runtime-service.js"
import { registerAiRuntime } from "../shared/application/model-routing/ai-runtime.js"
import { aiCallLimiter } from "../shared/application/model-routing/ai-call-limiter.js"
import { chatTurnMetrics } from "../shared/application/observability/chat-turn-trace.js"
import { purgeExpiredRateLimitHits } from "../shared/infrastructure/rate-limit/postgres-rate-limit-store.js"
import { purgeOldLoginAttempts } from "../modules/auth/infrastructure/postgres-credential-store.js"
import { createApp } from "./app.js"
import { componentsOf, resolveProcessRole } from "./process-role.js"
import { installSharedRuntimeState } from "./shared-runtime-state.js"
import { DATA_HUB_WAKE_CHANNEL, listenForWake, notifyWake } from "../shared/infrastructure/process-wake/postgres-wake-channel.js"
import { startWorkerHealthServer } from "./worker-health.js"
import { analyzeDelivery, gatewayAnalysisWriter, retryPendingAnalyses } from "../modules/reports/application/report-analysis.js"
import type { ExecutorDeps } from "../modules/reports/application/report-executor.js"
import { createPostgresReportRuntime } from "../modules/reports/application/report-runtime.js"
import { processReportRuns, scheduleDueReports } from "../modules/reports/application/report-scheduler.js"
import { createPostgresReportStore } from "../modules/reports/application/report-store.js"
import { processBestPracticeAnalyses } from "../modules/best-practices/application/analysis-service.js"
import { createReadiness } from "./readiness.js"
import { applyHttpTimeouts, createShutdown, installProcessHandlers, onHttpListen, processFaults, type LifecycleLog } from "./process-lifecycle.js"
import { createRuntimeMetrics } from "./runtime-metrics.js"
import { droppedLogLines, flushLogs, routeConsoleToLog } from "../shared/infrastructure/logging/logger.js"
import { configureServiceName } from "../shared/application/observability/service-identity.js"
import { createOccurrenceRecorder, registerOccurrenceRecorder } from "../modules/error-diagnostics/application/occurrence-recorder.js"
import { purgeOldOccurrences } from "../modules/error-diagnostics/infrastructure/pg-error-occurrence-store.js"

// Todo log (console.* e pino) num destino assíncrono: no Windows a saída do serviço é um pipe, e escrever em pipe ali é síncrono.
routeConsoleToLog()

// Papel do processo (process-role.ts): `all` (padrão) = API + processamento juntos, como sempre; `api` = só HTTP; `worker` = só
// o processamento de IA e as tarefas periódicas — um lote pesado deixa de dividir o event loop com as telas.
const role = resolveProcessRole(process.argv.slice(2), env.INIA_PROCESS_ROLE)
// `service` em toda linha de log e ocorrência (inia-api, inia-processamento, inia-api-processamento).
configureServiceName(role)
// Ocorrências de erro gravadas no banco (Diagnóstico de erros) — assíncronas e com teto; o log continua sendo a fonte primária.
registerOccurrenceRecorder(createOccurrenceRecorder(pool))
const parts = componentsOf(role)
// Limites de requisição e pausa do provedor de IA divididos com os outros processos (PostgreSQL).
const shared = installSharedRuntimeState(pool, role)

const lifecycleLog: LifecycleLog = {
  info: (event) => console.info(JSON.stringify({ role, ...event })),
  error: (event) => console.error(JSON.stringify({ role, ...event })),
}
// Prontidão (/ready) que o balanceador consulta: banco respondendo e processo não desligando.
const readiness = parts.http ? createReadiness(pool) : null
// Apoio com Anjo: chamadas longas da chamada de estado (só no papel de API). No dreno respondem com `reconnect: true` na hora.
const humanSupportWaiters = parts.http ? createWaiterRegistry({ readVersions: (keys) => readInboxVersions(pool, keys) }) : null
if (readiness && humanSupportWaiters) readiness.onDraining(() => humanSupportWaiters.drain())
// Métricas do processo (event loop, pool, HTTP por rota, limitador de IA): /internal/metrics na API, /health no worker.
const metrics = createRuntimeMetrics({
  role,
  pool,
  // A chamada longa do Apoio com Anjo espera de propósito até 20 s: contada, mas fora da latência.
  excludeFromLatency: ["/api/v1/human-support/me/state"],
  sections: () => ({ chat: chatTurnMetrics().snapshot(), aiCalls: aiCallLimiter().stats(), aiConnections: shared.providerGate.stats(), draining: readiness?.draining ?? false, faults: { ...processFaults }, droppedLogLines: droppedLogLines(), humanSupport: { waits: humanSupportWaiters?.stats() ?? null, ...humanSupportStats } }),
})

let server: Server | null = null
if (parts.http) {
  // O app registra o runtime de IA da organização (policy/uso/orçamento) — a mesma instância atende o admin.
  // Limites de requisição no PostgreSQL: N processos de API atrás do IIS dividem o mesmo contador.
  // Papel `api`: carga da Central de Dados só é enfileirada aqui; o processamento é acordado por NOTIFY e roda a carga lá.
  const dataHubWakeWorker = parts.processing
    ? undefined
    : () => notifyWake(pool, DATA_HUB_WAKE_CHANNEL).catch((error: unknown) => console.warn("Aviso à Central de Dados não enviado (o tick de 15 s do processamento pega a carga):", error instanceof Error ? error.message : error))
  const app = createApp(pool, { registerAiRuntime: true, rateLimitStore: shared.rateLimitStore, readiness: readiness!, metrics, humanSupportWaiters, ...(dataHubWakeWorker ? { dataHubWakeWorker } : {}) })
  // `shutdown` é declarado mais abaixo; o callback só roda depois do carregamento do módulo.
  const onListening = onHttpListen({ listening: () => process.stdout.write(`INIA API (${role}) listening on http://${env.HOST ?? "localhost"}:${env.PORT}\n`), shutdown: (reason, exitCode) => shutdown(reason, exitCode), log: lifecycleLog })
  server = env.HOST ? app.listen(env.PORT, env.HOST, onListening) : app.listen(env.PORT, onListening)
  applyHttpTimeouts(server)
} else {
  // Processamento sem HTTP: o MESMO runtime de IA (policy/uso/orçamento da organização). Escrita no admin (outro processo)
  // chega aqui pelo cache de 15 s do runtime.
  registerAiRuntime(createAiRuntime(pool))
}

function startProcessing() {
  // Motor de Workflow: worker contínuo com várias matrículas em paralelo (uma execução longa nunca segura as outras) — varre a
  // fila a cada 2 s e é acordado na hora por disparo manual (no mesmo processo) e pelo checador de agenda. Matrícula = posse
  // com lease + skip locked: 2+ processos de processamento nunca rodam o mesmo nó.
  const workflowWorker = startWorkflowWorker(pool, { concurrency: env.WORKFLOW_WORKER_CONCURRENCY })
  // Tarefas periódicas: cada rodada roda em UM processo (trava consultiva no banco) e nunca se sobrepõe à anterior. As travas
  // ficam numa conexão própria do processo (fora do pool): o trabalho das tarefas usa o pool só pelo tempo de cada consulta.
  const jobLocks = createPostgresJobLockSession({ connectionString: env.activeDatabaseUrl, applicationName: databaseSession.applicationName })
  const exclusive = jobLocks.runExclusive
  const dataHubContext = createDataHubContext(pool)
  const reportStore = createPostgresReportStore(pool)
  const reportExecutorDeps: ExecutorDeps = { store: reportStore, runtime: createPostgresReportRuntime(pool), now: () => new Date(), analyze: (delivery, report) => analyzeDelivery(reportStore, gatewayAnalysisWriter, delivery, report) }
  const jobs = startPeriodicJobs(exclusive, [
    {
      // Situação funcional: projeção diária (fuso da organização) na subida e a cada minuto, seguida do checador de agenda.
      name: "workflow-schedule",
      intervalMs: 60_000,
      startup: () => runEmploymentStatusProjection(pool).catch((error) => console.error("Falha na projeção de situação funcional:", error)),
      run: async ({ signal }) => {
        await runEmploymentStatusProjection(pool).catch((error) => console.error("Falha na projeção de situação funcional:", error))
        // Trava perdida no meio (conexão das travas caiu): outro processo pode assumir — não começa a segunda etapa.
        if (signal.aborted) return
        await runScheduleCheck(pool).catch((error) => console.error("Falha no checador de gatilho por agenda:", error))
      },
      after: () => workflowWorker.wake(),
    },
    // Central de Dados: agenda feeds vencidos, processa a fila de cargas e purga o raw expirado.
    { name: "data-hub", intervalMs: 15_000, run: () => runDataHubTick(dataHubContext), errorLabel: "Falha no tick da Central de Dados:" },
    // Bases de conhecimento: conclui publicações que ficaram sem dono (API reiniciada, falha passageira). A API processa na hora; esta varredura é a garantia.
    { name: "knowledge-publications", intervalMs: 15_000, run: () => processPendingKnowledgeVersions(pool), errorLabel: "Falha na publicação de bases:" },
    // Apoio com Anjo: garantia dos prazos (conexão do Anjo, fila, inatividade) e da atribuição. Os comandos já distribuem depois do
    // commit; esta rodada de 3 s cobre o que vence sozinho. Uma instância por vez no conjunto; dentro dela, uma trava por organização.
    { name: "human-support-dispatch", intervalMs: HUMAN_SUPPORT_LIMITS.dispatchIntervalMs, run: () => dispatchAllOrganizations(pool).then(() => undefined), errorLabel: "Falha na distribuição do apoio com Anjo:" },
    // PDFs digitalizados: lê as páginas sem texto (OCR) num documento por vez no conjunto e grava o texto no rascunho. Ver knowledge-ocr-jobs.ts.
    { name: "knowledge-ocr", intervalMs: 15_000, run: () => processKnowledgeOcrJobs(pool), errorLabel: "Falha na leitura de PDF digitalizado:" },
    // Reports recorrentes: agenda (cria a execução do horário vencido, uma por report × horário), fila (execução com posse e
    // até 3 tentativas) e recuperação da análise da IA (sem refazer a entrega; posse por entrega — uma chamada de IA por vez em
    // qualquer processo, inclusive junto com a análise que a execução faz logo depois de gravar). Ver docs/dev/reports-recorrentes.md.
    { name: "report-schedule", intervalMs: 60_000, run: () => scheduleDueReports(pool, new Date()).then(() => undefined), errorLabel: "Falha na agenda de reports:" },
    { name: "report-runs", intervalMs: 15_000, run: () => processReportRuns(pool, reportExecutorDeps).then(() => undefined), errorLabel: "Falha na execução de reports:" },
    // Base de boas práticas: fila de análises (uma por rodada, com posse de 20 min e uma nova tentativa). Ver docs/dev/memoria/boas-praticas.md.
    { name: "best-practice-analyses", intervalMs: 15_000, run: () => processBestPracticeAnalyses(pool).then(() => undefined), errorLabel: "Falha nas análises de boas práticas:" },
    // Com a trava perdida, para antes da próxima reivindicação.
    { name: "report-analysis-retry", intervalMs: 5 * 60_000, run: ({ signal }) => retryPendingAnalyses(reportExecutorDeps.store, gatewayAnalysisWriter, { signal }).then(() => undefined), errorLabel: "Falha na análise de reports:" },
    // Read model do analytics da liderança: refaz tudo depois da meia-noite local e recalcula quem tem marca pendente.
    // Com a trava perdida, para entre lotes (duas reconstruções juntas dariam chave duplicada/deadlock nos lotes).
    { name: "analytics-rollup", intervalMs: 15_000, runOnStart: true, run: ({ signal }) => runAnalyticsRollup(pool, { signal }), errorLabel: "Falha no read model do analytics:" },
    // Retenção: só as políticas LIGADAS em data_retention_policies (todas nascem desligadas — prazo é decisão de produto/LGPD).
    { name: "data-retention", intervalMs: 3_600_000, run: () => runDataRetention(pool), errorLabel: "Falha na retenção de dados:" },
    {
      // Calendário operacional: reconciliação PLANEJADO × OBSERVADO e alerta de horizonte da escala — determinísticos,
      // idempotentes, sem IA. Na subida e a cada 5 minutos.
      name: "calendar",
      intervalMs: 300_000,
      runOnStart: true,
      run: async ({ signal }) => {
        await runWorkdayReconciliation(pool).catch((error) => console.error("Falha na reconciliação de dias de trabalho:", error))
        if (signal.aborted) return
        await runScheduleHorizonAlerts(pool).catch((error) => console.error("Falha no alerta de horizonte da escala:", error))
      },
    },
    // Contadores dos limites de requisição que já não contam (janelas vencidas — migration 126).
    { name: "rate-limit-purge", intervalMs: 10 * 60_000, run: () => purgeExpiredRateLimitHits(pool), errorLabel: "Falha na limpeza dos limites de requisição:" },
    // Tentativas de login com mais de 30 dias (a trava usa 15 minutos): e-mails que nunca entram não acumulam para sempre (AUTH-15).
    { name: "login-attempts-purge", intervalMs: 3_600_000, run: () => purgeOldLoginAttempts(pool), errorLabel: "Falha na limpeza das tentativas de login:" },
    // Ocorrências de erro além da guarda (INIA_ERROR_OCCURRENCE_RETENTION_DAYS, padrão 30 dias), em lotes.
    { name: "error-occurrences-purge", intervalMs: 3_600_000, run: () => purgeOldOccurrences(pool, env.INIA_ERROR_OCCURRENCE_RETENTION_DAYS).then(() => undefined), errorLabel: "Falha na limpeza das ocorrências de erro:" },
  ])
  // Processamento sem HTTP (papel `worker`): a API avisa por NOTIFY que há carga nova na Central de Dados — processa na hora
  // (o tick de 15 s continua sendo a garantia). Com o papel `all` a própria API processa, sem aviso.
  const dataHubWake = parts.http ? null : listenForWake({ connectionString: env.activeDatabaseUrl, channel: DATA_HUB_WAKE_CHANNEL, onWake: () => kickWorker(dataHubContext) })
  // Feedback de atendimento: entrega idempotente ao Acompanhamento do que já está pronto. Só com
  // INIA_INTERACTION_FEEDBACK_PIPELINE=ON — com OFF devolve null e nada roda.
  const stopFeedbackDeliverySweeper = startFeedbackDeliverySweeper(pool, { exclusive })
  // Monitoria de usabilidade: projeções (sessões, pessoa × dia, elegibilidade) e retenção — só com a coleta ligada.
  const stopUsageAnalyticsWorker = env.INIA_USAGE_COLLECTION === "ON" ? startUsageAnalyticsWorker(pool, { exclusive }) : null
  return {
    workflowWorker,
    jobs,
    jobLocks,
    async stop() {
      stopFeedbackDeliverySweeper?.()
      stopUsageAnalyticsWorker?.()
      await dataHubWake?.stop()
      // Para de reivindicar e dá até 10 s para os nós em execução terminarem (reinício do `tsx watch` não fica preso a um nó de
      // 12 min); o que sobrar é retomado quando a posse vencer.
      const [{ abandoned }] = await Promise.all([workflowWorker.stop(10_000), jobs.stop(10_000)])
      if (abandoned > 0) console.warn(`Motor de workflow: ${abandoned} execução(ões) em andamento serão retomadas quando a posse vencer.`)
      // Depois das rodadas: cada uma destravou ao terminar; o que sobrou cai com a sessão.
      await jobLocks.stop()
    },
  }
}

const processing = parts.processing ? startProcessing() : null
const health =
  parts.workerHealth && processing && env.WORKER_HEALTH_PORT > 0
    ? startWorkerHealthServer({ port: env.WORKER_HEALTH_PORT, host: env.WORKER_HEALTH_HOST, token: env.INIA_METRICS_TOKEN, snapshot: () => ({ workflowRunning: processing.workflowWorker.running, jobs: processing.jobs.status(), jobLocks: processing.jobLocks.status(), ...metrics.snapshot() }) })
    : null
if (role === "worker") process.stdout.write("INIA processamento (worker) iniciado — motor de Workflow e tarefas periódicas, sem HTTP público.\n")

const shutdown = createShutdown({
  readiness,
  servers: () => [server, health],
  stopProcessing: async () => {
    await processing?.stop()
  },
  closeResources: async () => {
    shared.stop()
    metrics.stop()
    await pool.end()
  },
  drainMs: parts.http ? env.shutdownDrainMs : 0,
  timeoutMs: env.INIA_SHUTDOWN_TIMEOUT_MS,
  exit: (code) => {
    void flushLogs().finally(() => process.exit(code))
  },
  log: lifecycleLog,
})
installProcessHandlers(shutdown, lifecycleLog)
