import type { ClaimScope } from "./tool-trace.js"

/**
 * ESCOPO DE SUPORTE (V1.4.2 — §8–§13): "até onde a evidência permite generalizar?" — dimensão DISTINTA do nível de
 * suporte ("quanto se repetiu?"). Uma taxonomia só, compartilhada pelo pattern semântico e pela relação temporal
 * (V1.4.1 `TemporalSupportScope` = SAMPLE | RECORDED_UNIVERSE | EMPLOYEE_PATTERN — subconjunto desta ordem):
 * - SAMPLE: vale só para as interações analisadas ("observado em N das M analisadas");
 * - PERIOD: amostra REPRESENTATIVA do universo registrado da janela — sustenta "no período analisado" por inferência;
 * - RECORDED_UNIVERSE: a amostra É o universo registrado da janela (cobertura total) — fato sobre o período, não inferência;
 * - EMPLOYEE_PATTERN: evidência que justifica generalizar ALÉM da janela ("o colaborador apresenta…").
 * Cobertura total de poucas interações prova o universo registrado do período, não a pessoa (§11).
 */
export const SUPPORT_SCOPES = ["SAMPLE", "PERIOD", "RECORDED_UNIVERSE", "EMPLOYEE_PATTERN"] as const
export type SupportScope = (typeof SUPPORT_SCOPES)[number]

export function supportScopeRank(scope: SupportScope): number {
  return SUPPORT_SCOPES.indexOf(scope)
}

/** Maior escopo de CLAIM que cada escopo de suporte autoriza (§10) — POPULATION nunca vem de um pattern do próprio colaborador. */
export const MAXIMUM_CLAIM_SCOPE_BY_SUPPORT: Record<SupportScope, ClaimScope> = {
  SAMPLE: "INTERACTION_SPECIFIC",
  PERIOD: "PERIOD_PATTERN",
  RECORDED_UNIVERSE: "PERIOD_PATTERN",
  EMPLOYEE_PATTERN: "EMPLOYEE_PATTERN",
}

/** Ordem de amplitude dos escopos de claim (POPULATION é outra dimensão — pares — e é validada à parte). */
export const CLAIM_SCOPE_RANK: Record<ClaimScope, number> = { INTERACTION_SPECIFIC: 0, PERIOD_PATTERN: 1, EMPLOYEE_PATTERN: 2, POPULATION_PATTERN: 1 }

export function claimScopeWithin(claimScope: ClaimScope, maximum: ClaimScope): boolean {
  return CLAIM_SCOPE_RANK[claimScope] <= CLAIM_SCOPE_RANK[maximum]
}

export const SUPPORT_SCOPE_LABELS: Record<SupportScope, string> = {
  SAMPLE: "só nas interações analisadas",
  PERIOD: "no período analisado (amostra representativa)",
  RECORDED_UNIVERSE: "no período analisado (todas as interações registradas)",
  EMPLOYEE_PATTERN: "padrão do colaborador (além da janela)",
}
