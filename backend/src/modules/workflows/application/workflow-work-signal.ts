/**
 * Aviso em processo de que há trabalho novo para o motor (ex.: um disparo manual acabou de criar a matrícula) — o worker
 * reivindica na hora em vez de esperar a próxima varredura. É só um atalho de latência: sem ninguém escutando (testes,
 * processo só de API) nada acontece, e o worker de qualquer instância encontra a matrícula na varredura seguinte, porque a
 * fonte da verdade continua sendo a linha em `workflow_enrollments`.
 */
type Listener = () => void

const listeners = new Set<Listener>()

export function onWorkflowWork(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function signalWorkflowWork(): void {
  for (const listener of listeners) listener()
}
