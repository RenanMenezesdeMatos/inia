import { isSensitiveLeave, SENSITIVE_LEAVE_STATUSES } from "../../org-structure/domain/management-metrics.js"

/**
 * O TIPO do afastamento sensível (INSS, maternidade, paternidade) nunca sai da avaliação de política: a decisão só usa
 * "elegível ou não", e o resumo e os fatos chegam à simulação, à justificativa e ao texto do nó de Workflow — lidos por quem
 * tem o papel de políticas ou `workflows.manage`, sem `people.manage`. Mesma regra do C14 (R-37): achado APPSEC-01, 29/10/2026.
 */
export const PROTECTED_LEAVE = "AFASTAMENTO_PROTEGIDO"
export const PROTECTED_LEAVE_TEXT = "afastamento — motivo protegido"
const protectedLeaveStatus = (status: string) => (isSensitiveLeave(status) ? PROTECTED_LEAVE : status)

/** Fatos de QUALQUER condição (a de indicador também traz `eligibility.excludedByStatus` da medição operacional): chave ou valor
 * com o tipo sensível vira AFASTAMENTO_PROTEGIDO, com as contagens somadas. */
export function protectLeave(value: unknown): unknown {
  return walk(value, protectedLeaveStatus)
}

// O resumo gravado antes da correção (291bd48c) dizia "não elegível (INSS)" — e esse texto foi copiado para a justificativa, os
// fatos do relatório de inteligência e a situação inicial da intervenção.
const LEGACY_SUMMARY_PATTERN = new RegExp(`\\((?:${SENSITIVE_LEAVE_STATUSES.join("|")})\\)`, "g")
const protectedStoredText = (text: string) => (isSensitiveLeave(text) ? PROTECTED_LEAVE : text.replace(LEGACY_SUMMARY_PATTERN, `(${PROTECTED_LEAVE_TEXT})`))

/**
 * Mesma proteção na LEITURA do que já foi gravado (avaliação, relatório de inteligência, situação inicial e evidências da
 * intervenção): linhas gravadas entre 13/10 e 29/10/2026 ainda têm o tipo exato (achado de 10/11/2026). Nada é reescrito no
 * banco — quem devolve ou usa o registro passa por aqui. O que já foi gravado protegido não muda.
 */
export function protectStoredLeave<T>(value: T): T {
  return walk(value, protectedStoredText) as T
}

function walk(value: unknown, text: (value: string) => string): unknown {
  if (typeof value === "string") return text(value)
  if (Array.isArray(value)) return value.map((item) => walk(item, text))
  if (value === null || typeof value !== "object" || value instanceof Date || Buffer.isBuffer(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    const target = protectedLeaveStatus(key)
    const safe = walk(inner, text)
    result[target] = target !== key && typeof result[target] === "number" && typeof safe === "number" ? (result[target] as number) + safe : safe
  }
  return result
}
