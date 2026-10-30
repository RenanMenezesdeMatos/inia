import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Identificador da requisição HTTP em curso, visível de qualquer ponto da cadeia (inclusive depois de `await`): o logger o
 * põe em toda linha e o 500 genérico o devolve ao cliente — a reclamação do usuário ("deu erro às 10h") vira uma busca exata
 * no log. Fora de uma requisição (worker, tarefas periódicas) é `null`.
 */
const storage = new AsyncLocalStorage<{ requestId: string }>()

export function runWithRequestId<T>(requestId: string, work: () => T): T {
  return storage.run({ requestId }, work)
}

export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null
}
