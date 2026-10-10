import type { AssessedCriterion, CriterionStatus, ItemNature, Materiality, ScenarioRole, VerifiedCallAnalysis, VerifiedQuote } from "./call-analysis.js"
import { firmnessOf, RECURRENCE_FOR_CORRECTION, strongestFirmness, type Firmness } from "./firmness.js"
import type { HeadingSubjectSource } from "../../feedbacks/domain/feedback-heading.js"
import { CUSTOMER_SPEAKERS, OPERATOR_SPEAKERS, type RulePerspective } from "./procedure.js"
import type { FeedbackView } from "./feedback-view.js"
import { COMPOSITION_VERSION } from "./versions.js"

/**
 * BRIEF DO FEEDBACK — a ponte entre o DIAGNÓSTICO e a MENSAGEM (domínio puro).
 *
 * CONTRATO DE CONFIANÇA (FEEDBACK_COMPOSITION_V2): o brief separa o que é FATO VERIFICADO do que é LEITURA DO MODELO.
 *   Fatos (podem sustentar qualquer frase): fala literal conferida por turno/falante, texto literal da regra da base, status do
 *   critério DEPOIS da verificação por código (e a afirmação do sistema derivada dele — `observed`), números e históricos
 *   calculados pelo sistema, resultado oficial, motivo de seleção e procedimento aplicado.
 *   Leitura do modelo (NUNCA vira fato só por ter vindo da análise): a justificativa (`reading`), a orientação (`guidance`), o
 *   "por que importa" (`whyItMatters`) e a situação do cliente (`situation`). Uma regra válida referenciada não prova que toda
 *   orientação associada a ela esteja sustentada. Essas leituras só chegam ao colaborador depois que o verificador as confere
 *   contra os FATOS (na mesma chamada da verificação das frases) — e o que for recusado não volta por nenhuma superfície.
 * O que entra é escolhido por MATERIALIDADE: desvios materiais verificados viram pontos de desenvolvimento (todos os HIGH
 * precisam aparecer); condutas materiais verificadas viram reconhecimento (poucas e as mais relevantes — a mensagem não reconta a
 * chamada). Achados menores continuam na memória; nada material some.
 */
export type BriefQuote = { speaker: "OPERATOR" | "CUSTOMER" | "OTHER"; text: string; turn: string | null }
/** Regra LITERAL da base. `leadIn` = a frase que abre a lista do item (condição, "avaliar:", "informar:") — a regra só tem o seu
 * sentido junto dela. */
export type BriefRule = {
  text: string
  section: string | null
  documentId: string
  documentTitle: string
  leadIn?: string | null
  /** Regra de ARGUMENTÁRIO (documentId = id do argumentário): nunca vira material da base. */
  sourceKind?: "ARGUMENT_SCRIPT"
  /** Regra COMPOSTA: a parte avaliada (a regra literal inteira fica em `text`). */
  part?: string | null
  /** `ARGUMENT_PHRASING_V1`: a fraseologia sugerida pelo ARGUMENTÁRIO de origem (o próprio, ou o que também exige esta linha da base —
   * duplicidade por sentido aceita). Texto oficial da operação: modelo de como dizer, nunca critério nem fala desta chamada. */
  phrasing?: { scriptName: string; text: string } | null
  /** Nome do argumentário de origem (regra de argumentário) — título de um ponto que junta itens do mesmo argumentário. */
  argumentName?: string
  /** `RULE_SOURCES_V1`: item do campo "evitar" do argumentário (estrutura do cadastro) — o que a operação pede para NÃO fazer. Nunca é
   * apresentado como orientação: vai para "o procedimento pede evitar". */
  avoid?: boolean
}
/** Outra linha da MESMA lista e como foi avaliada nesta chamada (fato: texto literal + status verificado). */
export type BriefSibling = { text: string; status: CriterionStatus }
/**
 * `RULE_SOURCES_V1`: de onde vem cada linha-fonte de uma obrigação (documento/argumentário, seção, campo do cadastro), lido da MESMA
 * versão do procedimento e dos argumentários que a análise usou. Uma obrigação junta linhas de várias fontes (a lista da base, a
 * orientação do argumentário, o item "evitar"); sem isto elas viravam uma "regra" só, com a seção da primeira — e o item "evitar"
 * aparecia como orientação.
 */
export type SourceLineMeta = { documentId: string; documentTitle: string; heading: string | null; source: "KNOWLEDGE_DOCUMENT" | "ARGUMENT_SCRIPT"; avoid: boolean; leadIn: string | null; condition: string | null }
/**
 * `CONSOLIDATED_STEPS_V1`: uma ETAPA de um ponto consolidado (caminho inadequado ou várias etapas da mesma seção/prática), com os FATOS
 * dela — status confirmado, falas verificadas ou ausência, regra literal. Sem isso o redator via só o status do ponto inteiro e as
 * duas primeiras falas, e orientava uma etapa ("ofereça o bloqueio preventivo") sem poder dizer que ela faltou (avaliação de 05/10).
 */
export type BriefStep = { title: string; status: CriterionStatus; quotes: BriefQuote[]; absentInCall: boolean; declaredOnly: boolean; rule: BriefRule | null; /** `RULE_SOURCES_V1`: todas as fontes da etapa (a primeira = `rule`). */ rules?: BriefRule[]; findingKey?: string }
export type BriefFinding = {
  ref: string
  /** Identidade do FATO para supressão de mensagem duplicada: chamada × critério (ou indicador × período × critério). */
  findingKey: string
  kind: "DEVELOPMENT" | "STRENGTH"
  origin: "CRITERION" | "PATH" | "INDICATOR_PATTERN" | "INDICATOR_RESULT"
  title: string
  materiality: Materiality
  status: CriterionStatus | "PATH_INCORRECT" | "PATH_PARTIAL" | "PATH_CORRECT" | "PATTERN" | "RESULT"
  /** O que aconteceu — afirmação do SISTEMA derivada do status verificado (ou números do sistema). Fato. */
  observed: string
  /** Justificativa do MODELO para o status (leitura; nunca fato, nunca usada fora da redação verificada). */
  reading: string | null
  quotes: BriefQuote[]
  /** Omissão verificada: a ação não aparece na chamada; `opportunity` = a fala do momento em que caberia (contexto). */
  absence: { opportunity: BriefQuote | null } | null
  /** A ação foi só DECLARADA pelo operador (sistema não verificável pela transcrição). */
  declaredOnly: boolean
  rules: BriefRule[]
  /** Orientação proposta pelo MODELO (leitura): só usada depois de conferida contra os fatos. */
  guidance: { moment: string; condition: string | null; action: string } | null
  /** "Por que importa" proposto pelo MODELO (leitura): só usado depois de conferido contra os fatos. */
  whyItMatters: string | null
  /** Histórico comparável com denominador (frase do sistema) — nunca "sempre". */
  history: string | null
  criterionKeys: string[]
  /** Indicadores: números da amostra/referência já prontos (frases do sistema). */
  stats: string[]
  /** Os outros itens da mesma lista e o status de cada um — alternativas cumpridas ficam visíveis para quem redige e confere. */
  sameList?: BriefSibling[]
  /** Itens das listas desta regra que ninguém avaliou nesta chamada (fato estrutural): o reconhecimento não se estende a eles. */
  notAssessedInSameList?: string[]
  /** A regra foi publicada depois das chamadas avaliadas (reavaliação pela regra atual): orientação daqui para frente, nunca culpa. */
  ruleBasis?: RulePerspective
  /** Consolidação: achados do MESMO comportamento (mesma seção do procedimento, ou etapas do caminho inadequado) viram um ponto só;
   * cada um continua rastreável aqui (entrega/supressão por achado) e nos detalhes (todas as regras literais). */
  memberFindingKeys?: string[]
  /** Acerto de uma regra CONDICIONAL cuja condição a revisão encontrou NESTA chamada (fala verificada): a fala da condição vai junto
   * como contexto do ponto. Não é critério de prioridade (uma regra condicional não é automaticamente mais importante). */
  situational?: boolean
  /** `STRENGTH_SELECTION_V3`: papel no caso (leitura da análise/revisão): CENTRAL = ligado à necessidade do cliente ou à decisão do
   * caso. Só ORDENA o que é oferecido ao redator; nunca vira fato. */
  role?: ScenarioRole | null
  /** `CONDUCT_OCCURRENCE_V1`: a mesma conduta julgada por mais de uma regra — um ponto só, com as bases normativas de todas. */
  occurrenceKey?: string | null
  /** `OBLIGATION_SPEECH_EXECUTION_V1`: obrigação MISTA — o ponto avalia só a parte da conversa (leitura da revisão); a parte feita em
   * sistema vai para `notVerifiableByRecording` (nunca elogiada nem cobrada). */
  evaluatedPart?: string | null
  /** `PRACTICE_ANCHOR_V1`: práticas (linha-âncora da base) deste ponto — identidade estável entre análises e versões, usada para
   * reincidência e para saber se o ponto já foi orientado antes. */
  practiceKeys?: string[]
  /** `FEEDBACK_FIRMNESS_V1`: tom do ponto decidido pelo código (ORIENT/CORRECT/INSIST) + frases do sistema que o justificam. */
  firmness?: Firmness
  /** Reincidência da prática nas OUTRAS chamadas analisadas (números do sistema; a frase vai em `history`). Uso interno do brief. */
  recurrence?: { assessed: number; notMet: number }
  /** `CONSOLIDATED_STEPS_V1`: as etapas que este ponto consolidado junta, cada uma com os próprios fatos. */
  steps?: BriefStep[]
}
/** PONTO EM ABERTO: etapa ligada ao centro do caso que a conversa NÃO permite concluir (ex.: depende de uma ação interna não
 * verbalizada). Nunca é acusação nem acerto: o redator pode orientar de forma condicional ("se…") ou dizer o que comunicar. */
export type BriefOpenPoint = { ref: string; findingKey: string; title: string; nature: ItemNature | null; why: string; rules: BriefRule[]; quotes: BriefQuote[] }
/** LIMITE DE COBERTURA (auditoria, nunca vai ao redator): exigência que a evidência disponível não permite avaliar — execução fora da
 * conversa (com o que a fala mostra: declaração, intenção, nada) ou aplicabilidade incerta. Não é falha nem acerto. */
/** `saidIn`: falas do operador que DIZEM que a ação (em sistema) foi ou será feita — comprovam o que foi dito, nunca a execução nem o estado
 * relatado (rodada real V12: "Ao identificar a pendência no cancelamento…" foi aprovado porque nada ligava T7 à verificação declarada). */
export type BriefCoverageLimit = { title: string; reason: "OUTSIDE_CONVERSATION" | "APPLICABILITY_UNCERTAIN"; executionClaim: "DECLARED" | "INTENDED" | "NONE" | null; role: ScenarioRole | null; criterionKey: string; saidIn?: { turn: string; quote: string }[] }
export type BriefMaterial = { documentId: string; documentVersion: number | null; title: string; sections: string[]; reason: string; criterionKeys: string[]; usedIn: string[] }
export type BriefSubjectRow = {
  key: string
  label: string
  previous: { value: number; calls: number } | null
  current: { value: number; calls: number } | null
  /** Pela direção do indicador (pior/melhor), só quando os dois períodos têm chamadas suficientes. */
  direction: "WORSE" | "BETTER" | "STABLE" | "UNKNOWN"
  comparable: boolean
  /** Assunto onde a investigação localizou a mudança (o que foi examinado nas chamadas). */
  focus: boolean
  /** Chamadas do assunto lidas nesta investigação (memória + novas) × gravadas no período. */
  analyzed: { calls: number; universe: number } | null
}
export type BriefSubjects = { proxyKind: "DURATION_SECONDS" | "SIGNAL_RATE" | "VOLUME"; description: string; previousLabel: string; currentLabel: string; rows: BriefSubjectRow[] }
export type FeedbackBrief = {
  version: typeof COMPOSITION_VERSION
  domain: "MONITORING" | "INDICATOR"
  label: string
  /** `subjectSource` (FEEDBACK_HEADING_V1): de onde veio o assunto do título — "NONE" = título neutro (sem assunto confiável). */
  heading: { title: string; subtitle: string | null; subjectSource?: HeadingSubjectSource }
  /** Contexto factual do caso (só frases do SISTEMA): sinal que selecionou a chamada, procedimento aplicado, localização. */
  context: string[]
  /** Situação do cliente como o MODELO a leu (leitura — dica para a redação, nunca fato). */
  situation?: string | null
  /** V4 — etapas centrais que a conversa não permite concluir (O-n). */
  openPoints?: BriefOpenPoint[]
  /** V4 — o que ajuda o COLABORADOR a entender o retorno (detalhes da tela). Notas técnicas da análise/revisão nunca entram aqui. */
  readerNotes?: string[]
  /** V5 — limites de cobertura (auditoria; fora do payload do redator). */
  coverageLimits?: BriefCoverageLimit[]
  /** `CENTRAL_NEED_V1`: a necessidade central do cliente ficou SEM conclusão confirmada (nem tratada, nem falta confirmada) — a mensagem
   * não pode apresentá-la como resolvida nem acusar; as regras literais das linhas que a revisão apontou situam o assunto. */
  centralNeedOpen?: { rules: BriefRule[] } | null
  /** Falas verificadas do cenário (condições e caminho) — fatos que situam a conversa. */
  scenarioQuotes?: BriefQuote[]
  developments: BriefFinding[]
  strengths: BriefFinding[]
  limitations: string[]
  materials: BriefMaterial[]
  /** Linhas oficiais do indicador (quando houver) — exibidas pelo sistema, nunca reescritas. */
  officialLines: { label: string; value: string }[]
  /** `OFFICIAL_RESULT_TABLE_V1` (indicador): o resultado oficial em tabela, montada pelo SISTEMA no texto (números do fechamento,
   * nunca do redator). Uma linha por indicador. */
  officialTable?: OfficialTableRow[] | null
  indicatorName: string | null
  /** Tom decidido pelos fatos: só reconhecimento, só desenvolvimento, misto, ou INFORMATIVE (indicador: onde mudou e o que foi
   * verificado, sem causa sustentada — comunicação limitada, identificada como tal). */
  tone: "RECOGNITION" | "DEVELOPMENT" | "MIXED" | "INFORMATIVE"
  /** Achados suprimidos por já terem sido entregues (a observação continua na memória). */
  suppressed: { findingKey: string; title: string; reason: "ALREADY_DELIVERED" }[]
  /**
   * CURRENT_RULE_REEVALUATION = a regra usada foi publicada DEPOIS da chamada (não havia versão vigente na data): o que ela aponta é
   * orientação para as próximas chamadas pela regra atual, nunca culpa por não ter seguido uma regra que ainda não existia.
   */
  rulePerspective?: RulePerspective | null
  /** Afirmações proibidas pela estratégia do indicador (configuração da operação) — nenhuma frase pode contê-las. */
  prohibitedClaims?: string[]
  /**
   * `REFERENCE_PRACTICES_V1` (indicador): o que os colegas com melhor resultado comparável fazem nas chamadas deles (P-n) — AGREGADO,
   * com os mínimos de privacidade, sem nomes. Boa prática para orientar, nunca causa do resultado (deles ou da pessoa); `you` = como
   * a mesma etapa aparece nas chamadas analisadas da pessoa (null = sem avaliação dela — nunca é falta dela).
   */
  referencePractices?: BriefReferencePractice[]
  /**
   * `INDICATOR_SUBJECTS_V1` (indicador): a métrica das chamadas da pessoa POR ASSUNTO nos dois períodos da investigação — números do
   * SISTEMA (localização), nunca do modelo; aproximação pelas chamadas gravadas, não o valor oficial. Só para os detalhes da tela.
   */
  subjects?: BriefSubjects | null
}
export type OfficialTableRow = { indicator: string; periodLabel: string; result: string; target: string | null; withinTarget: boolean | null; previousLabel: string | null; previous: string | null }
export type BriefReferencePractice = {
  ref: string
  title: string
  rule: BriefRule
  group: string
  you: string | null
  contrast: "REFERENCE_FOLLOWS_PERSON_MISSES" | "BOTH_FOLLOW" | "REFERENCE_ALSO_MISSES" | "REFERENCE_ONLY"
}
/** Fundamento de cada frase entregue: verificada pelo verificador, texto literal da regra, status verificado, leitura do modelo
 * APROVADA pelo verificador, ou fato calculado pelo sistema. Nunca "leitura não conferida". */
export type SentenceBasis = "WRITER_VERIFIED" | "RULE_LITERAL" | "VERIFIED_STATUS" | "VERIFIED_ANALYSIS" | "SYSTEM_FACT"
export type ComposedSentence = { text: string; stance: "CONTEXT" | "RECOGNITION" | "ADJUSTMENT" | "GUIDANCE" | "VALUE"; refs: string[]; paragraph: number; source: "WRITER" | "SYSTEM"; basis?: SentenceBasis; /** `NARRATIVE_FORMATTING_V1`: item de lista (o sistema põe o marcador). */ format?: "BULLET" | "NUMBERED" }
/** Leituras do modelo conferidas pelo verificador (ref → sentença aprovada). Só estas podem aparecer fora da redação. */
export type TrustedReadings = { guidance: Record<string, string>; why: Record<string, string> }
export type ComposedMessage = { card: string; paragraphs: string[]; sentences: ComposedSentence[]; view: FeedbackView; text: string; source: "WRITER" | "MIXED" | "SYSTEM"; trusted?: TrustedReadings; /** Pontos do brief que a mensagem de fato comunicou (só eles contam como entregues). */ communicatedRefs?: string[] }

const speakerKind = (speaker: string | null): BriefQuote["speaker"] => {
  const value = (speaker ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
  return OPERATOR_SPEAKERS.has(value) ? "OPERATOR" : CUSTOMER_SPEAKERS.has(value) ? "CUSTOMER" : "OTHER"
}
export const briefQuoteOf = (quote: VerifiedQuote): BriefQuote => ({ speaker: speakerKind(quote.speaker), text: quote.quote, turn: quote.turn })

/** Título curto e humano de um critério: o item da regra (sem marcador) — nunca código. */
export function criterionTitleOf(criterion: Pick<AssessedCriterion, "text" | "heading"> & { lineRole?: AssessedCriterion["lineRole"]; leadIn?: string | null; titleText?: string | null }): string {
  // Obrigação completa: o título literal já vem montado (abertura + primeiro item), nunca a ação escrita pelo modelo.
  if (criterion.titleText) return criterion.titleText.length > 90 ? `${criterion.titleText.slice(0, 87).trimEnd()}…` : criterion.titleText
  const text = criterion.text.replace(/^\s*(?:[-*•+]\s*(?:\[[ xX]\]\s*)?|\(?\d{1,3}[.)]\s*)/u, "").replace(/[*_`]/g, "").trim()
  const firstSentence = text.split(/(?<=[.;:!?])\s/)[0] ?? text
  const trimmed = firstSentence.replace(/[;:.]+$/, "").trim()
  // V6: item que é a SITUAÇÃO (ou o conteúdo) da ação da abertura não tem sentido sozinho como título — vai com a frase que abre a
  // lista (texto literal da base), para a conduta do título ser a ação e não a condição.
  const leadIn = (criterion.lineRole === "CONDITION_OF_ACTION" || criterion.lineRole === "CONTENT_OF_ACTION") && criterion.leadIn ? criterion.leadIn.replace(/[*_`]/g, "").replace(/[:\s]+$/, "").trim() : null
  const title = leadIn && trimmed ? `${leadIn}: ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}` : trimmed
  return title.length > 90 ? `${title.slice(0, 87).trimEnd()}…` : title || cleanHeading(criterion.heading) || "Etapa do procedimento"
}
export const cleanHeading = (heading: string | null) => (heading ? heading.replace(/^\s*\d+(?:\.\d+)*\.?\s+/u, "").replace(/[*_`#]/g, "").trim() : null)

const MATERIALITY_RANK: Record<Materiality, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
export const byMateriality = <T extends { materiality: Materiality }>(a: T, b: T) => MATERIALITY_RANK[a.materiality] - MATERIALITY_RANK[b.materiality]

export type MonitoringBriefInput = {
  analysis: VerifiedCallAnalysis
  interactionId: string
  /** Assunto legível do atendimento (`readableSubjectOf`) — título; sem assunto confiável, o título neutro. */
  label: string
  subjectSource?: HeadingSubjectSource
  dateLabel: string
  selectionReason: string
  criterionKeys: ReadonlyMap<string, string>
  documentTitles: ReadonlyMap<string, string>
  documentVersions: ReadonlyMap<string, number>
  history: ReadonlyMap<string, { assessed: number; notMet: number; met: number }>
  delivered: ReadonlySet<string>
  /** `FEEDBACK_FIRMNESS_V1`, por chave de critério desta análise: a prática (âncora) e se ela já foi orientada num retorno entregue.
   * Ausente = sem informação (nível pela regra vigente, materialidade e histórico). */
  practices?: ReadonlyMap<string, { practiceKey: string; priorOrientation: { dateLabel: string } | null }>
  /** Contexto de lista por linha (abertura + itens irmãos), da versão do procedimento usada na análise. Ausente = sem contexto. */
  listContext?: ReadonlyMap<string, { leadIn: string | null; siblings: string[] }>
  /** `ARGUMENT_PHRASING_V1`, por argumentário (id): a fraseologia sugerida da MESMA versão que a análise usou. Ausente = sem fraseologia. */
  argumentPhrasings?: ReadonlyMap<string, { name: string; text: string }>
  /** `RULE_SOURCES_V1`, por chave de linha: a origem de cada linha-fonte (documento × argumentário, seção, campo "evitar"). Ausente =
   * a regra continua sendo o texto inteiro da obrigação (comportamento anterior). */
  sourceLines?: ReadonlyMap<string, SourceLineMeta>
  /** `PRACTICE_TITLE_V1`, por chave de linha: o nome curto da prática da linha (catálogo) — título do ponto no lugar do texto cru da
   * regra. Vale a prática da linha PRINCIPAL da obrigação (a que o ponto avalia), nunca a de uma linha de apoio. */
  lineTitles?: ReadonlyMap<string, string>
}

/** Condição de um item de argumentário como frase que abre a regra (a condição do cadastro já vem escrita como frase). */
export const argumentConditionLeadIn = (condition: string) => `Condição: ${condition.trim()}`

/**
 * `RULE_SOURCES_V1`: as linhas-fonte de uma obrigação viram regras SEPARADAS por origem (documento/argumentário + seção), na ordem em
 * que vieram; o item do campo "evitar" de um argumentário vira regra própria marcada `avoid` (estrutura do cadastro, nunca palavra).
 * A regra da linha principal da obrigação vem primeiro (é a que identifica o ponto). Sem a origem de TODAS as linhas, null (quem
 * chama mantém a regra única — nunca mistura origem conhecida com palpite).
 */
export function rulesFromSources(input: { sources: readonly { lineKey: string; text: string }[]; primary: { documentId: string; heading: string | null }; sourceLines: ReadonlyMap<string, SourceLineMeta> }): BriefRule[] | null {
  const metas = input.sources.map((source) => ({ source, meta: input.sourceLines.get(source.lineKey) }))
  if (metas.length === 0 || metas.some((entry) => !entry.meta)) return null
  const groups: { meta: SourceLineMeta; texts: string[] }[] = []
  for (const { source, meta } of metas as { source: { lineKey: string; text: string }; meta: SourceLineMeta }[]) {
    const last = groups[groups.length - 1]
    if (last && !meta.avoid && !last.meta.avoid && last.meta.documentId === meta.documentId && last.meta.heading === meta.heading) last.texts.push(source.text)
    else groups.push({ meta, texts: [source.text] })
  }
  const rules = groups.map(({ meta, texts }): BriefRule => {
    const argument = meta.source === "ARGUMENT_SCRIPT"
    // Base: a frase que abre a lista só entra quando ela mesma não é uma das linhas-fonte (senão apareceria duas vezes).
    const leadIn = argument ? (meta.condition ? argumentConditionLeadIn(meta.condition) : null) : meta.leadIn && !texts.some((text) => text.trim() === meta.leadIn!.trim()) ? meta.leadIn : null
    return {
      text: texts.join("\n"),
      section: cleanHeading(meta.heading),
      documentId: meta.documentId,
      documentTitle: argument ? `Argumentário: ${meta.documentTitle}` : meta.documentTitle,
      leadIn,
      ...(argument ? { sourceKind: "ARGUMENT_SCRIPT" as const, argumentName: meta.documentTitle } : {}),
      ...(meta.avoid ? { avoid: true } : {}),
    }
  })
  const primaryIndex = rules.findIndex((rule) => !rule.avoid && rule.documentId === input.primary.documentId && rule.section === cleanHeading(input.primary.heading))
  return primaryIndex > 0 ? [rules[primaryIndex]!, ...rules.filter((_, index) => index !== primaryIndex)] : rules
}

/** Execução fora da conversa nunca chega ao redator como acerto nem como desvio (a análise já a deixou não observável; aqui é só a
 * mesma política repetida na fronteira com o redator — um caminho futuro que esquecer a regra não vira elogio nem acusação). */
const executedOutside = (criterion: AssessedCriterion) => criterion.observability === "OUTSIDE_CONVERSATION"
const isDevelopment = (criterion: AssessedCriterion) => (criterion.status === "NOT_MET" || criterion.status === "PARTIAL") && !criterion.ruleConflict && criterion.materiality !== "LOW" && !executedOutside(criterion)
const isStrength = (criterion: AssessedCriterion) => criterion.status === "MET" && !criterion.ruleConflict && criterion.materiality !== "LOW" && !executedOutside(criterion)
/** A condição da regra que a revisão encontrou nesta chamada (falas VERIFICADAS) — só de acerto confirmado. */
const situationQuotesOf = (criterion: AssessedCriterion): BriefQuote[] => (criterion.status === "MET" && criterion.confirmation === "CONFIRMED" ? (criterion.review?.conditionEvidence ?? []).map(briefQuoteOf).slice(0, 1) : [])

function historySentence(entry: { assessed: number; notMet: number; met: number } | undefined, kind: "DEVELOPMENT" | "STRENGTH"): string | null {
  if (!entry || entry.assessed < 2) return null
  return kind === "DEVELOPMENT"
    ? entry.notMet === 0
      ? `Nas ${entry.assessed} chamadas anteriores analisadas em que esta etapa se aplicava, ela foi cumprida em todas.`
      : `Nas ${entry.assessed} chamadas anteriores analisadas em que esta etapa se aplicava, ela não foi cumprida em ${entry.notMet}.`
    : `Nas ${entry.assessed} chamadas anteriores analisadas em que esta etapa se aplicava, ela foi cumprida em ${entry.met}.`
}

/**
 * Afirmação do SISTEMA sobre o que aconteceu, derivada SÓ do status verificado e do tipo de evidência — nunca da justificativa
 * do modelo. É o "fato" do ponto: pode ser dita sem conferência adicional porque só repete o que a verificação já decidiu.
 */
export function verifiedStatementOf(input: { kind: "DEVELOPMENT" | "STRENGTH"; status: BriefFinding["status"]; omission: boolean; declaredOnly: boolean; part?: string | null; mixed?: boolean }): string {
  // Obrigação MISTA (parte na conversa + parte em sistema): o status é só da parte da conversa — a do sistema não foi avaliada.
  if (input.mixed) {
    if (input.kind === "STRENGTH") return "A parte desta etapa que acontece na conversa foi cumprida nesta chamada; a parte feita em sistema não aparece na gravação."
    if (input.status === "PARTIAL") return "A parte desta etapa que acontece na conversa foi feita só em parte nesta chamada; a parte feita em sistema não aparece na gravação."
    return input.omission ? "A parte desta etapa que acontece na conversa não aparece nesta chamada; a parte feita em sistema não aparece na gravação." : "A conduta nesta chamada não seguiu a parte desta etapa que acontece na conversa; a parte feita em sistema não aparece na gravação."
  }
  // Parte de regra COMPOSTA: o fato é sobre a parte — a regra inteira não foi cumprida nem descumprida por causa dela.
  if (input.part) {
    if (input.kind === "STRENGTH") return `A parte “${input.part}” desta regra foi cumprida nesta chamada.`
    if (input.status === "PARTIAL") return `A parte “${input.part}” desta regra foi feita só em parte nesta chamada.`
    return input.omission ? `A parte “${input.part}” desta regra não aparece nesta chamada.` : `A conduta nesta chamada não seguiu a parte “${input.part}” desta regra.`
  }
  if (input.status === "PATH_INCORRECT") return "O caminho seguido nesta chamada não foi o indicado pelo procedimento para este cenário."
  if (input.status === "PATH_PARTIAL") return "O caminho seguido nesta chamada foi o indicado para o cenário, mas com etapas faltando."
  if (input.status === "PATH_CORRECT") return "O caminho seguido nesta chamada foi o indicado pelo procedimento para este cenário."
  if (input.kind === "STRENGTH") return input.declaredOnly ? "Na conversa, você informou ao cliente que fez esta etapa." : "Esta etapa foi cumprida nesta chamada."
  if (input.status === "PARTIAL") return "Esta etapa foi feita só em parte nesta chamada."
  if (input.omission) return "Esta etapa não aparece nesta chamada."
  return input.declaredOnly ? "Na conversa, esta etapa foi só declarada, não conduzida como o procedimento pede." : "A conduta nesta chamada não seguiu o que esta etapa pede."
}

/** Quantos reconhecimentos são OFERECIDOS ao redator (ele escolhe o que comunicar; a mensagem não reconta a chamada item a item). */
const STRENGTHS_WITH_DEVELOPMENT = 3
const STRENGTHS_ALONE = 3
const MAX_OPEN_POINTS = 2
/** Ordem pelo papel no caso: central antes de apoio (ou sem leitura) antes de rotina. */
export const ROLE_RANK: Record<string, number> = { CENTRAL: 0, SUPPORTING: 1, ROUTINE: 2 }
const roleRankOf = (role: ScenarioRole | null | undefined) => (role ? ROLE_RANK[role] ?? 1 : 1)
const bestRole = (roles: readonly (ScenarioRole | null | undefined)[]): ScenarioRole | null => (roles.filter((role): role is ScenarioRole => Boolean(role)).sort((a, b) => roleRankOf(a) - roleRankOf(b))[0] ?? null)

/**
 * Brief da MONITORIA. Ordem: caminho incorreto (quando sustentado) primeiro; depois desvios por materialidade e posição no
 * procedimento; reconhecimentos das condutas materiais verificadas (HIGH antes de MEDIUM, caminho antes de etapa). Achados já
 * entregues à pessoa (mesma chamada × critério) são suprimidos da mensagem — continuam na memória.
 */
export function buildMonitoringBrief(input: MonitoringBriefInput): FeedbackBrief {
  const { analysis } = input
  const phrasingOf = (criterion: { argument?: AssessedCriterion["argument"]; alsoRequiredBy?: AssessedCriterion["alsoRequiredBy"]; sources?: AssessedCriterion["sources"] }): { scriptId: string; scriptName: string; text: string } | null => {
    // Argumentários da obrigação: o da linha principal, os que também exigem a linha e os das outras linhas-fonte (`RULE_SOURCES_V1`).
    const fromSources = (criterion.sources ?? []).flatMap((source) => {
      const meta = input.sourceLines?.get(source.lineKey)
      return meta?.source === "ARGUMENT_SCRIPT" && !meta.avoid ? [meta.documentId] : []
    })
    for (const scriptId of [criterion.argument?.scriptId, ...(criterion.alsoRequiredBy ?? []).map((source) => source.scriptId), ...fromSources]) {
      const phrasing = scriptId ? input.argumentPhrasings?.get(scriptId) : undefined
      if (phrasing) return { scriptId: scriptId!, scriptName: phrasing.name, text: phrasing.text }
    }
    return null
  }
  const singleRuleOf = (criterion: Pick<AssessedCriterion, "text" | "heading" | "documentId"> & { lineKey?: string; obligation?: AssessedCriterion["obligation"]; argument?: AssessedCriterion["argument"] }): BriefRule => ({
    // Regra composta: a regra LITERAL inteira (a parte avaliada vai em `part`); argumentário: a origem é o argumentário.
    text: criterion.obligation?.lineText ?? criterion.text,
    section: cleanHeading(criterion.heading),
    documentId: criterion.documentId,
    documentTitle: criterion.argument ? `Argumentário: ${criterion.argument.scriptName}` : input.documentTitles.get(criterion.documentId) ?? "Procedimento",
    leadIn: criterion.argument ? (criterion.argument.condition ? argumentConditionLeadIn(criterion.argument.condition) : null) : criterion.lineKey ? input.listContext?.get(criterion.obligation?.parentLineKey ?? criterion.lineKey)?.leadIn ?? null : null,
    ...(criterion.argument ? { sourceKind: "ARGUMENT_SCRIPT" as const, argumentName: criterion.argument.scriptName } : {}),
    ...(criterion.argument?.field === "AVOID" ? { avoid: true } : {}),
    ...(criterion.obligation ? { part: criterion.obligation.part } : {}),
  })
  /** As regras de um critério: uma por origem (`RULE_SOURCES_V1`) quando a origem de todas as linhas-fonte é conhecida; senão a regra única. */
  const rulesOf = (criterion: Pick<AssessedCriterion, "text" | "heading" | "documentId"> & { lineKey?: string; obligation?: AssessedCriterion["obligation"]; argument?: AssessedCriterion["argument"]; alsoRequiredBy?: AssessedCriterion["alsoRequiredBy"]; sources?: AssessedCriterion["sources"] }): BriefRule[] => {
    const split = input.sourceLines && (criterion.sources ?? []).length > 0 ? rulesFromSources({ sources: criterion.sources!, primary: { documentId: criterion.documentId, heading: criterion.heading }, sourceLines: input.sourceLines }) : null
    const rules = split ?? [singleRuleOf(criterion)]
    const phrasing = phrasingOf(criterion)
    if (!phrasing) return rules
    // A fraseologia vai na regra do argumentário de onde ela vem (ou na primeira, quando o argumentário só "também exige" a linha).
    const target = Math.max(0, rules.findIndex((rule) => rule.documentId === phrasing.scriptId && !rule.avoid))
    return rules.map((rule, index) => (index === target ? { ...rule, phrasing: { scriptName: phrasing.scriptName, text: phrasing.text } } : rule))
  }
  const ruleOf = (criterion: Parameters<typeof rulesOf>[0]): BriefRule => rulesOf(criterion)[0]!
  /** `PRACTICE_TITLE_V1`: o título de um ponto é o nome curto da prática da linha principal (catálogo); sem nome, o texto da regra. */
  const titleOf = (criterion: AssessedCriterion) => {
    // Linha principal de uma obrigação = a fonte da mesma origem e seção do critério (o critério herda documento e seção dela).
    const primary = (criterion.sources ?? []).find((source) => {
      const meta = input.sourceLines?.get(source.lineKey)
      return meta && !meta.avoid && meta.documentId === criterion.documentId && meta.heading === criterion.heading
    })?.lineKey ?? criterion.lineKey
    return input.lineTitles?.get(primary) ?? criterionTitleOf(criterion)
  }
  const byLineKey = new Map(analysis.criteria.map((criterion) => [criterion.lineKey, criterion]))
  const lineKeyOfHandle = new Map(analysis.criteria.map((criterion) => [criterion.lineHandle, criterion.lineKey]))
  const leadInOfHandle = (handle: string) => {
    const lineKey = lineKeyOfHandle.get(handle)
    return lineKey ? input.listContext?.get(lineKey)?.leadIn ?? null : null
  }
  // Obrigação completa (`OBLIGATIONS_V1`): as PARTES da própria obrigação, como a conclusão CONFIRMADA as leu, fazem o papel dos itens
  // irmãos — sem isso, reconhecer a parte feita de um ponto parcial ("explicou o motivo; faltou o protocolo") era recusado como
  // reconhecimento sem base (rodada real V10: rascunho aprovado pelo verificador descartado por código, reparo sem orçamento).
  const OBLIGATION_ITEM_STATUS: Record<string, CriterionStatus> = { DONE: "MET", NOT_DONE: "NOT_MET", NOT_APPLICABLE: "NOT_APPLICABLE", NOT_VERIFIABLE: "NOT_OBSERVABLE" }
  const sameListOf = (criterion: AssessedCriterion): BriefSibling[] => criterion.contract === "OBLIGATIONS_V1" && (criterion.items ?? []).length > 0 && criterion.confirmation === "CONFIRMED"
    ? criterion.items!.map((item) => ({ text: item.text, status: OBLIGATION_ITEM_STATUS[item.status] ?? "NOT_ASSESSED" })).slice(0, 12)
    : (input.listContext?.get(criterion.lineKey)?.siblings ?? []).flatMap((lineKey) => {
        const sibling = byLineKey.get(lineKey)
        return sibling ? [{ text: sibling.text, status: sibling.status }] : []
      }).slice(0, 12)
  const keyOf = (criterion: AssessedCriterion) => input.criterionKeys.get(criterion.lineKey) ?? criterion.lineKey
  const suppressed: FeedbackBrief["suppressed"] = []
  const developments: BriefFinding[] = []
  const strengths: BriefFinding[] = []

  const pathCriteria = analysis.criteria.filter((criterion) => criterion.onPath)
  // Caminho INADEQUADO é o ponto principal (a escolha errada vem antes das etapas). Caminho certo com etapas faltando não vira ponto
  // próprio: as etapas faltantes já são os ajustes (evita repetir a mesma coisa duas vezes).
  // O caminho só é um ponto PRÓPRIO quando a análise o leu com evidência (falas do caminho seguido ou o caminho correto descrito). No
  // contrato de obrigações o "caminho" é só a soma das etapas: virar um ponto juntava comportamentos diferentes (lista errada,
  // impaciência, recapitulação) num "Caminho do atendimento" e o redator comunicava só parte deles (titularidade, 06/10).
  if (analysis.scenario.pathAssessment === "INCORRECT" && (analysis.scenario.pathEvidence.length > 0 || Boolean(analysis.scenario.correctPath?.trim()))) {
    const findingKey = `CALL:${input.interactionId}:PATH:${analysis.scenario.procedureDocumentId ?? "none"}`
    const pathRules = pathCriteria.filter(isDevelopment).slice(0, 3).map(ruleOf)
    const finding: BriefFinding = {
      ref: "",
      findingKey,
      kind: "DEVELOPMENT",
      origin: "PATH",
      title: "Caminho do atendimento",
      materiality: "HIGH",
      status: "PATH_INCORRECT",
      observed: verifiedStatementOf({ kind: "DEVELOPMENT", status: "PATH_INCORRECT", omission: false, declaredOnly: false }),
      reading: analysis.scenario.pathRationale || analysis.scenario.pathTaken || null,
      quotes: analysis.scenario.pathEvidence.map(briefQuoteOf).slice(0, 2),
      absence: null,
      declaredOnly: false,
      rules: pathRules,
      // O caminho correto descrito pelo modelo é LEITURA: vira orientação só se o verificador a sustentar pelas regras.
      guidance: analysis.scenario.correctPath ? { moment: "ao identificar a situação do cliente", condition: null, action: analysis.scenario.correctPath } : null,
      whyItMatters: null,
      history: null,
      criterionKeys: pathCriteria.filter(isDevelopment).map(keyOf),
      stats: [],
      ...(analysis.scenario.rulePerspective === "CURRENT_RULE_REEVALUATION" ? { ruleBasis: "CURRENT_RULE_REEVALUATION" as const } : {}),
      firmness: firmnessOf({ ruleBasis: analysis.scenario.rulePerspective, materiality: "HIGH", recurrence: null, priorOrientation: null }),
    }
    if (input.delivered.has(findingKey)) suppressed.push({ findingKey, title: finding.title, reason: "ALREADY_DELIVERED" })
    else developments.push(finding)
  }

  const reevaluated = (criterion: AssessedCriterion) => analysis.scenario.rulePerspective === "CURRENT_RULE_REEVALUATION" || criterion.argument?.perspective === "CURRENT_RULE_REEVALUATION"
  const ordered = [...analysis.criteria].sort((a, b) => roleRankOf(a.scenarioRole) - roleRankOf(b.scenarioRole) || byMateriality(a, b) || Number(b.onPath) - Number(a.onPath))
  for (const criterion of ordered) {
    const findingKey = `CALL:${input.interactionId}:${keyOf(criterion)}`
    if (isDevelopment(criterion)) {
      const omission = criterion.evidenceKind === "OMISSION" || criterion.evidence.every((quote) => briefQuoteOf(quote).speaker !== "OPERATOR")
      const declaredOnly = criterion.evidenceKind === "DECLARED_ACTION"
      const finding: BriefFinding = {
        ref: "",
        findingKey,
        kind: "DEVELOPMENT",
        origin: "CRITERION",
        title: titleOf(criterion),
        materiality: criterion.materiality,
        status: criterion.status,
        observed: verifiedStatementOf({ kind: "DEVELOPMENT", status: criterion.status, omission, declaredOnly, part: criterion.obligation?.part ?? null, mixed: Boolean(criterion.judgedPart) }),
        reading: criterion.rationale,
        quotes: criterion.evidence.map(briefQuoteOf).slice(0, 2),
        absence: omission ? { opportunity: null } : null,
        declaredOnly,
        rules: [...rulesOf(criterion), ...(criterion.guidance?.ruleLines ?? []).filter((line) => line.text !== criterion.text && !(criterion.sources ?? []).some((source) => source.handle === line.handle)).slice(0, 2).map((line) => ({ text: line.text, section: cleanHeading(line.heading), documentId: criterion.documentId, documentTitle: input.documentTitles.get(criterion.documentId) ?? "Procedimento", leadIn: leadInOfHandle(line.handle) }))],
        guidance: criterion.guidance ? { moment: criterion.guidance.moment, condition: criterion.guidance.condition, action: criterion.guidance.action } : null,
        whyItMatters: null,
        history: historySentence(input.history.get(keyOf(criterion)), "DEVELOPMENT"),
        criterionKeys: [keyOf(criterion)],
        stats: [],
        sameList: sameListOf(criterion),
        ...((criterion.notAssessedInSameList ?? []).length > 0 ? { notAssessedInSameList: criterion.notAssessedInSameList } : {}),
        ...(reevaluated(criterion) ? { ruleBasis: "CURRENT_RULE_REEVALUATION" as const } : {}),
        practiceKeys: [input.practices?.get(keyOf(criterion))?.practiceKey ?? keyOf(criterion)],
        ...(input.history.get(keyOf(criterion)) ? { recurrence: { assessed: input.history.get(keyOf(criterion))!.assessed, notMet: input.history.get(keyOf(criterion))!.notMet } } : {}),
        firmness: firmnessOf({ ruleBasis: reevaluated(criterion) ? "CURRENT_RULE_REEVALUATION" : null, materiality: criterion.materiality, recurrence: input.history.get(keyOf(criterion)) ?? null, priorOrientation: input.practices?.get(keyOf(criterion))?.priorOrientation ?? null }),
        role: criterion.scenarioRole ?? null,
        ...(criterion.occurrence?.basis === "REVIEW_SAME_CONDUCT" ? { occurrenceKey: criterion.occurrence.key } : {}),
        ...(criterion.judgedPart ? { evaluatedPart: criterion.judgedPart } : {}),
      }
      if (input.delivered.has(findingKey)) suppressed.push({ findingKey, title: finding.title, reason: "ALREADY_DELIVERED" })
      else developments.push(finding)
    } else if (isStrength(criterion)) {
      const declaredOnly = criterion.evidenceKind === "DECLARED_ACTION"
      const finding: BriefFinding = {
        ref: "",
        findingKey,
        kind: "STRENGTH",
        origin: "CRITERION",
        title: titleOf(criterion),
        materiality: criterion.materiality,
        status: criterion.status,
        observed: verifiedStatementOf({ kind: "STRENGTH", status: criterion.status, omission: false, declaredOnly, part: criterion.obligation?.part ?? null, mixed: Boolean(criterion.judgedPart) }),
        reading: criterion.rationale,
        // Conduta (fala do operador) e, se a regra é condicional, a fala que mostra a condição NESTA chamada (o porquê do caso).
        quotes: [...criterion.evidence.filter((quote) => briefQuoteOf(quote).speaker === "OPERATOR").map(briefQuoteOf).slice(0, 2), ...situationQuotesOf(criterion)].filter((quote, index, all) => all.findIndex((other) => other.turn === quote.turn && other.text === quote.text) === index).slice(0, 3),
        absence: null,
        declaredOnly,
        rules: rulesOf(criterion),
        guidance: null,
        whyItMatters: criterion.whyItMatters,
        ...(situationQuotesOf(criterion).length > 0 ? { situational: true } : {}),
        history: historySentence(input.history.get(keyOf(criterion)), "STRENGTH"),
        criterionKeys: [keyOf(criterion)],
        stats: [],
        sameList: sameListOf(criterion),
        ...((criterion.notAssessedInSameList ?? []).length > 0 ? { notAssessedInSameList: criterion.notAssessedInSameList } : {}),
        role: criterion.scenarioRole ?? null,
        ...(criterion.occurrence?.basis === "REVIEW_SAME_CONDUCT" ? { occurrenceKey: criterion.occurrence.key } : {}),
        ...(criterion.judgedPart ? { evaluatedPart: criterion.judgedPart } : {}),
      }
      if (input.delivered.has(findingKey)) suppressed.push({ findingKey, title: finding.title, reason: "ALREADY_DELIVERED" })
      else strengths.push(finding)
    }
  }
  // Reconhecimento do CAMINHO quando a decisão foi correta e sustentada — o mérito da escolha, não só de uma etapa.
  if (analysis.scenario.pathAssessment === "CORRECT" && developments.length === 0) {
    const findingKey = `CALL:${input.interactionId}:PATH:${analysis.scenario.procedureDocumentId ?? "none"}`
    if (!input.delivered.has(findingKey)) {
      strengths.unshift({
        ref: "",
        findingKey,
        kind: "STRENGTH",
        origin: "PATH",
        title: "Condução do caso",
        materiality: "HIGH",
        status: "PATH_CORRECT",
        observed: verifiedStatementOf({ kind: "STRENGTH", status: "PATH_CORRECT", omission: false, declaredOnly: false }),
        reading: analysis.scenario.pathRationale || analysis.scenario.pathTaken || null,
        quotes: analysis.scenario.pathEvidence.filter((quote) => briefQuoteOf(quote).speaker === "OPERATOR").map(briefQuoteOf).slice(0, 2),
        absence: null,
        declaredOnly: false,
        rules: pathCriteria.filter((criterion) => criterion.status === "MET").slice(0, 2).map(ruleOf),
        guidance: null,
        whyItMatters: null,
        history: null,
        criterionKeys: pathCriteria.filter((criterion) => criterion.status === "MET").map(keyOf),
        stats: [],
      })
    }
  }
  const consolidated = consolidateDevelopments(developments)
  developments.splice(0, developments.length, ...consolidated)
  // Seleção dos reconhecimentos: poucos e os que MOSTRAM a conduta desta chamada (ver `consolidateStrengths`); o que ficou de fora
  // continua na memória e nos números da liderança.
  const selectedStrengths = consolidateStrengths(strengths, developments).slice(0, developments.length > 0 ? STRENGTHS_WITH_DEVELOPMENT : STRENGTHS_ALONE)
  developments.forEach((finding, index) => (finding.ref = `A${index + 1}`))
  selectedStrengths.forEach((finding, index) => (finding.ref = `S${index + 1}`))

  const materials = materialsOf(developments, input.documentVersions)
  const reevaluation = analysis.scenario.rulePerspective === "CURRENT_RULE_REEVALUATION"
  const context = [
    ...(analysis.scenario.pathAssessment === "PARTIALLY_CORRECT" ? ["Caminho: o indicado para o cenário, com etapas faltando."] : []),
    `Como a chamada chegou à análise: ${input.selectionReason}`,
    ...(analysis.scenario.procedureTitle ? [`Procedimento aplicado: ${analysis.scenario.procedureTitle}`] : []),
    ...(reevaluation ? ["A versão do procedimento usada foi publicada depois desta chamada: o que ela aponta é orientação para as próximas chamadas, não descumprimento de uma regra que valia na época."] : []),
    ...(analysis.criteria.some((criterion) => criterion.argument?.perspective === "CURRENT_RULE_REEVALUATION") ? ["Argumentários usados numa REAVALIAÇÃO pela regra atual (não estavam vigentes na data desta chamada): o que eles apontam é orientação para as próximas chamadas, não descumprimento da época."] : []),
  ]
  const scenarioQuotes = [...analysis.scenario.conditions.flatMap((condition) => condition.evidence), ...analysis.scenario.pathEvidence].map(briefQuoteOf).filter((quote, index, all) => all.findIndex((other) => other.turn === quote.turn && other.text === quote.text) === index).slice(0, 4)
  const openPoints = openPointsOf(analysis, input.interactionId, keyOf, rulesOf)
  const coverageLimits = coverageLimitsOf(analysis, keyOf)
  // `CENTRAL_NEED_V1`: necessidade central sem conclusão confirmada → a mensagem não a apresenta como resolvida nem acusa; o colaborador
  // lê, nos detalhes, que esse ponto não foi avaliado (regras LITERAIS das linhas apontadas — nunca o texto da revisão).
  const need = analysis.scenario.centralNeed ?? null
  const needOpen = need && (need.resolution === "GAP_UNCONFIRMED" || need.resolution === "NOT_DETERMINABLE")
  const needRules: BriefRule[] = needOpen ? (need.sourceLines ?? []).map((line) => ({ text: line.text, section: cleanHeading(line.heading), documentId: line.documentId, documentTitle: input.documentTitles.get(line.documentId) ?? "Procedimento", leadIn: input.listContext?.get(line.lineKey)?.leadIn ?? null })).slice(0, 3) : []
  const readerNotes = [
    ...(reevaluation ? ["Este retorno usa a versão atual do procedimento, publicada depois desta chamada: vale como orientação para as próximas chamadas."] : []),
    ...(analysis.transcriptStatus === "INCOMPLETE" ? ["Parte da conversa não está na transcrição: só o que aparece nela foi considerado."] : []),
    // Neutro: explica por que etapas feitas em sistemas não aparecem no retorno — nunca sugere que faltaram.
    ...(coverageLimits.some((limit) => limit.reason === "OUTSIDE_CONVERSATION" && limit.role === "CENTRAL") ? ["O que é feito em sistemas, fora da conversa, não aparece na gravação e não foi avaliado neste retorno."] : []),
    ...(needOpen ? ["A gravação não permitiu concluir se a orientação sobre a necessidade principal do cliente ficou completa: esse ponto não conta como acerto nem como falha neste retorno."] : []),
  ]
  const tone: FeedbackBrief["tone"] = developments.length === 0 ? "RECOGNITION" : selectedStrengths.length === 0 ? "DEVELOPMENT" : "MIXED"
  return {
    version: COMPOSITION_VERSION,
    domain: "MONITORING",
    label: input.label,
    heading: { title: input.label, subtitle: `Atendimento de ${input.dateLabel}`, ...(input.subjectSource ? { subjectSource: input.subjectSource } : {}) },
    context,
    situation: analysis.scenario.customerNeed || null,
    scenarioQuotes,
    ...(openPoints.length > 0 ? { openPoints } : {}),
    readerNotes,
    ...(coverageLimits.length > 0 ? { coverageLimits } : {}),
    ...(needOpen ? { centralNeedOpen: { rules: needRules } } : {}),
    developments,
    strengths: selectedStrengths,
    limitations: analysis.limitations.filter((limitation) => !/item\(ns\) do caminho/.test(limitation) || analysis.coverage.status === "PARTIAL"),
    materials,
    officialLines: [],
    indicatorName: null,
    tone,
    suppressed,
    rulePerspective: analysis.scenario.rulePerspective,
  }
}

/** Com uma regra por origem (`RULE_SOURCES_V1`), um ponto de duas etapas já tem 4–6 regras (base, argumentário, "evitar"). */
const RULES_PER_POINT = 8
const STEPS_PER_POINT = 8
const stepOf = (finding: BriefFinding): BriefStep => ({ title: finding.title, status: finding.status as CriterionStatus, quotes: finding.quotes.slice(0, 2), absentInCall: Boolean(finding.absence), declaredOnly: finding.declaredOnly, rule: finding.rules[0] ?? null, ...(finding.rules.length > 1 ? { rules: finding.rules } : {}), findingKey: finding.findingKey })
/** Título de um ponto que junta etapas de uma mesma origem: o nome do argumentário (a seção dele é só o campo do cadastro) ou a seção da base. */
const groupTitleOf = (rule: BriefRule | undefined, fallback: string) => (rule?.sourceKind === "ARGUMENT_SCRIPT" ? rule.argumentName ?? fallback : rule?.section ?? fallback)
/**
 * CONSOLIDAÇÃO do que é o MESMO comportamento (a mensagem não repete o mesmo ajuste em vários pontos):
 *   - caminho INADEQUADO absorve as etapas do próprio caminho que não foram cumpridas (a escolha errada é o ponto; as etapas são a
 *     prova e ficam nas regras/detalhes);
 *   - duas ou mais etapas não cumpridas da MESMA seção do MESMO documento viram um ponto, com todas as regras literais.
 * Nada some: cada achado fica em `memberFindingKeys`/`criterionKeys` (memória, supressão e analytics por critério).
 */
export function consolidateDevelopments(developments: readonly BriefFinding[]): BriefFinding[] {
  const path = developments.find((finding) => finding.origin === "PATH")
  const pathKeys = new Set(path?.criterionKeys ?? [])
  // Etapa REINCIDENTE (já orientada antes, ou não cumprida em outras chamadas) é ponto próprio: absorvida pelo caminho ela sumia da
  // mensagem (validação V14C: "recapitulação não cumprida em 7 das 8 chamadas anteriores" estava no brief e o texto não falou dela).
  const recurring = (finding: BriefFinding) => finding.firmness?.level === "INSIST" || (finding.recurrence?.notMet ?? 0) >= RECURRENCE_FOR_CORRECTION
  const absorbed = path ? developments.filter((finding) => finding.origin === "CRITERION" && finding.criterionKeys.some((key) => pathKeys.has(key)) && !recurring(finding)) : []
  const out: BriefFinding[] = []
  if (path) {
    const rules = [...path.rules, ...absorbed.flatMap((finding) => finding.rules)].filter((rule, index, all) => all.findIndex((other) => other.text === rule.text && other.documentId === rule.documentId) === index)
    const members = [path, ...absorbed]
    out.push({
      ...path,
      rules: rules.slice(0, RULES_PER_POINT),
      criterionKeys: [...new Set([...path.criterionKeys, ...absorbed.flatMap((finding) => finding.criterionKeys)])],
      memberFindingKeys: absorbed.map((finding) => finding.findingKey),
      quotes: path.quotes.length > 0 ? path.quotes : absorbed.flatMap((finding) => finding.quotes).slice(0, 2),
      ...(absorbed.length > 0 ? { steps: absorbed.slice(0, STEPS_PER_POINT).map(stepOf) } : {}),
      // As etapas absorvidas continuam com a reincidência e o tom delas (rodada real V14: o caminho absorvia tudo e a recapitulação
      // repetida em outras chamadas sumia do ponto).
      history: memberHistoryOf(members),
      ...(members.some((finding) => finding.practiceKeys) ? { practiceKeys: [...new Set(members.flatMap((finding) => finding.practiceKeys ?? []))] } : {}),
      ...(strongestFirmness(members.map((finding) => finding.firmness)) ? { firmness: strongestFirmness(members.map((finding) => finding.firmness))! } : {}),
    })
  }
  const remaining = developments.filter((finding) => finding !== path && !absorbed.includes(finding))
  const groups = new Map<string, BriefFinding[]>()
  // A mesma PRÁTICA (`PRACTICE_IDENTITY_V1`: a leitura que organizou a base disse que duas regras pedem a mesma conduta) julgada por
  // mais de uma regra nesta chamada é UM ponto — como a mesma ocorrência.
  const practiceCount = new Map<string, number>()
  for (const finding of remaining) for (const key of new Set(finding.practiceKeys ?? [])) practiceCount.set(key, (practiceCount.get(key) ?? 0) + 1)
  for (const finding of remaining) {
    const rule = finding.rules[0]
    const sharedPractice = (finding.practiceKeys ?? []).find((key) => (practiceCount.get(key) ?? 0) > 1)
    // A MESMA ocorrência (mesma conduta julgada por regras diferentes) e a mesma prática vêm antes do agrupamento por seção.
    const key = finding.occurrenceKey ? `occ:${finding.occurrenceKey}` : sharedPractice ? `prc:${sharedPractice}` : finding.origin === "CRITERION" && rule ? `${rule.documentId}|${rule.section ?? ""}` : `single:${finding.findingKey}`
    groups.set(key, [...(groups.get(key) ?? []), finding])
  }
  for (const [groupKey, members] of groups.entries()) {
    if (members.length === 1) {
      out.push(members[0]!)
      continue
    }
    const [lead] = [...members].sort((a, b) => roleRankOf(a.role) - roleRankOf(b.role) || byMateriality(a, b))
    const allOmission = members.every((finding) => finding.absence)
    const anyPartial = members.some((finding) => finding.status === "PARTIAL")
    const sameConduct = groupKey.startsWith("occ:") || groupKey.startsWith("prc:")
    out.push({
      ...lead!,
      // Mesma conduta: o ponto é a conduta (título e fato do ponto principal); seção com várias etapas: o título é a seção.
      title: sameConduct ? lead!.title : groupTitleOf(lead!.rules[0], lead!.title),
      // Tudo não cumprido = não cumprido; qualquer parte feita = feito só em parte (a recapitulação incompleta não "deixou de existir").
      status: members.every((finding) => finding.status === "NOT_MET") ? "NOT_MET" : "PARTIAL",
      observed: sameConduct ? lead!.observed : allOmission ? "Estas etapas não aparecem nesta chamada." : anyPartial ? "Estas etapas foram feitas só em parte ou não foram cumpridas nesta chamada." : "A conduta nesta chamada não seguiu o que estas etapas pedem.",
      reading: members.map((finding) => finding.reading).filter(Boolean).join(" ") || null,
      quotes: members.flatMap((finding) => finding.quotes).filter((quote, index, all) => all.findIndex((other) => other.turn === quote.turn && other.text === quote.text) === index).slice(0, 2),
      absence: allOmission ? { opportunity: null } : null,
      declaredOnly: members.every((finding) => finding.declaredOnly),
      rules: withoutRepeatedLeadIns(members.flatMap((finding) => finding.rules)).slice(0, RULES_PER_POINT),
      guidance: members.find((finding) => finding.guidance)?.guidance ?? null,
      history: memberHistoryOf(members),
      criterionKeys: [...new Set(members.flatMap((finding) => finding.criterionKeys))],
      memberFindingKeys: members.filter((finding) => finding !== lead).map((finding) => finding.findingKey),
      steps: members.slice(0, STEPS_PER_POINT).map(stepOf),
      sameList: members.flatMap((finding) => finding.sameList ?? []).filter((sibling, index, all) => !members.some((member) => member.rules.some((rule) => rule.text === sibling.text)) && all.findIndex((other) => other.text === sibling.text) === index).slice(0, 12),
      ...(members.some((finding) => (finding.notAssessedInSameList ?? []).length > 0) ? { notAssessedInSameList: [...new Set(members.flatMap((finding) => finding.notAssessedInSameList ?? []))].slice(0, 10) } : {}),
      role: bestRole(members.map((finding) => finding.role)),
      ...(members.some((finding) => finding.practiceKeys) ? { practiceKeys: [...new Set(members.flatMap((finding) => finding.practiceKeys ?? []))] } : {}),
      ...(strongestFirmness(members.map((finding) => finding.firmness)) ? { firmness: strongestFirmness(members.map((finding) => finding.firmness))! } : {}),
    })
  }
  return out.sort((a, b) => Number(b.origin === "PATH") - Number(a.origin === "PATH") || roleRankOf(a.role) - roleRankOf(b.role) || byMateriality(a, b))
}

/**
 * Histórico de um ponto consolidado: o de cada etapa membro, identificado pelo título (frase do sistema). "Esta etapa" de um membro solto
 * num ponto com várias etapas ficaria ambíguo; um membro só = a frase dele como está.
 */
function memberHistoryOf(members: readonly BriefFinding[]): string | null {
  // Uma frase por PRÁTICA: etapas da mesma prática (mesma linha-âncora) têm o mesmo histórico.
  const byPractice = new Map<string, BriefFinding>()
  for (const finding of members) {
    const key = finding.practiceKeys?.[0] ?? finding.findingKey
    if (finding.history && !byPractice.has(key)) byPractice.set(key, finding)
  }
  const practices = new Set(members.map((finding) => finding.practiceKeys?.[0] ?? finding.findingKey))
  const withHistory = [...byPractice.values()]
  if (withHistory.length === 0) return null
  if (practices.size === 1) return withHistory[0]!.history
  return withHistory.map((finding) => `Sobre “${finding.title}”: ${finding.history!.charAt(0).toLocaleLowerCase("pt-BR")}${finding.history!.slice(1)}`).join(" ")
}

/** Regras sem repetição: a frase que abre a lista já vai junto dos itens (`leadIn`), então não aparece de novo sozinha. */
function withoutRepeatedLeadIns(rules: readonly BriefRule[]): BriefRule[] {
  const leadIns = new Set(rules.map((rule) => rule.leadIn?.trim()).filter(Boolean))
  return rules.filter((rule, index, all) => !leadIns.has(rule.text.trim()) && all.findIndex((other) => other.text === rule.text) === index)
}

/**
 * RECONHECIMENTO que mostra a conduta desta chamada (nunca a lista das etapas cumpridas) — `STRENGTH_SELECTION_V3`:
 *   - acertos da MESMA seção viram um ponto (a prática inteira: "explicou a composição da conta" = nome, valor, data, origem…);
 *   - prioridade: caminho correto; depois o PAPEL NO CASO (central = ligado à necessidade do cliente ou à decisão do caso, antes de
 *     apoio, antes de rotina), a materialidade e a conduta OBSERVADA (fala verificada do operador; ação só declarada vale menos e
 *     "não fez o que é proibido" fica por último). NÃO contam: quantos itens a seção tem nem a regra ser condicional;
 *   - seção que também tem ajuste perde prioridade (a mensagem não elogia e corrige o mesmo trecho do procedimento);
 *   - dois reconhecimentos não mostram a MESMA fala.
 * V1 escolhia pela quantidade de etapas cumpridas na seção (validação e escuta venciam); V2 dava bônus fixo à regra condicional —
 * nenhum dos dois mede o que importou no caso.
 */
export function consolidateStrengths(strengths: readonly BriefFinding[], developments: readonly BriefFinding[]): BriefFinding[] {
  const sectionKey = (finding: BriefFinding) => (finding.occurrenceKey ? `occ:${finding.occurrenceKey}` : finding.origin === "CRITERION" && finding.rules[0] ? `${finding.rules[0].documentId}|${finding.rules[0].section ?? ""}` : `single:${finding.findingKey}`)
  const developedSections = new Set(developments.flatMap((finding) => finding.rules.map((rule) => `${rule.documentId}|${rule.section ?? ""}`)))
  const groups = new Map<string, BriefFinding[]>()
  for (const finding of strengths) groups.set(sectionKey(finding), [...(groups.get(sectionKey(finding)) ?? []), finding])
  const conduct = (finding: BriefFinding) => (finding.quotes.some((quote) => quote.speaker === "OPERATOR") ? 2 : finding.declaredOnly ? 1 : 0)
  const scored = [...groups.entries()].map(([key, members]) => {
    const [lead] = [...members].sort((a, b) => roleRankOf(a.role) - roleRankOf(b.role) || conduct(b) - conduct(a) || byMateriality(a, b))
    const sameConduct = key.startsWith("occ:")
    const merged: BriefFinding = members.length === 1 ? members[0]! : {
      ...lead!,
      title: sameConduct ? lead!.title : groupTitleOf(lead!.rules[0], lead!.title),
      observed: sameConduct ? lead!.observed : members.every((finding) => finding.declaredOnly) ? "Na conversa, você informou ao cliente que fez estas etapas." : "Estas etapas foram cumpridas nesta chamada.",
      reading: members.map((finding) => finding.reading).filter(Boolean).join(" ") || null,
      quotes: members.flatMap((finding) => finding.quotes).filter((quote, index, all) => all.findIndex((other) => other.turn === quote.turn && other.text === quote.text) === index).slice(0, 3),
      declaredOnly: members.every((finding) => finding.declaredOnly),
      rules: withoutRepeatedLeadIns(members.flatMap((finding) => finding.rules)).slice(0, RULES_PER_POINT),
      whyItMatters: members.map((finding) => finding.whyItMatters).find(Boolean) ?? null,
      history: members.map((finding) => finding.history).find(Boolean) ?? null,
      criterionKeys: [...new Set(members.flatMap((finding) => finding.criterionKeys))],
      memberFindingKeys: members.filter((finding) => finding !== lead).map((finding) => finding.findingKey),
      sameList: [],
      ...(members.some((finding) => (finding.notAssessedInSameList ?? []).length > 0) ? { notAssessedInSameList: [...new Set(members.flatMap((finding) => finding.notAssessedInSameList ?? []))].slice(0, 10) } : {}),
      ...(members.some((finding) => finding.situational) ? { situational: true } : {}),
      role: bestRole(members.map((finding) => finding.role)),
    }
    const best = Math.max(...members.map(conduct))
    const role = bestRole(members.map((finding) => finding.role))
    const materiality = members.some((finding) => finding.materiality === "HIGH") ? 2 : members.some((finding) => finding.materiality === "MEDIUM") ? 1 : 0
    const score = members.some((finding) => finding.origin === "PATH") ? 10_000 : ((2 - roleRankOf(role)) * 100 + materiality * 10 + best) * (developedSections.has(key) ? 0.25 : 1) - (best === 0 ? 1_000 : 0)
    return { merged, score, high: members.filter((finding) => finding.materiality === "HIGH").length }
  })
  const ranked = scored.sort((a, b) => b.score - a.score || b.high - a.high).map((entry) => entry.merged)
  // Momentos distintos: o grupo cujos TRECHOS do operador já aparecem todos num reconhecimento anterior não repete aquela fala
  // (pelo trecho citado, não pelo turno: um turno pode trazer duas condutas diferentes — prazo e crédito na mesma fala).
  const normalize = (text: string) => text.toLocaleLowerCase("pt-BR").replace(/\s+/gu, " ").trim()
  const quotesOf = (finding: BriefFinding) => finding.quotes.flatMap((quote) => (quote.speaker === "OPERATOR" ? [normalize(quote.text)] : []))
  const distinct: BriefFinding[] = []
  const repeated: BriefFinding[] = []
  const seen: string[] = []
  for (const finding of ranked) {
    const quotes = quotesOf(finding)
    if (finding.origin !== "PATH" && quotes.length > 0 && quotes.every((quote) => seen.some((shown) => shown.includes(quote) || quote.includes(shown)))) repeated.push(finding)
    else distinct.push(finding)
    seen.push(...quotes)
  }
  return [...distinct, ...repeated]
}

/** Material recomendado = o documento das regras que sustentam os AJUSTES (nunca "toda a base"), com o motivo. */
export function materialsOf(developments: readonly BriefFinding[], documentVersions: ReadonlyMap<string, number>): BriefMaterial[] {
  const byDocument = new Map<string, BriefMaterial>()
  for (const finding of developments) {
    for (const rule of finding.rules) {
      // Regra de argumentário não é documento da base: nunca vira material recomendado (a origem aparece no próprio ponto).
      if (rule.sourceKind === "ARGUMENT_SCRIPT") continue
      const material = byDocument.get(rule.documentId) ?? { documentId: rule.documentId, documentVersion: documentVersions.get(rule.documentId) ?? null, title: rule.documentTitle, sections: [], reason: "", criterionKeys: [], usedIn: [] }
      if (rule.section && !material.sections.includes(rule.section)) material.sections.push(rule.section)
      for (const key of finding.criterionKeys) if (!material.criterionKeys.includes(key)) material.criterionKeys.push(key)
      if (!material.usedIn.includes(finding.title)) material.usedIn.push(finding.title)
      byDocument.set(rule.documentId, material)
    }
  }
  return [...byDocument.values()].map((material) => ({ ...material, reason: `Sustenta o ajuste em: ${material.usedIn.join("; ")}${material.sections.length > 0 ? ` (seções: ${material.sections.join("; ")})` : ""}.` }))
}

/**
 * FATOS que sustentam números e afirmações da mensagem (a checagem de números usa esta lista). Só o que é verificado: nunca a
 * justificativa, a orientação, o "por que importa" ou a situação lidos pelo modelo.
 */
export function groundingTextsOf(brief: FeedbackBrief): string[] {
  const findings = [...brief.developments, ...brief.strengths]
  return [
    brief.label,
    brief.heading.subtitle ?? "",
    ...brief.context,
    ...brief.officialLines.flatMap((line) => [line.label, line.value]),
    ...brief.limitations,
    ...(brief.scenarioQuotes ?? []).map((quote) => quote.text),
    ...findings.flatMap((finding) => [finding.title, finding.observed, finding.history ?? "", ...finding.stats, ...finding.quotes.map((quote) => quote.text), ...finding.rules.flatMap((rule) => [rule.leadIn ?? "", rule.text, rule.phrasing?.text ?? ""]), ...(finding.sameList ?? []).map((sibling) => sibling.text)]),
    ...(brief.openPoints ?? []).flatMap((point) => [point.title, point.why, ...point.quotes.map((quote) => quote.text), ...point.rules.flatMap((rule) => [rule.leadIn ?? "", rule.text])]),
    ...(brief.referencePractices ?? []).flatMap((practice) => [practice.title, practice.group, practice.you ?? "", practice.rule.text]),
  ]
}


/**
 * PONTOS EM ABERTO (V5): etapa DA CONVERSA (comunicar, perguntar, orientar) de papel CENTRAL que terminou "não observável" — descarte
 * reaberto pela revisão, revisão incerta ou aplicabilidade incerta — e que tem FALA verificada ligando-a ao caso (a necessidade
 * concreta). Não é acerto nem desvio. Execução FORA da conversa (sistema/registro) nunca vira ponto em aberto: o redator não tem como
 * orientar sobre o que a gravação não mostra sem insinuar falha ("se você ainda não…") — fica como limite de cobertura.
 */
function openPointsOf(analysis: VerifiedCallAnalysis, interactionId: string, keyOf: (criterion: AssessedCriterion) => string, rulesOf: (criterion: AssessedCriterion) => BriefRule[]): BriefOpenPoint[] {
  // A própria exigência acontece fora da conversa (sistema/registro). "Depende de uma ação interna" (aplicabilidade) não é isso: a
  // exigência continua sendo algo a dizer ao cliente.
  const outside = (criterion: AssessedCriterion) => criterion.observability === "OUTSIDE_CONVERSATION" || (criterion.observability === undefined && criterion.itemNature === "INTERNAL_ACTION") || (criterion.review?.issues ?? []).includes("INTERNAL_ACTION_NOT_OBSERVABLE")
  const reopened = (criterion: AssessedCriterion) => criterion.origin === "REVIEW_CHALLENGE" && criterion.status === "NOT_OBSERVABLE"
  const uncertain = (criterion: AssessedCriterion) => (criterion.confirmation === "UNCONFIRMED" && criterion.confirmationReasons.includes("REVIEW_UNCERTAIN")) || criterion.applicability === "UNCERTAIN"
  const quotesOf = (criterion: AssessedCriterion) => [...(criterion.review?.conditionEvidence ?? []), ...(criterion.applicabilityEvidence ?? []), ...criterion.evidence].map(briefQuoteOf).filter((quote, position, all) => all.findIndex((other) => other.turn === quote.turn && other.text === quote.text) === position).slice(0, 3)
  return analysis.criteria
    .filter((criterion) => criterion.status === "NOT_OBSERVABLE" && criterion.scenarioRole === "CENTRAL" && !criterion.ruleConflict && !outside(criterion) && (reopened(criterion) || uncertain(criterion)) && quotesOf(criterion).length > 0)
    .slice(0, MAX_OPEN_POINTS)
    .map((criterion, index) => ({
      ref: `O${index + 1}`,
      findingKey: `CALL:${interactionId}:${keyOf(criterion)}`,
      title: criterionTitleOf(criterion),
      nature: criterion.itemNature ?? null,
      why: criterion.applicability === "UNCERTAIN" ? "A conversa não permite saber se esta regra valia neste caso: não é falha nem acerto." : "A conversa não permite concluir sobre esta etapa: não é falha nem acerto.",
      rules: rulesOf(criterion),
      quotes: quotesOf(criterion),
    }))
}

/** LIMITES DE COBERTURA: exigências que a evidência disponível não permite avaliar (fora da conversa; aplicabilidade incerta). */
function coverageLimitsOf(analysis: VerifiedCallAnalysis, keyOf: (criterion: AssessedCriterion) => string): BriefCoverageLimit[] {
  return [
    ...analysis.criteria
      .filter((criterion) => criterion.status === "NOT_OBSERVABLE" && !criterion.ruleConflict && (criterion.observability === "OUTSIDE_CONVERSATION" || criterion.applicability === "UNCERTAIN"))
      .map((criterion) => ({ title: criterionTitleOf(criterion), reason: criterion.observability === "OUTSIDE_CONVERSATION" ? ("OUTSIDE_CONVERSATION" as const) : ("APPLICABILITY_UNCERTAIN" as const), executionClaim: criterion.executionClaim ?? null, role: criterion.scenarioRole ?? null, criterionKey: keyOf(criterion), ...saidInOf(criterion, criterion.executionClaim ?? null, () => true) })),
    // Obrigação MISTA confirmada: a parte em sistema é limite de cobertura (o que a fala mostra sobre ela fica registrado).
    ...analysis.criteria
      .filter((criterion) => criterion.operationalPart && !criterion.ruleConflict)
      .map((criterion) => ({ title: criterion.operationalPart!.text, reason: "OUTSIDE_CONVERSATION" as const, executionClaim: criterion.operationalPart!.executionClaim, role: criterion.scenarioRole ?? null, criterionKey: keyOf(criterion), ...saidInOf(criterion, criterion.operationalPart!.executionClaim, (index) => ["DECLARATION", "INTENTION"].includes(criterion.evidenceRoles?.[index] ?? "")) })),
  ]
}
/** Falas verificadas do operador que declaram/anunciam a execução (só quando a conclusão registrou a declaração). */
function saidInOf(criterion: AssessedCriterion, claim: BriefCoverageLimit["executionClaim"], include: (index: number) => boolean): { saidIn?: { turn: string; quote: string }[] } {
  if (claim !== "DECLARED" && claim !== "INTENDED") return {}
  const said = criterion.evidence.flatMap((quote, index) => (speakerKind(quote.speaker) === "OPERATOR" && include(index) ? [{ turn: quote.turn, quote: quote.quote }] : []))
  return said.length > 0 ? { saidIn: said.slice(0, 3) } : {}
}
