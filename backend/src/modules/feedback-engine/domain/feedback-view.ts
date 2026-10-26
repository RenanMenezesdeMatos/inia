import { materialsOf, verifiedStatementOf, type ArgumentRequirement, type BriefFinding, type BriefQuote, type BriefRule, type BriefStep, type BriefSubjects, type ComposedSentence, type FeedbackBrief, type OfficialTableRow } from "./feedback-brief.js"
import type { HeadingSubjectSource } from "../../feedbacks/domain/feedback-heading.js"
import { feedbackGreetingNameOf } from "../../profile-preferences/domain/person-presentation.js"
import type { FeedbackBestPractices } from "../../best-practices/domain/feedback-section.js"
import { phrasingProductOf } from "./product-applicability.js"

/**
 * VIEW MODEL do Acompanhamento (`FEEDBACK_VIEW_V1` — o MESMO contrato que a tela já renderiza): narrativa + card na camada 1,
 * detalhes sob demanda na camada 2 (o que aconteceu, a fala ou a ausência verificada, o que o procedimento orienta, de qual
 * documento/seção, como aplicar; o que manter; materiais). Derivado do brief e das frases aprovadas — nunca uma segunda verdade,
 * nunca dado técnico (status, códigos, refs). Links de material são resolvidos na LEITURA, para quem lê.
 * Contrato de confiança: os detalhes mostram só FATOS (fala literal, ausência verificada, regra literal, fonte, números) e a
 * leitura da análise APROVADA pelo verificador ("como aplicar", "por que importa"). Nunca a justificativa ou a orientação não
 * conferidas, e nunca repetem a narrativa (a narrativa já disse o ajuste; os detalhes são a prova).
 */
export const FEEDBACK_VIEW_VERSION = "FEEDBACK_VIEW_V1" as const

/** `product` (`PRODUCT_IN_FEEDBACK_V1`): o produto da solicitação da chamada de onde a fala de exemplo veio (indicador). */
export type FeedbackViewQuote = { speaker: "OPERATOR" | "CUSTOMER" | "OTHER"; intro: string; text: string; truncated: boolean; product?: string | null }
export type FeedbackViewSource = { documentId: string; documentTitle: string; section: string | null; href: string | null; accessible?: boolean }
export type FeedbackViewCall = { kind: "QUOTES"; quotes: FeedbackViewQuote[] } | { kind: "ABSENCE"; statement: string; verified: boolean; context: FeedbackViewQuote | null } | { kind: "NONE" }
export type FeedbackViewDevelopment = {
  key: string
  title: string
  whatHappened: string
  call: FeedbackViewCall
  adjustment: string[]
  /** `label`: rótulo pronto da origem ("Seção “…”" ou "Argumentário “…”"); ausente em views antigas (a tela monta pela seção).
   * `requirement` (`ARGUMENT_REQUIREMENT_V1`): item de argumentário obrigatório ("deve" ou ponto obrigatório na fala) ou opcional ("pode"). */
  guidance: { rules: { text: string; section: string | null; label?: string; requirement?: ArgumentRequirement; /** `PRODUCT_IN_FEEDBACK_V1`: "Vale para". */ appliesTo?: string[] }[]; avoid: string[]; examples: string[] }
  sources: FeedbackViewSource[]
  whyItMatters: string[]
  howToApply: string | null
  suggestedResponse: string | null
  /** `OFFICIAL_PHRASING_V1`: a sugestão é a fraseologia OFICIAL do argumentário (texto da operação, como está), não um exemplo do redator. */
  suggestedResponseSource?: { kind: "ARGUMENT_SCRIPT"; name: string }
  /** `PRODUCT_IN_FEEDBACK_V1`: o produto do pedido a que o ponto pertence (monitoria) e o da fala do argumentário mostrada. */
  product?: string | null
  suggestedResponseProduct?: string | null
  itemIndexes: number[]
  consolidates?: string[]
}
/** `INDICATOR_SUBJECTS_V1` — os assuntos da pessoa nos dois períodos (texto pronto do sistema; a tela só exibe). */
export type FeedbackViewSubjectRow = { label: string; previous: string | null; current: string | null; change: string | null; trend: "WORSE" | "BETTER" | "STABLE" | "NOT_COMPARED"; reading: string; focus: boolean; analyzed: string | null }
export type FeedbackViewSubjects = { title: string; note: string; periods: { previous: string; current: string }; rows: FeedbackViewSubjectRow[]; hidden: number }
export type FeedbackView = {
  version: typeof FEEDBACK_VIEW_VERSION
  heading?: { title: string; subtitle: string | null; subjectSource?: HeadingSubjectSource }
  card: string
  greeting: string | null
  narrative: string[]
  developments: FeedbackViewDevelopment[]
  /** `optional` (`ARGUMENT_REQUIREMENT_V1`): tudo o que o ponto cumpriu é orientação "pode" de argumentário — iniciativa, não obrigação. */
  maintain: { summary: string; evidence: { title: string; statement: string; quotes: FeedbackViewQuote[]; itemIndex: number; optional?: true }[] } | null
  attention: { title: string; markdown: string; itemIndex: number }[]
  materials: { documentId: string; title: string; href: string | null; usedIn: string[]; sections?: string[]; accessible?: boolean }[]
  context: string | null
  kind?: "MONITORING" | "INDICATOR"
  sectionLabels?: { developments?: string; call?: string; maintain?: string; detailsHint?: string }
  cycle?: { title: string; indicators: { name: string; lines: { label: string; value: string }[]; notes: string[] }[] } | null
  subjects?: FeedbackViewSubjects | null
  /** Base de boas práticas (`BEST_PRACTICE_FEEDBACK_V1`–`V3`): oportunidades OPCIONAIS montadas pelo sistema, separadas do processo; o texto
   * pode citá-las desde a V3 (`citedInText`). */
  bestPractices?: FeedbackBestPractices | null
  /**
   * `PRODUCT_APPLICABILITY_V1` — o que a análise da GRAVAÇÃO estabeleceu sobre o produto (nomes do cadastro) e as regras que ficaram sem
   * avaliação por depender dele. Dado para a conversa sobre o feedback (a sessão pode perguntar o produto e orientar a partir da resposta,
   * sem atribuí-la à gravação); a tela não mostra.
   */
  product?: { identified: string[]; undetermined: boolean; pendingPoints: string[]; byProduct?: { products: string[]; rules: string[] }[] } | null
}

/**
 * `PRODUCT_APPLICABILITY_V2` — "Depende do produto" (em "Vale confirmar"): o produto não ficou claro, então o que cada produto possível
 * pede aparece com o texto LITERAL da fonte, montado pelo sistema — sem avaliação (nem erro, nem acerto) e sem passar pelo redator.
 */
export function productDependentMarkdownOf(groups: readonly { products: readonly string[]; rules: readonly { text: string; leadIn?: string | null }[] }[]): string | null {
  if (groups.length === 0) return null
  const lines = ["**Depende do produto**", "", "A chamada não deixou claro qual era o produto do cliente, então estes pontos não foram avaliados — não contam como erro nem como acerto. O que o procedimento de cada produto pede:"]
  // Só o marcador de lista da linha da fonte sai (formatação); as palavras da regra ficam como estão.
  const literal = (text: string) => text.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, "")
  for (const group of groups) lines.push("", `**${group.products.join(" e ")}**`, ...group.rules.map((rule) => `- “${rule.leadIn ? `${rule.leadIn} ${literal(rule.text)}` : literal(rule.text)}”`))
  return lines.join("\n")
}

const QUOTE_MAX = 280
const INTRO: Record<BriefQuote["speaker"], string> = { OPERATOR: "Você disse", CUSTOMER: "O cliente disse", OTHER: "Na chamada" }
export function viewQuoteOf(quote: BriefQuote): FeedbackViewQuote {
  const truncated = quote.text.length > QUOTE_MAX
  return { speaker: quote.speaker, intro: INTRO[quote.speaker], text: truncated ? `${quote.text.slice(0, QUOTE_MAX).trimEnd()}` : quote.text, truncated, ...(quote.call?.product ? { product: quote.call.product } : {}) }
}

const ABSENCE_STATEMENT = "Não há fala desta etapa na conversa (confirmado na transcrição inteira)."
/**
 * O que o procedimento orienta, por ORIGEM (`RULE_SOURCES_V1`): regras com o rótulo da fonte; o item "evitar" do argumentário vai em
 * `avoid` (nunca como orientação). Regra de argumentário não é documento da base — nunca vira link de material "indisponível".
 */
/** Reconhecimento só de orientação "pode": todas as regras (fora o "evitar") são itens opcionais de argumentário. */
const onlyOptional = (rules: readonly BriefRule[]) => {
  const guidance = rules.filter((rule) => !rule.avoid)
  return guidance.length > 0 && guidance.every((rule) => rule.sourceKind === "ARGUMENT_SCRIPT" && rule.requirement === "OPTIONAL")
}
function guidanceOf(rules: readonly BriefRule[]): FeedbackViewDevelopment["guidance"] {
  return {
    rules: rules.filter((rule) => !rule.avoid).map((rule) => {
      const argument = rule.sourceKind === "ARGUMENT_SCRIPT"
      const section = argument ? rule.documentTitle : rule.section
      return { text: rule.leadIn ? `${rule.leadIn}\n${rule.text}` : rule.text, section, ...((rule.appliesTo ?? []).length > 0 ? { appliesTo: rule.appliesTo! } : {}), ...(argument ? { label: `Argumentário “${rule.argumentName ?? rule.documentTitle.replace(/^Argumentário:\s*/u, "")}”` } : section ? { label: `Seção “${section}”` } : {}), ...(argument && rule.requirement ? { requirement: rule.requirement } : {}) }
    }),
    avoid: rules.filter((rule) => rule.avoid).map((rule) => rule.text),
    examples: [],
  }
}
/**
 * `OFFICIAL_PHRASING_V1` + `LITERAL_QUOTES_V1`: os detalhes mostram a fraseologia que o ARGUMENTÁRIO de origem define para o ponto —
 * texto oficial da operação, exibido exatamente como está (lacunas "[…]" incluídas: o operador completa com os dados da chamada) e
 * identificado como tal. Nunca a adaptação de um redator. Fraseologia com número que parece protocolo/documento fica de fora (o número
 * do exemplo da operação seria lido como o deste cliente).
 */
function officialPhrasingOf(rules: readonly BriefRule[], shown: Set<string>, candidates: readonly { rule: BriefRule; product: string | null }[] = []): { text: string; name: string; product: string | null } | null {
  // `PRODUCT_IN_FEEDBACK_V1`: num padrão do indicador a fala vem das chamadas de exemplo, cada uma com o produto dela.
  for (const { rule, product } of [...rules.map((rule) => ({ rule, product: null })), ...candidates]) {
    const phrasing = rule.phrasing
    if (!phrasing || shown.has(phrasing.text)) continue
    const identifier = [...phrasing.text.matchAll(/\d(?:[\d.\- ]*\d)?/gu)].some((match) => match[0].replace(/\D/gu, "").length >= 8)
    if (identifier) continue
    shown.add(phrasing.text)
    return { text: phrasing.text, name: phrasing.scriptName, product: phrasingProductOf(rule.appliesTo, product) }
  }
  return null
}
/** `LITERAL_QUOTES_V1`: "como dizer" é só a fraseologia do argumentário, exatamente como está cadastrada, com o nome dele. */
const withSuggestion = (official: { text: string; name: string; product?: string | null } | null): Pick<FeedbackViewDevelopment, "suggestedResponse" | "suggestedResponseSource" | "suggestedResponseProduct"> =>
  official ? { suggestedResponse: official.text, suggestedResponseSource: { kind: "ARGUMENT_SCRIPT", name: official.name }, ...(official.product ? { suggestedResponseProduct: official.product } : {}) } : { suggestedResponse: null }
const sourcesOf = (rules: readonly BriefRule[]): FeedbackViewSource[] => [...new Map(rules.filter((rule) => rule.sourceKind !== "ARGUMENT_SCRIPT").map((rule) => [`${rule.documentId}|${rule.section ?? ""}`, { documentId: rule.documentId, documentTitle: rule.documentTitle, section: rule.section, href: null }])).values()]

function developmentOf(finding: BriefFinding, index: number): FeedbackViewDevelopment {
  const call: FeedbackViewCall = finding.absence
    ? { kind: "ABSENCE", statement: ABSENCE_STATEMENT, verified: true, context: finding.absence.opportunity ? viewQuoteOf(finding.absence.opportunity) : null }
    : finding.quotes.length > 0
      ? { kind: "QUOTES", quotes: finding.quotes.map(viewQuoteOf) }
      : { kind: "NONE" }
  return {
    key: finding.findingKey,
    title: finding.title,
    // "O que aconteceu" só quando não há fala nem ausência a mostrar — e sempre a afirmação do SISTEMA (status verificado/números).
    whatHappened: call.kind === "NONE" ? finding.observed : "",
    call,
    adjustment: [],
    guidance: guidanceOf(finding.rules),
    sources: sourcesOf(finding.rules),
    whyItMatters: [],
    // `LITERAL_QUOTES_V1`: "como aplicar" era a orientação escrita pela análise — dedução que a regra não traz. Os detalhes mostram só a
    // regra literal ("O processo orienta"), as falas da chamada e a fraseologia do argumentário.
    howToApply: null,
    ...withSuggestion(officialPhrasingOf(finding.rules, new Set(), finding.quotes.flatMap((quote) => (quote.call ? [{ rule: quote.call.rule, product: quote.call.product }] : [])))),
    ...(finding.product ? { product: finding.product } : {}),
    itemIndexes: [index],
    ...(finding.stats.length > 0 || finding.history ? { consolidates: [...finding.stats, ...(finding.history ? [finding.history] : [])] } : {}),
  }
}

/**
 * Ponto que junta várias etapas (`STEP_DETAILS_V1`): cada etapa aparece com a PRÓPRIA prova — a fala dela ou a ausência confirmada, e
 * as regras dela. Antes os detalhes mostravam só as duas primeiras falas do ponto e as regras de todas as etapas juntas: uma etapa que
 * faltou (a recapitulação) não aparecia em lugar nenhum.
 */
function stepDevelopmentsOf(finding: BriefFinding, steps: readonly BriefStep[], index: number): FeedbackViewDevelopment[] {
  // A mesma fraseologia (etapas do mesmo argumentário) aparece uma vez só no ponto.
  const shown = new Set<string>()
  return steps.map((step, position) => {
    const rules = step.rules ?? (step.rule ? [step.rule] : [])
    const call: FeedbackViewCall = step.absentInCall ? { kind: "ABSENCE", statement: ABSENCE_STATEMENT, verified: true, context: null } : step.quotes.length > 0 ? { kind: "QUOTES", quotes: step.quotes.map(viewQuoteOf) } : { kind: "NONE" }
    return {
      key: step.findingKey ?? `${finding.findingKey}#${position + 1}`,
      title: step.title,
      whatHappened: call.kind === "NONE" ? verifiedStatementOf({ kind: "DEVELOPMENT", status: step.status, omission: step.absentInCall, declaredOnly: step.declaredOnly }) : "",
      call,
      adjustment: [],
      guidance: guidanceOf(rules),
      sources: sourcesOf(rules),
      whyItMatters: [],
      howToApply: null,
      ...withSuggestion(officialPhrasingOf(rules, shown)),
      itemIndexes: [index],
      ...(position === 0 && (finding.stats.length > 0 || finding.history) ? { consolidates: [...finding.stats, ...(finding.history ? [finding.history] : [])] } : {}),
    }
  })
}

const SUBJECT_ROWS_SHOWN = 8
const decimal = (value: number, digits: number) => value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits })
const durationText = (seconds: number) => {
  const total = Math.round(Math.abs(seconds))
  const minutes = Math.floor(total / 60)
  return minutes > 0 ? `${minutes} min ${total % 60} s` : `${total} s`
}
const callsText = (calls: number) => `${calls} ${calls === 1 ? "chamada" : "chamadas"}`
const MEASURE: Record<BriefSubjects["proxyKind"], string> = {
  DURATION_SECONDS: "Duração média registrada das suas chamadas gravadas em cada assunto",
  SIGNAL_RATE: "Parte das suas chamadas gravadas de cada assunto marcada com o sinal do indicador",
  VOLUME: "Quantidade das suas chamadas gravadas em cada assunto",
}
const TREND_READING: Record<"WORSE" | "BETTER" | "STABLE", string> = { WORSE: "Piorou", BETTER: "Melhorou", STABLE: "Estável" }

/**
 * `INDICATOR_SUBJECTS_V1`: os assuntos como a investigação os mediu, em texto pronto. Variação só quando o assunto tinha chamadas
 * suficientes nos DOIS períodos (a mesma regra que decidiu onde investigar); senão diz por que não compara. Números do sistema.
 */
export function subjectsViewOf(subjects: BriefSubjects | null | undefined): FeedbackViewSubjects | null {
  if (!subjects || subjects.rows.length === 0) return null
  const kind = subjects.proxyKind
  const valueText = (side: { value: number; calls: number } | null) => {
    if (!side) return null
    if (kind === "VOLUME") return callsText(side.calls)
    return `${kind === "DURATION_SECONDS" ? durationText(side.value) : `${decimal(side.value * 100, 1)}%`} · ${callsText(side.calls)}`
  }
  const changeText = (row: BriefSubjects["rows"][number]) => {
    if (!row.comparable || !row.previous || !row.current) return null
    const diff = row.current.value - row.previous.value
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : ""
    if (kind === "SIGNAL_RATE") return `${sign}${decimal(Math.abs(diff) * 100, 1)} p.p.`
    if (kind === "VOLUME") return `${sign}${callsText(Math.abs(row.current.calls - row.previous.calls))}`
    const relative = row.previous.value !== 0 ? ` (${sign}${decimal(Math.abs(diff / row.previous.value) * 100, 1)}%)` : ""
    return `${sign}${durationText(diff)}${relative}`
  }
  const rows = subjects.rows.slice(0, SUBJECT_ROWS_SHOWN).map((row): FeedbackViewSubjectRow => {
    const compared = row.comparable && row.direction !== "UNKNOWN"
    const reading = compared
      ? TREND_READING[row.direction as "WORSE" | "BETTER" | "STABLE"]
      : !row.previous ? `Sem chamadas em ${subjects.previousLabel}` : !row.current ? `Sem chamadas em ${subjects.currentLabel}` : "Poucas chamadas para comparar"
    return {
      label: row.label,
      previous: valueText(row.previous),
      current: valueText(row.current),
      change: changeText(row),
      trend: compared ? (row.direction as "WORSE" | "BETTER" | "STABLE") : "NOT_COMPARED",
      reading,
      focus: row.focus,
      analyzed: row.analyzed && row.analyzed.universe > 0 ? `${row.analyzed.calls} de ${callsText(row.analyzed.universe)}` : null,
    }
  })
  const description = subjects.description.trim().replace(/[.]+$/, "")
  return {
    title: "Seus assuntos no período",
    note: `${MEASURE[kind]} — ${description}. Um assunto só é comparado quando tem chamadas suficientes nos dois períodos.`,
    periods: { previous: subjects.previousLabel, current: subjects.currentLabel },
    rows,
    hidden: Math.max(0, subjects.rows.length - SUBJECT_ROWS_SHOWN),
  }
}

/**
 * `OFFICIAL_RESULT_TABLE_V1`: o resultado oficial em tabela, no TEXTO do retorno de indicador (logo depois do primeiro parágrafo) —
 * montada pelo sistema com os números do fechamento (nunca do redator). Um indicador = tabela vertical de 2 colunas (cabe no celular);
 * vários (fechamento) = uma linha por indicador. A voz não lê a tabela (o texto já diz os números).
 */
const cell = (text: string) => text.replace(/\|/gu, "/").replace(/\s+/gu, " ").trim()
const capitalized = (text: string) => text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1)
const targetCell = (row: OfficialTableRow) => (row.target === null ? "—" : `${row.target}${row.withinTarget === null ? "" : row.withinTarget ? " · dentro da meta" : " · fora da meta"}`)
export function officialTableMarkdownOf(rows: readonly OfficialTableRow[] | null | undefined): string | null {
  if (!rows || rows.length === 0) return null
  if (rows.length === 1) {
    const row = rows[0]!
    return [
      `| | ${cell(row.indicator)} |`,
      "|---|---|",
      `| ${cell(capitalized(row.periodLabel))} (resultado oficial) | ${cell(row.result)} |`,
      `| Meta | ${cell(targetCell(row))} |`,
      ...(row.previous && row.previousLabel ? [`| ${cell(capitalized(row.previousLabel))} | ${cell(row.previous)} |`] : []),
    ].join("\n")
  }
  return [
    "| Indicador | Resultado oficial | Meta | Período anterior |",
    "|---|---|---|---|",
    ...rows.map((row) => `| ${cell(row.indicator)} | ${cell(`${row.result} (${row.periodLabel})`)} | ${cell(targetCell(row))} | ${cell(row.previous && row.previousLabel ? `${row.previous} (${row.previousLabel})` : "—")} |`),
  ].join("\n")
}
/** Bloco da narrativa que é uma tabela markdown (toda linha começa com "|") — a voz não lê. */
export const isMarkdownTableBlock = (paragraph: string) => paragraph.trim().length > 0 && paragraph.trim().split("\n").every((line) => line.trim().startsWith("|"))

/** Pontos que os detalhes mostram: os ajustes que a mensagem comunicou e os acertos confirmados. */
function shownFindingsOf(brief: FeedbackBrief, communicatedRefs: readonly string[] | undefined) {
  const communicated = new Set(communicatedRefs ?? [...brief.developments, ...brief.strengths].map((finding) => finding.ref))
  const developmentsShown = brief.developments.filter((finding) => communicated.has(finding.ref))
  // `ALL_STRENGTHS_SHOWN_V1`: todo acerto confirmado aparece em "O que manter" (fala exata + afirmação do sistema), mesmo que o texto não o
  // cite — o texto reconhece só o que fez diferença; o acerto de rotina não some da tela. Etapa só declarada continua só se o texto a citou.
  const strengthsShown = brief.strengths.filter((finding) => communicated.has(finding.ref) || !finding.declaredOnly)
  return { communicated, developmentsShown, strengthsShown }
}

/**
 * "Materiais utilizados" da view. Com ponto a ajustar: os documentos que sustentam os ajustes comunicados. `RECOGNITION_MATERIALS_V1`:
 * retorno sem ponto a ajustar mostra os documentos da base que sustentam os acertos confirmados (argumentário não é documento). Só a view
 * muda: o material RECOMENDADO (`brief.materials`, gravado para a liderança) continua sendo só o dos ajustes. Também usado para
 * reprojetar os feedbacks já publicados (`reproject-feedback-materials.ts`).
 */
export function viewMaterialsOf(brief: FeedbackBrief, communicatedRefs?: readonly string[]): FeedbackView["materials"] {
  const { developmentsShown, strengthsShown } = shownFindingsOf(brief, communicatedRefs)
  if (brief.developments.length > 0) return brief.materials.filter((material) => developmentsShown.some((finding) => finding.criterionKeys.some((key) => material.criterionKeys.includes(key)))).map((material) => ({ documentId: material.documentId, title: material.title, href: null, usedIn: material.usedIn.filter((title) => developmentsShown.some((finding) => finding.title === title)), sections: material.sections }))
  return materialsOf(strengthsShown, new Map()).map((material) => ({ documentId: material.documentId, title: material.title, href: null, usedIn: material.usedIn, sections: material.sections }))
}

/**
 * Os detalhes mostram a PROVA só dos pontos que a mensagem comunicou (`communicatedRefs`): um ponto que a narrativa não
 * mencionou não aparece "de surpresa" nos detalhes nem é marcado como entregue — continua na memória.
 */
export function feedbackViewOf(brief: FeedbackBrief, message: { card: string; paragraphs: string[]; sentences: readonly ComposedSentence[]; communicatedRefs?: readonly string[] }): FeedbackView {
  const { communicated, developmentsShown, strengthsShown } = shownFindingsOf(brief, message.communicatedRefs)
  const developments = developmentsShown.flatMap((finding, index) => ((finding.steps ?? []).length > 1 ? stepDevelopmentsOf(finding, finding.steps!, index) : [developmentOf(finding, index)]))
  const maintain = strengthsShown.length > 0
    ? {
        // Sem resumo: a narrativa já reconheceu; aqui fica a PROVA (a fala e o fato do sistema), não uma repetição nem o "por que importa"
        // escrito pela análise (`LITERAL_QUOTES_V1`: leitura de modelo não vai para os detalhes).
        summary: "",
        evidence: strengthsShown.map((finding, index) => ({ title: finding.title, statement: finding.observed, quotes: finding.quotes.map(viewQuoteOf), itemIndex: developmentsShown.length + index, ...(onlyOptional(finding.rules) ? { optional: true as const } : {}) })),
      }
    : null
  // Detalhes para o COLABORADOR: só o que ajuda a entender o retorno (procedimento publicado depois da chamada, transcrição parcial) e
  // os pontos em aberto que a mensagem comunicou — nunca as notas técnicas da revisão ("não confirmado", contagens de recusas).
  // Brief sem `readerNotes` (gerado antes da V4) = nenhuma nota (as limitações dele misturavam notas técnicas).
  const readerNotes = brief.readerNotes ?? []
  const openShown = (brief.openPoints ?? []).filter((point) => communicated.has(point.ref))
  const attention = [
    ...(readerNotes.length > 0 ? [{ title: "Para entender este retorno", markdown: readerNotes.map((note) => `- ${note}`).join("\n"), itemIndex: developmentsShown.length + strengthsShown.length }] : []),
    ...openShown.map((point, index) => ({ title: point.title, markdown: [point.why, ...point.rules.map((rule) => `O procedimento: “${rule.leadIn ? `${rule.leadIn} ${rule.text}` : rule.text}”`)].join("\n\n"), itemIndex: developmentsShown.length + strengthsShown.length + 1 + index })),
  ]
  const productDependent = productDependentMarkdownOf(brief.productScope?.byProduct ?? [])
  if (productDependent) attention.push({ title: "Depende do produto", markdown: productDependent, itemIndex: developmentsShown.length + strengthsShown.length + 1 + openShown.length })
  return {
    version: FEEDBACK_VIEW_VERSION,
    heading: brief.heading,
    card: message.card,
    greeting: null,
    narrative: withOfficialTable(message.paragraphs, brief.domain === "INDICATOR" ? officialTableMarkdownOf(brief.officialTable) : null),
    developments,
    maintain,
    attention,
    materials: viewMaterialsOf(brief, message.communicatedRefs),
    context: null,
    kind: brief.domain,
    ...(brief.productScope && (brief.productScope.undetermined > 0 || brief.productScope.identified.length > 0)
      ? { product: { identified: brief.productScope.identified.map((entry) => entry.name), undetermined: brief.productScope.undetermined > 0, pendingPoints: brief.productScope.rulesNotEstablished.map((rule) => (rule.text.length > 160 ? `${rule.text.slice(0, 157).trimEnd()}…` : rule.text)).slice(0, 6), ...(brief.productScope.byProduct ? { byProduct: brief.productScope.byProduct.map((group) => ({ products: group.products, rules: group.rules.map((rule) => rule.text) })) } : {}) } }
      : {}),
    ...(brief.domain === "INDICATOR"
      ? {
          sectionLabels: { developments: "O que ajustar", call: "Nas chamadas analisadas", maintain: "O que manter", detailsHint: "Entenda como chegamos a esta análise" },
          cycle: brief.officialLines.length > 0 ? { title: "Resultado oficial", indicators: [{ name: brief.indicatorName ?? brief.label, lines: brief.officialLines, notes: [] }] } : null,
          subjects: subjectsViewOf(brief.subjects),
        }
      : {}),
  }
}

/**
 * Texto plano da mensagem (campo `recommendation` do feedback, chat/avatar, auditoria) = a NARRATIVA escrita e verificada. Nada é
 * anexado pelo sistema (regra literal, "o procedimento orienta", lista de materiais): a prova fica nos detalhes estruturados.
 */
/** A tabela entra depois do primeiro parágrafo (o que diz o resultado); sem parágrafo, no começo. */
const withOfficialTable = (paragraphs: readonly string[], table: string | null): string[] => (table ? [...paragraphs.slice(0, 1), table, ...paragraphs.slice(1)] : [...paragraphs])

export function plainTextOf(view: FeedbackView): string {
  return view.narrative.join("\n\n").trim()
}

/**
 * SAUDAÇÃO (`FEEDBACK_GREETING_V1`) — montada pelo SISTEMA na entrega, nunca pelo redator: o nome nunca vai ao modelo e a mensagem
 * verificada não muda. Só o PRIMEIRO nome do tratamento (o nome escolhido no perfil, senão o do cadastro —
 * `profile-preferences › feedbackGreetingNameOf`); sem nome, só "Olá!". Vale para o Acompanhamento e para a projeção em Chat/Avatar.
 */
export const FEEDBACK_GREETING_VERSION = "FEEDBACK_GREETING_V1" as const
export const greetingOf = (addressName: string | null | undefined): string => {
  const firstName = feedbackGreetingNameOf(addressName)
  return firstName ? `Olá, ${firstName}!` : "Olá!"
}
export const withRecipientGreeting = (view: FeedbackView, addressName: string | null | undefined): FeedbackView => ({ ...view, greeting: greetingOf(addressName) })
