import { isDisplayIconKey, type DisplayIconKey } from "../../../shared/domain/display-icon.js"

/**
 * MOTIVO de um feedback no Acompanhamento — o que o colaborador precisa entender de relance: é uma monitoria disparada por
 * uma flag (ex.: Rechamada), da rotina, avulsa, ou um feedback de indicador (ex.: Tempo Médio de Atendimento)?
 *
 * Função pura sobre FATOS já gravados (gatilho da matrícula do Workflow que publicou, indicador investigado). Nome e ícone de
 * flag/indicador são DADOS configurados pelo administrador (migration 115); sem eles vale um padrão pelo COMPORTAMENTO (tipo
 * de valor da flag, unidade do indicador) — nunca por código de flag ou de indicador.
 */
export type FeedbackFamily = "MONITORING" | "INDICATOR"
export type FeedbackOriginReason = "FLAG" | "SCHEDULE" | "MANUAL" | "INDICATOR" | "UNKNOWN"

export type FeedbackOrigin = {
  family: FeedbackFamily
  reason: FeedbackOriginReason
  /** Complemento do tipo ("Rechamada", "Rotina", "Avulsa"); `null` = só o tipo. */
  label: string | null
  iconKey: DisplayIconKey
}

export type FeedbackOriginFacts = {
  family: FeedbackFamily
  trigger:
    | { kind: "FLAG"; flagName: string; flagLabel: string | null; flagIconKey: string | null; flagValueType: "BOOLEAN" | "NUMERIC" | null }
    | { kind: "SCHEDULE" }
    | { kind: "MANUAL" }
    | { kind: "INDICATOR" }
    | null
  indicator: { unit: string; iconKey: string | null } | null
}

const UNIT_ICONS: Record<string, DisplayIconKey> = {
  SECONDS: "timer",
  STARS: "star",
  POINTS: "gauge",
  PERCENT: "percent",
  COUNT: "hash",
  CASES: "list-checks",
  CASES_PER_DAY: "trending-up",
}

/** "nota_ura" → "Nota ura": só quando a flag não tem nome de exibição configurado. */
export function humanizeFlagName(flagName: string): string {
  const words = flagName.replace(/[_-]+/g, " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : flagName
}

const configured = (iconKey: string | null | undefined): DisplayIconKey | null => (isDisplayIconKey(iconKey) ? iconKey : null)

export function resolveFeedbackOrigin(facts: FeedbackOriginFacts): FeedbackOrigin {
  if (facts.family === "INDICATOR") {
    const iconKey = configured(facts.indicator?.iconKey) ?? (facts.indicator ? UNIT_ICONS[facts.indicator.unit] : undefined) ?? "chart-line"
    // O título do item já é o nome do indicador; o selo diz só o tipo.
    return { family: "INDICATOR", reason: facts.indicator ? "INDICATOR" : "UNKNOWN", label: null, iconKey }
  }
  const trigger = facts.trigger
  if (trigger?.kind === "FLAG") {
    return {
      family: "MONITORING",
      reason: "FLAG",
      label: trigger.flagLabel?.trim() || humanizeFlagName(trigger.flagName),
      iconKey: configured(trigger.flagIconKey) ?? (trigger.flagValueType === "NUMERIC" ? "gauge" : "flag"),
    }
  }
  if (trigger?.kind === "SCHEDULE") return { family: "MONITORING", reason: "SCHEDULE", label: "Rotina", iconKey: "calendar-check" }
  if (trigger?.kind === "MANUAL") return { family: "MONITORING", reason: "MANUAL", label: "Avulsa", iconKey: "clipboard-check" }
  return { family: "MONITORING", reason: "UNKNOWN", label: null, iconKey: "headset" }
}
