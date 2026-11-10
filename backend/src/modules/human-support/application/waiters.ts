import { HUMAN_SUPPORT_LIMITS } from "../domain/catalogs.js"
import { versionKey } from "./inbox-versions.js"

/**
 * ESPERAS SEM PRENDER O BANCO (design_draft.md seção 11): registro em memória das chamadas longas abertas NESTE processo. Enquanto
 * houver alguma, um laço de 1 s faz UMA consulta (as versões de todas as pessoas esperando) e responde as que mudaram. Nenhuma
 * conexão do pool fica presa; nenhum `LISTEN`. A quinta chamada longa da mesma pessoa no processo faz a mais antiga responder na
 * hora. No dreno (desligamento), todas respondem com `reconnect: true` e as novas também, na hora.
 */
export type WaitOutcome = "CHANGED" | "TIMEOUT" | "DRAINING" | "EVICTED" | "CANCELLED"
export type WaitRequest = { organizationId: string; personId: string; since: string; timeoutMs: number; signal?: AbortSignal | undefined }
export type WaiterStats = { open: number; answeredByChange: number; answeredByTimeout: number; answeredByDrain: number; evicted: number; cancelled: number; readFailures: number }

export type WaiterRegistry = {
  wait(request: WaitRequest): Promise<WaitOutcome>
  drain(): void
  readonly draining: boolean
  stats(): WaiterStats
  stop(): void
}

type Waiter = { id: number; key: string; organizationId: string; personId: string; since: string; settle: (outcome: WaitOutcome) => void }

export function createWaiterRegistry(options: { readVersions: (keys: { organizationId: string; personId: string }[]) => Promise<Map<string, string>>; tickMs?: number; maxPerPerson?: number }): WaiterRegistry {
  const tickMs = options.tickMs ?? HUMAN_SUPPORT_LIMITS.waiterTickMs
  const maxPerPerson = options.maxPerPerson ?? HUMAN_SUPPORT_LIMITS.maxWaitsPerPersonPerProcess
  const waiters = new Map<number, Waiter>()
  const counters = { answeredByChange: 0, answeredByTimeout: 0, answeredByDrain: 0, evicted: 0, cancelled: 0, readFailures: 0 }
  let nextId = 1
  let draining = false
  let loop: ReturnType<typeof setInterval> | null = null
  let ticking = false

  const stopLoop = () => {
    if (loop) clearInterval(loop)
    loop = null
  }

  const tick = async () => {
    if (ticking) return
    if (waiters.size === 0) return stopLoop()
    ticking = true
    try {
      const keys = new Map<string, { organizationId: string; personId: string }>()
      for (const waiter of waiters.values()) keys.set(waiter.key, { organizationId: waiter.organizationId, personId: waiter.personId })
      const versions = await options.readVersions([...keys.values()])
      for (const waiter of [...waiters.values()]) {
        const current = versions.get(waiter.key)
        if (current !== undefined && current !== waiter.since) waiter.settle("CHANGED")
      }
    } catch (error) {
      counters.readFailures += 1
      console.error(JSON.stringify({ event: "human_support_waiters_read_failed", message: (error as Error).message }))
    } finally {
      ticking = false
    }
  }

  const ensureLoop = () => {
    if (loop) return
    loop = setInterval(() => void tick(), tickMs)
    loop.unref?.()
  }

  return {
    wait(request) {
      if (draining) {
        counters.answeredByDrain += 1
        return Promise.resolve("DRAINING")
      }
      return new Promise<WaitOutcome>((resolve) => {
        const id = nextId++
        const key = versionKey(request.organizationId, request.personId)
        let timer: ReturnType<typeof setTimeout> | null = null
        const onAbort = () => waiter.settle("CANCELLED")
        const waiter: Waiter = {
          id,
          key,
          organizationId: request.organizationId,
          personId: request.personId,
          since: request.since,
          settle: (outcome) => {
            if (!waiters.delete(id)) return
            if (timer) clearTimeout(timer)
            request.signal?.removeEventListener("abort", onAbort)
            if (outcome === "CHANGED") counters.answeredByChange += 1
            else if (outcome === "TIMEOUT") counters.answeredByTimeout += 1
            else if (outcome === "DRAINING") counters.answeredByDrain += 1
            else if (outcome === "EVICTED") counters.evicted += 1
            else counters.cancelled += 1
            if (waiters.size === 0) stopLoop()
            resolve(outcome)
          },
        }
        waiters.set(id, waiter)
        timer = setTimeout(() => waiter.settle("TIMEOUT"), Math.max(0, request.timeoutMs))
        timer.unref?.()
        if (request.signal) {
          if (request.signal.aborted) return waiter.settle("CANCELLED")
          request.signal.addEventListener("abort", onAbort, { once: true })
        }
        // A quinta chamada da mesma pessoa: a mais antiga responde agora (o estado atual vai nela).
        const same = [...waiters.values()].filter((entry) => entry.key === key).sort((a, b) => a.id - b.id)
        if (same.length > maxPerPerson) same[0]!.settle("EVICTED")
        ensureLoop()
      })
    },
    drain() {
      draining = true
      for (const waiter of [...waiters.values()]) waiter.settle("DRAINING")
      stopLoop()
    },
    get draining() {
      return draining
    },
    stats() {
      return { open: waiters.size, ...counters }
    },
    stop() {
      for (const waiter of [...waiters.values()]) waiter.settle("CANCELLED")
      stopLoop()
    },
  }
}
