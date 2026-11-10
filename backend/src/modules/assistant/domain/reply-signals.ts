/**
 * SINAIS DA RESPOSTA (`SUPPORT_SIGNALS_V1`, migration 181): o que aconteceu na consulta que produziu uma mensagem da INIA,
 * calculado por CÓDIGO a partir dos resultados estruturados do turno — nunca procurando frases no texto gerado. Alimentam a
 * sugestão de falar com um Anjo e as medidas M6 do funil (docs/designs/apoio-com-anjo/design_draft.md, seção 3).
 *
 * Um resultado de especialista TEM CONTEÚDO quando a consulta às bases trouxe trechos (`RETRIEVAL` ou `FULL`) ou quando alguma
 * ferramenta de investigação dele terminou (`COMPLETED`, ou `CACHED`, que é o mesmo dado reaproveitado). `NONE` = nenhuma base
 * autorizada para o especialista; `NO_MATCH` = buscou e nenhum trecho serviu (`knowledge/application/retrieve-knowledge.ts`). Um
 * resultado direto do backend (dados de resultados, liderança, processo) tem conteúdo quando trouxe o cartão de dados. O rastro do
 * Orquestrador nunca conta: ele normalmente não tem base.
 */
export const SUPPORT_SIGNALS_VERSION = "SUPPORT_SIGNALS_V1" as const
export const SUPPORT_SIGNALS = ["KNOWLEDGE_NOT_FOUND", "KNOWLEDGE_INSUFFICIENT", "CONSULTATION_FAILED", "SPECIALIST_BLOCKED", "NO_REPLY"] as const
export type SupportSignal = (typeof SUPPORT_SIGNALS)[number]
/** Nome de cada sinal para quem acompanha o funil (painel do apoio). A tela do operador usa os textos próprios da sugestão. */
export const SUPPORT_SIGNAL_LABELS: Record<SupportSignal, string> = {
  KNOWLEDGE_NOT_FOUND: "Não encontrou nas bases",
  KNOWLEDGE_INSUFFICIENT: "Bases insuficientes para responder",
  CONSULTATION_FAILED: "Consulta não concluída",
  SPECIALIST_BLOCKED: "Especialista indisponível",
  NO_REPLY: "Pergunta sem resposta",
}

type KnowledgeMode = "NONE" | "FULL" | "RETRIEVAL" | "NO_MATCH" | (string & {})

/** Resultado de um especialista no turno (só os campos que decidem o sinal). */
export type SpecialistSignalInput = {
  knowledge?: { mode: KnowledgeMode } | undefined
  toolTrace?: readonly { status: string }[] | undefined
  /** Chamada que falhou e virou "consulta não concluída" (`runOrchestratedReply` com `toleratesToolFailure`). */
  failed?: boolean | undefined
  /** Chamada impedida (especialista inativo ou sem autorização): não conta como consulta feita. */
  blocked?: boolean | undefined
}

/** Resultado de uma ferramenta direta do backend no turno: tem conteúdo quando trouxe o cartão de dados (sem cartão = pedido que ela
 * não resolveu, ex.: indicador ambíguo — o texto dela só explica o que faltou). */
export type DirectSignalInput = { card: unknown | null; failed?: boolean | undefined }

export type ReplySignalInput = {
  specialists?: readonly SpecialistSignalInput[]
  direct?: readonly DirectSignalInput[]
  /** Alguma chamada de especialista foi impedida (inativo ou sem autorização). */
  blocked?: boolean
  /** Estado final do esclarecimento pelas bases, quando a resposta saiu dele. */
  clarificationStatus?: string | null
}

const INVESTIGATION_WITH_DATA = new Set(["COMPLETED", "CACHED"])

const specialistHasContent = (result: SpecialistSignalInput) =>
  result.knowledge?.mode === "RETRIEVAL" || result.knowledge?.mode === "FULL" || (result.toolTrace ?? []).some((step) => INVESTIGATION_WITH_DATA.has(step.status))

const directHasContent = (result: DirectSignalInput) => !result.failed && result.card !== null && result.card !== undefined

/** Os sinais de uma mensagem da INIA, na ordem do catálogo. Nada aconteceu = lista vazia. */
export function signalsOf(input: ReplySignalInput): SupportSignal[] {
  const specialists = input.specialists ?? []
  const direct = input.direct ?? []
  const found = new Set<SupportSignal>()
  const anyFailed = specialists.some((result) => result.failed) || direct.some((result) => result.failed)
  if (input.clarificationStatus === "INSUFFICIENT" || input.clarificationStatus === "NOT_CONVERGED") found.add("KNOWLEDGE_INSUFFICIENT")
  if (anyFailed) found.add("CONSULTATION_FAILED")
  if (input.blocked || specialists.some((result) => result.blocked)) found.add("SPECIALIST_BLOCKED")
  const consulted = specialists.filter((result) => !result.failed && !result.blocked)
  if (consulted.length > 0 && !anyFailed && !consulted.some(specialistHasContent) && !direct.some(directHasContent)) found.add("KNOWLEDGE_NOT_FOUND")
  return SUPPORT_SIGNALS.filter((signal) => found.has(signal))
}

/**
 * Sinais da mensagem depois da CONFERÊNCIA da resposta (PEN-017; decisão do responsável em 10/11/2026). Conferência que FALHOU e
 * trocou o texto ("Não consegui concluir esta resposta agora") = para a pessoa, a consulta não terminou: `CONSULTATION_FAILED`, e a
 * tela sugere falar com um Anjo. Resposta barrada por VIOLAÇÃO de regra = lista vazia (o texto fixo já orienta; não é falta de
 * informação). Resposta que não foi trocada = os sinais calculados do turno. Decide pelo resultado estruturado da conferência, nunca
 * pelo texto.
 */
export function signalsAfterResponseCheck(input: { replaced: boolean; checkOutcome: string; computed: readonly SupportSignal[] }): SupportSignal[] {
  if (!input.replaced) return [...input.computed]
  return input.checkOutcome === "CHECK_FAILED" ? ["CONSULTATION_FAILED"] : []
}
