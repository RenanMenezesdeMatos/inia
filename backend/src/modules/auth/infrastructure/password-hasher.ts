import bcrypt from "bcryptjs"
import { createRequire } from "node:module"
import { availableParallelism } from "node:os"
import { Worker } from "node:worker_threads"
import { DomainError } from "../../../shared/domain/domain-error.js"

const SALT_ROUNDS = 10

/**
 * HASH DE SENHA FORA DO EVENT LOOP. O bcryptjs é JavaScript puro (sem dependência nativa — a instalação no Windows não
 * precisa de compilador) e custa ~60 ms de CPU por verificação: na virada de turno, centenas de logins (e a ciência, que
 * também confere a senha) ocupavam a thread que atende todas as telas. As verificações rodam num pool pequeno de
 * worker threads, com o MESMO bcryptjs e o mesmo formato de hash; se o pool não puder existir, cai no bcryptjs assíncrono
 * na thread principal, como antes.
 */
type Task = { op: "hash" | "compare"; a: string; b: string | number; resolve: (value: string | boolean) => void; reject: (error: unknown) => void }
type PoolWorker = { worker: Worker; busy: Task | null }

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads")
const bcrypt = require(workerData.bcryptPath)
parentPort.on("message", ({ op, a, b }) => {
  try {
    parentPort.postMessage({ ok: true, value: op === "hash" ? bcrypt.hashSync(a, b) : bcrypt.compareSync(a, b) })
  } catch (error) {
    parentPort.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) })
  }
})
`

const POOL_SIZE = Math.max(1, Math.min(4, availableParallelism() - 1))
/**
 * Verificações esperando thread, no máximo (achado AUTH-2 da auditoria de 17/10/2026): ~1 s de espera por thread. Acima disso a
 * tarefa nova é recusada NA HORA (503): uma rajada de logins não empurra o login legítimo e a ciência com senha para o fim de
 * uma fila de minutos, nem segura conexões penduradas.
 */
export const PASSWORD_QUEUE_LIMIT = POOL_SIZE * 16

export class PasswordCheckBusyError extends DomainError {
  constructor() {
    super("Muitos acessos ao mesmo tempo. Tente de novo em alguns segundos.", "AUTH_BUSY", 503)
  }
}
const workers: PoolWorker[] = []
const queue: Task[] = []
let poolUnavailable = false
/** Threads que morrem seguidas sem nenhuma resposta (ex.: o bcryptjs não carrega nelas): desiste do pool em vez de recriar sem fim. */
const MAX_CONSECUTIVE_FAILURES = 3
let consecutiveFailures = 0

function spawn(): PoolWorker | null {
  try {
    const bcryptPath = createRequire(import.meta.url).resolve("bcryptjs")
    const entry: PoolWorker = { worker: new Worker(WORKER_SOURCE, { eval: true, workerData: { bcryptPath } }), busy: null }
    entry.worker.unref()
    entry.worker.on("message", (message: { ok: boolean; value?: string | boolean; message?: string }) => {
      const task = entry.busy
      entry.busy = null
      entry.worker.unref()
      consecutiveFailures = 0
      if (task) {
        if (message.ok) task.resolve(message.value!)
        else task.reject(new Error(message.message))
      }
      dispatch()
    })
    const fail = (error: unknown) => {
      const task = entry.busy
      entry.busy = null
      workers.splice(workers.indexOf(entry), 1)
      // A tarefa em andamento volta para a fila (outra thread, ou o caminho de reserva, a executa).
      if (task) queue.unshift(task)
      if (!(error instanceof Error && error.message === "exit 0")) {
        console.error(JSON.stringify({ event: "password_hash_worker_failed", message: error instanceof Error ? error.message : String(error) }))
        consecutiveFailures += 1
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) poolUnavailable = true
      }
      dispatch()
    }
    entry.worker.on("error", fail)
    entry.worker.on("exit", (code) => {
      if (workers.includes(entry)) fail(new Error(`exit ${code}`))
    })
    workers.push(entry)
    return entry
  } catch (error) {
    poolUnavailable = true
    console.error(JSON.stringify({ event: "password_hash_pool_unavailable", message: error instanceof Error ? error.message : String(error) }))
    return null
  }
}

function runOnMainThread(task: Task): void {
  const work = task.op === "hash" ? bcrypt.hash(task.a, task.b as number) : bcrypt.compare(task.a, task.b as string)
  work.then(task.resolve, task.reject)
}

function dispatch(): void {
  while (queue.length > 0) {
    if (poolUnavailable) {
      runOnMainThread(queue.shift()!)
      continue
    }
    const idle = workers.find((entry) => entry.busy === null) ?? (workers.length < POOL_SIZE ? spawn() : null)
    if (!idle) {
      if (poolUnavailable) continue
      return
    }
    const task = queue.shift()!
    idle.busy = task
    // Ocupada, a thread segura o processo vivo até responder; ociosa, nunca impede o processo de sair.
    idle.worker.ref()
    idle.worker.postMessage({ op: task.op, a: task.a, b: task.b })
  }
}

function run<T extends string | boolean>(op: Task["op"], a: string, b: string | number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!poolUnavailable && queue.length >= PASSWORD_QUEUE_LIMIT) {
      reject(new PasswordCheckBusyError())
      return
    }
    queue.push({ op, a, b, resolve: resolve as Task["resolve"], reject })
    dispatch()
  })
}

export async function hashPassword(plainPassword: string) {
  return run<string>("hash", plainPassword, SALT_ROUNDS)
}

export async function verifyPassword(plainPassword: string, passwordHash: string) {
  return run<boolean>("compare", plainPassword, passwordHash)
}
