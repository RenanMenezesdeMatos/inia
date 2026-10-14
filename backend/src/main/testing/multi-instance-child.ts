import type { AddressInfo } from "node:net"
import { pool } from "../../infrastructure/database/pool.js"
import { aiCallLimiter } from "../../shared/application/model-routing/ai-call-limiter.js"
import type { AiCallPriority } from "../../shared/application/model-routing/ai-call-limiter.js"
import { AiProviderError } from "../../shared/application/model-routing/ai-errors.js"
import { runThroughProviderGate } from "../../shared/application/model-routing/provider-call-gate.js"
import { createApp } from "../app.js"
import { installSharedRuntimeState } from "../shared-runtime-state.js"

/**
 * UM PROCESSO DE API da prova `multi-instance-proof.test.ts` (rodado com `node --import tsx`, NODE_ENV=test → banco de teste):
 * a mesma ligação do server.ts (`installSharedRuntimeState` + `createApp` com a loja do PostgreSQL), escutando numa porta livre
 * de 127.0.0.1. O teste fala com ele por HTTP (login) e por IPC: chamadas de IA por uma "conexão" (chave do portão) com um
 * provedor falso — segurar vaga, sondar se sai, receber 429 — e o estado do portão. Nada sai da máquina.
 */
type Command =
  | { id: number; type: "hold"; key: string; max: number | null; priority: AiCallPriority }
  | { id: number; type: "release"; holdId: number }
  | { id: number; type: "probe"; key: string; max: number | null; priority: AiCallPriority }
  | { id: number; type: "rate-limited"; key: string; retryAfterMs: number }
  | { id: number; type: "gate-stats" }
  | { id: number; type: "stop" }

const send = (message: Record<string, unknown>) => process.send?.(message)
const shared = installSharedRuntimeState(pool, "api")
const app = createApp(pool, { rateLimitStore: shared.rateLimitStore, rateLimits: { loginPerIpAndEmail: Number(process.env.PROOF_LOGIN_LIMIT ?? 4), loginPerIp: 1_000 } })
const server = app.listen(0, "127.0.0.1", () => send({ type: "ready", port: (server.address() as AddressInfo).port, pid: process.pid }))
const holds = new Map<number, () => void>()

/** Uma chamada de IA como o gateway faz: limitador do processo (classe) → portão da conexão → "provedor". */
const call = <T>(priority: AiCallPriority, key: string, max: number | null, provider: () => Promise<T>) =>
  aiCallLimiter().run({ priority, priorityReason: priority === "INTERACTIVE" ? "USER_REQUEST" : "WORKFLOW_EXECUTION", useCase: "SPECIALIST_RESPONSE", noRetry: true }, () => runThroughProviderGate(key, max, provider))

process.on("message", (raw: unknown) => {
  const command = raw as Command
  if (command.type === "hold") {
    void call(command.priority, command.key, command.max, () =>
      new Promise<void>((resolve) => {
        holds.set(command.id, resolve)
        send({ id: command.id, type: "holding" })
      }),
    )
    return
  }
  if (command.type === "release") {
    holds.get(command.holdId)?.()
    holds.delete(command.holdId)
    send({ id: command.id, type: "released" })
    return
  }
  if (command.type === "probe") {
    const startedAt = Date.now()
    call(command.priority, command.key, command.max, async () => {
      send({ id: command.id, type: "probe", waitedMs: Date.now() - startedAt })
    }).catch((error: unknown) => send({ id: command.id, type: "probe", error: (error as { code?: string }).code ?? String(error) }))
    return
  }
  if (command.type === "rate-limited") {
    call("BATCH", command.key, null, async () => {
      throw new AiProviderError("RATE_LIMIT", { httpStatus: 429, retryAfterMs: command.retryAfterMs })
    }).catch(() => send({ id: command.id, type: "rate-limited", stats: shared.providerGate.stats() }))
    return
  }
  if (command.type === "gate-stats") {
    send({ id: command.id, type: "gate-stats", stats: shared.providerGate.stats() })
    return
  }
  if (command.type === "stop") {
    shared.stop()
    server.close(() => {
      void pool.end().then(() => process.exit(0))
    })
  }
})
