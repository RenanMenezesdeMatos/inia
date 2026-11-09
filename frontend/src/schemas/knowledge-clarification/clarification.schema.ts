import { z } from "zod"

/**
 * Esclarecimento pelas bases — o que a tela recebe do backend (evento SSE `knowledge_clarification` e `GET …/messages`). Espelho de
 * `backend/src/modules/knowledge-clarification/domain/clarification-view.ts`: o estado validado pelo servidor, com cada fonte já
 * marcada como disponível ou não para quem lê (indisponível = sem título nem seção). A tela só RENDERIZA componentes da aplicação
 * a partir destes dados — nunca HTML vindo do modelo; perguntas, opções e cenários são texto puro.
 */
export const clarificationSourceSchema = z.object({
  documentId: z.string(),
  documentTitle: z.string(),
  versionId: z.string(),
  heading: z.string(),
  chunkIndex: z.number(),
  /** Páginas do PDF de origem, vindas do registro da conversão. Ausente em base que não é PDF convertido e em respostas anteriores. */
  pages: z.object({ from: z.number(), to: z.number() }).optional(),
  /** Imagens da seção no arquivo, para consulta. A IA não as recebe. Ausente nas respostas anteriores a isso e em base sem imagens. */
  images: z.array(z.object({ id: z.string(), page: z.number(), width: z.number(), height: z.number() })).optional(),
  available: z.boolean(),
})

export const clarificationOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  group: z.string().nullable(),
  evidence: z.array(clarificationSourceSchema),
})

export const clarificationStepAnswerSchema = z.object({
  optionIds: z.array(z.string()),
  freeText: z.string().nullable(),
  noneMatched: z.boolean(),
  via: z.enum(["FORM", "TEXT"]),
  answeredAt: z.string(),
})

export const clarificationStepSchema = z.object({
  id: z.string(),
  dimension: z.string(),
  question: z.string(),
  selectionMode: z.enum(["SINGLE", "MULTIPLE"]),
  options: z.array(clarificationOptionSchema),
  answer: clarificationStepAnswerSchema.nullable(),
})

export const scenarioFactSchema = z.object({
  dimension: z.string(),
  value: z.string(),
  origin: z.enum(["QUESTION", "SELECTION", "TEXT"]),
  stepId: z.string().nullable(),
})

export const clarificationViewSchema = z.object({
  version: z.string(),
  id: z.string(),
  originalQuestion: z.string(),
  status: z.enum(["OPEN", "ANSWERED", "INSUFFICIENT", "NOT_CONVERGED"]),
  steps: z.array(clarificationStepSchema),
  questionFacts: z.array(z.object({ dimension: z.string(), value: z.string() })),
  coverage: z.object({ consideredDocuments: z.number(), matchedDocuments: z.number(), presentedDocuments: z.number(), omittedDocuments: z.number(), complete: z.boolean() }),
  sources: z.array(clarificationSourceSchema),
  conflicts: z.array(z.object({ description: z.string(), sources: z.array(clarificationSourceSchema) })),
  notice: z.string().nullable(),
  updatedAt: z.string(),
  scenario: z.array(scenarioFactSchema),
})

export type ClarificationSource = z.infer<typeof clarificationSourceSchema>
export type ClarificationOption = z.infer<typeof clarificationOptionSchema>
export type ClarificationStep = z.infer<typeof clarificationStepSchema>
export type ScenarioFact = z.infer<typeof scenarioFactSchema>
export type ClarificationView = z.infer<typeof clarificationViewSchema>

/** Escolha (ou correção) enviada ao responder uma etapa — o servidor valida contra o estado gravado. */
export const clarificationAnswerSchema = z.object({
  clarificationId: z.string(),
  stepId: z.string(),
  optionIds: z.array(z.string()),
  freeText: z.string().max(1_000).optional(),
  noneMatched: z.boolean(),
  revise: z.boolean(),
})
export type ClarificationAnswer = z.infer<typeof clarificationAnswerSchema>

/** Lê o estado recebido (defensivo: formato de outra versão = sem formulário, nunca erro na tela). */
export function parseClarification(value: unknown): ClarificationView | null {
  if (!value) return null
  const parsed = clarificationViewSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** A etapa aguardando escolha (a última, sem resposta, com o fluxo aberto). */
export function openStepOf(view: ClarificationView): ClarificationStep | null {
  const last = view.steps.at(-1)
  return view.status === "OPEN" && last && last.answer === null ? last : null
}

/**
 * O que o balão da INIA mostra numa mensagem de esclarecimento. Com uma etapa aberta, o texto gravado termina na pergunta seguida da
 * linha com as opções — que o formulário já mostra: o balão vai até a pergunta (inclusive), mantendo o que vem antes dela (na
 * liderança, a parte da resposta que veio de outras ferramentas). Sem etapa aberta (resposta com fontes, o que falta), o texto todo.
 */
export function clarificationBubbleText(text: string, view: ClarificationView): string {
  const open = openStepOf(view)
  if (!open) return view.status === "ANSWERED" ? withoutSourceMarkers(text, view.sources.length) : text
  const at = text.lastIndexOf(open.question)
  return at >= 0 ? text.slice(0, at + open.question.length) : open.question
}

/**
 * Os marcadores de fonte ([1], [2]…) saem do texto que a pessoa LÊ no chat — a conversa fica natural e as fontes ficam no bloco
 * recolhido. O texto gravado mantém os marcadores: é a trilha da auditoria (Monitoramento › Conversas com a INIA). Só some marcador
 * que corresponde a uma fonte da resposta.
 */
export function withoutSourceMarkers(text: string, sourceCount: number): string {
  if (sourceCount === 0) return text
  return text.replace(/[ \t]*\[(\d{1,2})\]/g, (marker, number: string) => (Number(number) >= 1 && Number(number) <= sourceCount ? "" : marker))
}

/** Fontes de uma resposta pelas bases (o mesmo teto do backend, `MAX_ANSWER_SOURCES`). */
export const MAX_CLARIFICATION_SOURCES = 12

/**
 * A resposta pelas bases chegando em fluxo: ainda sem a lista de fontes, saem os marcadores que podem ser de uma fonte (até o teto)
 * — o mesmo texto que a pessoa lê quando a resposta termina (`clarificationBubbleText`), sem marcadores piscando no meio.
 */
export function withoutLiveSourceMarkers(text: string): string {
  return withoutSourceMarkers(text, MAX_CLARIFICATION_SOURCES)
}

/** Texto legível da escolha — a mensagem de quem pergunta gravada na conversa. */
export function describeClarificationAnswer(step: ClarificationStep, answer: Pick<ClarificationAnswer, "optionIds" | "freeText" | "noneMatched">): string {
  const labels = step.options.filter((option) => answer.optionIds.includes(option.id)).map((option) => option.label)
  const chosen = answer.noneMatched ? "Nenhuma das opções corresponde ao meu caso" : labels.join("; ")
  return [chosen, answer.freeText?.trim()].filter(Boolean).join(" — ")
}

/** A seção vale a pena mostrar quando existe e não é o próprio título da base (o trecho de abertura de um documento). */
export function sectionLabelOf(source: ClarificationSource): string | null {
  const heading = source.heading.trim()
  return heading && heading.toLowerCase() !== source.documentTitle.trim().toLowerCase() ? heading : null
}

/** Onde, dentro da base, está a fonte: a seção; sem título de seção, o número do trecho; o próprio título = a abertura. */
export function sourcePartLabel(source: ClarificationSource): string {
  if (!source.available) return "seção indisponível"
  return sectionLabelOf(source) ?? (source.heading.trim() ? "abertura do documento" : `trecho ${source.chunkIndex + 1}`)
}

/** "p. 3" ou "p. 3–4" da fonte; sem registro de páginas, nada. */
export function sourcePageLabel(source: ClarificationSource): string | null {
  if (!source.available || !source.pages) return null
  return source.pages.from === source.pages.to ? `p. ${source.pages.from}` : `p. ${source.pages.from}–${source.pages.to}`
}

/** "Base › Seção" de uma fonte (indisponível = aviso neutro). */
export function describeSource(source: ClarificationSource): string {
  if (!source.available) return "Fonte não disponível para você"
  const section = sectionLabelOf(source)
  return section ? `${source.documentTitle} › ${section}` : source.documentTitle
}

/** Fontes agrupadas por base, na ordem de chegada (o título aparece uma vez; `index` = posição na lista original). */
export function groupSourcesByDocument(sources: readonly ClarificationSource[]): { documentId: string; available: boolean; documentTitle: string; items: { source: ClarificationSource; index: number }[] }[] {
  const groups: { documentId: string; available: boolean; documentTitle: string; items: { source: ClarificationSource; index: number }[] }[] = []
  sources.forEach((source, index) => {
    const key = source.available ? source.documentId : `indisponivel-${index}`
    const group = groups.find((item) => item.documentId === key)
    if (group) group.items.push({ source, index })
    else groups.push({ documentId: key, available: source.available, documentTitle: source.documentTitle, items: [{ source, index }] })
  })
  return groups
}
