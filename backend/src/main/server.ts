import type { Server } from "node:http"
import { env } from "../config/env.js"
import { pool } from "../infrastructure/database/pool.js"
import { createExclusiveJobRunner, startPeriodicJobs } from "../infrastructure/jobs/periodic-jobs.js"
import { startWorkflowWorker } from "../modules/workflows/application/workflow-worker.js"
import { runScheduleCheck } from "../modules/workflows/application/schedule-check.js"
import { createDataHubContext } from "../modules/data-hub/application/data-hub-context.js"
import { runDataHubTick } from "../modules/data-hub/application/run-service.js"
import { runEmploymentStatusProjection } from "../modules/people/application/employment-status-service.js"
import { runScheduleHorizonAlerts } from "../modules/people/application/schedule-horizon-alert-service.js"
import { runWorkdayReconciliation } from "../modules/people/application/workday-reconciliation-service.js"
import { startFeedbackDeliverySweeper } from "../modules/interaction-feedback/application/feedback-delivery-sweeper.js"
import { startUsageAnalyticsWorker } from "../modules/usage-analytics/application/usage-analytics-worker.js"
import { createAiRuntime } from "../modules/ai-management/application/ai-runtime-service.js"
import { registerAiRuntime } from "../shared/application/model-routing/ai-runtime.js"
import { aiCallLimiter } from "../shared/application/model-routing/ai-call-limiter.js"
import { createApp } from "./app.js"
import { componentsOf, resolveProcessRole } from "./process-role.js"
import { startWorkerHealthServer } from "./worker-health.js"

// Papel do processo (process-role.ts): `all` (padrão) = API + processamento juntos, como sempre; `api` = só HTTP; `worker` = só
// o processamento de IA e as tarefas periódicas — um lote pesado deixa de dividir o event loop com as telas.
const role = resolveProcessRole(process.argv.slice(2), env.INIA_PROCESS_ROLE)
const parts = componentsOf(role)

let server: Server | null = null
if (parts.http) {
  // O app registra o runtime de IA da organização (policy/uso/orçamento) — a mesma instância atende o admin.
  const app = createApp(pool, { registerAiRuntime: true })
  const onListening = () => process.stdout.write(`INIA API (${role}) listening on http://${env.HOST ?? "localhost"}:${env.PORT}\n`)
  server = env.HOST ? app.listen(env.PORT, env.HOST, onListening) : app.listen(env.PORT, onListening)
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
  // Tarefas periódicas: cada rodada roda em UM processo (trava consultiva no banco) e nunca se sobrepõe à anterior.
  const exclusive = createExclusiveJobRunner(pool)
  const dataHubContext = createDataHubContext(pool)
  const jobs = startPeriodicJobs(exclusive, [
    {
      // Situação funcional: projeção diária (fuso da organização) na subida e a cada minuto, seguida do checador de agenda.
      name: "workflow-schedule",
      intervalMs: 60_000,
      startup: () => runEmploymentStatusProjection(pool).catch((error) => console.error("Falha na projeção de situação funcional:", error)),
      run: async () => {
        await runEmploymentStatusProjection(pool).catch((error) => console.error("Falha na projeção de situação funcional:", error))
        await runScheduleCheck(pool).catch((error) => console.error("Falha no checador de gatilho por agenda:", error))
      },
      after: () => workflowWorker.wake(),
    },
    // Central de Dados: agenda feeds vencidos, processa a fila de cargas e purga o raw expirado.
    { name: "data-hub", intervalMs: 15_000, run: () => runDataHubTick(dataHubContext), errorLabel: "Falha no tick da Central de Dados:" },
    {
      // Calendário operacional: reconciliação PLANEJADO × OBSERVADO e alerta de horizonte da escala — determinísticos,
      // idempotentes, sem IA. Na subida e a cada 5 minutos.
      name: "calendar",
      intervalMs: 300_000,
      runOnStart: true,
      run: () =>
        runWorkdayReconciliation(pool)
          .catch((error) => console.error("Falha na reconciliação de dias de trabalho:", error))
          .then(() => runScheduleHorizonAlerts(pool))
          .catch((error) => console.error("Falha no alerta de horizonte da escala:", error)),
    },
  ])
  // Feedback de atendimento: entrega idempotente ao Acompanhamento do que já está pronto. Só com
  // INIA_INTERACTION_FEEDBACK_PIPELINE=ON — com OFF devolve null e nada roda.
  const stopFeedbackDeliverySweeper = startFeedbackDeliverySweeper(pool, { exclusive })
  // Monitoria de usabilidade: projeções (sessões, pessoa × dia, elegibilidade) e retenção — só com a coleta ligada.
  const stopUsageAnalyticsWorker = env.INIA_USAGE_COLLECTION === "ON" ? startUsageAnalyticsWorker(pool, { exclusive }) : null
  return {
    workflowWorker,
    jobs,
    async stop() {
      stopFeedbackDeliverySweeper?.()
      stopUsageAnalyticsWorker?.()
      // Para de reivindicar e dá até 10 s para os nós em execução terminarem (reinício do `tsx watch` não fica preso a um nó de
      // 12 min); o que sobrar é retomado quando a posse vencer.
      const [{ abandoned }] = await Promise.all([workflowWorker.stop(10_000), jobs.stop(10_000)])
      if (abandoned > 0) console.warn(`Motor de workflow: ${abandoned} execução(ões) em andamento serão retomadas quando a posse vencer.`)
    },
  }
}

const processing = parts.processing ? startProcessing() : null
const health =
  parts.workerHealth && processing && env.WORKER_HEALTH_PORT > 0
    ? startWorkerHealthServer({ port: env.WORKER_HEALTH_PORT, host: env.WORKER_HEALTH_HOST, snapshot: () => ({ workflowRunning: processing.workflowWorker.running, aiCalls: aiCallLimiter().stats(), jobs: processing.jobs.status() }) })
    : null
if (role === "worker") process.stdout.write("INIA processamento (worker) iniciado — motor de Workflow e tarefas periódicas, sem HTTP público.\n")

const closeServer = (target: Server | null) => new Promise<void>((resolve) => (target ? target.close(() => resolve()) : resolve()))

let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  await processing?.stop()
  await Promise.all([closeServer(server), closeServer(health)])
  await pool.end()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
