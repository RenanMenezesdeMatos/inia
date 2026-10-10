/**
 * INDICATOR DIAGNOSIS V1 — REUSO DE ProcessObservations (domínio puro). A observação de processo é MEMÓRIA OPERACIONAL: antes de
 * pedir a um modelo para avaliar uma chamada de novo, o sistema confere se aquela chamada JÁ foi avaliada de forma compatível.
 *
 * Compatibilidade (`OBSERVATION_COMPATIBILITY_V1`) é sobre VERSÃO, não sobre prontidão:
 *   - contrato da avaliação: etapa endereçada pelo sistema (`checkpoint_ref`, contrato V3 — V1.7.1n em diante). Toda observação
 *     anterior (inclusive as gravadas por FONTE antes do comportamento canônico) não tem `checkpoint_ref`; a chave `KB:` continua
 *     legítima depois dela para comportamento fora do vocabulário canônico (cauda longa sem registry);
 *   - base: a versão do documento que avaliou é a versão PUBLICADA atual (regra republicada = avaliação desatualizada).
 * Uma observação compatível e RESOLVIDA (VERIFIED/REJECTED) é reaproveitada como "já avaliada" — REJECTED só não entra na
 * contagem (`isObservationEligibleForAnalytics`).
 *   - V1.0.2 — PENDÊNCIA (NEEDS_REVIEW) só é reaproveitada quando foi gravada pela MESMA lógica de avaliação do diagnóstico
 *     (`displayContext.assessmentLogic`): sob a lógica atual, reavaliar não muda a prova; sob uma lógica anterior, muda (ex.: a
 *     troca de papéis da evidência que a V1.0.2 passou a mandar ao reparo) — então a chamada é reavaliada, nunca reaproveitada
 *     com a pendência antiga. Observação resolvida não depende da lógica.
 *
 * Por atendimento: REUSABLE (tem observação e TODAS são compatíveis) · INCOMPATIBLE (tem observação e alguma não é — reavaliar)
 * · NONE (nunca avaliado). Só FOLLOWED/NOT_FOLLOWED são persistidos: NOT_OBSERVABLE/NOT_APPLICABLE de um atendimento reaproveitado
 * não são conhecidos (limitação registrada, nunca inventada).
 */
export const OBSERVATION_COMPATIBILITY_VERSION = "OBSERVATION_COMPATIBILITY_V1" as const

export type StoredObservation = {
  interactionId: string
  practiceKey: string
  canonicalBehavior: string | null
  requirement: string
  documentId: string
  documentTitle: string | null
  documentVersion: number | null
  status: "FOLLOWED" | "NOT_FOLLOWED"
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN" | null
  analyticsStatus: "VERIFIED" | "NEEDS_REVIEW" | "REJECTED"
  checkpointRef: string | null
  /** Falas do operador já projetadas para exibição (display-safe), regra oficial e orientação — null nas observações anteriores
   * ao Indicator Diagnosis V1 (a observação continua reaproveitável; só sem exemplo exibível). */
  displayContext: ObservationDisplayContext | null
}

export type ObservationDisplayContext = { quotes: { text: string; truncated: boolean }[]; rule: { documentTitle: string; heading: string | null; quote: string } | null; guidance: string | null; /** V1.0.2 — lógica de avaliação do diagnóstico que gravou a observação (ausente = anterior). */ assessmentLogic?: string | null }

export type CompatibilityReason = "CONTRACT_BEFORE_CHECKPOINT_CATALOG" | "KNOWLEDGE_VERSION_CHANGED" | "DOCUMENT_NOT_PUBLISHED" | /** V1.0.2 */ "REVIEW_PENDING_UNDER_OLDER_LOGIC"

export function observationCompatibility(observation: Pick<StoredObservation, "checkpointRef" | "documentId" | "documentVersion"> & Partial<Pick<StoredObservation, "analyticsStatus" | "displayContext">>, publishedVersions: ReadonlyMap<string, number>, assessmentLogic: string | null = null): { compatible: boolean; reason: CompatibilityReason | null } {
  if (!observation.checkpointRef) return { compatible: false, reason: "CONTRACT_BEFORE_CHECKPOINT_CATALOG" }
  const published = publishedVersions.get(observation.documentId)
  if (published === undefined) return { compatible: false, reason: "DOCUMENT_NOT_PUBLISHED" }
  if (observation.documentVersion !== published) return { compatible: false, reason: "KNOWLEDGE_VERSION_CHANGED" }
  if (assessmentLogic && observation.analyticsStatus === "NEEDS_REVIEW" && (observation.displayContext?.assessmentLogic ?? null) !== assessmentLogic) return { compatible: false, reason: "REVIEW_PENDING_UNDER_OLDER_LOGIC" }
  return { compatible: true, reason: null }
}

export type InteractionReuse = { interactionId: string; status: "REUSABLE" | "INCOMPATIBLE" | "NONE"; reasons: CompatibilityReason[]; observations: StoredObservation[] }

export function interactionReuseOf(interactionId: string, observations: readonly StoredObservation[], publishedVersions: ReadonlyMap<string, number>, assessmentLogic: string | null = null): InteractionReuse {
  const own = observations.filter((observation) => observation.interactionId === interactionId)
  if (own.length === 0) return { interactionId, status: "NONE", reasons: [], observations: [] }
  const reasons = [...new Set(own.map((observation) => observationCompatibility(observation, publishedVersions, assessmentLogic).reason).filter((reason): reason is CompatibilityReason => reason !== null))]
  return { interactionId, status: reasons.length === 0 ? "REUSABLE" : "INCOMPATIBLE", reasons, observations: own }
}
