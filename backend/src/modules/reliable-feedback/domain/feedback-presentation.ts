import { INTERNAL_REF_PATTERN } from "../../investigation/domain/interaction-feedback.js"
import { JSON_LEAKAGE, TURN_REF } from "../../investigation/domain/interaction-feedback-writer.js"
import { detectUnsupportedEffectClaims } from "./effect-claims.js"
import { causalIndicatorClaims } from "./indicator-diagnosis-claims.js"
import { developmentTopicsOf, isProcessFeedback, type EmittedItem } from "./reliable-feedback-artifact.js"
import { SUPERVISOR_PRESENTATION_VERSION, supervisorPresentationOf } from "./supervisor-presentation.js"
import { terms } from "./verified-omission.js"
import { presentationLabelOf } from "./behavior-presentation.js"
import { exampleOnlyFactsIn, suggestedResponseScopeOf } from "./suggested-response.js"
import { resolveNarrative, type ResolvedNarrative, type StoredNarrative } from "./supervisor-narrative.js"

/**
 * V1.7.1b — APRESENTAÇÃO PESSOAL do feedback (domínio puro): o feedback lê como o de um bom supervisor — saudação pelo nome,
 * abertura que diz o que foi analisado e o que apareceu, e um fechamento humano — SEM mudar a confiabilidade:
 *
 *   CONTEÚDO/EVIDÊNCIA = os itens do feedback confiável (inalterados).
 *   APRESENTAÇÃO       = saudação + abertura + fechamento. Nunca cria fato: todo termo de conteúdo da abertura/fechamento
 *                        precisa estar nos itens que REALMENTE saem (etapas, regras, falas, textos) ou no rótulo do caso.
 *
 *   NOME       vem do SISTEMA (primeiro nome do cadastro da pessoa) e nunca é enviado ao modelo: a saudação "Olá, Rafael!" é
 *              montada aqui. O redator escreve abertura e fechamento sem nome; nome, apelido ou tratamento com gênero no texto
 *              dele = recusado.
 *   VALIDAÇÃO  a abertura/fechamento do redator é conferida contra os itens EMITIDOS na hora de emitir (se o QA rejeitou o
 *              ponto que a abertura citava, ela cai) — senão vale a versão do SISTEMA, montada só dos itens emitidos.
 */
export const FEEDBACK_PRESENTATION_VERSION = "FEEDBACK_PRESENTATION_V1" as const

export type PresentationDraft = { introduction: string; closing: string }
/** O que o artefato guarda: o destinatário (primeiro nome do sistema) e o rascunho do redator (auditoria + reuso na emissão). */
export type StoredPresentation = { version: typeof FEEDBACK_PRESENTATION_VERSION; recipient: { firstName: string } | null; writerDraft: PresentationDraft | null; writerViolations: string[]
  /** FEEDBACK POR FLAG V2 — rascunho da NARRATIVA de supervisor (redator próprio) + card; ausente em artefatos anteriores. */
  narrative?: StoredNarrative | null }
/** V1.7.2 — `card`: resumo curto (2–3 frases) do feedback de monitoria de processo (o card do Acompanhamento); ausente antes. */
/**
 * FEEDBACK POR FLAG V2 (`NATURAL_SUPERVISOR_FEEDBACK_V1`) — monitoria de processo: `narrative` = parágrafos da mensagem do
 * supervisor (redator validado ou versão do sistema), `card` = síntese do Acompanhamento; os DETALHES (prova) são renderizados
 * pelo sistema a partir dos itens (feedback-view.ts). `introduction` = narrativa em texto corrido (leitores antigos).
 */
export const NATURAL_FEEDBACK_VERSION = "NATURAL_SUPERVISOR_FEEDBACK_V1" as const
export type FeedbackPresentation = { version: typeof FEEDBACK_PRESENTATION_VERSION | typeof SUPERVISOR_PRESENTATION_VERSION | typeof NATURAL_FEEDBACK_VERSION; greeting: string; introduction: string; closing: string; source: "WRITER" | "SYSTEM"; violations: string[]; card?: string
  /** V2 — parágrafos da narrativa, primeiro nome do SISTEMA (para o vocativo) e a origem/validação de cada campo. */
  narrative?: string[]; firstName?: string | null; narrativeResolution?: Pick<ResolvedNarrative, "source" | "violations" | "factualityRejected" | "factualityRepaired"> }
export type PresentationContext = { domain: "MONITORING" | "INDICATOR"; label: string; firstName: string | null; indicatorName?: string | null; indicatorCode?: string | null
  /** V2 — textos adicionais que sustentam a narrativa (o brief e o vocabulário de condução). */
  extraGrounding?: readonly string[]
  /** FEEDBACK EXPERIENCE V2 — contexto da chamada declarado pelo especialista (fato do assessment; entra na checagem de especificidade). */
  interaction?: { customerNeed: string | null; situation: string | null; path: string | null } | null }

export type PresentationViolation =
  | "PRESENTATION_EMPTY"
  | "PRESENTATION_NAME"
  | "PRESENTATION_TREATMENT"
  | "PRESENTATION_UNSUPPORTED_CLAIM"
  | "PRESENTATION_POLARITY_MISMATCH"
  | "PRESENTATION_BLAME"
  | "PRESENTATION_UNCERTAINTY_AS_ERROR"
  | "GUARANTEED_EFFECT"
  | "CAUSAL_CLAIM"
  | "INTERNAL_REF"
  | "INTERNAL_JSON_LEAKAGE"
  /** V1.7.1f — abertura/fechamento com fato que só existe em EXEMPLO da base (prazo, canal, número). */
  | "EXAMPLE_CONTENT_AS_FACT"

/** Primeiro nome do cadastro (sistema): primeira palavra do nome, com a caixa preservada. Nunca apelido/inferência. */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? ""
  return /^\p{L}[\p{L}'-]*$/u.test(first) ? first : null
}
export const greetingOf = (firstName: string | null) => (firstName ? `Olá, ${firstName}!` : "Olá!")

/**
 * Vocabulário de CONDUÇÃO do texto (não é fato): o que um supervisor usa para organizar o feedback. Termo de conteúdo fora
 * disto e fora dos itens emitidos = afirmação sem base.
 */
const CONVERSATIONAL = terms(
  "analisei analisar análise atendimento atendimentos chamada chamadas ponto pontos forte fortes desenvolvimento desenvolver oportunidade oportunidades " +
    "encontrei identifiquei identificar mostrar mostro exatamente próximas próximos conduzir condução conduziu etapas etapa procedimento procedimentos processo " +
    "orientação orientações ajuste ajustes principal principais geral demonstrou importantes importante alguns algumas aconteceu também seguir detalhes abaixo " +
    "acima compartilhar padrões padrão resultado resultados período investiguei amostra suficiente entender apareceu operação atenção confirmar confirmado " +
    "produto produtos merece claro clara fica alinhado alinhada aplicado aplicada tipo trecho trechos fala falas base material materiais feedback cada bom boa " +
    "trabalho continue continuar manter prática práticas vale valeu separei separado junto juntos momento momentos seguinte seguintes cumpriu cumpridas cumprida " +
    "vamos vou juntar olhar olhei visão ficou ficaram completa completo completar mais menos forma maneira jeito caminho sobre aqui pontos-chave comentários " +
    "evidência evidências documento documentos regra regras orienta orientam organizei organizado seguir sugestão sugestões exemplo exemplos conduzir " +
    "indicador indicadores oficial meta metas dentro fora analisados analisadas atendidos observado observada observei nota notei destaque destaques " +
    "estão estao aplicando aplicar principal próximo próxima seguido seguida gostaria compartilhar parabéns obrigado vezes vez " +
    "tratativa foco depois " +
    // V1.7.4 — palavras NEUTRAS de condução que o redator usa para descrever a conduta (auditoria da Golden Demo "Argumentário":
    // eram falso positivo). Efeito/valor ("útil", "eficiente", "facilitar", "autonomia", "solução", "garantir") continuam fora.
    "interação interações necessário necessária necessidade situação postura prestar prestou prestando referência serviço serviços " +
    "realizar realizou realizada realizado realizando ação ações sequência execução executou comunicou comunicar comunicando " +
    "ofereceu oferecer apresentou apresentar apresentando cliente colaborador pedido solicitação " +
    "disso além através abordagem abordar abordou assunto assuntos questão questões tema temas tópico tópicos qualquer " +
    "pendente pendentes certificar certificou certifique utilizar utilizou utilize utilizando focar foque respeito relação " +
    "dessa desse deste desta nesse nessa neste nesta momento desejo deseja",
)

const TREATMENT = /(?<!\p{L})(?:prezad[oa]s?|car[oa]s?|querid[oa]s?|senhora?|sr\.?|sra\.?|bem-vind[oa]s?)(?!\p{L})/iu
const BLAME = /(?<!\p{L})(?:errou|erros?|errad[oa]s?|falh(?:a|as|ou)|incorret\p{L}*|equívoc\p{L}*|descuido|negligênci\p{L}*)(?!\p{L})/iu
const UNCERTAINTY_AS_ERROR = /(?<!\p{L})(?:não\s+(?:identificou|confirmou|verificou|perguntou|informou)|deixou\s+de|esqueceu)(?!\p{L})/iu
const OUTCOME_PROMISE = /(?<!\p{L})(?:reduzir|reduz|melhorar|melhora|aumentar|aumenta|diminuir|diminui|baixar|elevar)\s+(?:(?:o|a|os|as|seu|sua|seus|suas)\s+){0,2}(?:tma|nps|csat|indicador(?:es)?|resultado(?:s)?|nota|meta|tempo\s+médio)(?!\p{L})/iu
const POSITIVE_MARKER = /(?<!\p{L})(?:bem|boa|bons|boas|acert\p{L}*|corret[oa]s?|cumpriu|cumpriram|parabéns|destac\p{L}*|forte)(?!\p{L})/iu
const NEGATIVE_MARKER = /(?<!\p{L})(?:oportunidade|ajuste|desenvolv\p{L}*|faltou|melhorar|não)(?!\p{L})/iu
const VOCATIVE = /(?:^|[.!?]\s+)(?:olá|oi|ei|bom\s+dia|boa\s+tarde|boa\s+noite)[,\s]+(\p{Lu}[\p{L}'-]*)/u
const HEDGE = /(?<!\p{L})(?:indícios?|possível|provável|pode|podia|compatível|não\s+foi\s+possível|confirmar|incerto|dúvida)(?!\p{L})/iu

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0)
/** V1.7.1e — a apresentação fala do ASSUNTO do achado (rótulo de apresentação); o nome interno da etapa só como reserva. */
const stepNameOf = (item: EmittedItem) => presentationLabelOf(item) ?? item.process?.stepTitle ?? item.process?.requirement ?? null

/** Textos que sustentam a apresentação: SÓ o que sai no feedback (itens emitidos) + o rótulo do caso + o indicador. */
function groundingTextsOf(items: readonly EmittedItem[], context: PresentationContext): string[] {
  return [
    context.label,
    context.indicatorName ?? "",
    ...(context.extraGrounding ?? []),
    ...items.flatMap((item) => [
      stepNameOf(item) ?? "",
      item.process?.stepTitle ?? "",
      item.process?.requirement ?? "",
      item.knowledge?.operativeRule?.quote ?? "",
      item.knowledge?.quote ?? "",
      item.knowledge?.leadIn ?? "",
      // V1.7.1f — EXEMPLO da base nunca sustenta a apresentação (só regra e falas).
      item.knowledge?.detail && item.knowledge.detail.contentKind !== "EXAMPLE_CONTENT" ? item.knowledge.detail.quote : "",
      item.knowledge?.heading ?? "",
      item.knowledge?.documentTitle ?? "",
      item.wording.observed,
      item.wording.whyItMatters,
      item.wording.whatYouCanDo,
      ...item.facts.map((fact) => fact.text),
      ...(item.applicability?.candidates.flatMap((candidate) => [candidate.product, candidate.documentTitle]) ?? []),
    ]),
  ]
}

/** Termos de conteúdo do texto que não estão nos itens emitidos, no contexto nem no vocabulário de condução (auditoria/teste). */
export function unsupportedPresentationTerms(text: string, items: readonly EmittedItem[], context: PresentationContext): string[] {
  const groundingTerms = new Set(groundingTextsOf(items, context).flatMap((entry) => [...terms(entry)]))
  return [...terms(text)].filter((term) => !groundingTerms.has(term) && !CONVERSATIONAL.has(term))
}

/** Validação de abertura/fechamento contra os itens que REALMENTE saem. Pura; a mesma no redator, na emissão e no teste. */
export function presentationViolations(draft: PresentationDraft, items: readonly EmittedItem[], context: PresentationContext): PresentationViolation[] {
  const texts = [draft.introduction, draft.closing]
  if (texts.some((text) => text.trim().length === 0)) return ["PRESENTATION_EMPTY"]
  const all = texts.join("\n")
  const violations = new Set<PresentationViolation>()
  if (texts.some((text) => INTERNAL_REF_PATTERN.test(text) || TURN_REF.test(text))) violations.add("INTERNAL_REF")
  if (JSON_LEAKAGE.some((pattern) => pattern.test(all))) violations.add("INTERNAL_JSON_LEAKAGE")
  if (TREATMENT.test(all)) violations.add("PRESENTATION_TREATMENT")
  if (BLAME.test(all)) violations.add("PRESENTATION_BLAME")
  // Nome: nenhum vocativo e nenhum nome próprio que não esteja nos itens (a saudação com o nome é do sistema).
  const grounding = groundingTextsOf(items, context)
  const groundingWords = new Set(grounding.flatMap((text) => fold(text).split(/[^\p{L}\p{N}]+/u)).filter(Boolean))
  if (VOCATIVE.test(all)) violations.add("PRESENTATION_NAME")
  for (const sentence of sentencesOf(all)) {
    const words = sentence.split(/\s+/).slice(1).map((word) => word.replace(/[^\p{L}'-]/gu, ""))
    if (words.some((word) => /^\p{Lu}\p{Ll}+$/u.test(word) && !groundingWords.has(fold(word)))) violations.add("PRESENTATION_NAME")
  }
  // Nenhum fato novo: termo de conteúdo precisa estar nos itens emitidos (ou ser vocabulário de condução).
  if (unsupportedPresentationTerms(all, items, context).length > 0) violations.add("PRESENTATION_UNSUPPORTED_CLAIM")
  // Polaridade: elogio sobre etapa a desenvolver, ou crítica sobre etapa cumprida, na mesma frase.
  const namesTerms = (section: EmittedItem["section"]) => new Set(items.filter((item) => item.section === section).flatMap((item) => [...terms(stepNameOf(item) ?? "")]))
  const development = namesTerms("OPPORTUNITY")
  const strengths = namesTerms("STRENGTH")
  const devOnly = new Set([...development].filter((term) => !strengths.has(term)))
  const strengthOnly = new Set([...strengths].filter((term) => !development.has(term)))
  for (const sentence of sentencesOf(all)) {
    const sentenceTerms = [...terms(sentence)]
    const hitsDev = sentenceTerms.some((term) => devOnly.has(term))
    const hitsStrength = sentenceTerms.some((term) => strengthOnly.has(term))
    if (POSITIVE_MARKER.test(sentence) && hitsDev && !hitsStrength && !NEGATIVE_MARKER.test(sentence)) violations.add("PRESENTATION_POLARITY_MISMATCH")
    if (NEGATIVE_MARKER.test(sentence) && hitsStrength && !hitsDev && !POSITIVE_MARKER.test(sentence)) violations.add("PRESENTATION_POLARITY_MISMATCH")
  }
  // Incerteza do sistema nunca vira erro do colaborador nem certeza.
  const attention = items.filter((item) => item.section === "ATTENTION")
  if (attention.length > 0) {
    const products = attention.flatMap((item) => item.applicability?.candidates.map((candidate) => candidate.product) ?? [])
    for (const sentence of sentencesOf(all)) {
      const aboutProduct = /(?<!\p{L})produto/iu.test(sentence) || products.some((product) => fold(sentence).includes(fold(product)))
      if (aboutProduct && UNCERTAINTY_AS_ERROR.test(sentence)) violations.add("PRESENTATION_UNCERTAINTY_AS_ERROR")
      if (products.some((product) => fold(sentence).includes(fold(product))) && !HEDGE.test(sentence)) violations.add("PRESENTATION_UNCERTAINTY_AS_ERROR")
    }
  }
  const ruleTexts = items.flatMap((item) => [item.knowledge?.quote ?? "", item.knowledge?.leadIn ?? "", item.knowledge?.detail?.quote ?? ""])
  if (detectUnsupportedEffectClaims(all, ruleTexts).length > 0) violations.add("GUARANTEED_EFFECT")
  if (OUTCOME_PROMISE.test(all)) violations.add("CAUSAL_CLAIM")
  // V1.7.1f — fato que só existe em EXEMPLO de algum item (ex.: "SMS", "cinco dias úteis" de uma fala-modelo).
  const scopes = items.map((item) => suggestedResponseScopeOf({ ...item, domain: item.domain ?? "MONITORING" }))
  if (exampleOnlyFactsIn(texts, { ruleTexts: scopes.flatMap((scope) => scope.ruleTexts), evidenceTexts: scopes.flatMap((scope) => scope.evidenceTexts), exampleTexts: scopes.flatMap((scope) => scope.exampleTexts) }).length > 0) violations.add("EXAMPLE_CONTENT_AS_FACT")
  if (context.domain === "INDICATOR" && context.indicatorName && causalIndicatorClaims(all, { name: context.indicatorName, code: context.indicatorCode ?? context.indicatorName }).length > 0) violations.add("CAUSAL_CLAIM")
  return [...violations]
}

const quoted = (name: string) => `“${name}”`
const listAnd = (values: readonly string[]) => (values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} e ${values[values.length - 1]}`)
const stepsPhrase = (items: readonly EmittedItem[]) => {
  const names = [...new Set(items.flatMap((item) => { const name = stepNameOf(item); return name ? [quoted(name)] : [] }))]
  return names.length === 0 ? null : `${names.length === 1 ? "a etapa" : "as etapas"} ${listAnd(names)}`
}
/** "Atendimento de 25/09/2026 · Contestação de cobrança" → "seu atendimento de 25/09/2026 sobre contestação de cobrança". */
function subjectPhrase(label: string): string {
  const [head, ...rest] = label.split(" · ")
  const date = head?.startsWith("Atendimento de ") ? head.slice("Atendimento de ".length) : null
  const subject = rest.join(" · ")
  const lower = subject ? subject.charAt(0).toLowerCase() + subject.slice(1) : ""
  return `seu atendimento${date ? ` de ${date}` : ""}${lower ? ` sobre ${lower}` : ""}`
}

/**
 * Apresentação do SISTEMA (sempre válida por construção): só nomes de etapas, contagens e o rótulo do caso — nunca efeito,
 * nunca causa, nunca nome além do primeiro nome do cadastro (que só aparece na saudação).
 */
export function systemPresentation(items: readonly EmittedItem[], context: PresentationContext): PresentationDraft {
  const development = items.filter((item) => item.section === "OPPORTUNITY")
  const strengths = items.filter((item) => item.section === "STRENGTH")
  const attention = items.filter((item) => item.section === "ATTENTION")
  if (context.domain === "INDICATOR") {
    const official = items.find((item) => item.kind === "INDICATOR_TARGET_MET" || item.kind === "INDICATOR_TARGET_NOT_MET")
    const patterns = items.filter((item) => item.kind === "INDICATOR_DEVELOPMENT_PATTERN" || item.kind === "INDICATOR_STRENGTH_PATTERN")
    const [indicator, period] = context.label.split(" · ")
    const introduction = [
      `Analisei seu resultado oficial de ${indicator ?? "indicador"}${period ? ` no período de ${period}` : ""}.`,
      ...(patterns.length > 0 || attention.length > 0 ? ["Também analisei uma amostra dos seus atendimentos para entender o que apareceu na operação, e separei abaixo o que encontrei."] : []),
    ].join(" ")
    const devPatterns = patterns.filter((item) => item.section === "OPPORTUNITY")
    const closing = [
      ...(official ? [`No período, o resultado oficial ficou ${official.kind === "INDICATOR_TARGET_MET" ? "dentro" : "fora"} da meta.`] : []),
      ...(devPatterns.length > 0 && stepsPhrase(devPatterns.slice(0, 1)) ? [`Nos atendimentos analisados, o principal ponto para desenvolver é ${stepsPhrase(devPatterns.slice(0, 1))}.`] : []),
      ...(patterns.length > 0 ? ["O que aparece na amostra analisada não indica, sozinho, a causa do resultado."] : []),
    ].join(" ")
    return { introduction, closing: closing || "Os detalhes estão acima, com os dados oficiais do período." }
  }
  // V1.7.1d — frases naturais: contagem das etapas cumpridas e os TEMAS dos pontos de desenvolvimento (um por bloco de coaching,
  // no máximo dois citados) — nunca a lista crua de trechos longos, nunca "em as"/"de a".
  const done = strengths.length === 0 ? null : strengths.length === 1 ? "um ponto da tratativa" : `${strengths.length} pontos da tratativa`
  const topics = developmentTopicsOf(development)
  const shown = topics.slice(0, 2).map(quoted)
  const topicsPhrase = shown.length === 0 ? null : `${listAnd(shown)}${topics.length > 2 ? " e em outros pontos detalhados abaixo" : ""}`
  const attentionPhrase = development.length === 1 ? "um ponto de atenção" : "pontos de atenção"
  const introduction = [
    `Analisei ${subjectPhrase(context.label)}.`,
    done && topicsPhrase ? `Você conduziu bem ${done} e identifiquei ${attentionPhrase} em ${topicsPhrase}.` : done ? `Você conduziu bem ${done}.` : topicsPhrase ? `Identifiquei ${attentionPhrase} em ${topicsPhrase}.` : null,
    ...(attention.length > 0 ? ["Há também um ponto em que não foi possível confirmar o produto tratado."] : []),
    "Abaixo estão as evidências da chamada, o que o procedimento orienta e como aplicar nas próximas chamadas.",
  ].filter((sentence): sentence is string => Boolean(sentence)).join(" ")
  const focus = topics.length === 0 ? null : `Para as próximas chamadas, o foco é ${quoted(topics[0]!)}${topics[1] ? ` e, depois, ${quoted(topics[1])}` : ""}.`
  const closing = [
    ...(done ? [`No geral, você conduziu bem ${done}.`] : []),
    ...(focus ? [focus] : done ? ["Continue aplicando o procedimento nos próximos atendimentos."] : []),
    ...(attention.length > 0 ? ["Quando o procedimento muda conforme o produto, vale confirmar o produto antes de seguir."] : []),
  ].join(" ")
  return { introduction, closing: closing || "Os detalhes estão acima." }
}

/** A apresentação FINAL de uma emissão: a do redator se passar na validação contra os itens emitidos; senão a do sistema. */
export function resolvePresentation(stored: StoredPresentation | null | undefined, items: readonly EmittedItem[], context: PresentationContext, options: { legacy?: boolean; supervisorV172?: boolean } = {}): FeedbackPresentation {
  const greeting = greetingOf(context.firstName)
  // FEEDBACK POR FLAG V2 — monitoria de PROCESSO: narrativa de supervisor (redator validado campo a campo, senão a versão do
  // sistema) + card; a composição V1.7.2 fica só para comparação (`supervisorV172`).
  if (!options.legacy && !options.supervisorV172 && context.domain === "MONITORING" && isProcessFeedback(items)) {
    const narrative = resolveNarrative(stored?.narrative ?? null, items, context)
    return { version: NATURAL_FEEDBACK_VERSION, greeting, introduction: narrative.paragraphs.join("\n\n"), closing: "", source: narrative.source.narrative, violations: [...narrative.violations.narrative, ...narrative.violations.card], card: narrative.card, narrative: narrative.paragraphs, firstName: context.firstName, narrativeResolution: { source: narrative.source, violations: narrative.violations, ...(narrative.factualityRejected ? { factualityRejected: narrative.factualityRejected } : {}), ...(narrative.factualityRepaired ? { factualityRepaired: narrative.factualityRepaired } : {}) } }
  }
  // V1.7.2 — monitoria de PROCESSO: abertura/fechamento/card de supervisor, compostos só dos itens que saem (o rascunho do
  // redator V6 continua guardado no artefato para auditoria, mas fala em contagens — não é mais a abertura exibida).
  if (!options.legacy && context.domain === "MONITORING" && isProcessFeedback(items)) {
    const supervisor = supervisorPresentationOf(items, context.label)
    return { version: SUPERVISOR_PRESENTATION_VERSION, greeting, introduction: supervisor.introduction, closing: supervisor.closing, source: "SYSTEM", violations: [], card: supervisor.card }
  }
  const draft = stored?.writerDraft ?? null
  const violations = draft ? presentationViolations(draft, items, context) : []
  if (draft && violations.length === 0) return { version: FEEDBACK_PRESENTATION_VERSION, greeting, introduction: draft.introduction.trim(), closing: draft.closing.trim(), source: "WRITER", violations: [] }
  const system = systemPresentation(items, context)
  return { version: FEEDBACK_PRESENTATION_VERSION, greeting, introduction: system.introduction, closing: system.closing, source: "SYSTEM", violations }
}
