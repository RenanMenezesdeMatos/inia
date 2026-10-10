import { z } from "zod"
import type { LedgerEntry } from "./evidence-ledger.js"
import { FINDING_KIND_LABELS, PATTERN_KIND_LABELS, PATTERN_SUPPORT_LABELS, RISK_FINDING_KINDS, maximumClaimScopeOf, type InteractionFindingKind, type PatternKind, type PatternSupportLevel } from "./interaction-semantic-frame.js"
import { SUPPORT_SCOPE_LABELS, type SupportScope } from "./support-scope.js"
import { temporalConclusionOfLedger, type TemporalConclusion, type TemporalRelation, type TemporalSupportScope } from "./temporal-semantics.js"
import type { ClaimPolarity, ClaimScope } from "./tool-trace.js"

/**
 * CLAIM CANDIDATES (V1.4.4 — Deterministic Claim Projection).
 *
 * Até a V1.4.3 o modelo reconstruía, a cada síntese, propriedades que a aplicação JÁ tinha decidido a partir da evidência:
 * a polaridade ("isso é força ou risco?"), o escopo máximo ("até onde posso generalizar?") e o vínculo com o pattern/finding.
 * Era a maior fonte de variância e de rejeição na camada PATTERN → CLAIM (as 3 claims descartadas nas 24 execuções da
 * variância V1.4.3 foram todas de polaridade).
 *
 * Agora cada pattern/finding ACEITO é projetado, por código, num CANDIDATO DE AFIRMAÇÃO (`CC-n`) que carrega:
 * suporte canônico (SP-n/SF-n), tipo semântico, POLARIDADE derivada do tipo, TETO DE ESCOPO já calculado, nível e escopo de
 * suporte, as relações temporais autorizadas nesta execução, a proveniência e um SIGNIFICADO SEGURO determinístico.
 *
 * O modelo passa a decidir apenas DUAS coisas: quais candidatos são MATERIAIS para a resposta e COMO explicá-los em
 * linguagem natural. Não redecide a semântica estrutural da evidência. O texto continua validado (contradizer a polaridade
 * do candidato vira `TEXT_POLARITY_MISMATCH` — erro de REDAÇÃO, não de estrutura).
 */
export type ClaimCandidateKind = PatternKind | InteractionFindingKind

export type ClaimCandidate = {
  /** Handle do candidato nesta execução ("CC1"…) — o único identificador que o modelo escreve. */
  ref: string
  /** Suporte canônico (V1.4.2) que originou o candidato. */
  support: { type: "PATTERN"; ref: string } | { type: "FINDING"; ref: string }
  kind: ClaimCandidateKind
  /** Derivada do kind pela aplicação — o modelo NÃO escolhe. */
  polarity: ClaimPolarity
  /** Teto de escopo já validado (V1.4.2/V1.4.3). Claims nunca vão além dele. */
  maximumClaimScope: ClaimScope
  supportLevel: PatternSupportLevel | null
  supportScope: SupportScope | null
  matchedTranscriptCount: number | null
  analyzedTranscriptCount: number | null
  /** Fato do ledger que contém o pattern/finding (lineage) e interação de origem quando é finding. */
  provenance: { factRef: string; interactionRef: string | null }
  /** Relações temporais que ESTA execução autoriza (da TemporalConclusion) + escopo de suporte temporal. */
  temporal: { conclusion: TemporalConclusion["kind"]; allowedRelations: TemporalRelation[]; supportScope: TemporalSupportScope | null; safeMeaning: string }
  /** Formulação SEGURA derivada por código: restrição semântica para correção/fallback/auditoria — nunca template obrigatório. */
  safeMeaning: string
}

/** Polaridade de um candidato, derivada do tipo semântico (§3): atrito da interação NUNCA vira risco do operador. */
export function candidatePolarityOf(kind: ClaimCandidateKind): ClaimPolarity {
  if (kind === "STRENGTH") return "POSITIVE"
  if (kind === "MIXED") return "MIXED"
  if (kind === "RISK" || RISK_FINDING_KINDS.includes(kind as InteractionFindingKind)) return "NEGATIVE"
  // INTERACTION_FRICTION, PROCEDURAL/PROCEDURAL_QUESTION, CONTEXT, NEUTRAL, OTHER: fato da interação, sem atribuição.
  return "NEUTRAL"
}

/** Polaridades que o TEXTO pode expressar para este candidato (o mesmo contrato de sempre, agora derivado do candidato). */
export function candidateAllowedPolarities(kind: ClaimCandidateKind): ClaimPolarity[] {
  const polarity = candidatePolarityOf(kind)
  if (polarity === "POSITIVE") return ["POSITIVE", "NEUTRAL"]
  if (polarity === "NEGATIVE") return ["NEGATIVE", "NEUTRAL"]
  if (polarity === "MIXED") return ["POSITIVE", "NEGATIVE", "MIXED", "NEUTRAL"]
  return kind === "INTERACTION_FRICTION" ? ["NEUTRAL", "NEGATIVE"] : ["NEUTRAL", "NEGATIVE"]
}

const SCOPE_MEANING: Record<ClaimScope, string> = {
  INTERACTION_SPECIFIC: "só nas interações analisadas",
  PERIOD_PATTERN: "no período analisado",
  EMPLOYEE_PATTERN: "como padrão do colaborador no período analisado",
  POPULATION_PATTERN: "em comparação com os pares",
}

const KIND_MEANING = (kind: ClaimCandidateKind): string => {
  switch (kind) {
    case "STRENGTH":
      return "comportamento positivo observado"
    case "RISK":
    case "FRICTION":
    case "CONTRADICTION":
      return "ponto de atenção observado"
    case "INTERACTION_FRICTION":
      return "atrito da interação, SEM atribuição ao colaborador"
    // V1.4.6: resultado aberto sem ponte com a conduta — descreve o que ficou pendente, nunca "o colaborador falhou".
    case "UNRESOLVED_OUTCOME":
    case "OUTCOME":
      return "necessidade que ficou em aberto — RESULTADO da interação, sem atribuição ao colaborador"
    case "UNRESOLVED_NEED":
      return "necessidade em aberto ligada à conduta do operador (ponte verificada)"
    case "PROCEDURAL":
    case "PROCEDURAL_QUESTION":
      return "questão procedimental a verificar contra a base (nunca erro confirmado sem a base)"
    // V1.4.5: a comparação já foi feita pela aplicação contra um trecho LITERAL da base — aqui a divergência é verificada,
    // mas continua limitada ao que foi verificado (§19: nunca "não seguiu o procedimento" como um todo).
    case "PROCEDURAL_DIVERGENCE":
      return "divergência procedimental VERIFICADA contra um trecho literal da base (limitada ao ponto verificado, nunca ao procedimento inteiro)"
    case "MIXED":
      return "comportamento com aspectos positivos e pontos de atenção"
    default:
      return "fato da interação, sem juízo"
  }
}

/** SIGNIFICADO SEGURO (§13): o que este candidato autoriza dizer — restrição semântica, não frase pronta (§14). */
export function candidateSafeMeaning(input: { kind: ClaimCandidateKind; maximumClaimScope: ClaimScope; matched: number | null; analyzed: number | null; supportLevel: PatternSupportLevel | null; interactionRef: string | null; temporal: string }): string {
  const counts = input.matched !== null && input.analyzed !== null ? ` (observado em ${input.matched} de ${input.analyzed} interações analisadas${input.supportLevel ? `; ${PATTERN_SUPPORT_LABELS[input.supportLevel]}` : ""})` : input.interactionRef ? ` (interação ${input.interactionRef})` : ""
  return `${KIND_MEANING(input.kind)}${counts}, afirmável ${SCOPE_MEANING[input.maximumClaimScope]}. ${input.temporal}`
}

/** Projeta os candidatos desta execução a partir dos patterns/findings aceitos no ledger (ordem estável: fato → pattern → finding). */
export function buildClaimCandidates(ledger: LedgerEntry[]): ClaimCandidate[] {
  const conclusion = temporalConclusionOfLedger(ledger)
  const temporalSafe = temporalMeaningOf(conclusion)
  const candidates: ClaimCandidate[] = []
  let sequence = 0
  const next = () => { sequence += 1; return `CC${sequence}` }
  for (const entry of ledger) {
    const signals = entry.signals?.interactionAnalysis
    if (!signals || !Array.isArray(signals.patterns)) continue
    for (const pattern of signals.patterns) {
      const handle = pattern.handle ?? (pattern.ref ? `${entry.ref}/${pattern.ref}` : null)
      if (!handle) continue
      const maximumClaimScope = maximumClaimScopeOf(pattern)
      candidates.push({
        ref: next(),
        support: { type: "PATTERN", ref: handle },
        kind: pattern.kind,
        polarity: candidatePolarityOf(pattern.kind),
        maximumClaimScope,
        supportLevel: pattern.supportLevel,
        supportScope: pattern.supportScope ?? null,
        matchedTranscriptCount: pattern.matchedTranscriptCount,
        analyzedTranscriptCount: pattern.analyzedTranscriptCount,
        provenance: { factRef: entry.ref, interactionRef: null },
        temporal: { conclusion: conclusion.kind, allowedRelations: ["NONE", ...conclusion.allowedRelations], supportScope: conclusion.supportScope, safeMeaning: temporalSafe },
        safeMeaning: candidateSafeMeaning({ kind: pattern.kind, maximumClaimScope, matched: pattern.matchedTranscriptCount, analyzed: pattern.analyzedTranscriptCount, supportLevel: pattern.supportLevel, interactionRef: null, temporal: temporalSafe }),
      })
    }
    for (const finding of signals.findingRefs ?? []) {
      const handle = finding.handle ?? finding.ref
      candidates.push({
        ref: next(),
        support: { type: "FINDING", ref: handle },
        kind: finding.kind,
        polarity: candidatePolarityOf(finding.kind),
        // Um finding fala de UMA interação: nunca ultrapassa o escopo de interação.
        maximumClaimScope: "INTERACTION_SPECIFIC",
        supportLevel: null,
        supportScope: null,
        matchedTranscriptCount: null,
        analyzedTranscriptCount: null,
        provenance: { factRef: entry.ref, interactionRef: finding.ref.includes("/") ? finding.ref.split("/")[0]! : null },
        temporal: { conclusion: conclusion.kind, allowedRelations: ["NONE", ...conclusion.allowedRelations], supportScope: conclusion.supportScope, safeMeaning: temporalSafe },
        safeMeaning: candidateSafeMeaning({ kind: finding.kind, maximumClaimScope: "INTERACTION_SPECIFIC", matched: null, analyzed: null, supportLevel: null, interactionRef: finding.ref.includes("/") ? finding.ref.split("/")[0]! : null, temporal: temporalSafe }),
      })
    }
  }
  return candidates
}

/** O que a conclusão temporal desta execução autoriza dizer (§19–§21) — sempre explícito no candidato. */
export function temporalMeaningOf(conclusion: TemporalConclusion): string {
  switch (conclusion.kind) {
    case "SUPPORTED_RELATION":
      return `Relação temporal sustentada: ${conclusion.supportedRelations.map((item) => `${item.relation} ${item.earlierBucket}→${item.laterBucket}`).join(", ")} (escopo de suporte ${conclusion.supportScope}) — só essas relações podem ser afirmadas.`
    case "NO_DIFFERENCE_SUPPORTED":
      return 'Temporal: "não foi encontrada diferença temporal sustentada nas evidências analisadas" — NUNCA "permaneceu estável".'
    case "SAMPLE_DIFFERENCE_ONLY":
      return "Temporal: houve diferença entre as AMOSTRAS analisadas, sem evidência para generalizar ao período — descreva as amostras (N de M em cada bloco), nunca mudança do colaborador."
    case "INSUFFICIENT_EVIDENCE":
      return "Temporal: os dados não permitem concluir relação temporal — não afirme mudança, tendência, estabilidade, concentração nem posição no período."
    default:
      return "Temporal: os momentos da janela não foram comparados — nenhuma afirmação sobre mudança/estabilidade no período."
  }
}

/** Schema DINÂMICO (§10): `candidateRef` restrito aos candidatos existentes nesta execução; o texto é livre, o resto não existe. */
export function claimCandidateSchemaFor(candidates: ClaimCandidate[]) {
  const refs = candidates.map((item) => item.ref)
  return z.object({
    candidateRef: refs.length > 0 ? z.enum(refs as [string, ...string[]]) : z.never(),
    text: z.string().trim().min(1),
  })
}

/** Bloco model-facing com os candidatos (§8): o modelo SELECIONA; não reconstrói a semântica. */
export function renderClaimCandidates(candidates: ClaimCandidate[]): string {
  if (candidates.length === 0) return "CANDIDATOS DE AFIRMAÇÃO: nenhum (não há pattern/finding semântico nesta execução) — não afirme comportamento; descreva só os fatos apurados."
  const lines = candidates.map((item) => `${item.ref} · suporte ${item.support.ref} · ${PATTERN_KIND_LABELS[item.kind as PatternKind] ?? FINDING_KIND_LABELS[item.kind as InteractionFindingKind] ?? item.kind} (${item.kind}) · polaridade ${item.polarity} · escopo máximo ${item.maximumClaimScope}${item.supportScope ? ` (suporte ${item.supportLevel}/${item.supportScope}: ${SUPPORT_SCOPE_LABELS[item.supportScope]})` : ""} → ${item.safeMeaning}`)
  return [
    "CANDIDATOS DE AFIRMAÇÃO desta execução (a aplicação já derivou tipo, polaridade e escopo máximo da evidência — não redecida nenhum deles):",
    ...lines,
    'Para cada afirmação da resposta escreva { "candidateRef": "CC-n", "text": "a frase como o colaborador vai ler" }. Escolha SÓ os candidatos materiais para a resposta (deixar candidatos de fora é decisão legítima; inventar afirmação sem candidato, não). O texto não pode contradizer a polaridade nem ultrapassar o escopo máximo do candidato, e segue a regra temporal declarada nele.',
  ].join("\n")
}
