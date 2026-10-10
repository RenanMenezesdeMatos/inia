import type { Quartile } from "../../indicators/domain/employee-performance-schema.js"
import { RELEVANT_DELTA_PP } from "./deterministic-insights.js"
import type { MemberSituation } from "./view-models.js"

/**
 * Situação de um colaborador na competência — categorias por FATO, com prioridade explícita:
 *  1. NO_DATA: nenhuma linha oficial (indicador ou PRV) na competência.
 *  2. BELOW_REFERENCE: algum indicador com atingimento oficial < 100%, ou PRV no Q4.
 *  3. IMPROVING: média de atingimento subiu ≥ RELEVANT_DELTA_PP p.p. vs competência anterior.
 *  4. WITHIN_REFERENCE: todos os indicadores com dado estão ≥ 100%.
 * Não existe classificação oficial de "dentro do esperado" no domínio — por isso a categoria se
 * chama "referência" (a meta vigente) e é exatamente reproduzível a partir dos números mostrados.
 */
export type MemberSituationFacts = {
  hasAnyData: boolean
  indicatorsBelowTarget: number
  prvQuartile: Quartile | null
  deltaPp: number | null
}

export function classifyMemberSituation(facts: MemberSituationFacts): MemberSituation {
  if (!facts.hasAnyData) return "NO_DATA"
  if (facts.indicatorsBelowTarget > 0 || facts.prvQuartile === "Q4") return "BELOW_REFERENCE"
  if (facts.deltaPp !== null && facts.deltaPp >= RELEVANT_DELTA_PP) return "IMPROVING"
  return "WITHIN_REFERENCE"
}
