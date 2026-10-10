import { createHash } from "node:crypto"
import { isComparablePracticeKey, checkpointReadinessOf, type AnalyticsStatus } from "./observation-readiness.js"
import type { CheckpointStatus, GuidanceGrounding } from "../../agents/domain/process-assessment-contract.js"
import { normalizeForKnowledgeMatch, type KnowledgeVerification, type VerifiedCheckpoint, type VerifiedProcessAssessment } from "../../reliable-feedback/domain/process-assessment.js"
import { DIAGNOSIS_MIN_ANALYZED } from "./indicator-diagnosis.js"

/**
 * V1.6.1 — PADRÕES DE PROCESSO NA AMOSTRA (domínio puro, sem LLM). Cada chamada da amostra já foi avaliada e VERIFICADA
 * pela mesma regra da monitoria (V1.6.0: fala literal do operador por turno + regra literal da versão publicada, apresentada
 * na execução). Aqui só se CONTA:
 *
 *   identidade da prática  = documento + trecho literal VERIFICADO da base (`KB:<doc>:<hash>`) — a mesma chave que a evidência
 *                            de pares usa; sem regra verificada, o requisito normalizado (`REQ:<hash>`), que nunca é comparado
 *                            com pares (não é identidade da base).
 *   por chamada            = um status por prática (NOT_FOLLOWED > FOLLOWED > NOT_OBSERVABLE > NOT_APPLICABLE).
 *   DEVELOPMENT            = não seguida em ≥ 2 chamadas e em pelo menos tantas quanto as seguidas;
 *   STRENGTH               = seguida em ≥ 2 chamadas, na maioria da amostra e NUNCA não seguida (consistência);
 *   sempre com ≥ 3 chamadas analisadas. O resto é INCONCLUSIVE (fica na auditoria, não vira feedback).
 *
 * "Em 3 de 5 atendimentos analisados…" é o que isso sustenta — nunca "isso causou o seu resultado".
 */
export const PROCESS_PATTERN_VERSION = "PROCESS_PATTERN_V1" as const

export type AssessedInteraction = { handle: string; interactionId: string; label: string; assessment: VerifiedProcessAssessment; otherOperatorNames: string[] }

export type PatternClassification = "DEVELOPMENT" | "STRENGTH" | "INCONCLUSIVE"

export type ProcessPattern = {
  practiceKey: string
  /** true = identidade da BASE (comparável entre pessoas); false = requisito do modelo (nunca comparado com pares). */
  knowledgeIdentity: boolean
  processTitle: string
  requirement: string
  analyzed: number
  followed: string[]
  notFollowed: string[]
  notObservable: string[]
  notApplicable: string[]
  /** Melhor regra verificada entre as chamadas (VERIFIED antes de LITERAL_ONLY). */
  knowledge: KnowledgeVerification | null
  grounding: GuidanceGrounding
  guidanceText: string | null
  /** Etapas que sustentam o padrão, por chamada (auditoria + evidência exibível). */
  checkpoints: { handle: string; interactionId: string; checkpoint: VerifiedCheckpoint }[]
  classification: PatternClassification
}

const sha16 = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16)
const usableKnowledge = (knowledge: KnowledgeVerification | null): knowledge is KnowledgeVerification & { documentId: string; quote: string } => Boolean(knowledge && knowledge.applicability !== "NOT_VERIFIED" && knowledge.documentId && knowledge.quote)


/** Identidade da prática (a mesma para amostra do colaborador, observações persistidas e pares). */
export function practiceKeyOf(checkpoint: Pick<VerifiedCheckpoint, "knowledge" | "requirement"> & Partial<Pick<VerifiedCheckpoint, "canonical" | "source">>): string {
  // V1.7.1m — a prática é o COMPORTAMENTO canônico quando a etapa tem um: fontes diferentes do mesmo comportamento são UMA prática.
  if (checkpoint.canonical) return `BEHAVIOR:${checkpoint.canonical.behavior}`
  // Checkpoint Registry — cauda longa governada: a prática é a identidade LÓGICA do checkpoint (continua através das versões da base).
  if (checkpoint.source?.registry) return `CHECKPOINT:${checkpoint.source.registry.definitionId}`
  if (usableKnowledge(checkpoint.knowledge)) return `KB:${checkpoint.knowledge.documentId}:${sha16(normalizeForKnowledgeMatch(checkpoint.knowledge.quote))}`
  return `REQ:${sha16(normalizeForKnowledgeMatch(checkpoint.requirement))}`
}

const STATUS_PRIORITY: Record<CheckpointStatus, number> = { NOT_FOLLOWED: 0, FOLLOWED: 1, NOT_OBSERVABLE: 2, NOT_APPLICABLE: 3 }
const APPLICABILITY_RANK = { VERIFIED: 0, LITERAL_ONLY: 1, NOT_VERIFIED: 2 } as const
const GROUNDING_RANK: Record<GuidanceGrounding, number> = { OFFICIAL_PROCEDURE: 0, OFFICIAL_SERVICE_GUIDELINE: 1, VERIFIED_PEER_PATTERN: 2, NO_GROUNDED_GUIDANCE: 3 }

/** `minimumAnalyzed` (V1.6.2): mínimo da estratégia — nunca abaixo do piso do produto. */
export function classifyPattern(input: { analyzed: number; followed: number; notFollowed: number }, minimumAnalyzed: number = DIAGNOSIS_MIN_ANALYZED): PatternClassification {
  if (input.analyzed < Math.max(minimumAnalyzed, DIAGNOSIS_MIN_ANALYZED)) return "INCONCLUSIVE"
  if (input.notFollowed >= 2 && input.notFollowed >= input.followed) return "DEVELOPMENT"
  if (input.followed >= 2 && input.notFollowed === 0 && input.followed * 2 >= input.analyzed) return "STRENGTH"
  return "INCONCLUSIVE"
}

export function aggregateProcessPatterns(interactions: readonly AssessedInteraction[], options: { minimumAnalyzed?: number } = {}): ProcessPattern[] {
  const analyzed = interactions.length
  const byKey = new Map<string, { entries: { handle: string; interactionId: string; checkpoint: VerifiedCheckpoint }[]; order: number }>()
  interactions.forEach((interaction) => {
    // Um status por prática POR CHAMADA: a etapa mais "forte" em evidência vence (não seguida > seguida > não observável).
    const perInteraction = new Map<string, VerifiedCheckpoint>()
    for (const checkpoint of interaction.assessment.checkpoints) {
      // V1.7.1m — fonte que só reforça outra do mesmo comportamento não é outra evidência da chamada.
      if (checkpoint.canonical && checkpoint.canonical.role !== "PRIMARY") continue
      const key = practiceKeyOf(checkpoint)
      const current = perInteraction.get(key)
      if (!current || STATUS_PRIORITY[checkpoint.status] < STATUS_PRIORITY[current.status]) perInteraction.set(key, checkpoint)
    }
    for (const [key, checkpoint] of perInteraction) {
      const group = byKey.get(key) ?? { entries: [], order: byKey.size }
      group.entries.push({ handle: interaction.handle, interactionId: interaction.interactionId, checkpoint })
      byKey.set(key, group)
    }
  })
  return [...byKey.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([practiceKey, { entries }]) => {
      // V1.7.1i — etapa composta "cumprida" sem completude provada não conta como cumprida (fica como não observável).
      // V1.7.1j — nem etapa cuja "regra" é só EXEMPLO da base ou com evidência conflitante (REJECTED). A amostra DESTA execução
      // mantém a etapa sem regra verificada (V1.6.1: padrão sem orientação e sempre com QA); o histórico GRAVADO usa a elegibilidade
      // estrita (só VERIFIED — `isObservationEligibleForAnalytics`/`eligibleObservationSql`).
      const unusable = (checkpoint: VerifiedCheckpoint) => { const readiness = checkpointReadinessOf(checkpoint); return readiness.status === "REJECTED" || readiness.reasons.includes("EXAMPLE_ONLY_RULE") || readiness.reasons.includes("CANONICAL_BEHAVIOR_CONFLICT") }
      const effective = (checkpoint: VerifiedCheckpoint): CheckpointStatus => (followedWithoutCompleteness(checkpoint) || ((checkpoint.status === "FOLLOWED" || checkpoint.status === "NOT_FOLLOWED") && unusable(checkpoint)) ? "NOT_OBSERVABLE" : checkpoint.status)
      const handlesWith = (status: CheckpointStatus) => entries.filter((entry) => effective(entry.checkpoint) === status).map((entry) => entry.handle)
      const withKnowledge = entries.map((entry) => entry.checkpoint.knowledge).filter(usableKnowledge).sort((a, b) => APPLICABILITY_RANK[a.applicability] - APPLICABILITY_RANK[b.applicability])
      const grounded = entries.map((entry) => entry.checkpoint.guidance).filter((guidance) => guidance.grounding !== "NO_GROUNDED_GUIDANCE").sort((a, b) => GROUNDING_RANK[a.grounding] - GROUNDING_RANK[b.grounding])
      const followed = handlesWith("FOLLOWED")
      const notFollowed = handlesWith("NOT_FOLLOWED")
      const first = entries[0]!.checkpoint
      const knowledge = withKnowledge[0] ?? null
      return {
        practiceKey,
        knowledgeIdentity: isComparablePracticeKey(practiceKey),
        processTitle: first.processTitle,
        requirement: first.requirement,
        analyzed,
        followed,
        notFollowed,
        notObservable: handlesWith("NOT_OBSERVABLE"),
        notApplicable: handlesWith("NOT_APPLICABLE"),
        knowledge,
        // Orientação só sobrevive com regra utilizável (a verificação V1.6.0 já rebaixou o resto).
        grounding: knowledge ? grounded[0]?.grounding ?? "NO_GROUNDED_GUIDANCE" : "NO_GROUNDED_GUIDANCE",
        guidanceText: knowledge ? grounded[0]?.text ?? null : null,
        checkpoints: entries.filter((entry) => effective(entry.checkpoint) === "FOLLOWED" || effective(entry.checkpoint) === "NOT_FOLLOWED"),
        classification: classifyPattern({ analyzed, followed: followed.length, notFollowed: notFollowed.length }, options.minimumAnalyzed),
      }
    })
}

/** Frase exibível do padrão (contagens do sistema; escopo = a amostra analisada, nunca "sempre"/"costuma"). */
export function patternFactText(pattern: ProcessPattern, segmentLabel: string): string {
  const count = pattern.classification === "STRENGTH" ? pattern.followed.length : pattern.notFollowed.length
  const verb = pattern.classification === "STRENGTH" ? "foi identificada" : "não foi identificada"
  return `Etapa “${pattern.requirement}”: ${verb} em ${count} de ${pattern.analyzed} atendimentos analisados de ${segmentLabel}.`
}

/**
 * OBSERVAÇÃO PERSISTÍVEL: etapa FOLLOWED/NOT_FOLLOWED (fala do operador verificada) com regra LITERAL da base (documento
 * identificado). V1.7.1j — a observação registra o fato da avaliação e carrega a PRONTIDÃO ANALÍTICA (`analyticsStatus`): só
 * VERIFIED entra em agregação (`isObservationEligibleForAnalytics`); regra-exemplo, aplicabilidade só literal e omissão não
 * verificada ficam registradas como NEEDS_REVIEW. Etapa composta sem completude provada nunca é gravada como cumprida.
 */
export type ProcessObservation = { personId: string; interactionId: string; practiceKey: string; documentId: string; documentVersion: number | null; requirement: string; status: "FOLLOWED" | "NOT_FOLLOWED"
  /** V1.7.1i — etapa COMPOSTA: completude e subitens (texto literal da regra + situação). null = etapa simples. */
  completeness?: "COMPLETE" | "PARTIAL" | "UNKNOWN" | null
  /** `agency` (V1.7.1k): ação do operador × só estado descrito (itens de ação, como "serviço cancelado"). */
  subItems?: { text: string; status: string; conditional?: boolean; agency?: "OPERATOR_ACTION" | "STATE_ONLY"; /** SUBITEM_APPLICABILITY_V1 — por que o item (não) se aplicava. */ applicability?: { status: string; reason: string } }[] | null
  /** V1.7.1j — prontidão para agregação (`observation-readiness.ts`); só VERIFIED é elegível. */
  analyticsStatus?: AnalyticsStatus
  /** V1.7.1m — comportamento canônico (a chave da prática é BEHAVIOR:<código>) e TODAS as fontes oficiais que o sustentam. */
  canonicalBehavior?: string | null
  sourceLineages?: SourceLineage[] | null
  /** V1.7.1n — etapa de origem (checkpointRef do catálogo) da fonte que AVALIA o comportamento; null antes / contrato V2. */
  checkpointRef?: string | null
  /** Checkpoint Registry — identidade lógica e versão da regra que avaliou (null fora de documento governado / antes). */
  checkpointDefinitionId?: string | null
  checkpointVersionId?: string | null
  analyticsReasons?: string[] }

/** V1.7.1m — linhagem de uma fonte do comportamento (documento, versão, seção, hash do trecho, papel e conclusão dela). */
export type SourceLineage = { checkpointRef: string; role: string; status: string; documentId: string | null; documentVersion: number | null; heading: string | null; quoteSha256: string | null; /** V1.7.1n — código estável da etapa no catálogo (ausente antes). */ sourceCheckpointRef?: string | null; /** V1.7.1n */ origin?: "MODEL" | "SYSTEM_COMPLETION" }
function sourceLineagesOf(primary: VerifiedCheckpoint, all: readonly VerifiedCheckpoint[]): SourceLineage[] {
  return all.filter((checkpoint) => checkpoint === primary || checkpoint.canonical?.primaryRef === primary.ref).map((checkpoint) => ({ checkpointRef: checkpoint.ref, role: checkpoint.canonical?.role ?? "PRIMARY", status: checkpoint.status, documentId: checkpoint.knowledge?.documentId ?? null, documentVersion: checkpoint.knowledge?.version ?? null, heading: checkpoint.knowledge?.heading ?? null, quoteSha256: checkpoint.knowledge?.quote ? createHash("sha256").update(checkpoint.knowledge.quote).digest("hex") : null, ...(checkpoint.source ? { sourceCheckpointRef: checkpoint.source.ref, origin: checkpoint.origin ?? "MODEL" } : {}) }))
}

/** V1.7.1i — etapa composta dada como cumprida SEM prova de que todos os itens aconteceram: nunca conta como "cumpriu". */
export const followedWithoutCompleteness = (checkpoint: Pick<VerifiedCheckpoint, "status" | "completeness">) => checkpoint.status === "FOLLOWED" && Boolean(checkpoint.completeness) && checkpoint.completeness!.status !== "COMPLETE"

export function observationsFrom(personId: string, interactions: readonly { interactionId: string; assessment: VerifiedProcessAssessment }[]): ProcessObservation[] {
  const byKey = new Map<string, ProcessObservation>()
  for (const interaction of interactions) {
    for (const checkpoint of interaction.assessment.checkpoints) {
      if (checkpoint.status !== "FOLLOWED" && checkpoint.status !== "NOT_FOLLOWED") continue
      // V1.7.1m — uma contribuição por atendimento × comportamento: só a fonte que AVALIA; as outras vão como linhagem.
      if (checkpoint.canonical && checkpoint.canonical.role !== "PRIMARY") continue
      if (followedWithoutCompleteness(checkpoint)) continue
      const knowledge = checkpoint.knowledge
      if (!knowledge || knowledge.applicability === "NOT_VERIFIED" || !knowledge.documentId || !knowledge.quote) continue
      const readiness = checkpointReadinessOf(checkpoint)
      const practiceKey = practiceKeyOf(checkpoint)
      const key = `${interaction.interactionId}|${practiceKey}`
      const current = byKey.get(key)
      // Um status por atendimento × prática: não seguida vence (mesma regra do agrupamento da amostra).
      if (current && current.status === "NOT_FOLLOWED") continue
      byKey.set(key, { personId, interactionId: interaction.interactionId, practiceKey, documentId: knowledge.documentId, documentVersion: knowledge.version, requirement: checkpoint.requirement.slice(0, 400), status: checkpoint.status, ...(checkpoint.canonical ? { canonicalBehavior: checkpoint.canonical.behavior, sourceLineages: sourceLineagesOf(checkpoint, interaction.assessment.checkpoints) } : {}), completeness: checkpoint.completeness?.status ?? null, subItems: checkpoint.completeness ? checkpoint.completeness.items.map((item) => ({ text: item.text, status: item.status, ...(item.conditional ? { conditional: true } : {}), ...(item.agency ? { agency: item.agency } : {}), ...(item.applicability && item.applicability.status !== "APPLICABLE" ? { applicability: { status: item.applicability.status, reason: item.applicability.reason } } : {}) })) : null, analyticsStatus: readiness.status, analyticsReasons: readiness.reasons, ...(checkpoint.source ? { checkpointRef: checkpoint.source.ref } : {}), ...(checkpoint.source?.registry ? { checkpointDefinitionId: checkpoint.source.registry.definitionId, checkpointVersionId: checkpoint.source.registry.versionId } : {}) })
    }
  }
  return [...byKey.values()]
}
