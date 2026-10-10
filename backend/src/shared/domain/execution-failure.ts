import { DomainError } from "./domain-error.js"
import { ModelOutputContractError } from "./model-output-contract-error.js"

/**
 * V1.7.1c — TAXONOMIA DE FALHA DE EXECUÇÃO (um nó de Workflow, uma chamada de Agent/especialista). Cada categoria tem sua
 * política de retry (workflows/domain/node-retry-policy.ts):
 *
 *   TRANSIENT_PROVIDER_ERROR         timeout, rede, 429, 5xx, modelo indisponível — tentar de novo pode resolver;
 *   MODEL_OUTPUT_CONTRACT_INVALID    o modelo respondeu fora do contrato (JSON/campos/avaliação/evidência) — repetir a mesma
 *                                    chamada é gastar esperando sorte;
 *   APPLICATION_INVARIANT_VIOLATION  o próprio dado/configuração torna a execução impossível (grafo sem saída, operador sem
 *                                    grupo, especialista inexistente) — nada muda sozinho entre uma tentativa e outra;
 *   UNCLASSIFIED                     qualquer outro erro — mantém o comportamento histórico (retry com backoff) até ser
 *                                    classificado de propósito. Nunca é promovido a terminal por palpite.
 */
export const EXECUTION_ERROR_CATEGORIES = ["TRANSIENT_PROVIDER_ERROR", "MODEL_OUTPUT_CONTRACT_INVALID", "APPLICATION_INVARIANT_VIOLATION", "UNCLASSIFIED"] as const
export type ExecutionErrorCategory = (typeof EXECUTION_ERROR_CATEGORIES)[number]

export const EXECUTION_ERROR_CATEGORY_LABELS: Record<ExecutionErrorCategory, string> = {
  TRANSIENT_PROVIDER_ERROR: "Falha temporária do provedor de IA",
  MODEL_OUTPUT_CONTRACT_INVALID: "Resposta do Agent incompatível com o contrato",
  APPLICATION_INVARIANT_VIOLATION: "Configuração ou dado impede a execução",
  UNCLASSIFIED: "Erro na execução",
}

/** O modelo respondeu, mas fora do contrato (inclusive resposta vazia). */
export const MODEL_OUTPUT_CONTRACT_CODES = [
  "AGENT_STRUCTURED_OUTPUT_INVALID",
  "AGENT_STRUCTURED_OUTPUT_INCOMPLETE",
  "AGENT_PROCESS_ASSESSMENT_INCOMPLETE",
  "AGENT_PROCESS_AUDIT_INCOMPLETE",
  "AGENT_INDICATOR_DIAGNOSIS_INCOMPLETE",
  "AGENT_EVIDENCE_NOT_VERBATIM",
  "AGENT_EVIDENCE_ENVELOPE_MISSING",
  "AGENT_UNSUPPORTED_BEHAVIORAL_CLAIM",
  "AGENT_EXECUTION_EMPTY",
  "ASSISTANT_EMPTY",
  "SPECIALIST_UNEXPECTED_RESPONSE",
] as const

/** Invariantes da aplicação conhecidos (lista explícita; o resto fica UNCLASSIFIED). */
export const APPLICATION_INVARIANT_CODES = ["WORKFLOW_NODE_INVARIANT", "OPERATOR_WITHOUT_TEAM", "SPECIALIST_AGENT_NOT_FOUND", "SPECIALIST_AGENT_INACTIVE"] as const

/** Categorias de provedor (ai-errors.ts) que são transitórias. */
const TRANSIENT_PROVIDER_CATEGORIES = new Set(["RATE_LIMIT", "TIMEOUT", "NETWORK", "PROVIDER_ERROR", "MODEL_UNAVAILABLE"])

export type ExecutionFailure = { category: ExecutionErrorCategory; code: string | null; message: string }

/** Erro de invariante lançado pelo próprio motor/aplicação (ex.: nó sem aresta de saída numa versão publicada). */
export class ApplicationInvariantError extends DomainError {
  constructor(message: string, code = "WORKFLOW_NODE_INVARIANT") {
    super(message, code, 422)
    this.name = "ApplicationInvariantError"
  }
}

export function classifyExecutionError(error: unknown): ExecutionFailure {
  const message = error instanceof Error ? error.message : "Erro desconhecido na execução."
  if (error instanceof ModelOutputContractError) return { category: "MODEL_OUTPUT_CONTRACT_INVALID", code: error.code, message }
  if (!(error instanceof DomainError)) return { category: "UNCLASSIFIED", code: null, message }
  const code = error.code
  if ((MODEL_OUTPUT_CONTRACT_CODES as readonly string[]).includes(code)) return { category: "MODEL_OUTPUT_CONTRACT_INVALID", code, message }
  if (error instanceof ApplicationInvariantError || (APPLICATION_INVARIANT_CODES as readonly string[]).includes(code)) return { category: "APPLICATION_INVARIANT_VIOLATION", code, message }
  const details = error.details && typeof error.details === "object" ? (error.details as { category?: unknown; status?: unknown }) : null
  const providerCategory = typeof details?.category === "string" ? details.category : null
  const status = typeof details?.status === "number" ? details.status : null
  if (providerCategory && TRANSIENT_PROVIDER_CATEGORIES.has(providerCategory)) return { category: "TRANSIENT_PROVIDER_ERROR", code, message }
  if (/_TIMEOUT$|_NETWORK_ERROR$/.test(code)) return { category: "TRANSIENT_PROVIDER_ERROR", code, message }
  if (status !== null && (status === 429 || status >= 500)) return { category: "TRANSIENT_PROVIDER_ERROR", code, message }
  return { category: "UNCLASSIFIED", code, message }
}
