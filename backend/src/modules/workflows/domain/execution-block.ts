/**
 * Bloqueios da etapa de Revisão humana (P5c e D2, `docs/qa/workflows/propostas.md`). Como o bloqueio por agente, a execução fica
 * parada na etapa, mantém o que já foi produzido e só continua por uma nova tentativa confirmada: o defeito é de cadastro ou de
 * configuração, e repetir sozinho não resolve. Os textos nunca citam pessoa.
 */
export type HumanReviewBlockReason = "HUMAN_REVIEW_NO_REVIEWER" | "HUMAN_REVIEW_CONTENT_MISSING"

export type NoReviewerCause = "NO_ONE_IN_CHAIN" | "REVIEWER_INACTIVE" | "PREVIOUS_REVIEW_NOT_DECIDED" | "ONLY_THE_COLLABORATOR"
export type MissingContentCause = "SOURCE_NOT_AVAILABLE" | "VARIABLE_WITHOUT_VALUE"

export const NO_REVIEWER_MESSAGES: Readonly<Record<NoReviewerCause, string>> = {
  NO_ONE_IN_CHAIN: "Este colaborador não tem o cargo pedido para a revisão na hierarquia.",
  REVIEWER_INACTIVE: "A pessoa indicada para revisar está inativa.",
  PREVIOUS_REVIEW_NOT_DECIDED: "A revisão anterior, de onde sai o revisor, não foi decidida neste caminho.",
  ONLY_THE_COLLABORATOR: "O único revisor possível é o próprio colaborador desta execução.",
}

export const MISSING_CONTENT_MESSAGES: Readonly<Record<MissingContentCause, string>> = {
  SOURCE_NOT_AVAILABLE: "a etapa de origem não existe nesta versão do fluxo ou não rodou neste caminho",
  VARIABLE_WITHOUT_VALUE: "a variável escolhida ainda não tem valor nesta execução",
}

export const missingContentCauseOf = (path: string): MissingContentCause => (path.startsWith("variables.") ? "VARIABLE_WITHOUT_VALUE" : "SOURCE_NOT_AVAILABLE")

export class HumanReviewBlockedError extends Error {
  constructor(
    readonly reason: HumanReviewBlockReason,
    readonly blockCause: NoReviewerCause | MissingContentCause,
    message: string,
  ) {
    super(message)
    this.name = "HumanReviewBlockedError"
  }
}

/** A medição que iniciou a execução foi cancelada na Central de Dados. */
export const TRIGGERING_RECORD_CANCELLED = "TRIGGERING_RECORD_CANCELLED"

/** O Workflow foi excluído (exclusão lógica) com esta execução ainda por rodar. */
export const WORKFLOW_DELETED = "WORKFLOW_DELETED"
