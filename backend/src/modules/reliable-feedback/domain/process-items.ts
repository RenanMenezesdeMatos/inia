import { projectDisplayEvidence, type DisplayProjectionContext } from "../../investigation/domain/feedback-display-evidence.js"
import { buildKnowledgeMaterialHref } from "../../knowledge/domain/material-href.js"
import type { VerifiedCheckpoint, VerifiedProcessAssessment } from "./process-assessment.js"
import type { ReliableBehaviorRef, ReliableFact, ReliableFactRole, ReliableItemDraft, ReliableKnowledgeRef, ReliableProcessRef } from "./reliable-feedback-item.js"
import { exampleTextsOfSegments } from "./knowledge-segments.js"
import { compositeListOf } from "./composite-checkpoint.js"
import { LEADING_LIST_MARKER } from "../../knowledge/domain/knowledge-list.js"
import { checkpointReadinessOf, isObservationEligibleForAnalytics } from "../../indicator-diagnosis/domain/observation-readiness.js"
import { verifiedAbsenceDisplayOf } from "./verified-absence-display.js"

/**
 * V1.6.0 — ITENS DO FEEDBACK NASCIDOS DO DIAGNÓSTICO DE PROCESSO (domínio puro). O feedback não nasce de um "achado" solto:
 * cada item é UMA etapa de processo verificada.
 *
 *   FOLLOWED     + fala do operador verificada + regra da base ≥ LITERAL_ONLY → PONTO FORTE (MONITORING_STRENGTH)
 *   NOT_FOLLOWED + fala do operador verificada + regra da base ≥ LITERAL_ONLY → PONTO DE DESENVOLVIMENTO
 *   FOLLOWED/NOT_FOLLOWED com a regra NÃO verificada → item BLOQUEADO (KNOWLEDGE_NOT_VERIFIED; só auditoria)
 *   NOT_OBSERVABLE / NOT_APPLICABLE → nenhum item (ficam na avaliação, como limite/escopo)
 *
 * TAMANHO (V1.7.1a): o feedback tem o tamanho necessário para comunicar TODOS os achados confiáveis — não existe limite
 * editorial (a V1.6.0 cortava em 3 desenvolvimentos + 2 fortes e o excedente sumia do feedback). A ordem é DETERMINÍSTICA
 * (`PROCESS_ITEM_ORDER_V1`), ordena e nunca esconde:
 *   1. pontos de desenvolvimento antes de pontos fortes (o que mudar vem primeiro);
 *   2. regra ancorada na conversa (VERIFIED) antes de regra só literal; etapa sem regra verificada (bloqueada) por último;
 *   3. ordem do procedimento: avaliação de origem (processo) e, dentro dela, a posição do trecho no documento publicado;
 *   4. empate: a ordem em que a avaliação listou as etapas.
 * Etapas IGUAIS (mesmo documento, mesmo trecho verificado, mesmo status — p.ex. dois especialistas avaliando o mesmo passo)
 * viram UM item; as refs fundidas ficam em `collapsedCheckpoints` (linhagem preservada). Não há conceito de "criticidade"
 * na base hoje — nada é inventado para a ordem. Nada obriga as duas seções.
 */
export const PROCESS_ITEM_ORDER_VERSION = "PROCESS_ITEM_ORDER_V1" as const

export const PROCESS_SAFE_MEANING = {
  strength: "etapa do processo oficial cumprida nesta interação, sustentada por fala literal do operador e pela regra da base",
  development: "etapa do processo oficial não cumprida nesta interação, sustentada por fala literal do operador e pela regra da base",
  /** V1.7.1 — omissão verificada: a etapa se aplicava, havia oportunidade e não aconteceu. */
  omission: "etapa obrigatória do processo oficial que não aconteceu nesta interação (processo aplicável, janela completa, houve oportunidade e nenhuma fala do operador a cumpriu); a fala do operador mostra o momento em que ela caberia",
} as const

/**
 * NOME CANÔNICO DA ETAPA (V1.7.1d — `CHECKPOINT_LABEL_V2`): o nome EXIBIDO vem da regra da base, nunca de texto livre do modelo,
 * e nunca altera a regra (o trecho literal completo continua no item e é o que se cita).
 *   1. trecho de UMA linha (ou uma única linha de lista dentro do trecho) → essa linha, sem o marcador da lista ("1.", "-",
 *      "[ ]"), sem pontuação final e sem a cláusula condicional final (", quando permitido") — "1. Cancelar a recorrência,
 *      quando permitido;" → "Cancelar a recorrência";
 *   2. frase de abertura sozinha com conteúdo ("Sempre informar prazo de forma objetiva:") → a própria frase, sem ":";
 *   3. abertura de lista com vários itens ("O operador deverá permitir que o cliente explique: - …"), abertura sem conteúdo
 *      ("Evitar:") ou linha longa demais → o TÍTULO DA SEÇÃO do trecho, sem numeração ("35. Prazo da análise" → "Prazo da
 *      análise");
 *   4. senão, o requisito declarado SÓ se estiver literalmente dentro da regra; senão null (etapa sem nome = QA).
 */
export const CHECKPOINT_LABEL_VERSION = "CHECKPOINT_LABEL_V2" as const
const MAX_STEP_TITLE_CHARS = 90
/** V1.7.1k — marcador da representação canônica de lista (inclui "(n)"). */
const LIST_MARKER = LEADING_LIST_MARKER
const CONDITION_TAIL = /,\s*(?:quando|se|caso|desde\s+que)\b.*$/iu
const LEAD_IN_ONLY = /^(?:evit(?:ar|e)|(?:é\s+)?proibid[oa]s?|exemplos?|modelo|perguntar|registrar|consultar|confirmar|verificar|informar|antes\s+de\s+finalizar|o\s+operador\s+dever[áa])$/iu
const capitalize = (text: string) => (text.length > 0 ? text[0]!.toLocaleUpperCase("pt-BR") + text.slice(1) : text)
const cleanLine = (text: string) => text.replace(/[*_`]/g, "").replace(LIST_MARKER, "").replace(/\s+/g, " ").trim().replace(/[;:.,?!]+$/, "").trim()
/** "35. Prazo da análise" / "2.1 Respeito" → sem a numeração editorial. */
/** V1.7.4 — código interno do documento no início do título ("ARG-001 · Negociação", "PRC-12 — Troca") nunca chega ao operador. */
const INTERNAL_SECTION_CODE = /^\s*\p{Lu}{2,8}[-_ ]?\d{1,5}\s*[·\-–—:|]\s*/u
/** V1.7.4 — título longo com complemento entre parênteses ("Orientações para uso … (diretrizes transversais — …)"): o complemento
 * é nota do documento, não o assunto. */
const LONG_TITLE_NOTE = /\s*\([^)]{8,}\)\s*$/u
export const cleanSectionHeading = (heading: string) => (heading.length > 50 ? heading.replace(LONG_TITLE_NOTE, "") : heading).replace(INTERNAL_SECTION_CODE, "").replace(/^\s*\d+(?:\.\d+)*\.?\s+/, "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim()

const DANGLING_END = /(?<!\p{L})(?:e|ou|que|de|da|do|a|o|para|com|em|e\s+que|ou\s+que)$/iu
/** V1.7.4 — item de lista com RÓTULO próprio ("Promessas: Não garanta…", "Validação prévia: Sempre valide…"): o rótulo é o assunto. */
export function itemTopicLabelOf(line: string): string | null {
  // Rótulo = substantivo curto antes de ":" — nunca a ABERTURA de uma lista ("Antes de encerrar, informar:", "Perguntar:"), que
  // tem vírgula ou termina em verbo.
  const match = /^([^:.;,“"«]{3,40}):\s+\S/u.exec(cleanLine(line))
  if (!match) return null
  const label = match[1]!.trim()
  const lastWord = label.split(/\s+/).at(-1) ?? ""
  if (/^\p{L}{3,}(?:ar|er|ir)$/iu.test(lastWord) || /^\p{L}+(?:e|a)$/iu.test(label) && label.split(/\s+/).length === 1 && /^(?:informe|pergunte|confirme|verifique|registre|explique|oriente)$/iu.test(label)) return null
  return label.split(/\s+/).length <= 4 && !/^(?:n[ãa]o|nunca|evitar|exemplo|observa[çc][ãa]o)$/iu.test(label) ? capitalize(label) : null
}
function labelFromLine(line: string): string | null {
  const cleaned = cleanLine(line)
  if (cleaned.length === 0 || /^[“"«]/.test(cleaned)) return null
  const topic = itemTopicLabelOf(line)
  if (topic) return topic
  const withoutCondition = cleaned.replace(CONDITION_TAIL, "").trim()
  // V1.7.4 — cortar a condição não pode deixar a frase pendurada ("… pelo aplicativo e que"): aí o nome vem da seção.
  if (DANGLING_END.test(withoutCondition)) return null
  const label = withoutCondition.split(/\s+/).length >= 2 ? withoutCondition : cleaned
  return label.length <= MAX_STEP_TITLE_CHARS ? capitalize(label) : null
}

export function stepTitleOf(requirement: string, quote: string | null | undefined, heading?: string | null, step?: string | null): string | null {
  // V1.7.1k — a citação escolheu um ITEM de lista (representação canônica): o nome é esse item, sem abertura nem marcador.
  if (step) { const label = labelFromLine(step); if (label) return label }
  if (quote) {
    const lines = quote.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && line !== "…" && line !== "...")
    const listLines = lines.filter((line) => LIST_MARKER.test(line))
    const first = lines[0] ?? ""
    const isLeadIn = first.endsWith(":") && !LIST_MARKER.test(first)
    if (lines.length === 1 && !isLeadIn) { const label = labelFromLine(first); if (label) return label }
    if (listLines.length === 1) { const label = labelFromLine(listLines[0]!); if (label) return label }
    if (lines.length === 1 && isLeadIn) {
      const leadIn = cleanLine(first)
      if (!LEAD_IN_ONLY.test(leadIn) && leadIn.split(/\s+/).length >= 3 && leadIn.length <= MAX_STEP_TITLE_CHARS) return capitalize(leadIn)
    }
    if (heading) { const section = cleanSectionHeading(heading); if (section.length > 0 && section.length <= MAX_STEP_TITLE_CHARS) return capitalize(section) }
    const rule = cleanLine(quote)
    const declared = cleanLine(requirement)
    if (declared.length > 0 && declared.length <= MAX_STEP_TITLE_CHARS && rule.toLowerCase().includes(declared.toLowerCase())) return capitalize(declared)
  }
  return null
}

const roleOf = (speaker: string | null): ReliableFactRole => (speaker === "OPERADOR" ? "OPERADOR" : speaker === "CLIENTE" ? "CLIENTE" : speaker === "EVENTO" ? "EVENTO" : "OUTRO")

/** V1.7.1i — o que o item precisa saber da etapa composta: estado e os itens (literais da regra) por situação. */
function completenessRefOf(completeness: NonNullable<VerifiedCheckpoint["completeness"]>): NonNullable<ReliableProcessRef["completeness"]> {
  const of = (status: string) => completeness.items.filter((item) => item.status === status).map((item) => item.text)
  return { status: completeness.status, family: completeness.family, observed: of("OBSERVED"), absent: of("VERIFIED_ABSENT"), unknown: [...of("UNKNOWN"), ...of("NOT_VERIFIABLE")], conditional: of("CONDITIONAL"), elsewhere: of("OBSERVED_ELSEWHERE"), notApplicable: of("NOT_APPLICABLE") }
}

/** V1.7.1k — prontidão analítica pela MESMA regra da observação persistida (`observation-readiness.ts`). */
function analyticReadinessOf(checkpoint: VerifiedCheckpoint) {
  const readiness = checkpointReadinessOf(checkpoint)
  return { status: readiness.status, reasons: [...readiness.reasons], eligible: isObservationEligibleForAnalytics({ status: checkpoint.status, completeness: checkpoint.completeness?.status ?? null, analyticsStatus: readiness.status }) }
}

function knowledgeRefOf(checkpoint: VerifiedCheckpoint): ReliableKnowledgeRef | null {
  const knowledge = checkpoint.knowledge
  if (!knowledge || knowledge.applicability === "NOT_VERIFIED" || !knowledge.documentId || !knowledge.quote) return null
  return {
    documentId: knowledge.documentId,
    documentTitle: knowledge.documentTitle,
    heading: knowledge.heading,
    version: knowledge.version,
    quote: knowledge.quote.trim(),
    applicability: knowledge.applicability,
    href: buildKnowledgeMaterialHref(knowledge.documentId),
    leadIn: knowledge.leadIn,
    detail: checkpoint.knowledgeDetail,
    applicabilityBasis: knowledge.applicabilityBasis,
    contentKind: knowledge.contentKind ?? "RULE_CONTENT",
    chunkIndex: knowledge.chunkIndex ?? null,
    ...(checkpoint.operativeRule ? { operativeRule: checkpoint.operativeRule } : {}),
    ...(knowledge.applicabilityBasis === "STRUCTURED_ANCHOR" && knowledge.structuredAnchor?.basis ? { structuredAnchorBasis: knowledge.structuredAnchor.basis } : {}),
    ...(checkpoint.sectionExamples && checkpoint.sectionExamples.length > 0 ? { sectionExamples: checkpoint.sectionExamples } : {}),
    ...(checkpoint.checkpointStep ? { step: checkpoint.checkpointStep } : {}),
    ...(knowledge.citedQuote && knowledge.segments ? { citedExamples: exampleTextsOfSegments(knowledge.segments) } : {}),
  }
}

/**
 * V1.7.1m — o COMPORTAMENTO canônico do ponto e as outras fontes oficiais dele (proveniência). `addsFacets` = a dimensão que a
 * fonte acrescenta ao avaliador (ex.: "próximo passo" além do prazo) — continua visível no feedback; as demais só na auditoria.
 */
function behaviorRefOf(checkpoint: VerifiedCheckpoint, all: readonly VerifiedCheckpoint[]): ReliableBehaviorRef | null {
  const canonical = checkpoint.canonical
  if (!canonical) return null
  const own = new Set(canonical.facets)
  const sources = all.filter((other) => other !== checkpoint && other.canonical?.primaryRef === checkpoint.ref && other.canonical.role !== "PRIMARY").flatMap((other) => {
    const knowledge = other.knowledge
    if (!knowledge?.quote) return []
    return [{ checkpointRef: other.ref, role: other.canonical!.role as "SUPPORTING" | "CONFLICTING", status: other.status, applicability: knowledge.applicability === "VERIFIED" ? "VERIFIED" as const : "LITERAL_ONLY" as const, documentId: knowledge.documentId, documentTitle: knowledge.documentTitle, heading: knowledge.heading, quote: (other.checkpointStep ?? knowledge.quote).trim(), leadIn: knowledge.leadIn, href: knowledge.documentId ? buildKnowledgeMaterialHref(knowledge.documentId) : null, facets: [...other.canonical!.facets], addsFacets: other.canonical!.facets.filter((facet) => !own.has(facet)) }]
  })
  // Etapa COMPOSTA: o nome da própria seção do procedimento ("Recapitulação obrigatória") é mais específico que o do comportamento.
  const title = (checkpoint.completeness || compositeListOf(checkpoint.knowledge?.quote)) && checkpoint.knowledge?.heading ? cleanSectionHeading(checkpoint.knowledge.heading) || canonical.title : canonical.title
  return { code: canonical.behavior, title, facets: [...new Set([...canonical.facets, ...sources.flatMap((source) => source.facets)])], conflict: canonical.conflict, sources, ...(canonical.compositeResolution ? { compositeResolution: { heading: canonical.compositeResolution.heading, fromQuote: canonical.compositeResolution.fromQuote, fromHeading: canonical.compositeResolution.fromHeading } } : {}) }
}

function itemOf(checkpoint: VerifiedCheckpoint, index: number, displayContext: DisplayProjectionContext, all: readonly VerifiedCheckpoint[] = [], assessmentMissing: readonly string[] = []): ReliableItemDraft {
  const strength = checkpoint.status === "FOLLOWED"
  const display = checkpoint.transcriptEvidence.map((unit, factIndex) => projectDisplayEvidence({ turnRef: unit.turnRef, speaker: unit.speaker, quote: unit.quote }, { factIndex, evidenceType: "FINDING_EVIDENCE" }, displayContext))
  const facts = display.flatMap((entry): ReliableFact[] => (entry.status === "DISPLAYED" ? [{ role: roleOf(entry.speaker), text: entry.text, truncated: entry.truncated, masked: entry.wasRedacted }] : []))
  const knowledge = knowledgeRefOf(checkpoint)
  const operatorShown = facts.some((fact) => fact.role === "OPERADOR")
  const stepTitle = stepTitleOf(checkpoint.requirement, knowledge?.quote, knowledge?.heading, checkpoint.checkpointStep ?? null)
  // V1.7.3 — omissão VERIFICADA cuja fala do momento não pode ser exibida (privacidade): a conclusão do sistema a representa.
  const absenceDisplay = verifiedAbsenceDisplayOf({ evidenceType: checkpoint.evidenceType, applicability: knowledge?.applicability, applicabilityBasis: knowledge?.applicabilityBasis, operatorFactShown: operatorShown, behavior: checkpoint.canonical?.behavior ?? null, label: stepTitle, evidenceCount: display.length })
  return {
    index,
    claimRef: checkpoint.ref,
    domain: "MONITORING",
    section: strength ? "STRENGTH" : "OPPORTUNITY",
    kind: strength ? "MONITORING_STRENGTH" : "MONITORING_DEVELOPMENT_POINT",
    polarity: strength ? "POSITIVE" : "NEGATIVE",
    ownership: checkpoint.ownership,
    safeMeaning: strength ? PROCESS_SAFE_MEANING.strength : checkpoint.evidenceType === "VERIFIED_OMISSION" ? PROCESS_SAFE_MEANING.omission : PROCESS_SAFE_MEANING.development,
    guidanceSource: strength ? "REINFORCEMENT" : "COACHING_SUGGESTION",
    grounding: knowledge ? checkpoint.guidance.grounding : "NO_GROUNDED_GUIDANCE",
    knowledge,
    process: { title: checkpoint.processTitle, requirement: checkpoint.requirement, status: strength ? "FOLLOWED" : "NOT_FOLLOWED", checkpointRef: checkpoint.ref, analyticReadiness: analyticReadinessOf(checkpoint), evidenceType: checkpoint.evidenceType, stepTitle, ...(checkpoint.completeness ? { completeness: completenessRefOf(checkpoint.completeness) } : {}), ...(checkpoint.canonical ? { behavior: behaviorRefOf(checkpoint, all) } : {}), ...(checkpoint.source ? { sourceCheckpoint: { ref: checkpoint.source.ref, kind: checkpoint.source.kind, processRequirement: checkpoint.source.processRequirement, assessmentRequirement: checkpoint.source.assessmentRequirement, quoteMatch: checkpoint.source.quoteMatch, origin: checkpoint.origin ?? "MODEL" } } : {}), ...(checkpoint.source?.registry ? { registry: { definitionId: checkpoint.source.registry.definitionId, versionId: checkpoint.source.registry.versionId, definitionVersion: checkpoint.source.registry.definitionVersion, criticality: checkpoint.source.registry.criticality, highlight: checkpoint.source.registry.highlight } } : {}), ...(checkpoint.evidencePolarity ? { evidencePolarity: { behavior: checkpoint.evidencePolarity.behavior, evidence: checkpoint.evidencePolarity.evidence, conflict: checkpoint.evidencePolarity.conflict } } : {}), ...(assessmentMissing.length > 0 ? { assessmentMissing: [...assessmentMissing] } : {}), ...(absenceDisplay ? { absenceDisplay } : {}), ...(checkpoint.summary ? { summary: checkpoint.summary } : {}), ...(checkpoint.dependency?.state === "UNVERIFIED" ? { prerequisite: { state: "UNVERIFIED" as const, gateRef: checkpoint.dependency.gateRef, gateStatus: checkpoint.dependency.gateStatus ?? null, gateReason: checkpoint.dependency.gateReason ?? null } } : {}) },
    facts,
    withheldFacts: display.length - facts.length,
    // A interpretação da origem que segue ao redator é SÓ a orientação declarada, e só quando fundamentada na base verificada.
    analysis: checkpoint.guidance.text ? { observation: null, summary: null, recommendation: checkpoint.guidance.text } : null,
    analysisConflicts: [],
    structuralBlock: !knowledge ? "KNOWLEDGE_NOT_VERIFIED" : !operatorShown && !absenceDisplay ? "INSUFFICIENT_DISPLAY_EVIDENCE" : null,
    audit: { evidence: display.map((entry, factIndex) => ({ turnRef: entry.origin.turnRef, speaker: checkpoint.transcriptEvidence[factIndex]!.speaker, rawSha256: entry.origin.rawSha256 })), rejectedUnits: checkpoint.rejectedUnits },
  }
}

const applicabilityRank = (checkpoint: VerifiedCheckpoint) => (checkpoint.knowledge?.applicability === "VERIFIED" ? 0 : checkpoint.knowledge?.applicability === "LITERAL_ONLY" ? 1 : 2)
const normalizeQuote = (quote: string) => quote.replace(/[“”"'`*_#>]/g, "").replace(/[;:.,]+$/, "").replace(/\s+/g, " ").trim().toLowerCase()
const processIndexOf = (ref: string) => Number(/^P(\d+)\./.exec(ref)?.[1] ?? 0)

function priorityBasis(checkpoint: VerifiedCheckpoint): string[] {
  return [
    checkpoint.status === "NOT_FOLLOWED" ? "DEVELOPMENT_FIRST" : "STRENGTH",
    checkpoint.knowledge?.applicability === "VERIFIED" ? "RULE_VERIFIED" : checkpoint.knowledge?.applicability === "LITERAL_ONLY" ? "RULE_LITERAL_ONLY" : "RULE_NOT_VERIFIED",
    typeof checkpoint.knowledge?.documentOffset === "number" && checkpoint.knowledge.documentOffset >= 0 ? "PROCEDURE_ORDER" : "ASSESSMENT_ORDER",
  ]
}

/**
 * Itens de TODAS as etapas evidenciadas (FOLLOWED/NOT_FOLLOWED), na ordem de prioridade. `excludedForMateriality` fica sempre
 * vazio a partir da V1.7.1a (mantido no contrato do artefato só pelos artefatos anteriores).
 */
export function buildProcessItems(assessment: VerifiedProcessAssessment, displayContext: DisplayProjectionContext = {}): { items: ReliableItemDraft[]; excludedForMateriality: string[] } {
  // V1.7.1m — fonte que só REFORÇA um comportamento avaliado por outra não vira outro ponto (fica como proveniência do avaliador).
  const evidenced = assessment.checkpoints.map((checkpoint, order) => ({ checkpoint, order })).filter(({ checkpoint }) => (checkpoint.status === "FOLLOWED" || checkpoint.status === "NOT_FOLLOWED") && checkpoint.canonical?.role !== "SUPPORTING" && checkpoint.source?.registry?.feedbackEnabled !== false)
  // Fusão de etapas iguais (só com regra usável: sem regra, a identidade seria o texto do modelo).
  const kept: { checkpoint: VerifiedCheckpoint; order: number; collapsed: string[] }[] = []
  const byIdentity = new Map<string, { collapsed: string[] }>()
  for (const entry of evidenced) {
    const knowledge = knowledgeRefOf(entry.checkpoint)
    const identity = knowledge ? `${entry.checkpoint.status}|${knowledge.documentId}|${normalizeQuote(knowledge.quote)}` : null
    const existing = identity ? byIdentity.get(identity) : undefined
    if (existing) { existing.collapsed.push(entry.checkpoint.ref); continue }
    const record = { ...entry, collapsed: [] as string[] }
    if (identity) byIdentity.set(identity, record)
    kept.push(record)
  }
  const offset = (checkpoint: VerifiedCheckpoint) => (typeof checkpoint.knowledge?.documentOffset === "number" && checkpoint.knowledge.documentOffset >= 0 ? checkpoint.knowledge.documentOffset : Number.MAX_SAFE_INTEGER)
  const ordered = [...kept].sort((a, b) =>
    (a.checkpoint.status === "NOT_FOLLOWED" ? 0 : 1) - (b.checkpoint.status === "NOT_FOLLOWED" ? 0 : 1)
    || applicabilityRank(a.checkpoint) - applicabilityRank(b.checkpoint)
    || processIndexOf(a.checkpoint.ref) - processIndexOf(b.checkpoint.ref)
    || offset(a.checkpoint) - offset(b.checkpoint)
    || a.order - b.order)
  // V1.7.3 — etapa que a análise PRECISAVA avaliar (obrigatória no processo ou MUST_ASSESS) sem disposição mesmo depois do reparo
  // único (nem completável com segurança): cada ponto carrega a lacuna (QA, análise parcial).
  const assessmentMissing = (assessment.coverage?.missingUnresolved ?? []).map((entry) => entry.heading ?? entry.ref)
  const items = ordered.map(({ checkpoint, collapsed }, index) => {
    const supporting = assessment.checkpoints.filter((other) => other.canonical?.role === "SUPPORTING" && other.canonical.primaryRef === checkpoint.ref).map((other) => other.ref)
    const merged = [...collapsed, ...supporting]
    return {
      ...itemOf(checkpoint, index, displayContext, assessment.checkpoints, assessmentMissing),
      priority: { rank: index + 1, policy: PROCESS_ITEM_ORDER_VERSION, basis: priorityBasis(checkpoint) },
      ...(merged.length > 0 ? { collapsedCheckpoints: merged } : {}),
    }
  })
  return { items, excludedForMateriality: [] }
}
