export type IndicatorDirection = "HIGHER" | "LOWER" | "TARGET"

export function evaluateAttainment(value: number, target: number | null, direction: IndicatorDirection): boolean | null {
  if (target === null) return null
  if (direction === "LOWER") return value <= target
  return value >= target
}
