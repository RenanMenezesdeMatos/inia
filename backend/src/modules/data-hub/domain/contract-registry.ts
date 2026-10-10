import type { DataContract } from "./data-contract.js"
import { DataRunError } from "./error-codes.js"
import { INTERACTION_FLAGS_CONTRACT, INTERACTIONS_CONTRACT, TRANSCRIPTS_CONTRACT } from "./contracts/interaction-contracts.js"
import {
  EMPLOYEE_ABSENCES_CONTRACT,
  EMPLOYEES_CONTRACT,
  GOALS_CONTRACT,
  GROUPS_CONTRACT,
  ORGANIZATIONAL_STRUCTURE_CONTRACT,
  SUBGROUPS_CONTRACT,
  WORK_SCHEDULES_CONTRACT,
  WORK_SCHEDULE_DAYS_CONTRACT,
  WORK_SCHEDULE_EXCEPTIONS_CONTRACT,
} from "./contracts/master-data-contracts.js"
import { INDICATOR_MEASUREMENTS_CONTRACT, OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT, PRV_PERFORMANCE_CONTRACT } from "./contracts/performance-contracts.js"

/**
 * Registro central dos contratos suportados. Ordem = ordem de dependência (quem não depende de
 * ninguém primeiro) — feeds da mesma fonte são sincronizados nessa ordem.
 */
export const DATA_CONTRACTS: readonly DataContract[] = [
  GROUPS_CONTRACT,
  SUBGROUPS_CONTRACT,
  EMPLOYEES_CONTRACT,
  ORGANIZATIONAL_STRUCTURE_CONTRACT,
  EMPLOYEE_ABSENCES_CONTRACT,
  WORK_SCHEDULES_CONTRACT,
  WORK_SCHEDULE_DAYS_CONTRACT,
  WORK_SCHEDULE_EXCEPTIONS_CONTRACT,
  GOALS_CONTRACT,
  INDICATOR_MEASUREMENTS_CONTRACT,
  OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT,
  PRV_PERFORMANCE_CONTRACT,
  INTERACTIONS_CONTRACT,
  TRANSCRIPTS_CONTRACT,
  INTERACTION_FLAGS_CONTRACT,
]

const byKey = new Map(DATA_CONTRACTS.map((contract) => [contract.key, contract]))

export const DATA_CONTRACT_KEYS = DATA_CONTRACTS.map((contract) => contract.key)

export function findDataContract(key: string, version?: number): DataContract | undefined {
  const contract = byKey.get(key)
  if (!contract) return undefined
  if (version !== undefined && contract.version !== version) return undefined
  return contract
}

export function requireDataContract(key: string, version?: number): DataContract {
  const contract = findDataContract(key, version)
  if (!contract) throw new DataRunError("DATA_CONTRACT_UNKNOWN", `Contrato "${key}${version ? `@${version}` : ""}" não existe no registro.`)
  return contract
}

/** Posição no grafo de dependências — usada para ordenar feeds da mesma fonte. */
export function contractOrder(key: string): number {
  const index = DATA_CONTRACTS.findIndex((contract) => contract.key === key)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

/** Grafo de dependências declarado (para documentação/UI). */
export function dependencyGraph(): { key: string; dependsOn: string[] }[] {
  return DATA_CONTRACTS.map((contract) => ({ key: contract.key, dependsOn: [...contract.dependencies] }))
}
