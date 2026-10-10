import { z } from "zod"
import { isBehavioralEvidence, type LedgerEntry } from "./evidence-ledger.js"
import { assessLedgerRepresentativeness, bestRepresentativeness, type OperationalUniverse, type RepresentativenessAssessment } from "./evidence-representativeness.js"
import { checkFactPreservation, type CriticalFact } from "./decision-critical-facts.js"
import type { InvestigationObjective } from "./investigation-objective.js"
import type { ClaimScope, EvidenceGatingResult, InvestigationSynthesis } from "./tool-trace.js"
import { checkTemporalConclusionCompatibility, gateTemporalClaim, INDICATOR_TEMPORAL_TOOLS, temporalConclusionOfLedger, temporalFactsOf, TEMPORAL_RELATIONS, type TemporalBucket, type TemporalConclusion, type TemporalRelation } from "./temporal-semantics.js"
import { maximumClaimScopeOf, RISK_FINDING_KINDS, type FindingAttribution, type InteractionFindingKind, type PatternKind, type PatternSupportLevel, type PatternSupportSignal } from "./interaction-semantic-frame.js"
import { claimScopeWithin, CLAIM_SCOPE_RANK, type SupportScope } from "./support-scope.js"
import { buildClaimCandidates, candidateAllowedPolarities, renderClaimCandidates, type ClaimCandidate } from "./claim-candidates.js"
import type { BehavioralClaim, ClaimPolarity, GatingCorrectionCategory } from "./tool-trace.js"

/**
 * EVIDENCE GATING (V1.1 — itens 18/19), aplicado POR CÓDIGO à resposta final do Agent:
 * - afirmação comportamental ("você faz X", "você demora em Y") só passa com referência a um fato
 *   de interação/transcrição do ledger (F-refs de Tools de INTERACTION_ANALYSIS com dado);
 * - recomendação com base OBSERVED_EVIDENCE exige refs existentes no ledger;
 * - KNOWLEDGE_GUIDANCE exige base de conhecimento/procedimento real nesta execução;
 * - GENERAL_DEVELOPMENT_SUGGESTION sempre passa (é declaradamente sugestão).
 * Sem evidência a linguagem tem que ser factual — o modelo recebe UMA correção; se insistir, a
 * resposta é descartada (mesma postura da evidência não literal).
 */
/**
 * V1.4.4 — PARSE TOLERANTE POR ITEM (descoberto no smoke): uma lista com uma string vazia ("supportedHypotheses": [""])
 * fazia o zod recusar o objeto INTEIRO e `parseSynthesisFields` devolvia tudo vazio — perdendo afirmações VÁLIDAS por um
 * campo irrelevante. Agora item inválido cai fora, o resto sobrevive: o mesmo princípio do salvamento de claims (V1.4.3).
 */
const itemList = <T extends z.ZodTypeAny>(item: T) => z.array(z.unknown()).default([]).transform((items) => items.map((value) => item.safeParse(value)).filter((parsed): parsed is { success: true; data: z.infer<T> } => parsed.success).map((parsed) => parsed.data)).catch([])
const textList = z.array(z.unknown()).default([]).transform((items) => items.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())).catch([])

export const synthesisFieldsSchema = z.object({
  supportedHypotheses: textList,
  unsupportedHypotheses: textList,
  limitations: textList,
  behavioralClaims: itemList(z.object({ text: z.string().trim().min(1), evidenceRefs: z.array(z.string().trim()).default([]), scope: z.enum(["INTERACTION_SPECIFIC", "PERIOD_PATTERN", "EMPLOYEE_PATTERN", "POPULATION_PATTERN"]).optional(), temporalRelation: z.enum(TEMPORAL_RELATIONS).optional(), evidenceBuckets: z.array(z.string().trim()).optional(), position: z.enum(["FIRST", "MIDDLE", "LAST"]).optional(), patternRef: z.string().trim().optional(), findingRef: z.string().trim().optional(), polarity: z.enum(["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"]).optional(), support: z.object({ type: z.string().trim().transform((value) => value.toUpperCase()), patternRef: z.string().trim().optional(), findingRef: z.string().trim().optional() }).optional().catch(undefined), candidateRef: z.string().trim().optional() })),
  recommendationSupport: itemList(z.object({ text: z.string().trim().min(1), basis: z.enum(["OBSERVED_EVIDENCE", "KNOWLEDGE_GUIDANCE", "GENERAL_DEVELOPMENT_SUGGESTION"]), evidenceRefs: z.array(z.string().trim()).default([]) })),
  consideredCriticalFacts: z.array(z.unknown()).transform((items) => items.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())).optional().catch(undefined),
})

/** ENVELOPE de evidência presente? (V1.3 fail-closed): o JSON precisa trazer a lista interna
 * `behavioralClaims` como array (a declaração explícita — mesmo vazia — do que a resposta afirma
 * sobre comportamento). Sem ela a resposta NÃO foi validável: nunca passa como "zero claims". */
export function hasSynthesisEnvelope(json: unknown): boolean {
  if (!json || typeof json !== "object") return false
  return Array.isArray((json as Record<string, unknown>).behavioralClaims)
}

/** Correção pedida quando o envelope veio ausente/inválido (uma única vez) — sem ele a resposta é descartada/substituída. */
export function renderEnvelopeCorrection(kind: "JSON_FIELDS" | "MARKER_LINE"): string {
  return kind === "JSON_FIELDS"
    ? "CORREÇÃO OBRIGATÓRIA: a resposta anterior não trouxe os campos internos de auditoria (supportedHypotheses, unsupportedHypotheses, limitations, behavioralClaims, recommendationSupport) — sem eles a resposta é descartada por código. Reescreva o JSON COMPLETO incluindo esses campos (arrays, mesmo vazios), com refs válidas."
    : "CORREÇÃO OBRIGATÓRIA: a resposta anterior não trouxe a linha interna EVIDENCE_JSON (ou o JSON dela era inválido) — sem ela a resposta é descartada por código. Reescreva a resposta e termine com UMA linha própria \"EVIDENCE_JSON: {…}\" contendo supportedHypotheses, unsupportedHypotheses, limitations, behavioralClaims (com evidenceRefs e scope) e recommendationSupport (arrays, mesmo vazios). Um único EVIDENCE_JSON por resposta; outros marcadores internos (ex.: SUPPORT_MATERIALS_JSON) ficam cada um em sua própria linha, antes ou depois."
}

export function parseSynthesisFields(json: unknown): InvestigationSynthesis {
  const parsed = synthesisFieldsSchema.safeParse(json ?? {})
  if (parsed.success) return parsed.data
  return { supportedHypotheses: [], unsupportedHypotheses: [], limitations: [], behavioralClaims: [], recommendationSupport: [] }
}

export type GatingContext = {
  ledger: LedgerEntry[]
  knowledgeAvailable: boolean
  /** Interações do colaborador no período (universo REGISTRADO) — null = desconhecido. */
  interactionUniverse?: number | null
  /** Volume operacional do indicador (universo OPERACIONAL) — null = não determinado (V1.3). */
  operationalUniverse?: OperationalUniverse | null
  /** FACT PRESERVATION (V1.3.1): fatos críticos derivados do ledger + objetivo; `responseText` = o que o colaborador lê. */
  criticalFacts?: CriticalFact[] | undefined
  objective?: InvestigationObjective | undefined
  /** V1.3.4: blocos da janela (posição temporal calculada pela aplicação) — base do gating de claims temporais. */
  temporalBuckets?: TemporalBucket[] | undefined
}

export const CLAIM_SCOPE_LABELS: Record<ClaimScope, string> = {
  INTERACTION_SPECIFIC: "nesta(s) interação(ões)",
  PERIOD_PATTERN: "padrão no período",
  EMPLOYEE_PATTERN: "padrão do colaborador",
  POPULATION_PATTERN: "padrão da população (pares)",
}

/** Escopo padrão quando o modelo não declarou: o mais restrito (nunca promovemos uma claim por omissão). */
export const DEFAULT_CLAIM_SCOPE: ClaimScope = "INTERACTION_SPECIFIC"

/** O que cada escopo exige da evidência referenciada (V1.2 — evidência verdadeira ≠ generalização válida). */
export function scopeAllowedBy(scope: ClaimScope, assessments: RepresentativenessAssessment[]): { ok: true } | { ok: false; reason: string } {
  const own = assessments.filter((item) => item.tool !== "analyze_peer_patterns" && item.tool !== "find_comparable_interactions")
  const peers = assessments.filter((item) => item.tool === "analyze_peer_patterns")
  const best = (list: RepresentativenessAssessment[]) => bestRepresentativeness(list)
  switch (scope) {
    case "INTERACTION_SPECIFIC":
      return best(own) === "INSUFFICIENT" && best(peers) === "INSUFFICIENT" ? { ok: false, reason: "sem interação/transcrição analisada" } : { ok: true }
    case "PERIOD_PATTERN":
    case "EMPLOYEE_PATTERN":
      return best(own) === "REPRESENTATIVE" ? { ok: true } : { ok: false, reason: `evidência ${best(own) === "ANECDOTAL" ? "anedótica" : "insuficiente"} para generalizar como ${CLAIM_SCOPE_LABELS[scope]} — só sustenta "nas interações analisadas"` }
    case "POPULATION_PATTERN":
      return best(peers) === "REPRESENTATIVE" ? { ok: true } : { ok: false, reason: "padrão de população exige análise representativa de pares (analyze_peer_patterns)" }
  }
}

/**
 * V1.4.0 (§17–§20) / V1.4.2 (§10) — TETO DE CLAIM POR FATO: escopo PERIOD/EMPLOYEE só quando algum pattern dos fatos de análise
 * referenciados autoriza esse escopo (`maximumClaimScope`, derivado por código de nível × representatividade × distribuição
 * temporal × universo). Só entra em jogo quando os fatos referenciados carregam a camada semântica; fatos sem ela seguem a
 * regra de representatividade de sempre — nunca mais permissivo. 2 de 8 é REPEATED_IN_SAMPLE: sustenta "observado em duas
 * das oito analisadas", nunca "costuma". O binding por claim (`bindClaim`) é a autoridade final — esta checagem é o teto do fato.
 */
export function patternSupportAllowedBy(scope: ClaimScope, refs: LedgerEntry[]): { ok: true } | { ok: false; reason: string } {
  if (scope !== "PERIOD_PATTERN" && scope !== "EMPLOYEE_PATTERN") return { ok: true }
  const semanticFacts = refs.filter((entry) => Array.isArray(entry.signals?.interactionAnalysis?.patterns))
  if (semanticFacts.length === 0) return { ok: true }
  const signals: PatternSupportSignal[] = semanticFacts.flatMap((entry) => entry.signals!.interactionAnalysis!.patterns ?? [])
  const best = signals.reduce<PatternSupportSignal | null>((acc, item) => (acc === null || CLAIM_SCOPE_RANK[maximumClaimScopeOf(item)] > CLAIM_SCOPE_RANK[maximumClaimScopeOf(acc)] ? item : acc), null)
  if (best && claimScopeWithin(scope, maximumClaimScopeOf(best))) return { ok: true }
  return { ok: false, reason: best ? `nenhum padrão dos fatos referenciados autoriza ${scope} (teto: ${maximumClaimScopeOf(best)} — ${best.handle ?? best.ref ?? "pattern"} ${best.supportLevel}${best.supportScope ? `/${best.supportScope}` : ""}, ${best.matchedTranscriptCount} de ${best.analyzedTranscriptCount} analisadas) — escreva no escopo autorizado` : `os fatos referenciados não têm padrão entre interações (só findings por interação) — escopo ${scope} não sustentado` }
}

/**
 * V1.4.0 (§31–§35) — CONCLUSÃO PROCEDIMENTAL: "a orientação diverge/contraria o procedimento" exige evidência da interação E
 * evidência da base de conhecimento (fato query_knowledge com dado referenciado, ou a base recuperada no prompt quando a
 * execução não consultou a Tool). Sem base: questão procedimental ("o operador afirmou X; verificar contra o procedimento"),
 * nunca erro confirmado. O léxico é rede de segurança (defesa secundária) — genérico, sem regra de assunto.
 */
const PROCEDURAL_CONCLUSION_PATTERNS: readonly RegExp[] = [
  /\bdiverg\w*\s+d[oa]s?\s+(?:procedimento|norma|regra|pol[ií]tica|processo|base)/i,
  /\bcontrari\w*\s+[oa]s?\s+(?:procedimento|norma|regra|pol[ií]tica|processo)/i,
  /\bem\s+desacordo\s+com\s+[oa]s?\s+(?:procedimento|norma|regra|pol[ií]tica|processo)/i,
  /\bfora\s+d[oa]\s+(?:procedimento|norma|pol[ií]tica)\b/i,
  /\b(?:procedimento|orienta[çc][ãa]o|informa[çc][ãa]o)\s+(?:incorret[oa]|errad[oa]|equivocad[oa]|indevid[oa])\b/i,
  /\b(?:n[ãa]o\s+segu\w+|descumpr\w+|infring\w+|viol\w+)\s+[oa]s?\s+(?:procedimento|norma|regra|pol[ií]tica|processo)/i,
  /\borient\w+\s+(?:incorretamente|errad[oa]|de\s+forma\s+(?:incorreta|errada|equivocada|indevida))\b/i,
]
export function detectProceduralConclusionLanguage(text: string): string[] {
  return PROCEDURAL_CONCLUSION_PATTERNS.map((pattern) => pattern.exec(text)?.[0] ?? null).filter((match): match is string => match !== null)
}

/** Fato de BASE DE CONHECIMENTO com dado (query_knowledge que devolveu trechos) — a evidência normativa. */
export function isKnowledgeEvidence(entry: LedgerEntry): boolean {
  if (entry.tool === "query_knowledge" && entry.qualityStatus !== "NO_DATA" && entry.qualityStatus !== "NOT_SUPPORTED") return true
  // V1.4.5 (§16): a avaliação procedimental da análise verificou regras com TRECHO LITERAL da base — evidência normativa
  // tão real quanto um fato `query_knowledge`, e com lineage melhor (afirmação → regra → comparação determinística).
  return (entry.signals?.interactionAnalysis?.procedural?.rulesVerified ?? 0) > 0
}

/**
 * V1.4.5 (§19/§20) — ADERÊNCIA INTEGRAL: ter verificado duas regras não prova o procedimento inteiro. Linguagem de
 * integralidade ("seguiu integralmente o procedimento", "aderência total", "cumpriu todo o processo") só é aceitável com
 * cobertura procedimental COMPLETE (checklist estruturado completo) — que a aplicação, hoje, nunca declara.
 */
const PROCEDURAL_COMPLETENESS_LANGUAGE: readonly RegExp[] = [
  /\b(?:seguiu|cumpriu|atendeu|respeitou|observou)\s+(?:\p{L}+\s+){0,2}?(?:integralmente|totalmente|plenamente|por\s+completo)\b/iu,
  /\baderência\s+(?:integral|total|plena|completa)\b/iu,
  /\baderencia\s+(?:integral|total|plena|completa)\b/iu,
  /\b(?:seguiu|cumpriu|executou|respeitou)\s+(?:todo|toda|todos|todas)\s+(?:o|a|os|as)\s+(?:procedimento|processo|protocolo|etapas|passos|requisitos)/iu,
  /\b(?:todo|toda)\s+o\s+(?:procedimento|processo|protocolo)\s+foi\s+(?:seguid|cumprid|atendid|respeitad)/iu,
  /\bconformidade\s+(?:integral|total|plena)\b/iu,
  /\bsem\s+(?:nenhum|qualquer)\s+desvio\s+(?:de|do|no)\s+(?:procedimento|processo|protocolo)/iu,
]
export function detectProceduralCompletenessLanguage(text: string): string[] {
  return PROCEDURAL_COMPLETENESS_LANGUAGE.map((pattern) => pattern.exec(text)?.[0] ?? null).filter((match): match is string => match !== null)
}

/** Cobertura procedimental desta execução: COMPLETE só com checklist estruturado completo (nunca, hoje) — senão PARTIAL. */
export function proceduralCoverageOfLedger(ledger: LedgerEntry[]): "PARTIAL" | "COMPLETE" | "NONE" {
  const coverages = ledger.map((entry) => entry.signals?.interactionAnalysis?.procedural?.coverage).filter((value): value is "PARTIAL" | "COMPLETE" => Boolean(value))
  if (coverages.length === 0) return "NONE"
  return coverages.every((value) => value === "COMPLETE") ? "COMPLETE" : "PARTIAL"
}

/**
 * V1.4.1 → V1.4.2 — CLAIM ↔ PATTERN BINDING CANÔNICO (§2–§7, §10, §14): quando os fatos referenciados carregam a camada
 * semântica, a claim precisa apontar EXPLICITAMENTE para o que a sustenta por um HANDLE CANÔNICO da execução —
 * `support: { type: "PATTERN", patternRef: "SP-n" }` (PERIOD/EMPLOYEE/POPULATION exigem pattern) ou
 * `support: { type: "FINDING", findingRef: "SF-n" }` (INTERACTION_SPECIFIC). O modelo SELECIONA um handle existente; nunca
 * compõe "F3/P1" nem "I6/F1". SEM REPARO FUZZY (§5): handle desconhecido, string composta, "F3" solto ou tipo inválido =
 * rejeição com a lista de handles válidos. Compatibilidade legada só em forma 100 % inequívoca (`patternRef` "SP1";
 * `findingRef` "SF3"; formas V1.4.1 exatas "F3/P1" e "I6/F1" resolvidas por lookup exato — registradas como `legacy`).
 * Validação determinística: escopo da claim ≤ `maximumClaimScope` do pattern (quantidade de evidência ≠ amplitude da
 * generalização — §10/§13); polaridade compatível com o kind (STRENGTH nunca vira "falha"; RISK nunca vira "ponto forte";
 * INTERACTION_FRICTION não é atribuível ao operador); linguagem de padrão do colaborador só com teto EMPLOYEE_PATTERN (§14).
 * Fatos sem camada semântica (runs antigos, flags, pares) seguem as regras de sempre — nunca mais permissivo.
 */
const STRONG_PATTERN_LANGUAGE: readonly RegExp[] = [/\bcostuma(?:m)?\b/iu, /\bfrequentemente\b/iu, /\bhabitualmente\b/iu, /\bsistematicamente\b/iu, /\bsempre\b/iu, /\btende(?:m)?\s+a\b/iu, /\b(?:é|constitui|caracteriza|configura)\s+(?:um\s+)?padr[ãa]o\s+(?:recorrente\s+)?(?:d[oa]|seu|sua|no)\b/iu, /\bpadr[ãa]o\s+(?:recorrente\s+)?d[oa]\s+colaborador/iu, /\brecorrentemente\b/iu, /(?<!\p{L})(?:o|a)\s+colaborador(?:a)?\s+(?:apresenta|demonstra|tem|possui)\s+(?:como\s+)?(?:caracter[ií]stica|padr[ãa]o|tend[êe]ncia|h[áa]bito|perfil)/iu, /\b(?:caracter[ií]stica|tra[çc]o|h[áa]bito)\s+(?:geral\s+)?d[oa]\s+colaborador(?:a)?\b/iu]
export function detectStrongPatternLanguage(text: string): string[] {
  return STRONG_PATTERN_LANGUAGE.map((pattern) => pattern.exec(text)?.[0] ?? null).filter((match): match is string => match !== null)
}
const POSITIVE_LANGUAGE: readonly RegExp[] = [/\bponto(?:s)?\s+forte(?:s)?\b/iu, /\bboa(?:s)?\s+pr[áa]tica(?:s)?\b/iu, /\bpositiv[oa]s?\b/iu, /\badequad[oa](?:mente)?\b/iu, /\bcorret[oa](?:mente)?\b/iu, /\bcom\s+clareza\b/iu, /\befica[zc](?:es|mente)?\b/iu, /\bbem[- ](?:conduzid|estruturad|executad)/iu, /\bfor[çc]a(?:s)?\b/iu, /\bdestaque\b/iu]
const NEGATIVE_LANGUAGE: readonly RegExp[] = [/\bfalha(?:s)?\b/iu, /\bponto(?:s)?\s+de\s+aten[çc][ãa]o\b/iu, /\brisco(?:s)?\b/iu, /\bproblema(?:s)?\b/iu, /\bdesvio(?:s)?\b/iu, /\bincorret[oa](?:mente)?\b/iu, /\binadequad[oa](?:mente)?\b/iu, /\bdeix(?:a|ou|am|aram)\s+de\b/iu, /\bn[ãa]o\s+(?:realiz|confirm|inform|verific|recapitul|explic|valid)/iu, /\binterromp/iu, /\bsem\s+(?:explicar|confirmar|informar|verificar|recapitular|resolver)\b/iu, /\boportunidade(?:s)?\s+de\s+melhoria\b/iu]
/** Polaridade LEXICAL do texto da claim (rede de segurança quando a declarada falta ou contradiz). */
export function lexicalPolarityOf(text: string): ClaimPolarity | null {
  const positive = POSITIVE_LANGUAGE.some((pattern) => pattern.test(text))
  const negative = NEGATIVE_LANGUAGE.some((pattern) => pattern.test(text))
  if (positive && negative) return "MIXED"
  if (positive) return "POSITIVE"
  if (negative) return "NEGATIVE"
  return null
}
/** Atribuição explícita ao operador no texto da claim ("você interrompeu", "o operador/colaborador …", "pelo colaborador"). */
const OPERATOR_ATTRIBUTION: readonly RegExp[] = [/(?<!\p{L})voc[êe](?!\p{L})/iu, /(?<!\p{L})(?:o|a|d[oa]|pel[oa])\s+(?:operador(?:a)?|colaborador(?:a)?|atendente|agente)(?!\p{L})/iu, /(?<!\p{L})(?:sua|seu)\s+(?:conduta|comportamento|postura|atendimento)(?!\p{L})/iu]
export function detectOperatorAttribution(text: string): string[] {
  return OPERATOR_ATTRIBUTION.map((pattern) => pattern.exec(text)?.[0] ?? null).filter((match): match is string => match !== null)
}
const PATTERN_POLARITY: Record<PatternKind, ClaimPolarity[]> = { STRENGTH: ["POSITIVE", "NEUTRAL"], RISK: ["NEGATIVE", "NEUTRAL"], MIXED: ["POSITIVE", "NEGATIVE", "MIXED", "NEUTRAL"], PROCEDURAL: ["NEUTRAL", "NEGATIVE"], NEUTRAL: ["NEUTRAL"], INTERACTION_FRICTION: ["NEUTRAL", "NEGATIVE"], OUTCOME: ["NEUTRAL"] }
const FINDING_POLARITY = (kind: InteractionFindingKind): ClaimPolarity[] => (kind === "STRENGTH" ? ["POSITIVE", "NEUTRAL"] : RISK_FINDING_KINDS.includes(kind) ? ["NEGATIVE", "NEUTRAL"] : kind === "PROCEDURAL_QUESTION" ? ["NEUTRAL", "NEGATIVE"] : ["NEUTRAL"])

/** Um pattern selecionável numa claim: handle canônico + o que o modelo precisa saber para escolher (kind, nível, escopo, teto). */
export type ClaimPatternOption = { handle: string; /** Ref local V1.4.1 ("P1") — legado. */ ref: string | null; factRef: string; kind: PatternKind; supportLevel: PatternSupportLevel; supportScope: SupportScope | null; maximumClaimScope: ClaimScope; matchedTranscriptCount: number; analyzedTranscriptCount: number }
export type ClaimFindingOption = { handle: string; /** Ref composta V1.4.1 ("I6/F1") — legado. */ ref: string; factRef: string; kind: InteractionFindingKind; attribution: FindingAttribution | null }
export type ClaimSupportOptions = { patterns: ClaimPatternOption[]; findings: ClaimFindingOption[] }

/**
 * ENUM DINÂMICO (§4): os ÚNICOS suportes que uma claim pode citar nesta execução, lidos dos fatos de análise do ledger
 * (handles SP-n/SF-n gravados no trace). Runs sem handle (anteriores à V1.4.2) expõem só as formas legadas exatas.
 */
export function claimSupportOptionsOf(ledger: LedgerEntry[]): ClaimSupportOptions {
  const patterns: ClaimPatternOption[] = []
  const findings: ClaimFindingOption[] = []
  for (const entry of ledger) {
    const signals = entry.signals?.interactionAnalysis
    if (!signals || !Array.isArray(signals.patterns)) continue
    for (const item of signals.patterns) {
      const handle = item.handle ?? (item.ref ? `${entry.ref}/${item.ref}` : null)
      if (!handle) continue
      patterns.push({ handle, ref: item.ref ?? null, factRef: entry.ref, kind: item.kind, supportLevel: item.supportLevel, supportScope: item.supportScope ?? null, maximumClaimScope: maximumClaimScopeOf(item), matchedTranscriptCount: item.matchedTranscriptCount, analyzedTranscriptCount: item.analyzedTranscriptCount })
    }
    for (const item of signals.findingRefs ?? []) findings.push({ handle: item.handle ?? item.ref, ref: item.ref, factRef: entry.ref, kind: item.kind, attribution: item.attribution ?? null })
  }
  return { patterns, findings }
}

const CANONICAL_PATTERN_HANDLE = /^SP\d{1,4}$/
const CANONICAL_FINDING_HANDLE = /^SF\d{1,4}$/
/** Formas V1.4.1 EXATAS (lookup inequívoco): "F3/P1" (fato/pattern local) e "I6/F1" (interação/finding local). */
const LEGACY_PATTERN_REF = /^F\d{1,3}\/P\d{1,3}$/
const LEGACY_FINDING_REF = /^I\d{1,3}\/F\d{1,3}$/

/**
 * Schema DINÂMICO do suporte (§3/§4): `type` PATTERN|FINDING e o ref restrito por enum aos handles existentes. Uma execução sem
 * patterns não aceita `type: "PATTERN"` (não há o que escolher). Nunca reparo: "F3", "F3/F-I24", "SP99" falham aqui.
 */
export function claimSupportSchemaFor(options: ClaimSupportOptions) {
  const enumOf = (values: string[]) => (values.length > 0 ? z.enum(values as [string, ...string[]]) : z.never())
  return z.discriminatedUnion("type", [
    z.object({ type: z.literal("PATTERN"), patternRef: enumOf(options.patterns.map((item) => item.handle)) }),
    z.object({ type: z.literal("FINDING"), findingRef: enumOf(options.findings.map((item) => item.handle)) }),
  ])
}

export type ResolvedClaimSupport = { type: "PATTERN"; pattern: ClaimPatternOption; finding: null; legacy: boolean } | { type: "FINDING"; pattern: null; finding: ClaimFindingOption; legacy: boolean }
export type ClaimSupportResolution = { ok: true; support: ResolvedClaimSupport | null } | { ok: false; reason: string }

const listHandles = (values: string[]) => (values.length > 0 ? values.join(", ") : "(nenhum nesta execução)")

/**
 * Resolve o suporte declarado para um pattern/finding EXISTENTE — por seleção (handle canônico) ou por forma legada exata.
 * `support: null` = nada declarado (a exigência por escopo é decidida em `bindClaim`). Qualquer outra grafia é rejeitada
 * com a lista do que existe — sem "closest ref", sem substring, sem adivinhar por número (§5).
 */
export function resolveClaimSupport(claim: Pick<BehavioralClaim, "support" | "patternRef" | "findingRef">, options: ClaimSupportOptions): ClaimSupportResolution {
  const patternHandles = options.patterns.map((item) => item.handle)
  const findingHandles = options.findings.map((item) => item.handle)
  const byPatternHandle = (handle: string) => options.patterns.find((item) => item.handle === handle) ?? null
  const byFindingHandle = (handle: string) => options.findings.find((item) => item.handle === handle) ?? null
  const support = claim.support
  if (support && typeof support === "object") {
    const parsed = claimSupportSchemaFor(options).safeParse({ type: String(support.type ?? "").trim().toUpperCase(), ...(support.patternRef !== undefined ? { patternRef: support.patternRef.trim().toUpperCase() } : {}), ...(support.findingRef !== undefined ? { findingRef: support.findingRef.trim().toUpperCase() } : {}) })
    if (!parsed.success) {
      const type = String(support.type ?? "").trim().toUpperCase()
      if (type !== "PATTERN" && type !== "FINDING") return { ok: false, reason: `CLAIM_SUPPORT_FORMAT: support.type "${String(support.type ?? "")}" inválido — use {"type":"PATTERN","patternRef":"SP-n"} ou {"type":"FINDING","findingRef":"SF-n"}` }
      const ref = type === "PATTERN" ? support.patternRef : support.findingRef
      return { ok: false, reason: `CLAIM_SUPPORT_REF_UNKNOWN: support.${type === "PATTERN" ? "patternRef" : "findingRef"} "${ref ?? ""}" não existe nesta execução — ${type === "PATTERN" ? "patternRef" : "findingRef"} válidos: ${listHandles(type === "PATTERN" ? patternHandles : findingHandles)}` }
    }
    if (parsed.data.type === "PATTERN") return { ok: true, support: { type: "PATTERN", pattern: byPatternHandle(parsed.data.patternRef)!, finding: null, legacy: false } }
    return { ok: true, support: { type: "FINDING", pattern: null, finding: byFindingHandle(parsed.data.findingRef)!, legacy: false } }
  }
  // Legado (100 % inequívoco): handle canônico solto ou forma V1.4.1 exata; qualquer outra grafia é formato inválido.
  const patternRef = (claim.patternRef ?? "").trim().toUpperCase()
  const findingRef = (claim.findingRef ?? "").trim().toUpperCase()
  if (patternRef) {
    const pattern = CANONICAL_PATTERN_HANDLE.test(patternRef) ? byPatternHandle(patternRef) : LEGACY_PATTERN_REF.test(patternRef) ? options.patterns.find((item) => item.ref && `${item.factRef}/${item.ref}` === patternRef) ?? null : null
    if (pattern) return { ok: true, support: { type: "PATTERN", pattern, finding: null, legacy: true } }
    if (CANONICAL_PATTERN_HANDLE.test(patternRef) || LEGACY_PATTERN_REF.test(patternRef)) return { ok: false, reason: `CLAIM_SUPPORT_REF_UNKNOWN: patternRef "${claim.patternRef}" não existe nesta execução — patternRef válidos: ${listHandles(patternHandles)}` }
    return { ok: false, reason: `CLAIM_SUPPORT_FORMAT: patternRef "${claim.patternRef}" não é um handle canônico — use support: {"type":"PATTERN","patternRef":"SP-n"} com um dos handles ${listHandles(patternHandles)}` }
  }
  if (findingRef) {
    const finding = CANONICAL_FINDING_HANDLE.test(findingRef) ? byFindingHandle(findingRef) : LEGACY_FINDING_REF.test(findingRef) ? options.findings.find((item) => item.ref.toUpperCase() === findingRef) ?? null : null
    if (finding) return { ok: true, support: { type: "FINDING", pattern: null, finding, legacy: true } }
    if (CANONICAL_FINDING_HANDLE.test(findingRef) || LEGACY_FINDING_REF.test(findingRef)) return { ok: false, reason: `CLAIM_SUPPORT_REF_UNKNOWN: findingRef "${claim.findingRef}" não existe nesta execução — findingRef válidos: ${listHandles(findingHandles)}` }
    return { ok: false, reason: `CLAIM_SUPPORT_FORMAT: findingRef "${claim.findingRef}" não é um handle canônico — use support: {"type":"FINDING","findingRef":"SF-n"} com um dos handles ${listHandles(findingHandles)}` }
  }
  return { ok: true, support: null }
}

export type ClaimBinding = { ok: true; support: ResolvedClaimSupport | null; pattern: ClaimPatternOption | null; finding: ClaimFindingOption | null } | { ok: false; reason: string }

/** Refs de fato implícitas no suporte resolvido (o fato que contém o pattern/finding) — lineage, nunca inventadas. */
export function factRefsFromBinding(claim: BehavioralClaim, ledger: LedgerEntry[]): string[] {
  const resolution = resolveClaimSupport(claim, claimSupportOptionsOf(ledger))
  if (!resolution.ok || !resolution.support) return []
  return [resolution.support.pattern?.factRef ?? resolution.support.finding!.factRef]
}

export function bindClaim(claim: BehavioralClaim, refs: LedgerEntry[]): ClaimBinding {
  const semanticFacts = refs.filter((entry) => Array.isArray(entry.signals?.interactionAnalysis?.patterns))
  if (semanticFacts.length === 0) return { ok: true, support: null, pattern: null, finding: null }
  const scope = claim.scope ?? DEFAULT_CLAIM_SCOPE
  const options = claimSupportOptionsOf(semanticFacts)
  const resolution = resolveClaimSupport(claim, options)
  if (!resolution.ok) return { ok: false, reason: resolution.reason }
  const pattern = resolution.support?.pattern ?? null
  const finding = resolution.support?.finding ?? null
  const patternLabel = (item: ClaimPatternOption) => `${item.handle} (${item.kind}; ${item.supportLevel}${item.supportScope ? `/${item.supportScope}` : ""}; ${item.matchedTranscriptCount} de ${item.analyzedTranscriptCount} analisadas; claim até ${item.maximumClaimScope})`
  if (scope === "PERIOD_PATTERN" || scope === "EMPLOYEE_PATTERN" || scope === "POPULATION_PATTERN") {
    if (!pattern) return { ok: false, reason: `CLAIM_BINDING_MISSING: escopo ${scope} exige support {"type":"PATTERN","patternRef":"SP-n"} de um pattern aceito (válidos: ${listHandles(options.patterns.map((item) => item.handle))}) — fatos verdadeiros não sustentam padrão sem pattern` }
    // §10/§13: quantidade de evidência ≠ amplitude da generalização — o escopo da claim nunca excede o teto do pattern.
    if (!claimScopeWithin(scope, pattern.maximumClaimScope)) return { ok: false, reason: `CLAIM_SCOPE_EXCEEDED: ${patternLabel(pattern)} — escopo ${scope} excede o teto ${pattern.maximumClaimScope}; escreva no escopo autorizado (${pattern.maximumClaimScope === "PERIOD_PATTERN" ? '"no período analisado…"/"nas interações analisadas…"' : `"observado em ${pattern.matchedTranscriptCount} das ${pattern.analyzedTranscriptCount} interações analisadas"`})` }
  } else if (scope === "INTERACTION_SPECIFIC" && !pattern && !finding) {
    return { ok: false, reason: `CLAIM_BINDING_MISSING: claim sobre interações analisadas exige support {"type":"FINDING","findingRef":"SF-n"} (válidos: ${listHandles(options.findings.map((item) => item.handle))}) ou {"type":"PATTERN","patternRef":"SP-n"} (válidos: ${listHandles(options.patterns.map((item) => item.handle))})` }
  }
  // §14: linguagem de padrão do colaborador ("costuma", "é um padrão do colaborador", "apresenta como característica") só com teto EMPLOYEE_PATTERN.
  const strong = detectStrongPatternLanguage(claim.text)
  if (strong.length > 0 && (!pattern || !claimScopeWithin("EMPLOYEE_PATTERN", pattern.maximumClaimScope))) return { ok: false, reason: `CLAIM_SUPPORT_INSUFFICIENT: "${strong[0]}" é linguagem de padrão do colaborador — exige pattern com teto EMPLOYEE_PATTERN${pattern ? ` (${patternLabel(pattern)})` : " (nenhum pattern citado)"}; use linguagem proporcional ("observado em N das M analisadas", "no período analisado, recorrente nas interações analisadas")` }
  // Polaridade: declarada (ou lexical) compatível com o kind do pattern/finding — a claim não troca a polaridade do que a sustenta.
  const targetKind: PatternKind | InteractionFindingKind | null = pattern?.kind ?? finding?.kind ?? null
  const allowed = pattern ? PATTERN_POLARITY[pattern.kind] : finding ? FINDING_POLARITY(finding.kind) : null
  if (allowed && targetKind) {
    const lexical = lexicalPolarityOf(claim.text)
    const declared = claim.polarity ?? lexical ?? "NEUTRAL"
    const target = pattern ? `pattern ${pattern.handle} (${pattern.kind})` : `finding ${finding!.handle} (${finding!.kind})`
    // INTERACTION_FRICTION: o atrito pode ser descrito como fato (inclusive negativo) — o que não pode é ser ATRIBUÍDO ao operador.
    if (targetKind === "INTERACTION_FRICTION") {
      const attributed = detectOperatorAttribution(claim.text)
      if (attributed.length > 0) return { ok: false, reason: `CLAIM_POLARITY_MISMATCH: claim atribui ao operador ("${attributed[0]}") um atrito da interação sem atribuição (${target}) — descreva o fato da interação, não como falha do colaborador` }
      if (declared === "POSITIVE") return { ok: false, reason: `CLAIM_POLARITY_MISMATCH: claim POSITIVE sobre ${target}` }
    } else {
      if (!allowed.includes(declared)) return { ok: false, reason: `CLAIM_POLARITY_MISMATCH: claim ${declared} sobre ${target} — a claim não pode trocar a polaridade do que a sustenta` }
      if (lexical && lexical !== "MIXED" && !allowed.includes(lexical)) return { ok: false, reason: `CLAIM_POLARITY_MISMATCH: o texto da claim tem linguagem ${lexical} sobre ${target}` }
    }
  }
  return { ok: true, support: resolution.support, pattern, finding }
}

/**
 * V1.4.2 (§20): categoria de uma rejeição — BINDING_FORMAT = a claim morreu por CONTRATO (handle/forma/omissão do suporte, com
 * os objetos existindo); SEMANTIC = evidência, escopo, polaridade, fato crítico, procedimento, recomendação; TEMPORAL = relação
 * temporal. Mede se o contrato ainda causa retries/fallbacks.
 */
/**
 * V1.4.4 (§11/§18/§34–§39) — VALIDAÇÃO DO TEXTO CONTRA O CANDIDATO. Com o candidato determinístico, o modelo não erra mais a
 * ESTRUTURA (tipo, polaridade, escopo, suporte): o que pode errar é a REDAÇÃO. Esta checagem é só sobre o texto:
 * - `TEXT_POLARITY_MISMATCH`: a frase contradiz a polaridade do candidato (força descrita como falha, risco como ponto forte)
 *   ou atribui ao colaborador um atrito da interação sem atribuição;
 * - `TEXT_SCOPE_MISMATCH`: a frase generaliza além do escopo máximo do candidato ("costuma", "é um padrão do colaborador");
 * - `PERMANENT_TRAIT_LANGUAGE` (V1.4.3 §27/§29): atributo permanente/personalidade, proibido em qualquer escopo;
 * - `TEMPORAL_RELATION_NOT_AUTHORIZED` (§19): relação temporal declarada fora das autorizadas por esta execução.
 * O gating temporal por texto/metadata continua sendo o de sempre (V1.3.4.x), aplicado depois.
 */
export function checkClaimTextAgainstCandidate(claim: BehavioralClaim, candidate: ClaimCandidate): string | null {
  const allowed = candidateAllowedPolarities(candidate.kind)
  const lexical = lexicalPolarityOf(claim.text)
  if (candidate.kind === "INTERACTION_FRICTION") {
    const attributed = detectOperatorAttribution(claim.text)
    if (attributed.length > 0) return `TEXT_POLARITY_MISMATCH: o texto atribui ao colaborador ("${attributed[0]}") um atrito da interação sem atribuição (${candidate.ref} · ${candidate.support.ref}) — descreva o fato da interação, não como falha do colaborador`
    if (lexical === "POSITIVE") return `TEXT_POLARITY_MISMATCH: o texto trata como ponto forte um atrito da interação (${candidate.ref})`
  } else if (lexical && lexical !== "MIXED" && !allowed.includes(lexical)) {
    return `TEXT_POLARITY_MISMATCH: o texto tem linguagem ${lexical} sobre ${candidate.ref} (${candidate.kind}, polaridade ${candidate.polarity}) — reescreva mantendo o sentido do candidato`
  }
  const strong = detectStrongPatternLanguage(claim.text)
  if (strong.length > 0 && !claimScopeWithin("EMPLOYEE_PATTERN", candidate.maximumClaimScope)) {
    return `TEXT_SCOPE_MISMATCH: "${strong[0]}" generaliza como padrão do colaborador, acima do escopo máximo ${candidate.maximumClaimScope} de ${candidate.ref} — escreva ${candidate.maximumClaimScope === "PERIOD_PATTERN" ? '"no período analisado…"' : `"observado em ${candidate.matchedTranscriptCount ?? "N"} das ${candidate.analyzedTranscriptCount ?? "M"} interações analisadas"`}`
  }
  const permanent = detectPermanentTraitLanguage(claim.text)
  if (permanent.length > 0) return `PERMANENT_TRAIT_LANGUAGE: "${permanent[0]}" afirma atributo permanente/personalidade — ancore no período analisado ("no período analisado, o colaborador apresentou um padrão recorrente de…")`
  if (claim.temporalRelation && claim.temporalRelation !== "NONE" && !candidate.temporal.allowedRelations.includes(claim.temporalRelation)) {
    return `TEMPORAL_RELATION_NOT_AUTHORIZED: ${claim.temporalRelation} não está entre as relações autorizadas nesta execução (${candidate.temporal.allowedRelations.join(", ")}) — ${candidate.temporal.safeMeaning}`
  }
  return null
}

/**
 * V1.4.3 (§27) — EMPLOYEE_PATTERN ≠ TRAÇO ETERNO: mesmo com o escopo autorizado, a afirmação descreve o que foi observado
 * NA JANELA ANALISADA ("no período analisado, o colaborador apresentou um padrão recorrente de…"), nunca um atributo de
 * personalidade ou permanente ("o colaborador é impaciente", "tem por natureza", "sempre foi assim"). Léxico conservador:
 * só verbo de essência + adjetivo/atributo e marcadores explícitos de permanência.
 */
const PERMANENT_TRAIT_LANGUAGE: readonly RegExp[] = [
  /(?<!\p{L})(?:o|a)\s+colaborador(?:a)?\s+é\s+(?:um[a]?\s+)?\p{L}+/iu,
  /(?<!\p{L})voc[êe]\s+é\s+(?:um[a]?\s+)?(?:profissional\s+)?\p{L}+(?:\s+por\s+natureza)?/iu,
  /(?<!\p{L})(?:por|de)\s+natureza(?!\p{L})/iu,
  /(?<!\p{L})sempre\s+foi(?!\p{L})/iu,
  /(?<!\p{L})(?:tra[çc]o|caracter[íi]stica)\s+(?:de\s+)?(?:personalidade|permanente)(?!\p{L})/iu,
  /(?<!\p{L})perfil\s+(?:pessoal|comportamental\s+permanente)(?!\p{L})/iu,
]
export function detectPermanentTraitLanguage(text: string): string[] {
  return PERMANENT_TRAIT_LANGUAGE.map((pattern) => pattern.exec(text)?.[0] ?? null).filter((match): match is string => match !== null)
}

/**
 * V1.4.3 (§11/§12) — RESÍDUO DE CLAIM DESCARTADA no texto entregue: depois de descartar uma afirmação, a aplicação confere
 * por código que ela não continua viva na prosa (resumo, comportamento observado, recomendação, fecho). Comparação
 * determinística e conservadora: normaliza (minúsculas, sem acento/pontuação) e procura um TRECHO CONTÍGUO de palavras da
 * afirmação dentro do texto — pelo menos 6 palavras e 60 % da afirmação (afirmação curta precisa aparecer inteira). Sem
 * similaridade semântica, sem LLM: ou o texto repete literalmente o miolo da afirmação descartada, ou não repete.
 */
/** Trecho contíguo mínimo (em palavras) e fração mínima da afirmação para considerar que ela sobreviveu no texto. */
const RESIDUE_MIN_RUN = 6
const RESIDUE_MIN_COVERAGE = 0.6
const residueTokens = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)

export function claimResidueIn(text: string, claimText: string): boolean {
  const haystack = residueTokens(text)
  const needle = residueTokens(claimText)
  if (needle.length === 0 || haystack.length === 0) return false
  const contains = (run: string[]) => haystack.some((_, index) => run.every((token, offset) => haystack[index + offset] === token))
  // Afirmação curta: só conta como resíduo se aparecer inteira.
  if (needle.length <= RESIDUE_MIN_RUN) return contains(needle)
  const minimumRun = Math.max(RESIDUE_MIN_RUN, Math.ceil(needle.length * RESIDUE_MIN_COVERAGE))
  for (let start = 0; start + minimumRun <= needle.length; start += 1) if (contains(needle.slice(start, start + minimumRun))) return true
  return false
}

/** Handle do suporte de uma claim (identidade congelada na correção — §6). null = sem suporte declarado/resolvível. */
export function claimSupportHandleOf(claim: BehavioralClaim, ledger: LedgerEntry[]): string | null {
  const resolution = resolveClaimSupport(claim, claimSupportOptionsOf(ledger))
  if (!resolution.ok || !resolution.support) return null
  return resolution.support.pattern?.handle ?? resolution.support.finding!.handle
}

/**
 * V1.4.3 (§5) — CORREÇÃO LOCAL: o bloco enviado ao modelo cita SOMENTE as afirmações rejeitadas, cada uma com o suporte
 * CONGELADO (o mesmo SP-n/SF-n), as polaridades permitidas por aquele suporte, o teto de escopo e o motivo; e manda manter
 * intacto tudo o que passou. Uma afirmação que não puder ser corrigida deve ser REMOVIDA do texto (não reescrita com outro
 * suporte — §6). As rejeições globais (fato crítico, linguagem temporal/procedimental do texto) entram como itens do texto.
 */
export function renderClaimCorrection(input: { rejected: ClaimVerdict[]; accepted: ClaimVerdict[]; global: ClaimRejection[]; temporalConclusion?: string | undefined }): string {
  const lines: string[] = ["CORREÇÃO OBRIGATÓRIA (validação por código da resposta anterior) — corrija SÓ o que está listado; todo o resto da resposta (inclusive as afirmações aceitas) deve permanecer como está."]
  if (input.accepted.length > 0) lines.push(`AFIRMAÇÕES ACEITAS (mantenha o texto e o support delas exatamente como estão): ${input.accepted.map((verdict) => `"${verdict.claim.text.slice(0, 80)}"`).join("; ")}.`)
  for (const verdict of input.rejected) {
    // V1.4.4: com candidato, o que fica congelado é o CANDIDATO (e com ele tipo, polaridade, escopo e suporte) — só a frase muda.
    const candidate = verdict.candidate ?? null
    const support = candidate?.support.ref ?? verdict.support?.pattern?.handle ?? verdict.support?.finding?.handle ?? null
    const parts = [`- AFIRMAÇÃO REJEITADA: "${verdict.claim.text}"`, `motivo: ${verdict.rejections.map((item) => item.reason).join(" | ")}`]
    if (candidate) {
      parts.push(`candidato CONGELADO: ${candidate.ref} (suporte ${candidate.support.ref}) — reescreva SÓ a frase; trocar de candidato para a afirmação passar é proibido`)
      parts.push(`significado autorizado: ${candidate.safeMeaning}`)
      parts.push(`polaridade do candidato: ${candidate.polarity} · escopo máximo: ${candidate.maximumClaimScope}`)
    } else {
      if (support) parts.push(`support CONGELADO: ${support} — se reescrever, mantenha EXATAMENTE este support (trocar de pattern/finding para a afirmação passar é proibido)`)
      if (verdict.allowedPolarities) parts.push(`polaridade permitida para ${support ?? "este suporte"}: ${verdict.allowedPolarities.join(" | ")}`)
      if (verdict.maximumClaimScope) parts.push(`escopo máximo permitido: ${verdict.maximumClaimScope}`)
    }
    parts.push("se não for possível corrigir dentro dessas regras, REMOVA esta afirmação do texto e do JSON (e qualquer recomendação que dependa só dela) — o resto da resposta continua valendo")
    lines.push(parts.join(" · "))
  }
  for (const item of input.global) lines.push(`- ${item.kind === "CRITICAL_FACT" ? "Fato crítico à decisão" : item.kind === "TEMPORAL_CLAIM" ? "Relação temporal no texto" : item.kind === "PROCEDURAL_CLAIM" ? "Conclusão procedimental no texto" : "Recomendação"}: "${item.text}" — ${item.reason}.`)
  if (input.temporalConclusion) lines.push(`CONCLUSÃO TEMPORAL AUTORIZADA nesta execução: ${input.temporalConclusion}`)
  lines.push("Devolva a resposta completa no mesmo formato (com os campos internos de auditoria), preservando as afirmações aceitas e removendo/corrigindo apenas as listadas.")
  return lines.join("\n")
}

export function rejectionCategoryOf(item: EvidenceGatingResult["rejectedClaims"][number]): GatingCorrectionCategory {
  // V1.4.4: a relação temporal não autorizada chega pelo candidato (kind CLAIM_BINDING) — a categoria é do MOTIVO, não do kind.
  if (item.kind === "TEMPORAL_CLAIM" || /^TEMPORAL_/.test(item.reason)) return "TEMPORAL"
  if (item.kind === "CLAIM_BINDING" && /^(?:CLAIM_SUPPORT_FORMAT|CLAIM_SUPPORT_REF_UNKNOWN|CLAIM_BINDING_MISSING|CLAIM_PATTERN_NOT_FOUND|CLAIM_FINDING_NOT_FOUND)\b/.test(item.reason)) return "BINDING_FORMAT"
  return "SEMANTIC"
}
export function correctionCategoriesOf(rejected: EvidenceGatingResult["rejectedClaims"]): GatingCorrectionCategory[] {
  return [...new Set(rejected.map(rejectionCategoryOf))]
}

/**
 * Ref como o modelo escreveu → ref do ledger. Determinístico e estreito: só grafias da PRÓPRIA transcrição em
 * foco ("transcrição", "transcrição de I1", "TRANSCRIPT") viram TRANSCRICAO — e só quando essa entrada existe.
 * Um handle solto (I3) NUNCA vira evidência: pode ser uma interação listada e não lida. (V1.3.2 — observado no smoke.)
 */
export function normalizeEvidenceRef(ref: string, ledgerRefs: Set<string>): string {
  const upper = ref.trim().toUpperCase()
  if (ledgerRefs.has(upper)) return upper
  if (ledgerRefs.has("TRANSCRICAO") && /^(?:TRANSCRI[ÇC][ÃA]O|TRANSCRIPT)(?:\s+(?:DE|DA|OF)\s+I\d{1,3})?$/.test(upper)) return "TRANSCRICAO"
  return upper
}

/**
 * V1.4.3 (§3) — VERDITO POR CLAIM: o gating deixa de ser uma lista plana e passa a dizer, para CADA afirmação,
 * se ela foi aceita ou rejeitada e por quê, junto do que a aplicação já sabe sobre o suporte dela (handle congelado,
 * polaridades permitidas, teto de escopo). Uma claim inválida não contamina as irmãs: quem decide o destino da resposta
 * é o chamador (`text-evidence-gating.ts`), que corrige só o que falhou e preserva o que passou.
 * As rejeições GLOBAIS (fato crítico, linguagem temporal/procedimental no texto entregue, recomendações) continuam
 * separadas: elas são sobre o texto/resposta, não sobre uma afirmação isolada.
 */
export type ClaimRejection = EvidenceGatingResult["rejectedClaims"][number]
export type ClaimVerdict = {
  index: number
  claim: BehavioralClaim
  status: "ACCEPTED" | "REJECTED"
  rejections: ClaimRejection[]
  /** Suporte resolvido (SP-n/SF-n) — a IDENTIDADE que a correção congela (§6). */
  support: ResolvedClaimSupport | null
  /** O que a aplicação autoriza para este suporte: polaridades compatíveis e teto de escopo (entra na correção local). */
  allowedPolarities: ClaimPolarity[] | null
  maximumClaimScope: ClaimScope | null
  /** V1.4.4: candidato selecionado (quando a execução tem camada semântica) — a origem determinística de tipo/polaridade/escopo. */
  candidate?: ClaimCandidate | null
}
export type SynthesisGating = { criticalFacts: ClaimRejection[]; claims: ClaimVerdict[]; transversal: ClaimRejection[]; recommendations: ClaimRejection[]; /** V1.4.4: candidatos projetados nesta execução (disponíveis × selecionados). */ candidates: ClaimCandidate[] }

export function gateSynthesisDetailed(synthesis: InvestigationSynthesis, context: GatingContext, responseText?: string): SynthesisGating {
  const byRef = new Map(context.ledger.map((entry) => [entry.ref, entry]))
  const ledgerRefs = new Set(byRef.keys())
  const assessments = assessLedgerRepresentativeness(context.ledger, context.interactionUniverse ?? null, context.operationalUniverse ?? null)
  const criticalFacts: ClaimRejection[] = []
  const verdicts: ClaimVerdict[] = []
  // V1.4.4: candidatos projetados por código a partir dos patterns/findings aceitos — tipo, polaridade e teto já decididos.
  const candidates = buildClaimCandidates(context.ledger)
  const candidateByRef = new Map(candidates.map((item) => [item.ref.toUpperCase(), item]))
  const selectedCandidates = new Set<string>()
  const temporalContext = { buckets: context.temporalBuckets ?? [], facts: temporalFactsOf(context.ledger) }
  const acceptedRelations: TemporalRelation[] = []
  // FACT PRESERVATION (V1.3.1): fatos críticos considerados, sem contradição, limitação crítica declarada.
  if (context.criticalFacts && context.criticalFacts.length > 0 && responseText !== undefined) {
    const own = assessments.filter((item) => item.tool !== "analyze_peer_patterns" && item.tool !== "find_comparable_interactions")
    const criticalLimitationRequired = Boolean(context.objective?.causal) && bestRepresentativeness(own) !== "REPRESENTATIVE"
    criticalFacts.push(...checkFactPreservation({ criticalFacts: context.criticalFacts, consideredCriticalFacts: synthesis.consideredCriticalFacts ?? [], text: responseText, criticalLimitationRequired, limitationsDeclared: synthesis.limitations.length }))
  }
  synthesis.behavioralClaims.forEach((claim, index) => {
    const verdict: ClaimVerdict = { index, claim, status: "ACCEPTED", rejections: [], support: null, allowedPolarities: null, maximumClaimScope: null }
    verdicts.push(verdict)
    const reject = (item: ClaimRejection) => { verdict.rejections.push(item); verdict.status = "REJECTED" }
    // V1.4.1: o binding já identifica o fato — refs implícitas entram antes da checagem (nunca inventadas).
    // V1.4.4 (§2–§6): com candidato selecionado, a aplicação IMPÕE tipo, polaridade e escopo — o que o modelo declarou é ignorado.
    // A resolução vem ANTES das refs: o candidato carrega a proveniência (fato do ledger), então a claim não precisa repeti-la.
    let candidate = claim.candidateRef ? candidateByRef.get(claim.candidateRef.trim().toUpperCase()) ?? null : null
    if (claim.candidateRef && !candidate) return reject({ kind: "CLAIM_BINDING", text: claim.text, reason: `CLAIM_CANDIDATE_UNKNOWN: candidateRef "${claim.candidateRef}" não existe nesta execução — candidatos válidos: ${candidates.length > 0 ? candidates.map((item) => item.ref).join(", ") : "(nenhum)"}` })
    // Claim que citou o SUPORTE (SP-n/SF-n, contrato V1.4.2) em vez do candidato: resolve para o MESMO candidato — as
    // propriedades estruturais vêm sempre do objeto aceito, nunca do que o modelo declarou (V1.4.4 §4/§5).
    if (!candidate && (claim.support || claim.patternRef || claim.findingRef)) {
      const resolvedSupport = resolveClaimSupport(claim, claimSupportOptionsOf(context.ledger))
      const handle = resolvedSupport.ok && resolvedSupport.support ? resolvedSupport.support.pattern?.handle ?? resolvedSupport.support.finding?.handle ?? null : null
      candidate = handle ? candidates.find((item) => item.support.ref === handle) ?? null : null
    }
    if (candidate) {
      verdict.candidate = candidate
      verdict.allowedPolarities = candidateAllowedPolarities(candidate.kind)
      verdict.maximumClaimScope = candidate.maximumClaimScope
    }
    const candidateFactRef = candidate?.provenance.factRef
    const refs = [...new Set([...claim.evidenceRefs, ...(candidateFactRef ? [candidateFactRef] : []), ...factRefsFromBinding(claim, context.ledger)])].map((ref) => byRef.get(normalizeEvidenceRef(ref, ledgerRefs))).filter((entry): entry is LedgerEntry => Boolean(entry))
    if (refs.length === 0) return reject({ kind: "BEHAVIORAL_CLAIM", text: claim.text, reason: "sem referência a fato do ledger" })
    if (!refs.some(isBehavioralEvidence)) return reject({ kind: "BEHAVIORAL_CLAIM", text: claim.text, reason: `refs ${refs.map((entry) => entry.ref).join(", ")} não são evidência de interação/transcrição` })
    // V1.4.4 (§5/§6): o TETO vem do objeto aceito. Se o modelo ainda declarar um escopo (contrato legado), ele nunca pode ser
    // MAIOR que o teto — pedir escopo maior é rejeitado, não silenciosamente reduzido. Sem declaração, vale o teto.
    if (candidate && claim.scope && !claimScopeWithin(claim.scope, candidate.maximumClaimScope)) {
      return reject({ kind: "CLAIM_BINDING", text: claim.text, reason: `CLAIM_SCOPE_EXCEEDED: escopo declarado ${claim.scope} excede o teto ${candidate.maximumClaimScope} de ${candidate.ref} (${candidate.support.ref}) — a aplicação já derivou o escopo máximo da evidência` })
    }
    if (candidate && claim.polarity && !candidateAllowedPolarities(candidate.kind).includes(claim.polarity)) {
      return reject({ kind: "CLAIM_BINDING", text: claim.text, reason: `CLAIM_POLARITY_MISMATCH: polaridade declarada ${claim.polarity} incompatível com ${candidate.ref} (${candidate.kind}, polaridade ${candidate.polarity}) — a polaridade vem do candidato, não da declaração` })
    }
    const scope = claim.scope ?? candidate?.maximumClaimScope ?? DEFAULT_CLAIM_SCOPE
    const referenced = assessments.filter((item) => refs.some((entry) => entry.ref === item.ref))
    const allowed = scopeAllowedBy(scope, referenced)
    if (!allowed.ok) return reject({ kind: "BEHAVIORAL_CLAIM", text: claim.text, reason: `escopo ${scope}: ${allowed.reason}` })
    // V1.4.0 — suporte do pattern: representatividade da amostra não basta; o pattern referenciado precisa autorizar o escopo.
    const support = patternSupportAllowedBy(scope, refs)
    if (!support.ok) return reject({ kind: "BEHAVIORAL_CLAIM", text: claim.text, reason: `escopo ${scope}: ${support.reason}` })
    // V1.4.4: com candidato, o vínculo já está resolvido por construção — resta validar o TEXTO contra o que ele autoriza (§11).
    if (candidate) {
      const textRejection = checkClaimTextAgainstCandidate(claim, candidate)
      if (textRejection) return reject({ kind: "CLAIM_BINDING", text: claim.text, reason: textRejection })
    } else {
      // V1.4.1/V1.4.2 — BINDING canônico claim ↔ pattern/finding (execuções/legado sem candidato selecionado).
      // V1.4.3: o suporte resolvido é anotado ANTES do veredito — a correção local precisa dele mesmo quando a claim é rejeitada.
      const resolved = resolveClaimSupport(claim, claimSupportOptionsOf(refs))
      if (resolved.ok && resolved.support) {
        verdict.support = resolved.support
        verdict.allowedPolarities = resolved.support.pattern ? PATTERN_POLARITY[resolved.support.pattern.kind] : FINDING_POLARITY(resolved.support.finding!.kind)
        verdict.maximumClaimScope = resolved.support.pattern?.maximumClaimScope ?? null
      }
      const binding = bindClaim(claim, refs)
      if (!binding.ok) return reject({ kind: "CLAIM_BINDING", text: claim.text, reason: binding.reason })
    }
    // V1.4.0/V1.4.1 — conclusão procedimental exige lineage real: pattern PROCEDURAL ou finding PROCEDURAL_QUESTION + base.
    const proceduralLanguage = detectProceduralConclusionLanguage(claim.text)
    if (proceduralLanguage.length > 0) {
      const proceduralLineage = candidate
        ? candidate.kind === "PROCEDURAL" || candidate.kind === "PROCEDURAL_QUESTION" || candidate.kind === "PROCEDURAL_DIVERGENCE"
        : verdict.support?.pattern?.kind === "PROCEDURAL" || verdict.support?.finding?.kind === "PROCEDURAL_QUESTION" || verdict.support?.finding?.kind === "PROCEDURAL_DIVERGENCE" || (!verdict.support && refs.every((entry) => !Array.isArray(entry.signals?.interactionAnalysis?.patterns)))
      if (!proceduralLineage) return reject({ kind: "PROCEDURAL_CLAIM", text: claim.text, reason: `PROCEDURAL_CONCLUSION_WITHOUT_LINEAGE: "${proceduralLanguage[0]}" conclui sobre procedimento sem support de pattern PROCEDURAL nem de finding PROCEDURAL_QUESTION (afirmação normativa registrada na interação) — um fato da base sozinho não sustenta a conclusão` })
      if (!hasKnowledgeEvidence(refs, context)) return reject({ kind: "PROCEDURAL_CLAIM", text: claim.text, reason: `PROCEDURAL_CONCLUSION_WITHOUT_KNOWLEDGE: "${proceduralLanguage[0]}" conclui divergência do procedimento sem referência a fato da base de conhecimento (query_knowledge com trecho) — reformule como questão procedimental ("o operador afirmou X; verificar contra o procedimento") ou cite a base` })
    }
    // V1.4.3 (§27) — EMPLOYEE_PATTERN não é traço permanente: mesmo autorizado, a afirmação fica ancorada à janela analisada.
    // V1.4.5 (§19) — aderência parcial não vira aderência integral, mesmo com o candidato certo.
    const completeness = detectProceduralCompletenessLanguage(claim.text)
    if (completeness.length > 0 && proceduralCoverageOfLedger(context.ledger) !== "COMPLETE") return reject({ kind: "PROCEDURAL_CLAIM", text: claim.text, reason: `PROCEDURAL_COVERAGE_OVERSTATED: "${completeness[0]}" afirma aderência ao procedimento INTEIRO, mas a execução só verificou os pontos confrontados com a base (cobertura PARCIAL) — escreva "cumpriu os requisitos verificados…"` })
    const permanent = detectPermanentTraitLanguage(claim.text)
    if (permanent.length > 0) return reject({ kind: "BEHAVIORAL_CLAIM", text: claim.text, reason: `PERMANENT_TRAIT_LANGUAGE: "${permanent[0]}" afirma atributo permanente/personalidade — escreva o padrão ancorado ao período analisado ("no período analisado, o colaborador apresentou um padrão recorrente de…")` })
    // §26: o mesmo candidato não pode ser afirmado duas vezes — checado por último, para que o motivo específico venha primeiro.
    if (candidate) {
      if (selectedCandidates.has(candidate.ref)) return reject({ kind: "CLAIM_BINDING", text: claim.text, reason: `DUPLICATE_CANDIDATE_SELECTION: ${candidate.ref} já foi afirmado nesta resposta — uma afirmação por candidato` })
      selectedCandidates.add(candidate.ref)
    }
    // V1.3.4 — RELAÇÃO temporal (mudança/tendência/estabilidade/posição) exige comparação validada entre blocos.
    const temporal = gateTemporalClaim({ text: claim.text, metadata: { temporalRelation: claim.temporalRelation, evidenceBuckets: claim.evidenceBuckets, position: claim.position }, evidenceRefs: refs.map((entry) => entry.ref), scope, behavioral: true, scopeSupported: allowed.ok }, temporalContext)
    if (temporal.temporal && !temporal.ok) reject({ kind: "TEMPORAL_CLAIM", text: claim.text, reason: `${temporal.reason}: ${temporal.detail}` })
    else if (temporal.temporal && temporal.ok) acceptedRelations.push(claim.temporalRelation ?? "NONE")
  })
  // V1.3.4.2 — TRANSVERSAL CONTRA A CONCLUSÃO TEMPORAL AUTORIZADA (§14/§18) + V1.4.0 procedimental: hipóteses, premissas e
  // texto entregue. São rejeições da RESPOSTA (não de uma claim): só o texto pode consertá-las.
  const transversal = [...temporalCompatibilityRejections(synthesis, context.ledger, acceptedRelations, responseText), ...proceduralCompatibilityRejections(synthesis, context, responseText)]
  const recommendations: ClaimRejection[] = []
  for (const recommendation of synthesis.recommendationSupport) {
    if (recommendation.basis === "OBSERVED_EVIDENCE") {
      const refs = recommendation.evidenceRefs.filter((ref) => byRef.has(normalizeEvidenceRef(ref, ledgerRefs)))
      if (refs.length === 0) recommendations.push({ kind: "RECOMMENDATION", text: recommendation.text, reason: "OBSERVED_EVIDENCE sem referência válida ao ledger" })
    } else if (recommendation.basis === "KNOWLEDGE_GUIDANCE" && !context.knowledgeAvailable) {
      recommendations.push({ kind: "RECOMMENDATION", text: recommendation.text, reason: "KNOWLEDGE_GUIDANCE sem base de conhecimento/procedimento real nesta execução" })
    }
  }
  return { criticalFacts, claims: verdicts, transversal, recommendations, candidates }
}

/** Lista plana (compatibilidade: replay, QA Lab, chamadores que só querem "o que foi rejeitado"). */
export function gateSynthesis(synthesis: InvestigationSynthesis, context: GatingContext, responseText?: string): EvidenceGatingResult["rejectedClaims"] {
  const detailed = gateSynthesisDetailed(synthesis, context, responseText)
  return flattenGating(detailed)
}

export function flattenGating(detailed: SynthesisGating): ClaimRejection[] {
  return [...detailed.criticalFacts, ...detailed.claims.flatMap((verdict) => verdict.rejections), ...detailed.transversal, ...detailed.recommendations]
}

/** Evidência normativa presente: fato query_knowledge com dado entre as refs da claim, ou base recuperada no prompt quando a execução não consultou a Tool. */
function hasKnowledgeEvidence(refs: LedgerEntry[], context: GatingContext): boolean {
  if (refs.some(isKnowledgeEvidence)) return true
  const consultedTool = context.ledger.some((entry) => entry.tool === "query_knowledge")
  return !consultedTool && context.knowledgeAvailable
}

/** Superfícies transversais (hipóteses sustentadas, premissas, texto entregue) com linguagem de conclusão procedimental sem NENHUMA evidência normativa na execução. */
export function proceduralCompatibilityRejections(synthesis: Pick<InvestigationSynthesis, "supportedHypotheses" | "recommendationSupport">, context: GatingContext, responseText?: string): EvidenceGatingResult["rejectedClaims"] {
  const surfaces = temporalSurfacesOf(synthesis, responseText)
  const knowledgeInExecution = context.ledger.some(isKnowledgeEvidence) || (!context.ledger.some((entry) => entry.tool === "query_knowledge") && context.knowledgeAvailable)
  // V1.4.5 (§19): a linguagem de aderência INTEGRAL é transversal — vale para hipóteses, premissas e texto entregue, e não
  // depende de haver base: nem com base a execução prova o procedimento inteiro sem checklist estruturado.
  const completeness = proceduralCoverageOfLedger(context.ledger) === "COMPLETE" ? [] : surfaces
    .map((surface) => ({ surface, language: detectProceduralCompletenessLanguage(surface.text) }))
    .filter((item) => item.language.length > 0)
    .map((item) => ({ kind: "PROCEDURAL_CLAIM" as const, text: item.surface.where === "texto entregue" ? item.language.join(" | ") : item.surface.text, reason: `PROCEDURAL_COVERAGE_OVERSTATED (${item.surface.where}): afirma aderência ao procedimento inteiro; a execução só verificou os pontos confrontados com a base (cobertura PARCIAL) — escreva "os requisitos verificados foram cumpridos"` }))
  if (knowledgeInExecution) return completeness
  return [...completeness, ...surfaces
    .map((surface) => ({ surface, language: detectProceduralConclusionLanguage(surface.text) }))
    .filter((item) => item.language.length > 0)
    .map((item) => ({ kind: "PROCEDURAL_CLAIM" as const, text: item.surface.where === "texto entregue" ? item.language.join(" | ") : item.surface.text, reason: `PROCEDURAL_CONCLUSION_WITHOUT_KNOWLEDGE (${item.surface.where}): conclui divergência do procedimento sem nenhuma evidência da base de conhecimento nesta execução — escreva como questão procedimental a verificar` }))]
}

/** Conclusão temporal autorizada desta execução (derivada do ledger) — exposta para dossiê, telemetria e Orquestrador. */
export function temporalConclusionFor(ledger: LedgerEntry[]): TemporalConclusion {
  return temporalConclusionOfLedger(ledger)
}

/** Superfícies transversais da síntese checadas contra a conclusão temporal (hipóteses sustentadas, premissas, texto entregue). */
export function temporalSurfacesOf(synthesis: Pick<InvestigationSynthesis, "supportedHypotheses" | "recommendationSupport">, responseText?: string): { where: string; text: string }[] {
  return [
    ...synthesis.supportedHypotheses.map((text) => ({ where: "hipótese sustentada", text })),
    ...synthesis.recommendationSupport.map((item) => ({ where: "premissa de recomendação", text: item.text })),
    ...(responseText !== undefined ? [{ where: "texto entregue", text: responseText }] : []),
  ]
}

export function temporalCompatibilityRejections(synthesis: InvestigationSynthesis, ledger: LedgerEntry[], acceptedRelations: TemporalRelation[], responseText?: string): EvidenceGatingResult["rejectedClaims"] {
  const facts = temporalFactsOf(ledger)
  const authorization = {
    conclusion: temporalConclusionOfLedger(ledger),
    acceptedRelations,
    indicatorTemporalFact: facts.some((fact) => !fact.behavioral),
    indicatorStable: ledger.some((entry) => (INDICATOR_TEMPORAL_TOOLS as readonly string[]).includes(entry.tool) && entry.signals?.performance === "STABLE"),
  }
  return checkTemporalConclusionCompatibility(temporalSurfacesOf(synthesis, responseText), authorization).map((item) => ({ kind: "TEMPORAL_CLAIM" as const, text: item.where === "texto entregue" ? item.language.join(" | ") : item.text, reason: `${item.reason}: ${item.detail}` }))
}

/** Refs internas (F-n, M-n, I-n, K-n, C-n, TRANSCRICAO) que o modelo às vezes cola no texto do colaborador — removidas por código. */
const INTERNAL_REF = "(?:S[PF]\\d{1,4}|(?:F\\d{1,3}\\/)?P\\d{1,3}|I\\d{1,3}\\/F\\d{1,3}|F\\d{1,3}|M\\d{1,3}|I\\d{1,3}|K\\d{1,3}|C\\d{1,3}|TRANSCRICAO)"
/** V1.4.1 (§36): também "(Interação I10)", "(interações I9 e I10)", "(ref I3)", "(pattern P2)", "(finding I6/F1)" — rótulo + handle(s); V1.4.2: "(SP1)", "(pattern SP2)", "(finding SF3)", "(suporte SP1)". */
const INTERNAL_REF_LABEL = "(?:intera[çc](?:[ãa]o|[õo]es)|refs?\\.?|refer[êe]ncias?|handles?|patterns?|findings?|fatos?|suportes?|ver)"
const INTERNAL_REF_GROUP = new RegExp(`\\s*\\(\\s*(?:${INTERNAL_REF_LABEL}\\s+)?${INTERNAL_REF}(?:\\s*(?:[,;]|\\be\\b|\\bou\\b)\\s*${INTERNAL_REF})*\\s*\\)`, "gi")

export function stripInternalRefs(text: string): string {
  return text.replace(INTERNAL_REF_GROUP, "").replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ")
}

/**
 * V1.4.1: sanitização de uma LINHA DO LEDGER para o fallback factual (texto que o colaborador lê): remove o segmento
 * model-facing de findings ("; findings: I6/F1 [STRENGTH] …"), os prefixos "P1 " dos patterns, a legenda de suporte/binding
 * e handles soltos (I-n/F-n, P-n). Só o texto entregue — a linha original continua no ledger/auditoria.
 */
export function sanitizeLedgerSummaryForCollaborator(summary: string): string {
  return stripInternalRefs(
    summary
      .replace(/;\s*findings:\s.*?(?=:\s\d+\s(?:pattern|achado)\(s\)|$)/s, "")
      .replace(/\b(?:SP\d{1,4}|P\d{1,3})\s+(?=")/g, "")
      .replace(/\s*\[suporte:[^\]]*\]/g, "")
      .replace(/\s*\[nível = [^\]]*\]/g, "")
      .replace(/\s*\[contagem = [^\]]*\]/g, "")
      .replace(/;\s*findings\s+SF\d{1,4}(?:,\s*SF\d{1,4})*/g, "")
      .replace(/;\s*escopo\s+[A-Z_]+\s+→\s+claim\s+até\s+[A-Z_]+/g, "")
      .replace(/\bI\d{1,3}\/F\d{1,3}\b/g, "")
      .replace(/\bS[PF]\d{1,4}\b/g, "")
      .replace(/\(?\b(?:F\d{1,3}\/)?P\d{1,3}\b\)?/g, ""),
  ).replace(/[ \t]{2,}/g, " ").replace(/\s+([,;.])/g, "$1")
}

/** Representatividade calculada para persistir junto da síntese (auditoria/QA). */
export function representativenessOf(context: GatingContext): RepresentativenessAssessment[] {
  return assessLedgerRepresentativeness(context.ledger, context.interactionUniverse ?? null, context.operationalUniverse ?? null)
}

/** Bloco de correção enviado ao modelo (uma única vez) quando o gating rejeita algo. */
export function renderGatingCorrection(rejected: EvidenceGatingResult["rejectedClaims"]): string {
  const lines = rejected.map((item) => `- ${item.kind === "BEHAVIORAL_CLAIM" ? "Afirmação comportamental" : item.kind === "CRITICAL_FACT" ? "Fato crítico à decisão" : item.kind === "TEMPORAL_CLAIM" ? "Relação temporal" : item.kind === "PROCEDURAL_CLAIM" ? "Conclusão procedimental" : item.kind === "CLAIM_BINDING" ? "Vínculo claim ↔ pattern/finding" : "Recomendação"}: "${item.text}" — ${item.reason}.`)
  return [
    "CORREÇÃO OBRIGATÓRIA (validação por código da resposta anterior):",
    ...lines,
    "Reescreva o JSON completo: (1) remova do texto toda afirmação sobre comportamento que não tenha evidência de interação/transcrição no ledger, ou reformule em linguagem factual (ex.: \"os dados mostram o indicador acima da referência, mas a amostra de interações disponível não é suficiente para identificar uma causa comportamental\"); (2) afirmação com evidência anedótica só pode ter escopo INTERACTION_SPECIFIC e ser escrita como \"na(s) interação(ões) analisada(s) ocorreu X\" — nunca \"você costuma/sempre faz X\"; (3) recomendações sem evidência observada devem ser marcadas como GENERAL_DEVELOPMENT_SUGGESTION e escritas como sugestão, nunca como comportamento observado; (4) KNOWLEDGE_GUIDANCE só com documento real citado; (5) nunca invente referências F-n; (6) fatos críticos à decisão (valor × meta, tendência, comparação, qualidade do dado) devem ser considerados e listados em consideredCriticalFacts, sem contradizê-los no texto; (7) RELAÇÃO TEMPORAL (mudou, passou a, aumentou/reduziu ao longo do período, ficou estável, \"no início/fim do período\", \"interações iniciais/mais recentes\", \"deixou de ocorrer\", \"concentrado no início\") só com temporalRelation + evidenceBuckets numa claim sustentada por um fato do ledger que COMPAROU os blocos com relação SUSTENTADA; diferença SÓ NA AMOSTRA (achado sem trecho nas analisadas de um bloco) NÃO é mudança nem ausência no período — escreva o fato da amostra (\"observado em 2 das 3 interações analisadas de junho e em nenhuma das 3 analisadas de agosto\") com escopo INTERACTION_SPECIFIC; tendência exige 3 momentos ordenados; estabilidade (\"permaneceu/se manteve estável\", \"se manteve constante\", \"mantendo a performance estável\", \"mantendo-se uma estabilidade\") exige relação STABLE SUSTENTADA — \"nenhuma diferença sustentada\" NÃO é estabilidade: escreva \"não foi encontrada diferença temporal sustentada nas evidências analisadas\"; sem isso, descreva só o que ocorreu sem afirmar mudança, tendência, estabilidade, concentração ou posição no período — ter dados de vários momentos não é evidência de que algo mudou; (8) ESCOPO DO PADRÃO: cada pattern do ledger traz o teto de claim (\"claim até …\") — a claim nunca excede esse teto: teto INTERACTION_SPECIFIC escreve \"observado em N das M interações analisadas\"; teto PERIOD_PATTERN escreve \"no período analisado…\"; só teto EMPLOYEE_PATTERN autoriza \"o colaborador costuma/apresenta…\"; (9) CONCLUSÃO PROCEDIMENTAL (\"diverge/contraria o procedimento\", \"orientação incorreta\") só com support de pattern PROCEDURAL ou finding PROCEDURAL_QUESTION E fato da base de conhecimento referenciado — sem isso, escreva como questão a verificar; (10) SUPORTE (binding): cada claim traz EXATAMENTE UM suporte por handle existente no ledger — claim PERIOD/EMPLOYEE/POPULATION_PATTERN: \"support\": {\"type\":\"PATTERN\",\"patternRef\":\"SP-n\"}; claim INTERACTION_SPECIFIC: \"support\": {\"type\":\"FINDING\",\"findingRef\":\"SF-n\"} (ou um SP-n); copie o handle EXATAMENTE como está no ledger (SP1, SF3) — nunca F-n, F-n/P-n, I-n/F-n nem listas; a linha de suportes válidos desta execução lista os únicos handles aceitos; declare polarity (POSITIVE/NEGATIVE/NEUTRAL/MIXED) compatível com o kind do pattern/finding — STRENGTH nunca vira falha, RISK nunca vira ponto forte, INTERACTION_FRICTION não é falha do colaborador; \"costuma\"/\"é um padrão do colaborador\" só com teto EMPLOYEE_PATTERN, e mesmo assim ancorado ao período analisado — nunca atributo permanente/personalidade (\"o colaborador é…\", \"por natureza\").",
  ].join("\n")
}

/**
 * Linha DINÂMICA do contrato: quais refs existem nesta execução e (V1.4.2 §4/§6) os ÚNICOS suportes de claim selecionáveis —
 * o enum dinâmico: cada pattern com kind, nível, escopo, teto de claim e findings que o sustentam; cada finding com kind e
 * interação. O modelo seleciona um handle; não constrói identificadores.
 */
export function renderSynthesisRefsLine(refs: string[], supports?: ClaimSupportOptions, candidates?: ClaimCandidate[]): string {
  const refList = refs.length > 0 ? refs.join(", ") : "(nenhum fato disponível)"
  // V1.4.4: quando há candidatos, eles SUBSTITUEM a lista de suportes — o modelo escolhe CC-n e escreve o texto, nada mais.
  if (candidates && candidates.length > 0) return `Regras de evidência: refs válidas são somente ${refList}.\n${renderClaimCandidates(candidates)}`
  return `Regras de evidência: refs válidas são somente ${refList}.${supports ? `\n${renderClaimSupportsLine(supports)}` : ""}`
}

/** O ENUM DINÂMICO de suportes desta execução (patterns SP-n e findings SF-n existentes) — a única fonte de handles para `support`. */
export function renderClaimSupportsLine(supports: ClaimSupportOptions): string {
  if (supports.patterns.length === 0 && supports.findings.length === 0) return "Suportes de claim válidos nesta execução: nenhum pattern nem finding semântico — claims comportamentais só com fatos de interação (evidenceRefs) e escopo INTERACTION_SPECIFIC."
  // V1.4.3 (§14/§15): o modelo vê a POLARIDADE AUTORIZADA e o TETO de cada suporte — não precisa (nem deve) inferir.
  const patterns = supports.patterns.length > 0 ? supports.patterns.map((item) => `${item.handle} — ${item.kind} — nível ${item.supportLevel}${item.supportScope ? ` — escopo ${item.supportScope}` : ""} — claim até ${item.maximumClaimScope} — polarity permitida: ${PATTERN_POLARITY[item.kind].join("|")} (${item.matchedTranscriptCount} de ${item.analyzedTranscriptCount} analisadas)`).join("; ") : "nenhum"
  const findings = supports.findings.length > 0 ? supports.findings.map((item) => `${item.handle} (${item.kind}${item.ref.includes("/") ? `, ${item.ref.split("/")[0]}` : ""} — polarity permitida: ${FINDING_POLARITY(item.kind).join("|")})`).join(", ") : "nenhum"
  return `Suportes de claim válidos nesta execução (support.patternRef só entre: ${listHandles(supports.patterns.map((item) => item.handle))}; support.findingRef só entre: ${listHandles(supports.findings.map((item) => item.handle))}). Patterns: ${patterns}. Findings: ${findings}.`
}

/** Parte ESTÁTICA do contrato de síntese (campos internos + regras de escopo) — igual entre execuções (cacheável). */
export function renderSynthesisContractRules(options?: { transcriptRef?: string }): { fields: string; rules: string } {
  const transcriptRule = options?.transcriptRef
    ? `A ref ${options.transcriptRef} é a transcrição em foco (input). Os campos de citação literal (evidenceFound, processAudit.steps[].evidence) NÃO mudam: continuam trechos copiados EXATAMENTE da transcrição, com os rótulos originais de quem fala (ex.: "Operador:", "Cliente:") — nunca reescreva como "Você:"; a 2ª pessoa vale só para o texto da recommendation e das afirmações.\n`
    : ""
  const fields = `Inclua no MESMO JSON, além dos campos acima, estes campos internos de auditoria (não aparecem para o colaborador):
  "supportedHypotheses": ["hipóteses sustentadas pelos fatos, cada uma citando as refs (ex.: 'TMA acima do subgrupo (F1, F3)')"],
  "unsupportedHypotheses": ["hipóteses testadas e não sustentadas ou não testáveis com os dados"],
  "limitations": ["limitações dos dados: amostra, cobertura, o que não foi investigado"],
  "behavioralClaims": [{ "text": "cada afirmação do texto sobre o que o colaborador FAZ na chamada (ex.: 'você demora no fechamento'); números do indicador, tendência ou jornada NÃO são afirmações comportamentais — vão em supportedHypotheses", "evidenceRefs": ["refs de fatos de interações/transcrições que a sustentam"], "scope": "INTERACTION_SPECIFIC (só nas interações analisadas) | PERIOD_PATTERN (padrão no período) | EMPLOYEE_PATTERN (padrão do colaborador) | POPULATION_PATTERN (padrão dos pares)", "candidateRef": "CC-n do CANDIDATO DE AFIRMAÇÃO que sustenta esta frase (quando a execução lista candidatos, este é o ÚNICO campo de vínculo: tipo, polaridade, escopo e suporte já vêm dele)", "support": { "type": "PATTERN | FINDING", "patternRef": "SP-n", "findingRef": "SF-n" }, "polarity": "POSITIVE | NEGATIVE | NEUTRAL | MIXED — compatível com o kind do pattern/finding", "temporalRelation": "NONE | EARLIER_VS_LATER | TREND | CHANGE | STABILITY | TEMPORAL_CONCENTRATION | POSITION — só quando a afirmação compara momentos ou posiciona no período", "evidenceBuckets": ["B-n dos blocos que sustentam a relação temporal (quando houver)"] }],
  "recommendationSupport": [{ "text": "cada ação recomendada no texto", "basis": "OBSERVED_EVIDENCE | KNOWLEDGE_GUIDANCE | GENERAL_DEVELOPMENT_SUGGESTION", "evidenceRefs": ["refs do ledger quando OBSERVED_EVIDENCE"] }],
  "consideredCriticalFacts": ["F1", "F4"]`
  const rules = `${transcriptRule}As refs (F-n, TRANSCRICAO, M-n) são INTERNAS: nunca as escreva no texto que o colaborador lê (title, summary, recommendation e demais campos do feedback).
Escopo das afirmações: poucas interações (amostra anedótica frente ao volume do período) sustentam só INTERACTION_SPECIFIC — escreva "na(s) interação(ões) analisada(s) você…", nunca "você costuma/sempre…"; PERIOD_PATTERN/EMPLOYEE_PATTERN exigem amostra representativa; POPULATION_PATTERN exige análise de pares. Afirmação comportamental sem fato de interação/transcrição NÃO pode aparecer como fato observado — use linguagem factual sobre o indicador e declare a limitação. Recomendação OBSERVED_EVIDENCE exige refs; KNOWLEDGE_GUIDANCE exige documento real da base; GENERAL_DEVELOPMENT_SUGGESTION deve ser escrita como sugestão ("pode ajudar", "vale experimentar"), nunca como comportamento observado. Se a amostra de interações for insuficiente, é correto concluir só com os números do indicador e dizer que a causa comportamental não pôde ser identificada. TEMPO: dados de vários blocos da janela são COBERTURA; "mudou/passou a/aumentou/reduziu/ficou estável ao longo do período", "no início/fim do período", "interações iniciais/mais recentes", "deixou de ocorrer" são RELAÇÃO temporal — só com temporalRelation + evidenceBuckets sustentados por um fato que COMPAROU os blocos com relação SUSTENTADA; ausência na AMOSTRA de um bloco não é ausência no período: "diferença só na amostra" vira fato de amostra ("observado em N das M analisadas de B1 e em nenhuma das K de B3", INTERACTION_SPECIFIC), nunca "deixou de ocorrer"; "nenhuma diferença sustentada" NÃO é "permaneceu estável"/"se manteve constante" — estabilidade exige relação STABLE sustentada (claim STABILITY); sem ela, use a formulação segura "não foi encontrada diferença temporal sustentada nas evidências analisadas"; a posição de cada interação no período é a calculada pela aplicação (B-n), nunca a ordem no texto ou o estilo da conversa. Os campos internos são OBRIGATÓRIOS (arrays, mesmo vazios): sem eles a resposta é descartada por código.
CANDIDATOS DE AFIRMAÇÃO (V1.4.4): quando a execução lista candidatos CC-n, cada afirmação seleciona UM candidato ("candidateRef") e escreve só o texto — a aplicação já decidiu o tipo, a polaridade, o escopo máximo e o suporte daquele candidato; não os redeclare nem os contradiga. Escolher quais candidatos são materiais (e deixar outros de fora) é decisão sua; inventar afirmação sem candidato, não. Sem candidatos listados, vale o contrato de suporte abaixo.
SUPORTE DO PADRÃO (fatos de analyze_interactions trazem, por pattern SP-n, o kind, o NÍVEL — quanto se repetiu: OBSERVED, REPEATED_IN_SAMPLE, RECURRENT_IN_SAMPLE, EMPLOYEE_PATTERN_SUPPORTED — e o ESCOPO/TETO DE CLAIM — até onde generalizar: SAMPLE → INTERACTION_SPECIFIC; PERIOD/RECORDED_UNIVERSE → PERIOD_PATTERN; EMPLOYEE_PATTERN → EMPLOYEE_PATTERN; e os findings por interação SF-n): a claim NUNCA excede o teto do pattern — teto INTERACTION_SPECIFIC escreve "observado em N das M interações analisadas"; teto PERIOD_PATTERN escreve "no período analisado…"/"nas interações analisadas, recorrente…"; só teto EMPLOYEE_PATTERN autoriza "você costuma", "é um padrão seu", "o colaborador apresenta…", "recorrentemente", "frequentemente". Quantidade de evidência ≠ amplitude da generalização: cobrir todas as interações registradas de um período prova o período, não um traço do colaborador. SUPORTE (binding): cada claim traz EXATAMENTE UM suporte, selecionado entre os handles listados na linha "Suportes de claim válidos": claim PERIOD/EMPLOYEE/POPULATION_PATTERN → "support": {"type":"PATTERN","patternRef":"SP-n"}; claim INTERACTION_SPECIFIC → "support": {"type":"FINDING","findingRef":"SF-n"} (ou um SP-n). Copie o handle exatamente (SP1, SF3); nunca escreva F-n, F-n/P-n, I-n/F-n, listas ou "N/A" — handle inexistente é rejeitado por código. Declare polarity compatível com o kind (STRENGTH → POSITIVE; RISK → NEGATIVE; INTERACTION_FRICTION → NEUTRAL, sem atribuir falha ao colaborador; MIXED → o que o texto diz). Fatos verdadeiros não sustentam padrão sem pattern. EMPLOYEE_PATTERN descreve o que foi observado NA JANELA ANALISADA ("no período analisado, o colaborador apresentou um padrão recorrente de…") — nunca um atributo permanente ou de personalidade ("o colaborador é…", "por natureza", "sempre foi"). Forças (STRENGTH) merecem o mesmo tratamento que riscos. CONCLUSÃO PROCEDIMENTAL ("diverge/contraria o procedimento", "orientação incorreta") exige support com pattern PROCEDURAL ou finding PROCEDURAL_QUESTION E ref de fato da base de conhecimento (query_knowledge com trecho); sem isso, escreva como questão procedimental a verificar — nunca erro confirmado. RELAÇÃO TEMPORAL com escopo de suporte SAMPLE vale só como fato da amostra ("nas interações analisadas, 2 de 3 em B1 e 3 de 3 em B3", INTERACTION_SPECIFIC) — "o colaborador passou a/aumentou/mudou" exige escopo de suporte EMPLOYEE_PATTERN.
consideredCriticalFacts = lista das refs (ex.: ["F1","F4","F5"]) dos FATOS CRÍTICOS À DECISÃO que a conclusão levou em conta — valor × meta, tendência, comparação com a referência, qualidade do dado. A conclusão não pode contradizê-los (ex.: fato IMPROVED nunca vira "piorou"); não é preciso repetir todos os números.`
  return { fields, rules }
}

/** Instruções adicionais do contrato de saída quando há investigação (campos internos — não vão ao colaborador). Texto da V1.2 (perfil CURRENT). */
export function renderSynthesisContract(refs: string[], options?: { transcriptRef?: string }): string {
  const refList = refs.length > 0 ? refs.join(", ") : "(nenhum fato disponível)"
  const transcriptRule = options?.transcriptRef
    ? `\nA ref ${options.transcriptRef} é a transcrição em foco (input). Os campos de citação literal (evidenceFound, processAudit.steps[].evidence) NÃO mudam: continuam trechos copiados EXATAMENTE da transcrição, com os rótulos originais de quem fala (ex.: "Operador:", "Cliente:") — nunca reescreva como "Você:"; a 2ª pessoa vale só para o texto da recommendation e das afirmações.`
    : ""
  return `Inclua no MESMO JSON, além dos campos acima, estes campos internos de auditoria (não aparecem para o colaborador):
  "supportedHypotheses": ["hipóteses sustentadas pelos fatos, cada uma citando as refs (ex.: 'TMA acima do subgrupo (F1, F3)')"],
  "unsupportedHypotheses": ["hipóteses testadas e não sustentadas ou não testáveis com os dados"],
  "limitations": ["limitações dos dados: amostra, cobertura, o que não foi investigado"],
  "behavioralClaims": [{ "text": "cada afirmação do texto sobre o que o colaborador FAZ na chamada (ex.: 'você demora no fechamento'); números do indicador, tendência ou jornada NÃO são afirmações comportamentais — vão em supportedHypotheses", "evidenceRefs": ["refs de fatos de interações/transcrições que a sustentam"], "scope": "INTERACTION_SPECIFIC (só nas interações analisadas) | PERIOD_PATTERN (padrão no período) | EMPLOYEE_PATTERN (padrão do colaborador) | POPULATION_PATTERN (padrão dos pares)", "temporalRelation": "NONE | EARLIER_VS_LATER | TREND | CHANGE | STABILITY | TEMPORAL_CONCENTRATION | POSITION — só quando a afirmação compara momentos ou posiciona no período", "evidenceBuckets": ["B-n dos blocos que sustentam a relação temporal (quando houver)"] }],
  "recommendationSupport": [{ "text": "cada ação recomendada no texto", "basis": "OBSERVED_EVIDENCE | KNOWLEDGE_GUIDANCE | GENERAL_DEVELOPMENT_SUGGESTION", "evidenceRefs": ["refs do ledger quando OBSERVED_EVIDENCE"] }]
Regras de evidência: refs válidas são somente ${refList}.${transcriptRule}
As refs (F-n, TRANSCRICAO, M-n) são INTERNAS: nunca as escreva no texto que o colaborador lê (title, summary, recommendation e demais campos do feedback).
Escopo das afirmações: poucas interações (amostra anedótica frente ao volume do período) sustentam só INTERACTION_SPECIFIC — escreva "na(s) interação(ões) analisada(s) você…", nunca "você costuma/sempre…"; PERIOD_PATTERN/EMPLOYEE_PATTERN exigem amostra representativa; POPULATION_PATTERN exige análise de pares. Afirmação comportamental sem fato de interação/transcrição NÃO pode aparecer como fato observado — use linguagem factual sobre o indicador e declare a limitação. Recomendação OBSERVED_EVIDENCE exige refs; KNOWLEDGE_GUIDANCE exige documento real da base; GENERAL_DEVELOPMENT_SUGGESTION deve ser escrita como sugestão ("pode ajudar", "vale experimentar"), nunca como comportamento observado. Se a amostra de interações for insuficiente, é correto concluir só com os números do indicador e dizer que a causa comportamental não pôde ser identificada. TEMPO: dados de vários blocos da janela são COBERTURA; "mudou/passou a/aumentou/reduziu/ficou estável ao longo do período", "no início/fim do período", "interações iniciais/mais recentes", "deixou de ocorrer" são RELAÇÃO temporal — só com temporalRelation + evidenceBuckets sustentados por um fato que COMPAROU os blocos com relação SUSTENTADA; ausência na AMOSTRA de um bloco não é ausência no período: "diferença só na amostra" vira fato de amostra ("observado em N das M analisadas de B1 e em nenhuma das K de B3", INTERACTION_SPECIFIC), nunca "deixou de ocorrer"; "nenhuma diferença sustentada" NÃO é "permaneceu estável"/"se manteve constante" — estabilidade exige relação STABLE sustentada (claim STABILITY); sem ela, use a formulação segura "não foi encontrada diferença temporal sustentada nas evidências analisadas"; a posição de cada interação no período é a calculada pela aplicação (B-n), nunca a ordem no texto ou o estilo da conversa.`
}
