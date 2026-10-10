/**
 * Execution Context de um enrollment: `nodeOutputs` (resultado de nodes anteriores, incluindo o
 * valor bruto do gatilho em `nodeOutputs.trigger`) + `variables` (Workflow Variables). Extraído
 * de `node-handlers.ts` para um módulo próprio porque `action-executors.ts` também precisa dele
 * (pra resolver a origem dinâmica de "Definir variável") e não pode importar de `node-handlers.ts`
 * sem criar um ciclo (`node-handlers.ts` já importa `action-executors.ts`).
 */
export type ExecutionContextRoot = { nodeOutputs: Record<string, unknown>; variables: Record<string, unknown> }

/**
 * Navega um caminho tipo "nodeOutputs.diagnostico.severity", "nodeOutputs.trigger" ou
 * "variables.<variableId>" dentro do Execution Context. Retorna undefined se qualquer segmento
 * do caminho não existir — quem chama decide o que fazer (nunca trata silenciosamente como
 * false/0).
 */
export function resolveContextValue(context: ExecutionContextRoot, path: string): unknown {
  const root: Record<string, unknown> = { nodeOutputs: context.nodeOutputs, variables: context.variables }
  let current: unknown = root
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
