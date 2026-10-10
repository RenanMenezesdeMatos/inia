import type { VerifiedCheckpoint } from "../../reliable-feedback/domain/process-assessment.js"

/**
 * V1.7.1j — PRONTIDÃO ANALÍTICA DA OBSERVAÇÃO (`OBSERVATION_READINESS_V1`, domínio puro).
 *
 * "Observação gravada" ≠ "observação confiável para agregação". A observação continua registrando o que a avaliação concluiu
 * sobre a etapa (fato histórico), mas só entra em diagnóstico de indicador, histórico e no futuro Chat quando a PROVA é completa:
 *
 *   VERIFIED      fala do operador verificada + regra da base (não exemplo) + aplicabilidade verificada (âncora, omissão verificada
 *                 ou estrutura). Uma etapa composta PARCIAL continua VERIFIED — "parcial" é um fato provado (e nunca "cumpriu").
 *   NEEDS_REVIEW  a base citada é só EXEMPLO; aplicabilidade só literal; omissão não verificada; linhas anteriores à V1.7.1j.
 *   REJECTED      a mesma etapa canônica foi escolhida como cumprida e não cumprida (evidência conflitante); V1.7.1l: ou o trecho
 *                 citado não é uma ETAPA executável (seção de objetivo, abrangência, conceitos, resultado esperado, referência,
 *                 exemplos — `checkpoint-eligibility.ts`), mesmo com citação literal, âncora e regra válidas.
 *
 * Independe do QA do TEXTO: o redator cair no texto de segurança não muda a prova da etapa.
 */
export const OBSERVATION_READINESS_VERSION = "OBSERVATION_READINESS_V1" as const

export type AnalyticsStatus = "VERIFIED" | "NEEDS_REVIEW" | "REJECTED"
export type ReadinessReason = "EXAMPLE_ONLY_RULE" | "APPLICABILITY_UNVERIFIED" | "UNVERIFIED_OMISSION" | "CHECKPOINT_CONFLICT" | "LEGACY_BEFORE_ANALYTIC_READINESS" | /** V1.7.1l */ "NOT_A_PROCESS_CHECKPOINT" | /** V1.7.1l — gravada VERIFIED antes da elegibilidade de etapa existir (migration 089). */ "LEGACY_BEFORE_CHECKPOINT_ELIGIBILITY" | /** V1.7.1m — fontes do mesmo comportamento canônico em conflito. */ "CANONICAL_BEHAVIOR_CONFLICT" | /** V1.7.1m — gravada VERIFIED por FONTE, antes do comportamento canônico (migration 091). */ "LEGACY_BEFORE_CANONICAL_BEHAVIOR" | /** V1.7.1n — a fala citada contradiz a conclusão (mencionar ≠ cumprir). */ "EVIDENCE_POLARITY_CONFLICT" | /** V1.7.1n — a citação da base é de outra etapa do que o código escolhido. */ "CHECKPOINT_SOURCE_AMBIGUOUS" | /** Checkpoint Registry — o administrador desligou o analytics deste checkpoint (o fato fica gravado, fora da agregação). */ "CHECKPOINT_ANALYTICS_DISABLED" | /** MONITORING V2 — pré-requisito declarado inconclusivo: a etapa não é conformidade verificada. */ "PREREQUISITE_UNVERIFIED"
export type ObservationReadiness = { status: AnalyticsStatus; reasons: ReadinessReason[] }

export function checkpointReadinessOf(checkpoint: Pick<VerifiedCheckpoint, "knowledge" | "evidenceType"> & Partial<Pick<VerifiedCheckpoint, "checkpointEligibility" | "statusDowngradeReason" | "canonical" | "evidencePolarity" | "source" | "dependency">>): ObservationReadiness {
  const knowledge = checkpoint.knowledge
  // V1.7.1l — origem que não representa etapa operacional nunca é verdade analítica, por mais literal/ancorada que seja.
  if (checkpoint.checkpointEligibility?.eligible === false || checkpoint.statusDowngradeReason === "NOT_A_PROCESS_CHECKPOINT") return { status: "REJECTED", reasons: ["NOT_A_PROCESS_CHECKPOINT"] }
  if (knowledge?.structuredAnchor?.failure === "CHECKPOINT_CONFLICT") return { status: "REJECTED", reasons: ["CHECKPOINT_CONFLICT"] }
  if (checkpoint.source?.registry?.analyticsEnabled === false) return { status: "REJECTED", reasons: ["CHECKPOINT_ANALYTICS_DISABLED"] }
  const reasons: ReadinessReason[] = []
  if (knowledge?.contentKind === "EXAMPLE_CONTENT") reasons.push("EXAMPLE_ONLY_RULE")
  if (!knowledge || knowledge.applicability !== "VERIFIED") reasons.push("APPLICABILITY_UNVERIFIED")
  if (checkpoint.evidenceType === "UNVERIFIED_OMISSION") reasons.push("UNVERIFIED_OMISSION")
  // V1.7.1m — o mesmo comportamento com conclusões opostas entre fontes: nunca verdade analítica sem revisão.
  if (checkpoint.canonical?.conflict) reasons.push("CANONICAL_BEHAVIOR_CONFLICT")
  // V1.7.1n — "não sei informar o prazo" nunca vira "informou o prazo" na memória analítica (nem no futuro Chat).
  if (checkpoint.evidencePolarity?.conflict) reasons.push("EVIDENCE_POLARITY_CONFLICT")
  if (checkpoint.source && ["OTHER_CHECKPOINT", "UNRELATED"].includes(checkpoint.source.quoteMatch)) reasons.push("CHECKPOINT_SOURCE_AMBIGUOUS")
  if (checkpoint.dependency?.state === "UNVERIFIED") reasons.push("PREREQUISITE_UNVERIFIED")
  return { status: reasons.length === 0 ? "VERIFIED" : "NEEDS_REVIEW", reasons }
}

/** Forma mínima de uma observação para decidir elegibilidade (linha do banco ou objeto em memória). */
export type ObservationLike = { status: string; completeness?: string | null; analyticsStatus?: AnalyticsStatus | string | null }

/**
 * REGRA ÚNICA de elegibilidade para agregação (diagnóstico de indicador, histórico, relatórios, futuro Chat): só VERIFIED, e
 * nunca uma etapa composta sem completude provada lida como cumprida. O SQL equivalente é `ELIGIBLE_OBSERVATION_SQL`.
 */
export function isObservationEligibleForAnalytics(observation: ObservationLike): boolean {
  if (observation.analyticsStatus !== "VERIFIED") return false
  return !(observation.status === "FOLLOWED" && observation.completeness && observation.completeness !== "COMPLETE")
}
/** O mesmo critério em SQL, para leituras em lote (`alias` = alias de `process_checkpoint_observations`). */
export const eligibleObservationSql = (alias: string) => `(${alias}.analytics_status = 'VERIFIED' and not (${alias}.status = 'FOLLOWED' and coalesce(${alias}.completeness, 'COMPLETE') <> 'COMPLETE'))`

/**
 * V1.7.1k — VERDADE ANALÍTICA dos subitens de uma etapa composta (o que um consumidor futuro — diagnóstico, Chat — pode afirmar):
 *   informed     dito pelo operador (na etapa ou em outro momento da chamada), inclusive item condicional com evidência;
 *   notInformed  SÓ o que ficou comprovadamente ausente (detector confiável, transcrição completa) — única base para "não informou";
 *   notEvaluated condicional sem evidência, desconhecido, não verificável — nunca vira "não informou";
 *   notApplicable SUBITEM_APPLICABILITY_V1 — dependia de um resultado que a conversa mostra pendente (não se aplicava ali).
 */
export type CompositeFacts = { informed: string[]; notInformed: string[]; notEvaluated: string[]; notApplicable: string[] }
export function compositeFactsOf(subItems: readonly { text: string; status: string }[] | null | undefined): CompositeFacts {
  const facts: CompositeFacts = { informed: [], notInformed: [], notEvaluated: [], notApplicable: [] }
  for (const item of subItems ?? []) {
    if (item.status === "OBSERVED" || item.status === "OBSERVED_ELSEWHERE") facts.informed.push(item.text)
    else if (item.status === "VERIFIED_ABSENT") facts.notInformed.push(item.text)
    else if (item.status === "NOT_APPLICABLE") facts.notApplicable.push(item.text)
    else facts.notEvaluated.push(item.text)
  }
  return facts
}

export type PracticeSummary = { practiceKey: string; followed: number; notFollowed: number; partial: number; excluded: number }
/**
 * Agregação padrão por prática: só observações ELEGÍVEIS contam; PARTIAL conta como não cumprida (e à parte como parcial), nunca
 * como cumprida. `excluded` = observações registradas que ficaram fora (precisam de revisão, rejeitadas).
 */
export function summarizeObservations(observations: readonly (ObservationLike & { practiceKey: string })[]): PracticeSummary[] {
  const byKey = new Map<string, PracticeSummary>()
  for (const observation of observations) {
    const summary = byKey.get(observation.practiceKey) ?? { practiceKey: observation.practiceKey, followed: 0, notFollowed: 0, partial: 0, excluded: 0 }
    if (!isObservationEligibleForAnalytics(observation)) summary.excluded += 1
    else if (observation.status === "FOLLOWED") summary.followed += 1
    else { summary.notFollowed += 1; if (observation.completeness === "PARTIAL") summary.partial += 1 }
    byKey.set(observation.practiceKey, summary)
  }
  return [...byKey.values()]
}

/** V1.7.1m — prática comparável entre pessoas: identidade da BASE (KB:) ou comportamento canônico (BEHAVIOR:), nunca texto do modelo. */
/** Checkpoint Registry — `CHECKPOINT:<definição>`: cauda longa sem comportamento canônico, comparável pela identidade LÓGICA
 * (a mesma regra em outra versão da base continua a mesma série; nenhum enum novo por regra). */
export const isComparablePracticeKey = (key: string) => key.startsWith("KB:") || key.startsWith("BEHAVIOR:") || key.startsWith("CHECKPOINT:")
