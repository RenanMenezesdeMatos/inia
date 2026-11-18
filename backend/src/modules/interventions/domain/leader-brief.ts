import type { Evolution } from "./evolution.js"
import type { DecisionStatus } from "./policy-evaluation.js"

/**
 * RESUMO DA INIA PARA A LIDERANÇA (`INTERVENTION_LEADER_BRIEF_V1`) — o que o líder lê no Acompanhamento quando uma política abre
 * ou recomenda um acompanhamento: a situação, o que JÁ foi feito (feedbacks publicados e acompanhamentos anteriores), a evolução
 * medida desde então, o que a INIA propõe e o que ela ainda não sabe.
 *
 * Montado só por código, a partir dos fatos da avaliação: existe sempre, mesmo sem IA, e nada aqui decide nem muda uma decisão.
 * O texto dos feedbacks é HISTÓRICO do que já foi dito ao colaborador (cada item aponta o feedback de origem) — nunca evidência.
 * A sugestão de avaliação de continuidade tem texto FIXO: a INIA só sugere; a decisão é de uma pessoa autorizada.
 */
export const LEADER_BRIEF_CONTRACT = "INTERVENTION_LEADER_BRIEF_V1"

/** Janela do "o que já foi feito" e teto de feedbacks listados. */
export const BRIEF_HISTORY_DAYS = 180
export const BRIEF_MAX_FEEDBACKS = 5
export const BRIEF_RECOMMENDATION_MAX_CHARS = 320

/** `recommendation` = o que foi dito ao colaborador: o resumo curto do próprio feedback quando ele tem um; senão, o começo do texto publicado. */
export type BriefFeedback = { id: string; kind: "INDICATOR" | "MONITORING" | null; title: string | null; publishedAt: string; acknowledgedAt: string | null; recommendation: string }
export type BriefPerson = { personId: string; name: string }

export type BriefAction = {
  /** O mesmo marcador da ação no relatório (A1, A2…). */
  handle: string
  typeKey: string
  typeName: string
  sensitive: boolean
  status: DecisionStatus
  interventionId: string | null
  /** A fala da INIA: para quem vai executar (2ª pessoa) e para os demais leitores (aprovador, quem decide). */
  lead: { toResponsible: string; toOthers: string }
}

export type LeaderBrief = {
  contract: typeof LEADER_BRIEF_CONTRACT
  /** Fatos atendidos das regras que decidiram, como estão no relatório. */
  situation: string[]
  alreadyDone: {
    windowDays: number
    feedbacks: BriefFeedback[]
    /** Total no período (a lista mostra só os mais recentes). */
    feedbackCount: number
  }
  evolution: Evolution | null
  /** O que falta para concluir — dado ausente nunca é desempenho ruim. */
  unknowns: string[]
  actions: BriefAction[]
}

/**
 * O que foi dito no feedback, em texto curto e limpo: tira tabelas e marcação Markdown (negrito, títulos, marcadores de lista),
 * corta em palavra inteira com reticências e NUNCA no meio de uma citação literal aberta (“…”) — se o corte cairia dentro de uma,
 * recua para antes dela. As palavras do feedback não mudam: é só o começo dele.
 */
export function clipText(text: string, max: number): string {
  const flat = text
    .split("\n")
    .filter((line) => !/^\s*\|.*\|\s*$/.test(line))
    .map((line) => line.replace(/^\s*#{1,6}\s+/, "").replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "• "))
    .join(" ")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (flat.length <= max) return flat
  let cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  if (lastSpace > max * 0.6) cut = cut.slice(0, lastSpace)
  const open = cut.lastIndexOf("“")
  if (open > cut.lastIndexOf("”") && open > 0) cut = cut.slice(0, open)
  return `${cut.replace(/[\s,;:.•–—-]+$/u, "")}…`
}

const civilDate = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10).split("-").reverse().join("/") : null)

export type BriefActionInput = {
  handle: string
  typeKey: string
  typeName: string
  sensitive: boolean
  status: DecisionStatus
  interventionId: string | null
  responsible: BriefPerson | null
  approver: BriefPerson | null
  dueAt: string | null
}

/** A fala da INIA para UMA ação — texto fechado por situação; nenhuma palavra vem de modelo. */
export function briefLead(action: BriefActionInput, context: { personName: string; policyName: string }): BriefAction["lead"] {
  const person = context.personName
  const type = `“${action.typeName}”`
  const due = civilDate(action.dueAt)
  const until = due ? `, com prazo até ${due}` : ""
  const responsible = action.responsible?.name ?? "o responsável"
  const same = (text: string) => ({ toResponsible: text, toOthers: text })
  if (action.sensitive) {
    // Texto FIXO: sugestão, nunca decisão. Vale para qualquer leitor.
    return same(`Pela política “${context.policyName}”, sugiro a avaliação de continuidade de ${person}. É uma sugestão: a decisão é de quem está autorizado a decidir, com justificativa, e este aviso não muda a situação funcional de ninguém.`)
  }
  switch (action.status) {
    case "CREATED":
      return { toResponsible: `Criei um acompanhamento para você fazer com ${person}: ${type}${until}.`, toOthers: `Criei um acompanhamento para ${responsible} fazer com ${person}: ${type}${until}.` }
    case "PENDING_APPROVAL": {
      const approver = action.approver?.name ?? "quem aprova"
      return { toResponsible: `Preparei ${type} para você fazer com ${person}. Começa depois da aprovação de ${approver}.`, toOthers: `Preparei ${type} para ${responsible} fazer com ${person}. Aguarda a aprovação de ${approver}.` }
    }
    case "RECOMMENDED":
      return { toResponsible: `Sugiro ${type} para ${person}. Você decide se aceita${due ? ` até ${due}` : ""}.`, toOthers: `Sugeri ${type} para ${person}. ${responsible} decide se aceita${due ? ` até ${due}` : ""}.` }
    case "NOTIFIED":
      // Só avisar: nenhuma ação foi criada — abrir uma fica a critério de quem lidera.
      return { toResponsible: `Para você acompanhar: pela política “${context.policyName}”, ${person} chegou ao ponto de ${type}. Não abri nenhuma ação: fica a seu critério.`, toOthers: `Avisei ${responsible}: pela política “${context.policyName}”, ${person} chegou ao ponto de ${type}. Nenhuma ação foi aberta.` }
    case "EXISTING":
      return same(`${type} de ${person} já está em andamento: registrei o novo sinal nele.`)
    case "SUPPRESSED":
      return same(`Não reabri ${type} para ${person}: um igual foi encerrado há pouco tempo.`)
    case "CONFLICT":
      return same(`Não apliquei ${type} para ${person}: há conflito com outra ação. Precisa de decisão humana.`)
  }
}

export type LeaderBriefInput = {
  personName: string
  policyName: string
  /** Frases dos fatos atendidos (regras que decidiram), sem o marcador. */
  situation: readonly string[]
  feedbacks: readonly BriefFeedback[]
  feedbackCount: number
  evolution: Evolution | null
  unknowns: readonly string[]
  actions: readonly BriefActionInput[]
}

export function buildLeaderBrief(input: LeaderBriefInput): LeaderBrief {
  return {
    contract: LEADER_BRIEF_CONTRACT,
    situation: [...new Set(input.situation)],
    alreadyDone: {
      windowDays: BRIEF_HISTORY_DAYS,
      feedbacks: input.feedbacks.slice(0, BRIEF_MAX_FEEDBACKS).map((feedback) => ({ ...feedback, recommendation: clipText(feedback.recommendation, BRIEF_RECOMMENDATION_MAX_CHARS) })),
      feedbackCount: input.feedbackCount,
    },
    evolution: input.evolution,
    unknowns: [...new Set(input.unknowns)],
    actions: input.actions.map((action) => ({ handle: action.handle, typeKey: action.typeKey, typeName: action.typeName, sensitive: action.sensitive, status: action.status, interventionId: action.interventionId, lead: briefLead(action, input) })),
  }
}
