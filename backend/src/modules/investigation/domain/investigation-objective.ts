import type { ClaimScope } from "./tool-trace.js"

/**
 * INVESTIGATION OBJECTIVE (V1.3.1 — §4/5): toda investigação sabe explicitamente QUAL pergunta
 * precisa responder e QUAL escopo de afirmação a conclusão exige. Derivado pelo runtime a partir
 * do contexto (Workflow, contrato, sujeito, pergunta) — nunca pelo modelo. O objetivo alimenta o
 * controlador de suficiência (evidence-sufficiency.ts): o Agent não é obrigado a perseguir um
 * escopo maior do que o objetivo pede, nem pode parar antes de sustentá-lo.
 */
export const INVESTIGATION_OBJECTIVE_KINDS = ["DESCRIBE_PERFORMANCE", "EXPLAIN_INDICATOR_DEVIATION", "FEEDBACK_SINGLE_INTERACTION", "IDENTIFY_EMPLOYEE_PATTERN", "COMPARE_WITH_POPULATION", "PROCESS_AUDIT", "MULTI_DOMAIN_DIAGNOSIS"] as const
export type InvestigationObjectiveKind = (typeof INVESTIGATION_OBJECTIVE_KINDS)[number]

export type InvestigationObjective = {
  kind: InvestigationObjectiveKind
  /** A pergunta que a conclusão precisa responder (uma frase, sem ids). */
  question: string
  /** Escopo de afirmação EXIGIDO pela conclusão — null = conclusão quantitativa basta (afirmações comportamentais, se houver, seguem o gating normal). */
  requiredScope: ClaimScope | null
  /** true = o objetivo pretende explicar CAUSA/comportamento — evidência de interação vira necessidade material quando existe. */
  causal: boolean
}

export const INVESTIGATION_OBJECTIVE_LABELS: Record<InvestigationObjectiveKind, string> = {
  DESCRIBE_PERFORMANCE: "Descrever a performance",
  EXPLAIN_INDICATOR_DEVIATION: "Explicar o desvio do indicador",
  FEEDBACK_SINGLE_INTERACTION: "Feedback de uma interação",
  IDENTIFY_EMPLOYEE_PATTERN: "Identificar padrão do colaborador",
  COMPARE_WITH_POPULATION: "Comparar com a população",
  PROCESS_AUDIT: "Auditoria de processo",
  MULTI_DOMAIN_DIAGNOSIS: "Diagnóstico multidomínio",
}

const PATTERN_WORDS = /\b(padr[ãa]o|costum\w*|recorr\w*|frequent\w*|sempre|h[áa]bito)\b/i
const POPULATION_WORDS = /\b(compar\w*|pares|subgrupo|grupo|equipe|colegas|popula[çc][ãa]o)\b/i
const CAUSE_WORDS = /\b(por ?que|porqu[eê]|causa\w*|motivo\w*|explic\w*|raz[ãa]o|diagn[óo]stic\w*)\b/i
const DESCRIBE_WORDS = /\b(qual foi|quanto|como est[áa]|resultado|valor|meu tma|minha meta|situa[çc][ãa]o)\b/i

export type ObjectiveContext = {
  interactionId: string | null
  indicatorCode: string | null
  /** Contrato pedido pelo Workflow (auditoria de processo) — só com interação. */
  outputContract?: "FEEDBACK" | "PROCESS_AUDIT" | null | undefined
  /** Indicador dentro da meta no período (quando conhecido). */
  withinTarget?: boolean | null | undefined
  /** Pergunta livre (chat/voz/QA) — orienta o objetivo quando não há Workflow. */
  query?: string | null | undefined
  /** Resumo de vários indicadores (agenda). */
  multiIndicator?: boolean | undefined
}

/** Objetivo derivado por regras do runtime — determinístico. */
export function resolveInvestigationObjective(context: ObjectiveContext): InvestigationObjective {
  const query = context.query?.trim() ?? ""
  if (context.interactionId) {
    if (context.outputContract === "PROCESS_AUDIT") return { kind: "PROCESS_AUDIT", question: "A interação seguiu, etapa a etapa, o procedimento oficial aplicável?", requiredScope: "INTERACTION_SPECIFIC", causal: false }
    if (query && PATTERN_WORDS.test(query)) return { kind: "IDENTIFY_EMPLOYEE_PATTERN", question: "O comportamento observado nesta interação é um padrão do colaborador?", requiredScope: "EMPLOYEE_PATTERN", causal: true }
    return { kind: "FEEDBACK_SINGLE_INTERACTION", question: "O que o colaborador fez ou deixou de fazer NESTA interação, frente ao procedimento aplicável, e o que fazer da próxima vez?", requiredScope: "INTERACTION_SPECIFIC", causal: false }
  }
  if (context.multiIndicator) return { kind: "DESCRIBE_PERFORMANCE", question: "Como estão os indicadores do período frente às metas?", requiredScope: null, causal: false }
  if (context.indicatorCode) {
    if (query && PATTERN_WORDS.test(query)) return { kind: "IDENTIFY_EMPLOYEE_PATTERN", question: `Existe um padrão de comportamento do colaborador que explique ${context.indicatorCode}?`, requiredScope: "EMPLOYEE_PATTERN", causal: true }
    if (query && POPULATION_WORDS.test(query) && !CAUSE_WORDS.test(query)) return { kind: "COMPARE_WITH_POPULATION", question: `Como ${context.indicatorCode} do colaborador se compara à população de referência?`, requiredScope: "POPULATION_PATTERN", causal: false }
    if (context.withinTarget === true || (query && DESCRIBE_WORDS.test(query) && !CAUSE_WORDS.test(query))) return { kind: "DESCRIBE_PERFORMANCE", question: `Como está ${context.indicatorCode} no período frente à meta e à evolução?`, requiredScope: null, causal: false }
    return { kind: "EXPLAIN_INDICATOR_DEVIATION", question: `Por que ${context.indicatorCode} está onde está no período — e o que sustenta uma recomendação?`, requiredScope: null, causal: true }
  }
  if (query && PATTERN_WORDS.test(query)) return { kind: "IDENTIFY_EMPLOYEE_PATTERN", question: "Existe um padrão de comportamento do colaborador?", requiredScope: "EMPLOYEE_PATTERN", causal: true }
  if (query && CAUSE_WORDS.test(query)) return { kind: "MULTI_DOMAIN_DIAGNOSIS", question: "O que explica a situação perguntada?", requiredScope: null, causal: true }
  return { kind: "DESCRIBE_PERFORMANCE", question: "Qual é a situação perguntada, com os fatos disponíveis?", requiredScope: null, causal: false }
}

export function renderObjectiveForModel(objective: InvestigationObjective): string {
  return [
    `OBJETIVO DESTA INVESTIGAÇÃO: ${INVESTIGATION_OBJECTIVE_LABELS[objective.kind]} — ${objective.question}`,
    objective.requiredScope ? `Escopo de afirmação exigido pela conclusão: ${objective.requiredScope}.` : `A conclusão pode ser quantitativa; afirmações sobre comportamento só com evidência de interação/transcrição e no escopo que ela sustenta.`,
    objective.causal ? "A conclusão pretende explicar causa: sem transcrições analisadas, a causa comportamental NÃO pode ser afirmada — declare como não identificada." : "Não é necessário investigar causa comportamental além do que o objetivo pede.",
  ].join(" ")
}
