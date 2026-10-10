import type { DemoReferencePeriod } from "./demo-constants.js"

/**
 * Catálogo de Grupos/Subgrupos e dos indicadores de cada Grupo. Os CÓDIGOS são os já existentes
 * em `indicator_definitions` (migrations 026/043) — a massa reutiliza o catálogo real, nunca cria
 * "QUALIDADE_V2". Direção (`desired_direction`) NÃO fica aqui: é lida do banco na hora de gerar
 * (a fonte é a tabela, nunca o nome). Metas são por Grupo (subject_type TEAM), com poucas
 * mudanças ao longo das competências e duas exceções por Subgrupo, pra testar histórico e
 * resolução de meta mais específica.
 */
export type Segment = "B2C" | "B2B"
export type Domain = "ATENDIMENTO" | "FATURAMENTO" | "RETENCAO" | "SUPORTE"

export type IndicatorGoal = {
  code: string
  /** Meta vigente desde a 1ª competência. */
  target: number
  /** Peso no PRV (% — soma 100 por grupo). */
  weight: number
  /** Meta alterada a partir de uma competência (raro — só pra ter histórico de meta). */
  targetFrom?: { period: DemoReferencePeriod; target: number }
  /** Peso alterado a partir de uma competência (raro). */
  weightFrom?: { period: DemoReferencePeriod; weight: number }
}

export type GroupSpec = {
  key: string
  name: string
  segment: Segment
  domain: Domain
  subgroups: readonly string[]
  indicators: readonly IndicatorGoal[]
  /** Indicador de eficiência (TMA/TMT) usado pelas personas F/G. */
  efficiencyCode: string
  /** Viés do Grupo em p.p. de atingimento (operações não são todas iguais — dá contraste ao ranking por Grupo). */
  performanceBias: number
  /** Metas por Subgrupo (mais específicas que a do Grupo). */
  subgroupGoals?: readonly { subgroup: string; code: string; target: number }[]
}

export const QUALITY_CODE = "MONITORIA_QUALIDADE"

/**
 * INDICADOR DE VOLUME/PRODUÇÃO da massa — a única definição que a massa CRIA (idempotente, pelo mesmo
 * contrato da tela Indicadores): "Atendimentos" = soma de contagens por dia, medição operacional
 * diária, evidência de produção e política de falta injustificada CONTRIBUIÇÃO ZERO. É configuração
 * de catálogo (metadata), não regra no motor: a INIA continua sem conhecer o código. Não entra no PRV
 * (sem fechamento oficial) — é a produção diária que o Calendário/classificação usam.
 */
export const DEMO_VOLUME_INDICATOR = {
  code: "ATENDIMENTOS",
  name: "Atendimentos",
  unit: "COUNT",
  desiredDirection: "HIGHER",
  dailySupported: true,
  operationalAggregation: "SUM",
  officialClosureSupported: false,
  provesWorkActivity: true,
  unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION",
  minimumCoverage: 0.6,
} as const

export const DEMO_GROUPS: readonly GroupSpec[] = [
  {
    key: "b2c-atendimento-geral", performanceBias: 0, name: "B2C · Atendimento Geral", segment: "B2C", domain: "ATENDIMENTO",
    subgroups: ["Voz", "Chat", "WhatsApp"], efficiencyCode: "TMA",
    indicators: [
      { code: QUALITY_CODE, target: 90, weight: 25 },
      { code: "TMA", target: 420, weight: 20, targetFrom: { period: "2026-07", target: 400 } },
      { code: "NOTA_URA", target: 4.3, weight: 20 },
      { code: "REINCIDENCIA_7D", target: 9, weight: 20 },
      { code: "ADERENCIA", target: 92, weight: 15 },
    ],
    subgroupGoals: [{ subgroup: "Chat", code: "TMA", target: 300 }],
  },
  {
    key: "b2c-faturamento", performanceBias: -1.5, name: "B2C · Faturamento", segment: "B2C", domain: "FATURAMENTO",
    subgroups: ["Voz", "WhatsApp"], efficiencyCode: "TMA",
    indicators: [
      { code: QUALITY_CODE, target: 90, weight: 25 },
      { code: "TMA", target: 480, weight: 20 },
      { code: "REINCIDENCIA_7D", target: 9, weight: 20 },
      { code: "NOTA_URA", target: 4.3, weight: 20 },
      { code: "TAXA_RETRABALHO", target: 4, weight: 15 },
    ],
  },
  {
    key: "b2c-retencao", performanceBias: -2.5, name: "B2C · Retenção", segment: "B2C", domain: "RETENCAO",
    subgroups: ["Premium", "Massivo"], efficiencyCode: "TMA",
    indicators: [
      { code: QUALITY_CODE, target: 90, weight: 20, weightFrom: { period: "2026-07", weight: 15 } },
      { code: "TMA", target: 600, weight: 15 },
      { code: "TAXA_RETENCAO", target: 62, weight: 25, weightFrom: { period: "2026-07", weight: 30 } },
      { code: "NOTA_URA", target: 4.3, weight: 15 },
      { code: "ADERENCIA", target: 92, weight: 10 },
      { code: "RECONTATO_CANCELAMENTO", target: 8, weight: 15 },
    ],
  },
  {
    key: "b2c-suporte-tecnico", performanceBias: 1, name: "B2C · Suporte Técnico", segment: "B2C", domain: "SUPORTE",
    subgroups: ["Voz", "Chat"], efficiencyCode: "TMA",
    indicators: [
      { code: QUALITY_CODE, target: 90, weight: 20 },
      { code: "TMA", target: 540, weight: 15, targetFrom: { period: "2026-07", target: 520 } },
      { code: "FCR", target: 75, weight: 25 },
      { code: "NOTA_URA", target: 4.3, weight: 15 },
      { code: "TAXA_TRANSFERENCIA", target: 10, weight: 10 },
      { code: "TEMPO_DIAGNOSTICO", target: 300, weight: 15 },
    ],
  },
  {
    key: "b2c-digital", performanceBias: 2.5, name: "B2C · Digital", segment: "B2C", domain: "ATENDIMENTO",
    subgroups: ["Chat", "WhatsApp"], efficiencyCode: "TMA",
    indicators: [
      { code: QUALITY_CODE, target: 90, weight: 25 },
      { code: "TMA", target: 360, weight: 20 },
      { code: "NOTA_URA", target: 4.3, weight: 20 },
      { code: "REINCIDENCIA_7D", target: 9, weight: 20 },
      { code: "TEMPO_DISPONIVEL", target: 80, weight: 15 },
    ],
    subgroupGoals: [{ subgroup: "WhatsApp", code: "NOTA_URA", target: 4.5 }],
  },
  {
    key: "b2b-atendimento-pme", performanceBias: -1, name: "B2B · Atendimento PME", segment: "B2B", domain: "ATENDIMENTO",
    subgroups: ["Voz", "Chat"], efficiencyCode: "TMA",
    indicators: [
      { code: QUALITY_CODE, target: 92, weight: 25 },
      { code: "TMA", target: 450, weight: 20 },
      { code: "NOTA_URA", target: 4.3, weight: 20 },
      { code: "REINCIDENCIA_7D", target: 9, weight: 20 },
      { code: "ADERENCIA", target: 92, weight: 15 },
    ],
  },
  {
    key: "b2b-grandes-contas", performanceBias: 2, name: "B2B · Grandes Contas", segment: "B2B", domain: "ATENDIMENTO",
    subgroups: ["Corporate", "Premium"], efficiencyCode: "TMA",
    indicators: [
      { code: QUALITY_CODE, target: 92, weight: 25 },
      { code: "TMA", target: 540, weight: 15 },
      { code: "NPS", target: 70, weight: 25 },
      { code: "SLA_24H", target: 90, weight: 20 },
      { code: "TAXA_TRANSFERENCIA", target: 10, weight: 15 },
    ],
  },
  {
    key: "b2b-faturamento-empresarial", performanceBias: 0.5, name: "B2B · Faturamento Empresarial", segment: "B2B", domain: "FATURAMENTO",
    subgroups: ["PME", "Corporate"], efficiencyCode: "TMT",
    indicators: [
      { code: QUALITY_CODE, target: 92, weight: 15 },
      { code: "TMT", target: 720, weight: 15 },
      { code: "QUALIDADE_ANALISE", target: 94, weight: 20 },
      { code: "SLA_24H", target: 90, weight: 20, targetFrom: { period: "2026-08", target: 92 } },
      { code: "TAXA_RETRABALHO", target: 4, weight: 15 },
      { code: "BACKLOG", target: 180, weight: 15 },
    ],
  },
  {
    key: "b2b-suporte-empresarial", performanceBias: 1.5, name: "B2B · Suporte Empresarial", segment: "B2B", domain: "SUPORTE",
    subgroups: ["Voz", "Chat"], efficiencyCode: "TMA",
    indicators: [
      { code: QUALITY_CODE, target: 92, weight: 25 },
      { code: "TMA", target: 600, weight: 15 },
      { code: "FCR", target: 75, weight: 25 },
      { code: "NOTA_URA", target: 4.3, weight: 15 },
      { code: "TEMPO_DIAGNOSTICO", target: 300, weight: 20 },
    ],
  },
  {
    key: "b2b-retencao", performanceBias: -2, name: "B2B · Retenção B2B", segment: "B2B", domain: "RETENCAO",
    subgroups: [], efficiencyCode: "TMA",
    indicators: [
      { code: QUALITY_CODE, target: 92, weight: 20 },
      { code: "TMA", target: 660, weight: 15 },
      { code: "TAXA_RETENCAO", target: 65, weight: 30 },
      { code: "RECONTATO_CANCELAMENTO", target: 8, weight: 15 },
      { code: "NOTA_URA", target: 4.3, weight: 20 },
    ],
  },
]

/** Todos os códigos usados pela massa — precisam existir (ativos) em `indicator_definitions`. */
export const DEMO_INDICATOR_CODES: readonly string[] = [...new Set(DEMO_GROUPS.flatMap((group) => group.indicators.map((indicator) => indicator.code)))]

/** Limites físicos do VALOR por unidade/indicador, pra nunca gerar "Qualidade 104%" ou "5,3 estrelas". */
export function valueBounds(code: string, unit: string): { min: number; max: number | null } {
  if (unit === "STARS") return { min: 1, max: 5 }
  if (unit === "POINTS") return { min: -100, max: 100 }
  if (unit === "PERCENT") return { min: 0, max: 100 }
  return { min: code === "BACKLOG" ? 0 : 1, max: null }
}

/** Casas decimais do VALOR por unidade — segundos/casos/pontos são inteiros. */
export function valueDecimals(unit: string): number {
  if (unit === "SECONDS" || unit === "CASES" || unit === "POINTS" || unit === "CASES_PER_DAY") return 0
  return 2
}

export function effectiveTarget(indicator: IndicatorGoal, period: DemoReferencePeriod): number {
  return indicator.targetFrom && period >= indicator.targetFrom.period ? indicator.targetFrom.target : indicator.target
}

export function effectiveWeight(indicator: IndicatorGoal, period: DemoReferencePeriod): number {
  return indicator.weightFrom && period >= indicator.weightFrom.period ? indicator.weightFrom.weight : indicator.weight
}
