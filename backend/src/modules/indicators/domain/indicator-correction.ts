import { z } from "zod"
import { allowedMeasurementAggregations, MEASUREMENT_AGGREGATION_LABELS, OPERATIONAL_AGGREGATION_KINDS, type OperationalAggregationKind } from "./operational-aggregation.js"
import {
  AGGREGATION_STRATEGY_METADATA,
  INDICATOR_UNIT_METADATA,
  componentValueScale,
  componentsProblem,
  desiredDirectionSchema,
  indicatorUnitSchema,
  unitValueProblem,
  type IndicatorUnit,
  type MeasurementComponent,
} from "./indicator-definition.js"

/**
 * CORREÇÃO CONTROLADA de um indicador que já tem histórico: unidade, direção desejada e estratégia de consolidação. O código e
 * desligar a medição operacional continuam travados: as cargas do cliente e os grafos de Workflow citam o indicador pelo código.
 * Nada do histórico é reescrito. O período é sempre calculado na leitura, pela definição vigente, então trocar a estratégia muda o
 * resultado de períodos passados e futuros em todas as telas; fechamentos oficiais e conteúdo publicado ficam como estão.
 *
 * Aqui mora a regra (o que conta como problema e o que bloqueia), sem banco. A regra do que é uma medição válida é a mesma da
 * carga (`componentsProblem`, `unitValueProblem`), e por estratégia: nenhum código de indicador aparece aqui.
 */
export const INDICATOR_CORRECTION_REASON_MIN_LENGTH = 10

/** `strict`: código, medição operacional ou qualquer outro campo no corpo é recusado, nunca ignorado em silêncio. */
export const indicatorCorrectionFieldsSchema = z
  .object({
    unit: indicatorUnitSchema.optional(),
    desiredDirection: desiredDirectionSchema.optional(),
    operationalAggregation: z.enum(OPERATIONAL_AGGREGATION_KINDS).optional(),
  })
  .strict()

export const indicatorCorrectionRequestSchema = indicatorCorrectionFieldsSchema
  .extend({
    reason: z.string().trim().min(INDICATOR_CORRECTION_REASON_MIN_LENGTH, `Escreva o motivo da correção (ao menos ${INDICATOR_CORRECTION_REASON_MIN_LENGTH} caracteres).`).max(1000),
    /** O código do indicador digitado na tela, para confirmar. */
    confirmation: z.string().trim().min(1, "Digite o código do indicador para confirmar.").max(60),
  })
  .strict()

export type CorrectableValues = { unit: IndicatorUnit; desiredDirection: "HIGHER" | "LOWER" | "TARGET"; operationalAggregation: OperationalAggregationKind }

export type MeasurementRow = { subjectId: string; periodStart: string; value: number; numerator: number | null; denominator: number | null }
export type MeasurementIssue = "MISSING_COMPONENTS" | "INCOHERENT_VALUE" | "OUT_OF_UNIT_RANGE"

/** Linhas de exemplo por problema na prévia: o suficiente para achar a origem, nunca a lista inteira. */
const EXAMPLES_PER_ISSUE = 3

export type MeasurementScan = {
  total: number
  missingComponents: number
  incoherentValues: number
  outOfUnitRange: number
  /** Linhas com numerador e denominador que a estratégia nova não usa: ficam gravadas e o cálculo as ignora. */
  unusedComponents: number
  examples: (MeasurementRow & { issue: MeasurementIssue; expected: number | null })[]
}

export const emptyMeasurementScan = (): MeasurementScan => ({ total: 0, missingComponents: 0, incoherentValues: 0, outOfUnitRange: 0, unusedComponents: 0, examples: [] })

const REQUIRED_COMPONENTS: MeasurementComponent[] = ["numerator", "denominator"]

/** Soma uma medição à varredura, pela estratégia e unidade NOVAS. Uma linha pode ter mais de um problema. */
export function scanMeasurement(scan: MeasurementScan, row: MeasurementRow, next: Pick<CorrectableValues, "unit" | "operationalAggregation">): void {
  scan.total += 1
  const example = (issue: MeasurementIssue, expected: number | null) => {
    if (scan.examples.filter((item) => item.issue === issue).length < EXAMPLES_PER_ISSUE) scan.examples.push({ ...row, issue, expected })
  }
  const required = AGGREGATION_STRATEGY_METADATA[next.operationalAggregation].requiredComponents.filter((component) => REQUIRED_COMPONENTS.includes(component))
  if (required.some((component) => row[component as "numerator" | "denominator"] === null)) {
    scan.missingComponents += 1
    example("MISSING_COMPONENTS", null)
  }
  if (row.numerator !== null && row.denominator !== null) {
    const problem = componentsProblem(next.operationalAggregation, row.value, row.numerator, row.denominator)
    if (problem?.kind === "NOT_DEFINED_BY_COMPONENTS") scan.unusedComponents += 1
    if (problem?.kind === "INCOHERENT") {
      scan.incoherentValues += 1
      example("INCOHERENT_VALUE", problem.expected)
    }
  }
  if (unitValueProblem(next.unit, row.value)) {
    scan.outOfUnitRange += 1
    example("OUT_OF_UNIT_RANGE", null)
  }
}

export type CorrectionWorkflowUse = { nodeLabel: string; problem: "AGGREGATION" | "DIRECTION"; aggregationLabel: string | null; message: string }
export type CorrectionWorkflow = { id: string; name: string; inFlightEnrollments: number; uses: CorrectionWorkflowUse[] }
export type CorrectionWorkflows = { activePublished: CorrectionWorkflow[]; pausedPublished: CorrectionWorkflow[]; drafts: CorrectionWorkflow[]; outOfScope: { activePublished: number; pausedPublished: number; drafts: number } }

export type CorrectionFacts = {
  current: CorrectableValues
  next: CorrectableValues
  configurationError: string | null
  scan: MeasurementScan
  goals: number
  closuresWithIncoherentComponents: number
  closuresWithUnusedComponents: number
  zeroContributionReset: boolean
  workflows: CorrectionWorkflows
}

export type CorrectionBlocker = { code: "NO_CHANGE" | "INVALID_CONFIGURATION" | "MISSING_COMPONENTS" | "INCOHERENT_VALUES" | "VALUES_OUTSIDE_UNIT" | "ACTIVE_WORKFLOWS"; message: string }

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`

/** Como resolver depende da estratégia ATUAL: enquanto ela não usar componentes, a carga recusa a linha que os traz. */
function fixForMeasurements(current: OperationalAggregationKind): string {
  if (componentValueScale(current) !== null) return "Corrija essas medições na origem e carregue de novo: a carga atualiza a mesma linha."
  return `Enquanto a estratégia for "${AGGREGATION_STRATEGY_METADATA[current].label}", a carga recusa numerador e denominador, então essas linhas não podem ser corrigidas por carga: cancele-as em Central de Dados › Consultar dados e, depois da correção, carregue de novo com os componentes.`
}

export function correctionBlockers(facts: CorrectionFacts): CorrectionBlocker[] {
  const { current, next, scan, workflows } = facts
  const blockers: CorrectionBlocker[] = []
  if (current.unit === next.unit && current.desiredDirection === next.desiredDirection && current.operationalAggregation === next.operationalAggregation) {
    blockers.push({ code: "NO_CHANGE", message: "Nada mudou: escolha outra unidade, direção ou estratégia." })
  }
  if (facts.configurationError) blockers.push({ code: "INVALID_CONFIGURATION", message: facts.configurationError })
  const label = AGGREGATION_STRATEGY_METADATA[next.operationalAggregation].label
  // O caminho para resolver é o mesmo nos dois casos: aparece uma vez só, no último.
  const fix = fixForMeasurements(current.operationalAggregation)
  if (scan.missingComponents > 0) {
    blockers.push({ code: "MISSING_COMPONENTS", message: `${plural(scan.missingComponents, "medição não tem", "medições não têm")} numerador e denominador, que a estratégia "${label}" exige. O resultado do período ficaria errado, porque essas linhas entrariam com peso 1.${scan.incoherentValues > 0 ? "" : ` ${fix}`}` })
  }
  if (scan.incoherentValues > 0) {
    blockers.push({ code: "INCOHERENT_VALUES", message: `${plural(scan.incoherentValues, "medição tem", "medições têm")} valor que não confere com numerador ÷ denominador pela estratégia "${label}". O resultado do período não bateria com o que foi medido. ${fix}` })
  }
  if (scan.outOfUnitRange > 0) {
    blockers.push({ code: "VALUES_OUTSIDE_UNIT", message: `${plural(scan.outOfUnitRange, "medição tem", "medições têm")} valor fora do que a unidade "${INDICATOR_UNIT_METADATA[next.unit].label}" aceita. A carga recusaria essas linhas hoje.` })
  }
  const active = workflows.activePublished.length + workflows.outOfScope.activePublished
  if (active > 0) {
    blockers.push({ code: "ACTIVE_WORKFLOWS", message: `${plural(active, "Workflow ativo depende", "Workflows ativos dependem")} de uma configuração que a regra nova não aceita. A versão publicada não muda sozinha e a execução falharia. Pause antes de corrigir; depois, ajuste o nó e publique de novo.` })
  }
  return blockers
}

export function correctionNotices(facts: CorrectionFacts): string[] {
  const { current, next, scan, workflows } = facts
  const notices: string[] = []
  const strategyChanged = current.operationalAggregation !== next.operationalAggregation
  if (scan.unusedComponents > 0) {
    notices.push(`${plural(scan.unusedComponents, "medição tem", "medições têm")} numerador e denominador que a estratégia nova não usa: continuam gravados e são ignorados. As próximas cargas precisam vir sem essas colunas, senão a linha vai para a quarentena.`)
  }
  if (facts.zeroContributionReset) notices.push(`O tratamento de falta injustificada volta para "Sem amostra": "Contribuição zero" só vale para soma ou média de contagens. Dias de falta injustificada deixam de entrar como 0 no cálculo.`)
  if (facts.goals > 0 && current.unit !== next.unit) notices.push(`${plural(facts.goals, "meta continua", "metas continuam")} com o mesmo número: a unidade nova não converte valores. Confira se ainda fazem sentido.`)
  if (facts.closuresWithIncoherentComponents > 0) notices.push(`${plural(facts.closuresWithIncoherentComponents, "fechamento oficial tem", "fechamentos oficiais têm")} numerador e denominador que não conferem pela regra nova. O valor oficial fica como está; um novo envio com esses componentes vai para a quarentena.`)
  if (facts.closuresWithUnusedComponents > 0) notices.push(`${plural(facts.closuresWithUnusedComponents, "fechamento oficial tem", "fechamentos oficiais têm")} numerador e denominador que a estratégia nova não usa. O valor oficial fica como está; os próximos envios precisam vir sem esses componentes, senão vão para a quarentena.`)
  const paused = workflows.pausedPublished.length + workflows.outOfScope.pausedPublished
  if (paused > 0) notices.push(`${plural(paused, "Workflow pausado depende", "Workflows pausados dependem")} de uma configuração que a regra nova não aceita: não voltam a rodar. Ativar é recusado até ajustar o nó e publicar de novo.`)
  const drafts = workflows.drafts.length + workflows.outOfScope.drafts
  if (drafts > 0) notices.push(`${plural(drafts, "rascunho de Workflow usa", "rascunhos de Workflow usam")} uma configuração que a regra nova não aceita: a publicação é recusada até ajustar o nó.`)
  if (strategyChanged) notices.push("O glossário e as regras de cálculo por Grupo são texto livre e não mudam sozinhos: confira se ainda descrevem a regra nova.")
  return notices
}

/** O que a estratégia aceita como agregação em Condição e Ranking, para a tela explicar o que ajustar. */
export function allowedAggregationLabels(kind: OperationalAggregationKind): string[] {
  return allowedMeasurementAggregations(kind).map((aggregation) => MEASUREMENT_AGGREGATION_LABELS[aggregation])
}
