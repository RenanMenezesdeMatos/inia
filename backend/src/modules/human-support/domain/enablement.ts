/**
 * LIGA/DESLIGA do Apoio com Anjo (design_draft.md seção 5). Tudo nasce desligado: sem chave geral (ou com ela desligada) nada vale.
 *
 *   ligado(pessoa) = chave geral LIGADA
 *                    E valor do Subgrupo da pessoa, se ≠ HERDAR; senão valor do Grupo, se ≠ HERDAR; senão DESLIGADO
 *   pessoa sem Subgrupo: usa o Grupo; sem Grupo: DESLIGADO
 */
export const SCOPE_STATES = ["INHERIT", "ON", "OFF"] as const
export type ScopeState = (typeof SCOPE_STATES)[number]
export const SCOPE_STATE_LABELS: Record<ScopeState, string> = { INHERIT: "Herdar", ON: "Ligado", OFF: "Desligado" }

export type EnablementInput = {
  master: boolean
  /** Estado gravado do Grupo da pessoa (null = sem linha = HERDAR). */
  groupState: ScopeState | null
  /** Estado gravado do Subgrupo da pessoa (null = sem linha = HERDAR). */
  subgroupState: ScopeState | null
  hasGroup: boolean
  hasSubgroup: boolean
}

export function supportEnabledFor(input: EnablementInput): boolean {
  if (!input.master || !input.hasGroup) return false
  const subgroup = input.hasSubgroup ? (input.subgroupState ?? "INHERIT") : "INHERIT"
  if (subgroup !== "INHERIT") return subgroup === "ON"
  const group = input.groupState ?? "INHERIT"
  return group === "ON"
}

/** De onde vem o estado efetivo de um nó da árvore de escopos (tela do Administrador geral). */
export type EffectiveSource = "OWN" | "GROUP" | "DEFAULT_OFF" | "MASTER_OFF"
export type EffectiveScope = { effective: boolean; source: EffectiveSource }

export function effectiveGroup(input: { master: boolean; own: ScopeState | null }): EffectiveScope {
  if (!input.master) return { effective: false, source: "MASTER_OFF" }
  const own = input.own ?? "INHERIT"
  if (own !== "INHERIT") return { effective: own === "ON", source: "OWN" }
  return { effective: false, source: "DEFAULT_OFF" }
}

export function effectiveSubgroup(input: { master: boolean; own: ScopeState | null; group: ScopeState | null }): EffectiveScope {
  if (!input.master) return { effective: false, source: "MASTER_OFF" }
  const own = input.own ?? "INHERIT"
  if (own !== "INHERIT") return { effective: own === "ON", source: "OWN" }
  const group = input.group ?? "INHERIT"
  if (group !== "INHERIT") return { effective: group === "ON", source: "GROUP" }
  return { effective: false, source: "DEFAULT_OFF" }
}
