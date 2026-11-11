import { API_BASE_URL } from "@/lib/api/api-client"
import type { Failure } from "@/lib/errors/failure"

/**
 * Registro, no servidor, de uma falha que nasceu no navegador (`POST /api/v1/client-errors`). Só diz "registrada" quando a API
 * confirma (201). Sem conexão (ou API fora), a falha fica numa fila local (sessionStorage) e é enviada quando a rede voltar —
 * até lá a referência é LOCAL e a tela diz isso. Nunca tenta de novo em laço: uma tentativa por evento `online`, no máximo 20
 * itens na fila, e uma falha deste envio nunca vira outro registro.
 */
export type ReportOutcome = "recorded" | "local"

const QUEUE_KEY = "inia.pending-client-errors"
const MAX_QUEUE = 20
type Payload = { reference: string; code: string; route: string; occurredAt: string; httpStatus: number | null; message?: string; digest?: string; online: boolean; release?: string }

const recorded = new Set<string>()
const inFlight = new Map<string, Promise<ReportOutcome>>()
const listeners = new Set<(reference: string) => void>()

function readQueue(): Payload[] {
  try {
    const raw = window.sessionStorage.getItem(QUEUE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as Payload[]).slice(0, MAX_QUEUE) : []
  } catch {
    return []
  }
}

function writeQueue(queue: Payload[]): void {
  try {
    window.sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)))
  } catch {
    // Sem armazenamento (janela privada): a falha continua só nesta tela.
  }
}

async function post(payload: Payload): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/client-errors`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    return response.status === 201
  } catch {
    return false
  }
}

function markRecorded(reference: string) {
  recorded.add(reference)
  for (const listener of listeners) listener(reference)
}

export function isRecorded(reference: string | null): boolean {
  return reference !== null && recorded.has(reference)
}

/** Avisa quando uma referência local passa a estar registrada (envio adiado que deu certo). */
export function onRecorded(listener: (reference: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function reportClientFailure(failure: Failure, context: { route: string; release?: string | null }): Promise<ReportOutcome> {
  const reference = failure.reference
  if (!reference || !failure.code) return Promise.resolve("local")
  if (recorded.has(reference)) return Promise.resolve("recorded")
  const pending = inFlight.get(reference)
  if (pending) return pending
  const payload: Payload = {
    reference,
    code: failure.code,
    route: context.route,
    occurredAt: failure.occurredAt,
    httpStatus: failure.status,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    ...(failure.technicalMessage ? { message: failure.technicalMessage } : {}),
    ...(context.release ? { release: context.release } : {}),
  }
  const attempt = (async (): Promise<ReportOutcome> => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      writeQueue([...readQueue().filter((item) => item.reference !== reference), payload])
      return "local"
    }
    if (await post(payload)) {
      markRecorded(reference)
      return "recorded"
    }
    writeQueue([...readQueue().filter((item) => item.reference !== reference), payload])
    return "local"
  })().finally(() => inFlight.delete(reference))
  inFlight.set(reference, attempt)
  return attempt
}

/** Envia a fila guardada (chamado no evento `online` e na abertura do app). */
export async function flushPendingClientFailures(): Promise<void> {
  const queue = readQueue()
  if (queue.length === 0) return
  const remaining: Payload[] = []
  for (const payload of queue) {
    if (await post({ ...payload, online: true })) markRecorded(payload.reference)
    else remaining.push(payload)
  }
  writeQueue(remaining)
}
