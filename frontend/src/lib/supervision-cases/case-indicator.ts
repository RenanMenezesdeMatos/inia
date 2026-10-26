import { formatIndicatorValue } from "@/lib/analytics/format"
import { indicatorUnitSchema } from "@/schemas/admin/indicator-definition.schema"

/**
 * Apresentação do indicador na tela do caso de supervisão. Os campos `indicator_value`/`indicator_target` do caso são texto livre
 * gravado por produtores diferentes: o Agent de indicador grava o número cru com a unidade do catálogo ("466.95238095238096
 * SECONDS (meta vigente: 400 SECONDS)"), o motor de feedback e o feedback confiável gravam marcadores internos no lugar da meta
 * ("FEEDBACK_ENGINE_V1"), o gatilho de flag grava a condição. Aqui o número cru vira o formato do produto e só aparece como meta
 * o que é meta. Nada disto se aplica a citação literal de chamada: quem chama decide (só textos de indicador).
 */
const UNITS = indicatorUnitSchema.options.join("|")
const NUMBER = String.raw`-?\d+(?:\.\d+)?`
const RAW_MEASURE = new RegExp(String.raw`(${NUMBER})\s+(${UNITS})\b`, "g")
const EMBEDDED_TARGET = new RegExp(String.raw`\s*\(meta vigente:\s*(${NUMBER})\s+(${UNITS})\)\s*$`)
const TARGET_MEASURE = new RegExp(String.raw`^(${NUMBER})\s+(${UNITS})$`)
/** Número já formatado em pt-BR pela política de acompanhamento ("400", "0,92", "1.250,5"). */
const PLAIN_NUMBER = /^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:,\d+)?$/
const EMPTY = new Set(["", "—", "-"])

/** Troca cada "<número> <UNIDADE>" gravado cru pelo valor no formato do produto ("466.95 SECONDS" → "7m47s"). */
export function formatRawMeasures(text: string): string {
  return text.replace(RAW_MEASURE, (match, value: string, unit: string) => {
    const amount = Number(value)
    return Number.isFinite(amount) ? formatIndicatorValue(amount, unit) : match
  })
}

export type CaseIndicatorSummary = { value: string; target: string | null }

export function caseIndicatorSummary(item: { indicatorCode: string; indicatorValue: string; indicatorTarget: string }): CaseIndicatorSummary {
  const code = item.indicatorCode.trim()
  let text = item.indicatorValue.trim()
  let target: string | null = null
  const embedded = EMBEDDED_TARGET.exec(text)
  if (embedded) {
    target = formatIndicatorValue(Number(embedded[1]), embedded[2]!)
    text = text.slice(0, embedded.index).trim()
  } else {
    target = targetOf(item.indicatorTarget)
  }
  if (EMPTY.has(text)) return { value: code, target }
  const value = formatRawMeasures(text)
  const repeatsCode = code === "" || value.toLocaleLowerCase("pt-BR").includes(code.toLocaleLowerCase("pt-BR"))
  return { value: repeatsCode ? value : `${code} · ${value}`, target }
}

/** Só é meta o que é um número (com ou sem unidade). Marcadores internos, nomes e condições de gatilho não aparecem como meta. */
function targetOf(raw: string): string | null {
  const text = raw.trim()
  const measure = TARGET_MEASURE.exec(text)
  if (measure) return formatIndicatorValue(Number(measure[1]), measure[2]!)
  return PLAIN_NUMBER.test(text) ? text : null
}
