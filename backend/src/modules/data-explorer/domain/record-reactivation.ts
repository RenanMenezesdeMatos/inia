/**
 * QUANDO REATIVAR É PERMITIDO. Reativar é desfazer: o registro volta como estava, então as regras de valor da carga não são repetidas aqui. Uma medição aceita antes, com
 * componentes numa estratégia que não os usa, precisa poder voltar se ninguém mudou nada. O que barra é o indicador ter mudado depois do cancelamento:
 *  - código, unidade, direção ou estratégia diferentes: o valor pode passar em qualquer regra e ter sido calculado na regra antiga (de Soma para Média, nada no registro denuncia), e o caminho é a carga;
 *  - indicador inativo, ou que não aceita mais este tipo de dado: a carga também recusaria.
 */
export type ReactivationIndicator = {
  id: string
  active: boolean
  code: string
  unit: string
  direction: string
  aggregation: string
  dailySupported: boolean
  officialClosureSupported: boolean
}

/** O que define o indicador no momento do cancelamento, guardado no lote: os mesmos campos que a trava semântica protege e que afetam o valor. */
export type IndicatorRuleSnapshot = Record<string, { code: string; unit: string; direction: string; aggregation: string }>

export const REACTIVATION_PROBLEMS = {
  INDICATOR_NOT_AVAILABLE: "o indicador não existe mais ou está inativo",
  INDICATOR_RULE_CHANGED: "o código, a unidade, a direção ou a estratégia do indicador mudou depois do cancelamento, então estes valores precisam vir numa carga nova",
  CAPABILITY_DISABLED: "o indicador não aceita mais este tipo de dado",
  ACTIVE_RECORD_IN_PERIOD: "já existe um registro ativo da mesma pessoa e indicador nesse período, e os dois contariam juntos nos cálculos",
} as const

export type ReactivationProblem = keyof typeof REACTIVATION_PROBLEMS

export type ReactivationRow = {
  /** Medição diária depende da medição operacional habilitada; fechamento, do fechamento oficial habilitado. */
  requires: "DAILY_MEASUREMENT" | "OFFICIAL_CLOSURE" | null
}

export function reactivationProblem(snapshot: IndicatorRuleSnapshot, indicator: ReactivationIndicator | undefined, row: ReactivationRow): ReactivationProblem | null {
  if (!indicator?.active) return "INDICATOR_NOT_AVAILABLE"
  const before = snapshot[indicator.id]
  if (before && (before.code !== indicator.code || before.unit !== indicator.unit || before.direction !== indicator.direction || before.aggregation !== indicator.aggregation)) return "INDICATOR_RULE_CHANGED"
  if (row.requires === "DAILY_MEASUREMENT" && !indicator.dailySupported) return "CAPABILITY_DISABLED"
  if (row.requires === "OFFICIAL_CLOSURE" && !indicator.officialClosureSupported) return "CAPABILITY_DISABLED"
  return null
}
