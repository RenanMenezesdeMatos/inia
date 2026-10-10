/**
 * PAPEL DO PROCESSO (main/server.ts). Um lote pesado de IA dividia o event loop com as telas; agora dá para separar:
 *
 *   all     (padrão) API + processamento no mesmo processo — exatamente como antes
 *   api     só HTTP: telas, chat, voz, admin. Nada de motor de Workflow nem tarefas periódicas
 *   worker  só processamento: motor de Workflow + tarefas periódicas (agenda, Central de Dados, calendário, entregas,
 *           usabilidade), com um /health mínimo. As tarefas periódicas usam trava no banco — rodam uma vez mesmo com 2+ processos
 *
 * Ordem: `--role=<papel>` (ou `--role <papel>`) na linha de comando > INIA_PROCESS_ROLE > `all`.
 */
export const PROCESS_ROLES = ["all", "api", "worker"] as const
export type ProcessRole = (typeof PROCESS_ROLES)[number]

function isRole(value: string): value is ProcessRole {
  return (PROCESS_ROLES as readonly string[]).includes(value)
}

export function resolveProcessRole(argv: readonly string[], fromEnv: ProcessRole = "all"): ProcessRole {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    const value = arg.startsWith("--role=") ? arg.slice("--role=".length) : arg === "--role" ? argv[index + 1] ?? "" : null
    if (value === null) continue
    const role = value.trim().toLowerCase()
    if (!isRole(role)) throw new Error(`Papel de processo inválido: "${value}". Use --role=all, --role=api ou --role=worker.`)
    return role
  }
  return fromEnv
}

/** O que cada papel liga. */
export function componentsOf(role: ProcessRole): { http: boolean; processing: boolean; workerHealth: boolean } {
  return { http: role !== "worker", processing: role !== "api", workerHealth: role === "worker" }
}
