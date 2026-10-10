import { closedReferencePeriods, DEMO_RANDOM_SEED } from "./demo-constants.js"
import { demoId } from "./demo-ids.js"
import { DEMO_INDICATOR_CODES } from "./indicator-catalog.js"
import { generateOperatorDailyMeasurements, indexOfficialRows, type DailyMeasurementRow } from "./daily-measurement-generator.js"
import { mapDiagnosticCalls, type DiagnosticCall, type DiagnosticCallRow } from "./diagnostic-calls.js"
import { generateOperatorInteractions, type InteractionRow } from "./interaction-generator.js"
import { extendStructureWithLegacy, NO_LEGACY_PEOPLE, type LegacyAdoptionOptions, type LegacyAdoptionReport, type LegacyPeople } from "./legacy-adoption.js"
import { generatePerformance, type IndicatorDefinition, type PerformanceDataset } from "./performance-generator.js"
import { createRandom, type Random } from "./random.js"
import { generateStructure, type DemoPerson, type DemoStructure } from "./structure-generator.js"

/**
 * Monta a massa inteira em memória, EXCETO as interações — essas são geradas por operador,
 * sob demanda (`interactionsOf`), pra não segurar ~100 MB de transcrições de uma vez. Tudo é
 * função pura do seed + das definições reais de indicador lidas do banco.
 */
export type DemoMass = {
  seed: number
  /** Data de referência ("hoje" da massa diária, AAAA-MM-DD) — os 180 dias terminam aqui. */
  referenceDate: string
  /** As 6 competências OFICIAIS (meses civis completos anteriores ao mês da referência). */
  closedPeriods: string[]
  random: Random
  structure: DemoStructure
  /** Cadeia legada adotada + pessoas geradas pra completar o desenho (legacy-adoption.ts). */
  adoption: LegacyAdoptionReport
  definitions: Map<string, IndicatorDefinition>
  performance: PerformanceDataset
  interactionsOf: (operator: DemoPerson) => InteractionRow[]
  /** Medições diárias (camada operacional) de UM operador, ancoradas nos fechamentos oficiais dele. */
  dailyMeasurementsOf: (operator: DemoPerson) => DailyMeasurementRow[]
  /** As 90 chamadas de diagnóstico do lote externo (diagnostic-calls.ts), já resolvidas contra a estrutura — vazio quando o lote não foi carregado. */
  diagnosticCalls: DiagnosticCallRow[]
}

export function assertIndicatorCatalog(definitions: Map<string, IndicatorDefinition>): void {
  const missing = DEMO_INDICATOR_CODES.filter((code) => !definitions.has(code))
  if (missing.length > 0) {
    throw new Error(`Indicadores ausentes/inativos em indicator_definitions: ${missing.join(", ")}. Rode as migrations antes do seed demo.`)
  }
}

export const DEFAULT_DEMO_REFERENCE_DATE = "2026-09-15"

export function buildDemoMass(definitions: Map<string, IndicatorDefinition>, seed: number = DEMO_RANDOM_SEED, referenceDate: string = DEFAULT_DEMO_REFERENCE_DATE, legacy: LegacyPeople = NO_LEGACY_PEOPLE, diagnosticCalls: readonly DiagnosticCall[] = [], options: LegacyAdoptionOptions = {}): DemoMass {
  assertIndicatorCatalog(definitions)
  const random = createRandom(seed)
  const structure = generateStructure(random.fork("structure"))
  // Pessoas legadas (ids do banco) entram ANTES de qualquer dado: performance, diárias e chamadas
  // tratam-nas como qualquer operador da estrutura.
  const adoption = extendStructureWithLegacy(structure, legacy, random.fork("legacy"), options)
  const closedPeriods = closedReferencePeriods(referenceDate)
  const performance = generatePerformance(structure, definitions, random.fork("performance"), closedPeriods)
  const interactionsRandom = random.fork("interactions")
  const dailyRandom = random.fork("daily")
  const official = indexOfficialRows(performance)
  return {
    seed,
    referenceDate,
    closedPeriods,
    random,
    structure,
    adoption,
    definitions,
    performance,
    interactionsOf: (operator) => generateOperatorInteractions(structure, operator, interactionsRandom),
    dailyMeasurementsOf: (operator) => generateOperatorDailyMeasurements(structure, definitions, official, operator, referenceDate, dailyRandom),
    // Layout temporal V2 desvia das 10 chamadas geradas da própria pessoa (sem sobreposição no dia).
    diagnosticCalls: mapDiagnosticCalls(diagnosticCalls, structure, (operator) => generateOperatorInteractions(structure, operator, interactionsRandom).map((row) => ({ startedAt: row.startedAt, endedAt: row.endedAt }))),
  }
}

/** Definições fictícias com a MESMA forma da tabela — só pra testes do gerador (sem banco). */
export function stubIndicatorDefinitions(): Map<string, IndicatorDefinition> {
  const directions: Record<string, IndicatorDefinition["direction"]> = {
    MONITORIA_QUALIDADE: "HIGHER", TMA: "LOWER", NOTA_URA: "HIGHER", REINCIDENCIA_7D: "LOWER", ADERENCIA: "HIGHER", TAXA_RETRABALHO: "LOWER",
    TAXA_RETENCAO: "HIGHER", RECONTATO_CANCELAMENTO: "LOWER", FCR: "HIGHER", TAXA_TRANSFERENCIA: "LOWER", TEMPO_DIAGNOSTICO: "LOWER",
    TEMPO_DISPONIVEL: "HIGHER", NPS: "HIGHER", SLA_24H: "HIGHER", TMT: "LOWER", QUALIDADE_ANALISE: "HIGHER", BACKLOG: "LOWER",
  }
  const units: Record<string, string> = {
    TMA: "SECONDS", TMT: "SECONDS", TEMPO_DIAGNOSTICO: "SECONDS", NOTA_URA: "STARS", NPS: "POINTS", BACKLOG: "CASES",
  }
  // Mesma semântica da migration 052 (única fonte no banco; aqui só o espelho pros testes).
  const kinds: Record<string, IndicatorDefinition["kind"]> = {
    TMA: "WEIGHTED_AVERAGE", TMT: "WEIGHTED_AVERAGE", TEMPO_DIAGNOSTICO: "WEIGHTED_AVERAGE", NOTA_URA: "WEIGHTED_AVERAGE", NPS: "WEIGHTED_AVERAGE",
    MONITORIA_QUALIDADE: "WEIGHTED_AVERAGE", QUALIDADE_ANALISE: "WEIGHTED_AVERAGE", BACKLOG: "LATEST",
  }
  return new Map(
    Object.entries(directions).map(([code, direction]) => [code, { id: demoId(`stub-indicator:${code}`), code, unit: units[code] ?? "PERCENT", direction, kind: kinds[code] ?? "RATE", dailySupported: true }]),
  )
}
