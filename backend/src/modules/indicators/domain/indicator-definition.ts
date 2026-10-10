import { z } from "zod"
import { displayIconKeySchema } from "../../../shared/domain/display-icon.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { availabilityPolicySchema } from "../../data-hub/domain/data-availability.js"
import { OPERATIONAL_AGGREGATION_KINDS, UNJUSTIFIED_ABSENCE_POLICIES, zeroContributionSupported, type OperationalAggregationKind } from "./operational-aggregation.js"

/**
 * Definição de indicador como FONTE DE VERDADE do comportamento (catálogo metadata-driven).
 *
 * Regra arquitetural: a INIA conhece COMPORTAMENTOS (unidade, direção, estratégia de agregação,
 * capacidade operacional/oficial) — nunca CÓDIGOS de indicador. "TMA", "FCR",
 * "DIGITAL_RESOLUTION_RATE" são dados do catálogo; o código só sabe o que é SECONDS/LOWER/
 * WEIGHTED_AVERAGE. Um indicador novo com semântica já suportada é configuração, não
 * desenvolvimento. Este arquivo é o único lugar que descreve unidades, estratégias e a
 * validação de coerência entre elas.
 */

// ---------------------------------------------------------------------------------------------
// Unidade — contrato de apresentação (o frontend formata SÓ pela unidade, nunca pelo código).
// ---------------------------------------------------------------------------------------------
export const INDICATOR_UNITS = ["PERCENT", "SECONDS", "POINTS", "STARS", "COUNT", "CASES", "CASES_PER_DAY"] as const
export type IndicatorUnit = (typeof INDICATOR_UNITS)[number]
export const indicatorUnitSchema = z.enum(INDICATOR_UNITS)

export type IndicatorUnitMetadata = {
  label: string
  /** Sufixo curto pra composição em texto (agentes, alertas, evidências). */
  suffix: string
  /** Casas decimais sugeridas na apresentação. */
  decimals: number
  /** Unidades que representam notas/avaliações (média das avaliações) — muda só o texto funcional. */
  score: boolean
}

export const INDICATOR_UNIT_METADATA: Record<IndicatorUnit, IndicatorUnitMetadata> = {
  PERCENT: { label: "Percentual (%)", suffix: "%", decimals: 1, score: false },
  SECONDS: { label: "Segundos (tempo)", suffix: "s", decimals: 0, score: false },
  POINTS: { label: "Pontos", suffix: "pts", decimals: 1, score: true },
  STARS: { label: "Nota (estrelas)", suffix: "★", decimals: 1, score: true },
  COUNT: { label: "Quantidade", suffix: "", decimals: 0, score: false },
  CASES: { label: "Casos", suffix: "casos", decimals: 0, score: false },
  CASES_PER_DAY: { label: "Casos por dia", suffix: "/dia", decimals: 1, score: false },
}

/** Valor + unidade em texto pra prompts/alertas ("480 s", "87,5%", "4,6 ★") — mesma convenção da UI. */
export function formatIndicatorValue(value: number, unit: string): string {
  const meta = INDICATOR_UNIT_METADATA[unit as IndicatorUnit]
  if (!meta) return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${unit}`.trim()
  const text = value.toLocaleString("pt-BR", { maximumFractionDigits: meta.decimals })
  if (unit === "PERCENT") return `${text}%`
  return meta.suffix ? `${text} ${meta.suffix}` : text
}

// ---------------------------------------------------------------------------------------------
// Direção
// ---------------------------------------------------------------------------------------------
export const DESIRED_DIRECTIONS = ["HIGHER", "LOWER", "TARGET"] as const
export const desiredDirectionSchema = z.enum(DESIRED_DIRECTIONS)

// ---------------------------------------------------------------------------------------------
// Granularidade operacional — só o que ingestão + runtime suportam HOJE. HOURLY/INTERACTION
// existem no check da tabela de medições (migration 052) mas não são opção de configuração.
// ---------------------------------------------------------------------------------------------
export const SUPPORTED_OPERATIONAL_GRANULARITIES = ["DAILY"] as const

// ---------------------------------------------------------------------------------------------
// Estratégias de agregação — a engine conhece ESTRATÉGIAS, não indicadores. Cada uma declara os
// componentes genéricos da medição (`indicator_measurements.value/numerator/denominator/
// sample_count`) que a futura ingestão deve exigir (ver docs/dev/central-de-dados-ingestao.md).
// ---------------------------------------------------------------------------------------------
export type MeasurementComponent = "value" | "numerator" | "denominator" | "sampleCount"

export type AggregationStrategyMetadata = {
  /** Nome curto da opção no formulário ("Como consolidar este indicador em um período?"). */
  label: string
  /** Ajuda contextual genérica — nunca cita um indicador específico. */
  help: string
  /** Componentes obrigatórios numa medição pra estratégia agregar corretamente. */
  requiredComponents: MeasurementComponent[]
  /** Componentes opcionais que enriquecem a evidência (amostra declarada). */
  optionalComponents: MeasurementComponent[]
  /** Unidades compatíveis; `null` = qualquer unidade. */
  allowedUnits: IndicatorUnit[] | null
}

export const AGGREGATION_STRATEGY_METADATA: Record<OperationalAggregationKind, AggregationStrategyMetadata> = {
  RATE: {
    label: "Taxa",
    help: "Soma das ocorrências ÷ soma dos elegíveis do período × 100.",
    requiredComponents: ["value", "numerator", "denominator"],
    optionalComponents: [],
    allowedUnits: ["PERCENT"],
  },
  WEIGHTED_AVERAGE: {
    label: "Média ponderada",
    help: "Soma do total ÷ soma do volume/amostra do período (nunca média de médias).",
    requiredComponents: ["value", "numerator", "denominator"],
    optionalComponents: ["sampleCount"],
    allowedUnits: null,
  },
  AVERAGE: {
    label: "Média simples",
    help: "Média dos valores observados nos períodos.",
    requiredComponents: ["value"],
    optionalComponents: ["sampleCount"],
    allowedUnits: null,
  },
  SUM: {
    label: "Soma",
    help: "Soma os valores dos períodos.",
    requiredComponents: ["value"],
    optionalComponents: [],
    allowedUnits: null,
  },
  LATEST: {
    label: "Último valor",
    help: "Usa a medição mais recente da janela (snapshot).",
    requiredComponents: ["value"],
    optionalComponents: [],
    allowedUnits: null,
  },
}

/**
 * Texto FUNCIONAL do cálculo no período, derivado de estratégia + unidade (nunca por código de
 * indicador, nunca armazenado). É o que o editor de Workflow e a tela de Indicadores mostram no
 * lugar do nome técnico da estratégia: "Tempo consolidado dos atendimentos — Tempo total ÷
 * total de atendimentos" em vez de "Média ponderada pelo volume".
 */
export function describeAggregationStrategy(kind: OperationalAggregationKind, unit: string): { label: string; description: string } {
  const meta = INDICATOR_UNIT_METADATA[unit as IndicatorUnit]
  switch (kind) {
    case "RATE":
      return { label: "Taxa consolidada do período", description: "Ocorrências ÷ elegíveis do período × 100 (nunca média das taxas diárias)." }
    case "WEIGHTED_AVERAGE":
      if (unit === "SECONDS") return { label: "Tempo consolidado dos atendimentos", description: "Tempo total ÷ total de atendimentos do período." }
      if (meta?.score || unit === "PERCENT") return { label: "Média das avaliações realizadas", description: "Soma das notas ÷ total de avaliações do período (ponderada pelo volume)." }
      return { label: "Média ponderada pelo volume", description: "Soma do total ÷ soma do volume do período." }
    case "AVERAGE":
      return { label: "Média dos períodos", description: "Média simples dos valores observados." }
    case "SUM":
      return { label: "Soma do período", description: "Soma dos valores dos períodos." }
    case "LATEST":
      return { label: "Último valor registrado", description: "Usa a medição mais recente da janela — nunca soma snapshots." }
  }
}

// ---------------------------------------------------------------------------------------------
// Código
// ---------------------------------------------------------------------------------------------
export const INDICATOR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/

/** Normaliza o código do jeito que o catálogo o persiste: maiúsculo, sem espaços nas pontas. */
export function normalizeIndicatorCode(code: string): string {
  return code.trim().toUpperCase()
}

// ---------------------------------------------------------------------------------------------
// Configuração completa + validação de coerência (o backend impede configuração semanticamente
// inválida — nunca só o formulário).
// ---------------------------------------------------------------------------------------------
const definitionFields = {
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(120),
  unit: indicatorUnitSchema,
  desiredDirection: desiredDirectionSchema,
  /** Medição operacional (diária por colaborador) habilitada — coluna `daily_supported`. */
  dailySupported: z.boolean(),
  operationalAggregation: z.enum(OPERATIONAL_AGGREGATION_KINDS),
  minimumSampleSize: z.number().int().min(1).max(10_000).nullable(),
  minimumCoverage: z.number().min(0.01).max(1).nullable(),
  officialClosureSupported: z.boolean(),
  /**
   * EVIDÊNCIA DE PRODUÇÃO (people/domain/work-activity-evidence.ts): uma medição diária deste indicador
   * prova que o colaborador trabalhou naquele dia (ex.: volume de atendimentos). Default false — uma
   * linha de Qualidade ou de TMA atrasada NÃO prova presença; marcar é decisão do cliente, por
   * configuração, nunca por código/nome no motor. Exige medição operacional.
   */
  provesWorkActivity: z.boolean(),
  /**
   * FALTA INJUSTIFICADA (people/domain/workday-classification.ts): NO_SAMPLE (não há amostra — TMA,
   * Qualidade) ou ZERO_CONTRIBUTION (contribuição lógica 0 — Produção). Nunca cria medição; só afeta o
   * cálculo operacional quando uma falta injustificada foi confirmada por pessoa autorizada.
   */
  unjustifiedAbsencePolicy: z.enum(UNJUSTIFIED_ABSENCE_POLICIES),
  /** Override de disponibilidade esperada (D-1/D-2 + horário) — só quando o feed mistura SLAs. null = herda do feed. */
  availabilityPolicy: availabilityPolicySchema.nullable(),
  /** Ícone que representa o indicador no Acompanhamento (catálogo fechado, migration 115). null = padrão pela unidade. */
  iconKey: displayIconKeySchema.nullable(),
  active: z.boolean(),
}

export const indicatorDefinitionInputSchema = z.object({
  ...definitionFields,
  dailySupported: definitionFields.dailySupported.default(false),
  operationalAggregation: definitionFields.operationalAggregation.default("AVERAGE"),
  minimumSampleSize: definitionFields.minimumSampleSize.default(null),
  minimumCoverage: definitionFields.minimumCoverage.default(null),
  officialClosureSupported: definitionFields.officialClosureSupported.default(true),
  provesWorkActivity: definitionFields.provesWorkActivity.default(false),
  unjustifiedAbsencePolicy: definitionFields.unjustifiedAbsencePolicy.default("NO_SAMPLE"),
  availabilityPolicy: definitionFields.availabilityPolicy.default(null),
  iconKey: definitionFields.iconKey.default(null),
  active: definitionFields.active.default(true),
})
export type IndicatorDefinitionInput = z.infer<typeof indicatorDefinitionInputSchema>

/** PATCH parcial: campo ausente = mantém o atual (sem defaults — senão "ausente" viraria "false"). */
export const indicatorDefinitionPatchSchema = z.object(definitionFields).partial()

export type IndicatorDefinitionRecord = IndicatorDefinitionInput & { id: string }

/** Campos cuja mudança altera a SEMÂNTICA do histórico (medições, metas, fechamentos, Workflows). */
export const SEMANTIC_FIELDS = ["code", "unit", "desiredDirection", "operationalAggregation"] as const
export type SemanticField = (typeof SEMANTIC_FIELDS)[number]

export function validateIndicatorDefinition(input: IndicatorDefinitionInput): IndicatorDefinitionInput {
  const code = normalizeIndicatorCode(input.code)
  if (!INDICATOR_CODE_PATTERN.test(code)) {
    throw new DomainError("O código deve começar com letra e conter apenas letras maiúsculas, números e underscore (ex.: DIGITAL_RESOLUTION_RATE).", "INDICATOR_INVALID_CODE", 422)
  }
  const strategy = AGGREGATION_STRATEGY_METADATA[input.operationalAggregation]
  if (strategy.allowedUnits && !strategy.allowedUnits.includes(input.unit)) {
    throw new DomainError(
      `A estratégia "${strategy.label}" só é válida para ${strategy.allowedUnits.map((unit) => INDICATOR_UNIT_METADATA[unit].label).join(", ")} — ${INDICATOR_UNIT_METADATA[input.unit].label} não é compatível.`,
      "INDICATOR_INVALID_CONFIGURATION",
      422,
    )
  }
  if (!input.dailySupported && (input.minimumSampleSize !== null || input.minimumCoverage !== null)) {
    throw new DomainError("Amostra mínima e cobertura mínima só se aplicam a indicadores com medição operacional ativada.", "INDICATOR_INVALID_CONFIGURATION", 422)
  }
  if (!input.dailySupported && !input.officialClosureSupported) {
    throw new DomainError("Um indicador precisa de ao menos uma capacidade: medição operacional ou fechamento oficial.", "INDICATOR_INVALID_CONFIGURATION", 422)
  }
  if (input.provesWorkActivity && !input.dailySupported) {
    throw new DomainError("Só um indicador com medição operacional (diária) pode comprovar atividade operacional.", "INDICATOR_INVALID_CONFIGURATION", 422)
  }
  if (input.unjustifiedAbsencePolicy === "ZERO_CONTRIBUTION") {
    if (!input.dailySupported) throw new DomainError("Contribuição zero em falta injustificada só se aplica a indicadores com medição operacional (diária).", "INDICATOR_INVALID_CONFIGURATION", 422)
    if (!zeroContributionSupported(input.operationalAggregation, input.unit)) {
      throw new DomainError(
        `"Contribuição zero" só é válida para soma ou média de contagens (Quantidade, Casos, Casos por dia) — para ${INDICATOR_UNIT_METADATA[input.unit].label} com "${strategy.label}" um zero seria um valor inventado. Use "Sem amostra".`,
        "INDICATOR_INVALID_CONFIGURATION",
        422,
      )
    }
  }
  if (input.availabilityPolicy && !input.dailySupported) {
    throw new DomainError("Disponibilidade esperada (D-1/D-2) só se aplica a indicadores com medição operacional (diária).", "INDICATOR_INVALID_CONFIGURATION", 422)
  }
  return { ...input, code }
}

/** Quais campos semânticos mudaram entre a definição persistida e a nova — base do bloqueio com histórico. */
export function changedSemanticFields(current: IndicatorDefinitionInput, next: IndicatorDefinitionInput): SemanticField[] {
  const changed = SEMANTIC_FIELDS.filter((field) => current[field] !== next[field])
  return changed
}

export const SEMANTIC_FIELD_LABELS: Record<SemanticField | "dailySupported", string> = {
  code: "código",
  unit: "unidade",
  desiredDirection: "direção desejada",
  operationalAggregation: "estratégia de consolidação",
  dailySupported: "medição operacional",
}
