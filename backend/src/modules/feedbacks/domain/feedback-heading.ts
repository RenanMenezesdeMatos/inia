/**
 * TÍTULO DO FEEDBACK DE ATENDIMENTO (`FEEDBACK_HEADING_V2`, domínio puro — nenhuma chamada de IA).
 *
 * O título principal é o ASSUNTO do atendimento sustentado pelos dados daquela interação; a data é metadado à parte
 * ("Atendimento de 29/09/2026"). Ordem das fontes:
 *   1. CANONICAL — o nome do assunto canônico resolvido para a interação quando o feedback é gerado (o artefato guarda o nome; a
 *      leitura posterior não reclassifica);
 *   2. RECORDED — o assunto BRUTO gravado com a interação (nunca reescrito), quando é texto legível: o SUBMOTIVO
 *      (`interactions.sub_reason`) quando a fonte o informou, senão o motivo (`interactions.reason`) — V2, 16/10/2026;
 *   3. RECORDED_CODE — o bruto é um código e existe um assunto com EXATAMENTE esse código: o nome desse assunto (mesma identidade,
 *      só o rótulo legível — nunca um alias criado depois);
 *   4. sem assunto confiável → título neutro, a data continua separada.
 * Nunca entram como assunto: nome da base de conhecimento, do agente, do Workflow ou de um erro encontrado; nenhuma especificidade é
 * acrescentada ("Contestação de cobrança" só vira "Contestação de juros e multa" se o dado disser isso).
 */
export const FEEDBACK_HEADING_VERSION = "FEEDBACK_HEADING_V2" as const
export const NEUTRAL_INTERACTION_TITLE = "Feedback de atendimento"
export const SUBJECT_TITLE_MAX = 80

export type SubjectSource = "CANONICAL" | "RECORDED" | "RECORDED_CODE"
export type HeadingSubjectSource = SubjectSource | "NONE"
export type ReadableSubject = { text: string; source: SubjectSource }
export type InteractionHeading = { title: string; subtitle: string | null; subjectSource: HeadingSubjectSource }

const collapse = (value: string) => value.replace(/\s+/gu, " ").trim()
/** "segunda_via", "CONTESTACAO_COBRANCA", "COD123", "4471" — identificador de sistema, não um nome para a pessoa ler. */
export const isCodeLikeSubject = (value: string) => /_/u.test(value) || /^[A-Z0-9]{3,}$/u.test(value) || /^\d+$/u.test(value) || /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u.test(value)
const capitalized = (value: string) => `${value.charAt(0).toLocaleUpperCase("pt-BR")}${value.slice(1)}`
function capped(value: string): string {
  if (value.length <= SUBJECT_TITLE_MAX) return value
  const cut = value.slice(0, SUBJECT_TITLE_MAX - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > SUBJECT_TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export function readableSubjectOf(input: { canonicalName?: string | null; raw?: string | null; nameOfCode?: (code: string) => string | null | undefined }): ReadableSubject | null {
  const canonical = collapse(input.canonicalName ?? "")
  if (canonical) return { text: capped(capitalized(canonical)), source: "CANONICAL" }
  const raw = collapse(input.raw ?? "")
  if (!raw) return null
  const named = collapse(input.nameOfCode?.(raw) ?? "")
  if (named) return { text: capped(capitalized(named)), source: "RECORDED_CODE" }
  if (isCodeLikeSubject(raw) || !/\p{L}/u.test(raw)) return null
  return { text: capped(capitalized(raw)), source: "RECORDED" }
}

/** "dd/mm/aaaa" do atendimento + assunto → título (assunto ou neutro) e subtítulo com a data. */
export function interactionHeadingOf(subject: ReadableSubject | null, dateLabel: string | null): InteractionHeading {
  return { title: subject?.text ?? NEUTRAL_INTERACTION_TITLE, subtitle: dateLabel ? `Atendimento de ${dateLabel}` : null, subjectSource: subject?.source ?? "NONE" }
}

/** Um cabeçalho já publicado SEM assunto (só a data no título, ou título neutro): candidato à correção da projeção. */
export function headingLacksSubject(heading: { title?: string | null; subtitle?: string | null; subjectSource?: string | null } | null | undefined): boolean {
  if (!heading?.title) return true
  if (heading.subjectSource === "NONE") return true
  return /^Atendimento de \d{2}\/\d{2}\/\d{4}$/u.test(heading.title.trim()) || heading.title.trim() === NEUTRAL_INTERACTION_TITLE || heading.title.trim() === "Atendimento"
}

/**
 * CORREÇÃO DA PROJEÇÃO de um feedback JÁ PUBLICADO cujo cabeçalho não tem assunto (só a data no título). Usa só a fonte histórica
 * vinculada: o assunto BRUTO gravado com a interação e, se ele for um código, o nome do assunto com exatamente esse código — nunca
 * um alias de catálogo criado depois (não reclassifica o passado). Sem assunto confiável, o título fica neutro e a data vai para o
 * subtítulo. Nada da mensagem, da análise ou dos destinatários muda.
 */
export type LegacyHeadingCorrection = { kind: "CORRECTED"; heading: InteractionHeading } | { kind: "UNCHANGED"; reason: "HAS_SUBJECT" | "SAME_HEADING" }
export function legacyHeadingCorrectionOf(input: { current: { title?: string | null; subtitle?: string | null; subjectSource?: string | null } | null | undefined; recordedSubject: string | null; exactCodeName: string | null; dateLabel: string }): LegacyHeadingCorrection {
  if (!headingLacksSubject(input.current)) return { kind: "UNCHANGED", reason: "HAS_SUBJECT" }
  const heading = interactionHeadingOf(readableSubjectOf({ raw: input.recordedSubject, nameOfCode: () => input.exactCodeName }), input.dateLabel)
  const same = input.current?.title === heading.title && (input.current?.subtitle ?? null) === heading.subtitle && input.current?.subjectSource === heading.subjectSource
  return same ? { kind: "UNCHANGED", reason: "SAME_HEADING" } : { kind: "CORRECTED", heading }
}

/**
 * CABEÇALHO NA LEITURA de um feedback de atendimento publicado SEM view model (pipelines anteriores — o título gravado era o nome
 * da base de conhecimento, do agente ou um "indicador impactado"). Nada é regravado: a leitura troca só o título exibido.
 * Vínculo confiável com a interação, nesta ordem: o `interactionId` gravado no snapshot do feedback; senão a ÚNICA interação
 * citada como evidência do caso do feedback (duas ou mais = ambíguo, sem vínculo). A interação precisa ser do mesmo colaborador
 * (conferido por quem carrega). Com vínculo: o assunto BRUTO gravado com a interação (ou o nome do assunto com exatamente aquele
 * código) e a data dela como subtítulo; sem assunto legível, título neutro com a data. Sem vínculo: título neutro, sem subtítulo
 * — nunca o nome da base, do agente ou do indicador impactado.
 */
export function linkedInteractionIdOf(input: { snapshotInteractionId: unknown; evidenceInteractionIds: readonly string[] }): string | null {
  if (typeof input.snapshotInteractionId === "string" && input.snapshotInteractionId.trim().length > 0) return input.snapshotInteractionId
  const distinct = [...new Set(input.evidenceInteractionIds)]
  return distinct.length === 1 ? distinct[0]! : null
}
export function legacyFeedbackHeadingOf(linked: { recordedSubject: string | null; exactCodeName: string | null; dateLabel: string } | null): InteractionHeading {
  if (!linked) return { title: NEUTRAL_INTERACTION_TITLE, subtitle: null, subjectSource: "NONE" }
  return interactionHeadingOf(readableSubjectOf({ raw: linked.recordedSubject, nameOfCode: () => linked.exactCodeName }), linked.dateLabel)
}
