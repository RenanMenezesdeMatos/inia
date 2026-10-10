import type { FeedbackView } from "../../reliable-feedback/domain/feedback-view.js"
import type { FeedbackSourceRef } from "./feedback-application.js"

/**
 * CONTEXTO HISTÓRICO de uma aplicação de feedback — cópia do REGISTRO PUBLICADO, nunca dado atual.
 *
 * Um feedback antigo é explicado com base no que sustentou a sua publicação: o conteúdo publicado e a versão, o assunto, a
 * data de publicação e o período avaliado, os indicadores/valores/metas que ESTÃO no registro, o atendimento ou caso, as
 * evidências e o comportamento observado, as orientações e os materiais. Tudo aqui sai do registro gravado na publicação
 * (`feedbacks` + `context_snapshot`, ou a entrega imutável do feedback de atendimento). Nenhum indicador, meta ou medição atual
 * é consultado — e o que o registro não guarda vira LIMITAÇÃO declarada (a IA diz que não foi registrado, nunca reconstrói).
 *
 * A cópia é feita uma vez, na primeira aplicação, e congelada: retomadas, voz e perguntas posteriores usam a mesma versão.
 * Ela NÃO é "um snapshot criado agora": cada campo diz de onde veio, e o que entra no modelo é apresentado como "registro
 * publicado em <data>".
 */
export const HISTORICAL_CONTEXT_VERSION = "FEEDBACK_APPLICATION_CONTEXT_V1" as const

export type HistoricalIndicator = { name: string; lines: { label: string; value: string }[]; notes: string[] }
export type HistoricalMaterial = { documentId: string; title: string; sections: string[]; reason: string | null }

export type FeedbackHistoricalContext = {
  version: typeof HISTORICAL_CONTEXT_VERSION
  /** Instante da cópia (auditoria) — nunca apresentado como data do feedback. */
  capturedAt: string
  provenance: "PUBLISHED_RECORD" | "DELIVERED_RECORD"
  source: FeedbackSourceRef & { version: number | null }
  domain: "MONITORING" | "INDICATOR" | "INTERACTION"
  /** Assunto como registrado (título do feedback/atendimento). */
  subject: string
  /** Rótulo do período/atendimento avaliado como registrado ("Agosto de 2026", "Atendimento de 14/09/2026"); null = não registrado. */
  periodLabel: string | null
  /** Datas do período quando o registro as guarda (só leitura do registro). */
  period: { start: string; end: string } | null
  publishedAt: string
  /** Texto publicado (Markdown já mascarado — o mesmo que o colaborador vê no Acompanhamento). */
  publishedText: string
  /** Resumo curto publicado (card). */
  summary: string | null
  indicators: HistoricalIndicator[]
  interaction: { id: string | null; label: string | null } | null
  supervisionCase: { id: string; title: string } | null
  /** Evidências/comportamento observado como publicados (falas já mascaradas, ausências verificadas, fatos registrados). */
  evidence: string[]
  /** Orientações/procedimentos como publicados (regras literais citadas, "como aplicar" validado, recomendação). */
  guidance: string[]
  /** Pontos fortes registrados (reconhecimento só existe se estiver aqui). */
  strengths: string[]
  materials: HistoricalMaterial[]
  /** O que o registro não guarda — a IA declara a limitação em vez de completar. */
  limitations: string[]
}

/** Registro de um feedback PUBLICADO (linha de `feedbacks` + caso + materiais), exatamente como gravado. */
export type PublishedFeedbackRecord = {
  feedbackId: string
  version: number
  kind: "MONITORING" | "INDICATOR"
  publishedAt: Date
  impactedIndicator: string
  evidenceFound: string
  observedBehavior: string
  relatedProcedure: string
  recommendation: string
  suggestedApproach: string | null
  caseId: string | null
  caseTitle: string | null
  caseSummary: string | null
  /** `context_snapshot` gravado na publicação. */
  snapshot: Record<string, unknown>
  /** feedback_support_materials (título do documento como está hoje — sinalizado se não houver título registrado). */
  supportMaterials: { documentId: string; title: string; reason: string }[]
}

/** Feedback de atendimento ENTREGUE (projeção do colaborador já mascarada; texto vem da origem imutável da entrega). */
export type DeliveredFeedbackRecord = {
  deliveryId: string
  title: string
  sectionLabel: string
  section: "STRENGTH" | "OPPORTUNITY"
  interactionLabel: string
  interactionAt: string | null
  deliveredAt: string
  blocks: { key: string; label: string; text: string }[]
  evidence: { speakerLabel: string; text: string; truncated: boolean }[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const clean = (value: unknown): string => (typeof value === "string" ? value.trim() : "")
const unique = (values: readonly string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))]

/**
 * ASSUNTO do feedback como registrado — a identidade, nunca o "quando" ("Atendimento de 29/09/2026") nem o rótulo genérico do
 * caso ("Feedback de atendimento", constante da publicação confiável). Sem assunto registrado, o tipo do feedback.
 */
const isWhenLabel = (value: string) => /^atendimento de /i.test(value)
const GENERIC_CASE_TITLES = new Set(["feedback de atendimento"])
/** Rótulos registrados podem juntar o "quando" e o assunto ("Atendimento de 25/09/2026 · Contestação de cobrança"). */
function splitRegisteredLabel(value: string | null | undefined): { subject: string | null; when: string | null } {
  const parts = clean(value).split(" · ").map((part) => part.trim()).filter(Boolean)
  return { when: parts.find(isWhenLabel) ?? null, subject: parts.filter((part) => !isWhenLabel(part)).join(" · ") || null }
}
type SubjectInput = { kind: "MONITORING" | "INDICATOR"; headingTitle: string | null | undefined; impactedIndicator: string | null | undefined; caseTitle: string | null | undefined }
export function registeredSubjectOf(input: SubjectInput): string {
  const candidates = [input.headingTitle, input.impactedIndicator, input.caseTitle].map((value) => splitRegisteredLabel(value).subject)
  return candidates.find((value): value is string => Boolean(value) && !GENERIC_CASE_TITLES.has(value!.toLocaleLowerCase("pt-BR"))) ?? (input.kind === "INDICATOR" ? "Resultado do indicador" : "Monitoria do atendimento")
}
/** O "quando" registrado junto do assunto (ex.: "Atendimento de 25/09/2026"), quando existe. */
export function registeredWhenOf(input: SubjectInput): string | null {
  return [input.headingTitle, input.impactedIndicator, input.caseTitle].map((value) => splitRegisteredLabel(value).when).find((value): value is string => Boolean(value)) ?? null
}

/** View model publicado (feedback confiável V2 ou motor de feedback) — mesma coalescência da leitura do Acompanhamento. */
export function publishedViewOf(snapshot: Record<string, unknown>): FeedbackView | null {
  const engine = isRecord(snapshot.feedbackEngine) ? snapshot.feedbackEngine.feedbackView : undefined
  const reliable = isRecord(snapshot.reliableFeedback) ? snapshot.reliableFeedback.feedbackView : undefined
  const view = engine ?? reliable
  return isRecord(view) && typeof view.card === "string" && Array.isArray(view.narrative) ? (view as unknown as FeedbackView) : null
}

/** Fuso padrão das datas civis (as organizações demo são deste fuso; o serviço passa o da organização quando há). */
export const DEFAULT_TIME_ZONE = "America/Sao_Paulo"
/** Data civil (dd/mm/aaaa) de um instante, no fuso da organização. */
export function civilDay(instant: string | Date, timeZone = DEFAULT_TIME_ZONE): string {
  const date = typeof instant === "string" ? new Date(instant) : instant
  if (Number.isNaN(date.getTime())) return String(instant)
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(date)
}

/**
 * Rótulos RELATIVOS ("Ontem (D-1)", "Mês anterior", "Últimos 7 dias") só valem no dia em que foram publicados — repetidos
 * depois enganam. Com as datas registradas, o período vira as datas; sem elas, o rótulo relativo não é usado.
 */
const RELATIVE_PERIOD = /\b(ontem|hoje|anteontem|d-\d+|m[eê]s (anterior|atual|passado)|semana (anterior|atual|passada)|[uú]ltim[oa]s? \d*\s*(dias?|semanas?|meses))\b/i

/** Período registrado no snapshot (resumo de agenda), sem nenhuma leitura atual. Fim do registro é EXCLUSIVO. */
function registeredPeriodOf(snapshot: Record<string, unknown>, timeZone: string): { label: string | null; period: { start: string; end: string } | null } {
  const summary = isRecord(snapshot.periodSummary) ? snapshot.periodSummary : null
  if (!summary) return { label: null, period: null }
  const start = typeof summary.periodStart === "string" && !Number.isNaN(Date.parse(summary.periodStart)) ? summary.periodStart : null
  const end = typeof summary.periodEnd === "string" && !Number.isNaN(Date.parse(summary.periodEnd)) ? summary.periodEnd : null
  const label = clean(summary.periodLabel) || null
  if (start && end) {
    const first = civilDay(start, timeZone)
    const last = civilDay(new Date(Date.parse(end) - 1), timeZone)
    return { label: first === last ? first : `${first} a ${last}`, period: { start, end } }
  }
  return { label: label && !RELATIVE_PERIOD.test(label) ? label : null, period: null }
}

/** Texto publicado de um feedback sem view V2 (fluxo legado/manual): só os campos gravados, na ordem do formulário. */
function legacyPublishedText(record: PublishedFeedbackRecord): string {
  const parts = [
    record.recommendation ? record.recommendation : "",
    record.observedBehavior ? `**Comportamento observado:** ${record.observedBehavior}` : "",
    record.evidenceFound ? `**Evidência registrada:** ${record.evidenceFound}` : "",
    record.relatedProcedure ? `**Procedimento relacionado:** ${record.relatedProcedure}` : "",
    record.suggestedApproach ? `**Abordagem sugerida:** ${record.suggestedApproach}` : "",
  ]
  return parts.filter(Boolean).join("\n\n")
}

function viewEvidence(view: FeedbackView): string[] {
  const lines: string[] = []
  for (const development of view.developments ?? []) {
    if (development.whatHappened) lines.push(`${development.title}: ${development.whatHappened}`)
    if (development.call.kind === "QUOTES") for (const quote of development.call.quotes) lines.push(`${development.title} — ${quote.intro}: “${quote.text}${quote.truncated ? "…" : ""}”`)
    if (development.call.kind === "ABSENCE") lines.push(`${development.title} — ${development.call.statement}`)
  }
  for (const positive of view.maintain?.evidence ?? []) {
    for (const quote of positive.quotes) lines.push(`${positive.title} — ${quote.intro}: “${quote.text}${quote.truncated ? "…" : ""}”`)
  }
  for (const indicator of view.cycle?.indicators ?? []) lines.push(...indicator.notes.map((note) => `${indicator.name}: ${note}`))
  return unique(lines)
}

function viewGuidance(view: FeedbackView): string[] {
  const lines: string[] = []
  for (const development of view.developments ?? []) {
    for (const text of development.adjustment) lines.push(`${development.title} — ajuste: ${text}`)
    for (const rule of development.guidance.rules) lines.push(`${development.title} — o processo orienta${rule.section ? ` (${rule.section})` : ""}: “${rule.text}”`)
    for (const avoid of development.guidance.avoid) lines.push(`${development.title} — o procedimento pede evitar: “${avoid}”`)
    if (development.howToApply) lines.push(`${development.title} — como aplicar: ${development.howToApply}`)
    for (const why of development.whyItMatters) lines.push(`${development.title} — por que importa: ${why}`)
  }
  return unique(lines)
}

function viewStrengths(view: FeedbackView): string[] {
  const lines = (view.maintain?.evidence ?? []).map((positive) => `${positive.title}: ${positive.statement}`)
  if (view.maintain?.summary) lines.unshift(view.maintain.summary)
  return unique(lines)
}

function viewText(view: FeedbackView): string {
  const blocks = [[view.greeting ?? "", ...view.narrative].filter(Boolean).join("\n\n")]
  if (view.context) blocks.push(view.context)
  for (const attention of view.attention ?? []) blocks.push(`**${attention.title}**\n${attention.markdown}`)
  return blocks.filter(Boolean).join("\n\n")
}

export function buildPublishedFeedbackContext(record: PublishedFeedbackRecord, capturedAt: Date, timeZone = DEFAULT_TIME_ZONE): FeedbackHistoricalContext {
  const view = publishedViewOf(record.snapshot)
  const registered = registeredPeriodOf(record.snapshot, timeZone)
  const interactionId = typeof record.snapshot.interactionId === "string" ? record.snapshot.interactionId : null
  // Cabeçalho registrado: IDENTIDADE (assunto) × METADADO (quando). O "quando" também pode vir junto do assunto no rótulo.
  const headingTitle = view?.heading?.title?.trim() || null
  const subjectInput = { kind: record.kind, headingTitle, impactedIndicator: record.impactedIndicator, caseTitle: record.caseTitle }
  const headingSubtitle = view?.heading?.subtitle?.trim() || null
  const periodLabel = headingSubtitle ?? registeredWhenOf(subjectInput) ?? registered.label ?? view?.cycle?.title?.replace(/^.*·\s*/, "") ?? null
  const interactionLabel = record.kind === "MONITORING" ? (headingSubtitle ?? registeredWhenOf(subjectInput)) : null
  const subject = registeredSubjectOf(subjectInput)
  const indicators = view?.cycle?.indicators?.map((indicator) => ({ name: indicator.name, lines: indicator.lines.map((line) => ({ ...line })), notes: [...indicator.notes] })) ?? []

  const viewMaterials = (view?.materials ?? []).map((material): HistoricalMaterial => ({ documentId: material.documentId, title: material.title, sections: material.sections ?? [], reason: material.usedIn.length > 0 ? `Usado em: ${material.usedIn.join(", ")}` : null }))
  const registeredIds = new Set(viewMaterials.map((material) => material.documentId))
  const extraMaterials = record.supportMaterials.filter((material) => !registeredIds.has(material.documentId)).map((material): HistoricalMaterial => ({ documentId: material.documentId, title: material.title, sections: [], reason: material.reason }))
  const materials = [...viewMaterials, ...extraMaterials]

  const evidence = view ? viewEvidence(view) : unique([record.evidenceFound, record.observedBehavior ? `Comportamento observado: ${record.observedBehavior}` : ""])
  const guidance = view ? viewGuidance(view) : unique([record.recommendation, record.relatedProcedure ? `Procedimento relacionado: ${record.relatedProcedure}` : "", record.suggestedApproach ?? ""])
  const strengths = view ? viewStrengths(view) : []

  const limitations: string[] = []
  if (!periodLabel && !registered.period) limitations.push("O registro deste feedback não informa o período avaliado — só a data de publicação.")
  if (record.kind === "INDICATOR" && indicators.length === 0) limitations.push("O registro guarda o texto publicado, mas não uma tabela estruturada de valores e metas usados na avaliação; só os números escritos no próprio feedback são do período avaliado.")
  if (record.kind === "MONITORING" && !interactionId && !interactionLabel) limitations.push("O registro não identifica o atendimento avaliado.")
  if (materials.length > 0) limitations.push("As versões dos materiais de apoio usadas na época não foram registradas; os títulos e as seções são os registrados no feedback.")
  if (!view) limitations.push("Este é um feedback publicado antes da apresentação detalhada: os detalhes por ponto (falas, regras citadas, seções do procedimento) não foram registrados separadamente.")

  return {
    version: "FEEDBACK_APPLICATION_CONTEXT_V1",
    capturedAt: capturedAt.toISOString(),
    provenance: "PUBLISHED_RECORD",
    source: { kind: "PUBLISHED_FEEDBACK", id: record.feedbackId, version: record.version },
    domain: record.kind,
    subject,
    periodLabel,
    period: registered.period,
    publishedAt: record.publishedAt.toISOString(),
    publishedText: view ? viewText(view) : legacyPublishedText(record),
    summary: clean(view?.card) || clean(record.caseSummary) || null,
    indicators,
    interaction: interactionId || interactionLabel ? { id: interactionId, label: interactionLabel } : null,
    supervisionCase: record.caseId ? { id: record.caseId, title: clean(record.caseTitle) || subject } : null,
    evidence,
    guidance,
    strengths,
    materials,
    limitations,
  }
}

export function buildDeliveredFeedbackContext(record: DeliveredFeedbackRecord, capturedAt: Date): FeedbackHistoricalContext {
  const text = record.blocks.map((block) => `**${block.label}**\n${block.text}`).join("\n\n")
  const evidence = record.evidence.map((entry) => `${entry.speakerLabel}: “${entry.text}${entry.truncated ? "…" : ""}”`)
  const observed = record.blocks.filter((block) => block.key === "observed").map((block) => block.text)
  const guidance = record.blocks.filter((block) => block.key !== "observed").map((block) => `${block.label}: ${block.text}`)
  return {
    version: "FEEDBACK_APPLICATION_CONTEXT_V1",
    capturedAt: capturedAt.toISOString(),
    provenance: "DELIVERED_RECORD",
    source: { kind: "INTERACTION_FEEDBACK_DELIVERY", id: record.deliveryId, version: null },
    domain: "INTERACTION",
    subject: record.title,
    periodLabel: `Atendimento de ${record.interactionLabel}`,
    period: null,
    publishedAt: record.deliveredAt,
    publishedText: text,
    summary: observed[0] ?? null,
    indicators: [],
    interaction: { id: null, label: record.interactionLabel },
    supervisionCase: null,
    evidence: [...observed, ...evidence],
    guidance,
    strengths: record.section === "STRENGTH" ? observed : [],
    materials: [],
    limitations: ["Este feedback é sobre um único atendimento; o registro não guarda indicadores nem metas."],
  }
}

/** Data de publicação (dd/mm/aaaa) — do instante registrado, no fuso da organização. */
export function publishedDayLabel(context: Pick<FeedbackHistoricalContext, "publishedAt">, timeZone = DEFAULT_TIME_ZONE): string {
  return civilDay(context.publishedAt, timeZone)
}

/** Período por extenso para frases ("aos seus resultados de agosto de 2026", "ao atendimento de 14/09/2026"). */
export function periodPhraseOf(context: Pick<FeedbackHistoricalContext, "periodLabel" | "domain">): string | null {
  const label = context.periodLabel?.trim()
  if (!label) return null
  const lower = /^\d/.test(label) ? label : label.charAt(0).toLocaleLowerCase("pt-BR") + label.slice(1)
  if (/^(atendimento|fechamento) de /i.test(label)) return `ao ${lower}`
  if (/^\d{2}\/\d{2}\/\d{4} a /.test(label)) return `${context.domain === "INDICATOR" ? "aos seus resultados do período de" : "ao período de"} ${lower}`
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(label)) return `${context.domain === "INDICATOR" ? "aos seus resultados de" : "ao dia"} ${lower}`
  if (context.domain === "INDICATOR") return `aos seus resultados de ${lower}`
  return `a ${lower}`
}

/**
 * O registro como DADOS para o modelo (chat e voz). Nunca instruções; nunca ids técnicos de material. A IA explica só o que
 * está aqui e declara o que não foi registrado.
 */
export function renderHistoricalContextForModel(context: FeedbackHistoricalContext, timeZone = DEFAULT_TIME_ZONE): string {
  const section = (title: string, lines: readonly string[]) => (lines.length > 0 ? [`${title}:`, ...lines.map((line) => `- ${line}`)].join("\n") : null)
  const period = context.periodLabel ?? "não registrado"
  return [
    `Registro publicado em ${publishedDayLabel(context, timeZone)}${context.source.version !== null ? ` (versão ${context.source.version})` : ""}.`,
    `Assunto: ${context.subject}`,
    `Período/atendimento avaliado: ${period}`,
    context.summary ? `Resumo publicado: ${context.summary}` : null,
    context.supervisionCase ? `Caso de supervisão relacionado: ${context.supervisionCase.title}` : null,
    context.indicators.length > 0
      ? ["Indicadores considerados NA AVALIAÇÃO (valores e metas daquele período, como registrados):", ...context.indicators.map((indicator) => `- ${indicator.name}: ${indicator.lines.map((line) => `${line.label} = ${line.value}`).join("; ")}${indicator.notes.length > 0 ? ` | Notas: ${indicator.notes.join(" ")}` : ""}`)].join("\n")
      : null,
    "Texto publicado ao colaborador:",
    "<<<TEXTO_PUBLICADO",
    context.publishedText,
    "TEXTO_PUBLICADO>>>",
    section("Evidências e comportamento observado (como publicados)", context.evidence),
    section("Orientações e procedimentos (como publicados)", context.guidance),
    section("Pontos fortes registrados", context.strengths),
    section("Materiais de apoio registrados", context.materials.map((material) => `${material.title}${material.sections.length > 0 ? ` (seções: ${material.sections.join(", ")})` : ""}${material.reason ? ` — ${material.reason}` : ""}`)),
    section("Limitações do registro (diga isso se perguntarem; não complete)", context.limitations),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}
