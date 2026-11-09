import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads"
import { EXIT_FAILED, EXIT_MEMORY, EXIT_ORPHANED, type ChildMessage, type ChildReply, type ChildRequest, type IsolatedJob } from "./isolated-parser-protocol.js"

/**
 * PROCESSO FILHO DO PARSER (R-24) — a thread principal só vigia; o parser roda numa worker thread deste processo.
 *
 * Por quê: o pdf.js descompacta os fluxos em ArrayBuffers FORA do heap do V8, que `--max-old-space-size` não limita (um PDF de
 * 23 KB com a cadeia `[/FlateDecode /RunLengthDecode]` chegou a 2,4 GB de memória residente com heap de 256 MB), e prende o laço
 * de eventos por segundos. Com o parser numa worker, a thread principal continua livre para medir a memória residente do processo
 * INTEIRO a cada 25 ms e sair na hora em que ela passa do teto. O prazo é da API, que mata este processo.
 *
 * As partes que o job emite (`emit`) passam pela thread principal direto para a API, na ordem: a resposta final só sai depois.
 */
const MB = 1024 * 1024
const WATCH_INTERVAL_MS = 25

if (isMainThread) {
  process.once("disconnect", () => process.exit(EXIT_ORPHANED))
  process.once("message", (request: ChildRequest) => {
    // Só o número fica preso ao vigia: a cópia do arquivo recebida aqui é liberada depois de passar para a worker.
    const rssLimit = request.rssMb * MB
    setInterval(() => {
      if (process.memoryUsage.rss() > rssLimit) process.exit(EXIT_MEMORY)
    }, WATCH_INTERVAL_MS)
    const worker = new Worker(new URL(import.meta.url), {
      workerData: request,
      resourceLimits: { maxOldGenerationSizeMb: request.heapMb },
      // O teto de heap da thread vai em `resourceLimits`; a flag do processo não é aceita numa worker.
      execArgv: process.execArgv.filter((arg) => !arg.startsWith("--max-old-space-size")),
    })
    const reply = (message: ChildReply, code: number) => process.send!(message, () => process.exit(code))
    worker.on("message", (message: ChildMessage) => {
      if ("chunk" in message) process.send!(message)
      else reply(message, message.ok ? 0 : EXIT_FAILED)
    })
    worker.once("error", (error: Error & { code?: string }) => {
      if (error.code === "ERR_WORKER_OUT_OF_MEMORY") process.exit(EXIT_MEMORY)
      reply({ ok: false, message: error.message }, EXIT_FAILED)
    })
  })
} else {
  const request = workerData as ChildRequest
  const emit = (chunk: unknown) => parentPort!.postMessage({ chunk } satisfies ChildMessage)
  let message: ChildReply
  try {
    const job = (await import(request.job)) as IsolatedJob
    message = { ok: true, value: await job.run(request.input, emit) }
  } catch (error) {
    message = { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  parentPort!.postMessage(message)
}
