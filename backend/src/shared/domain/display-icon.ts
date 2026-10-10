import { z } from "zod"

/**
 * Catálogo FECHADO de ícones que o administrador escolhe para flags e indicadores (migration 115). Só a CHAVE é guardada; o
 * desenho fica no frontend (`frontend/src/lib/display-icons.tsx`, mesma lista — teste de sincronia). Ícone novo = entrada nas
 * duas listas, nunca uma migration.
 */
export const DISPLAY_ICON_KEYS = [
  "phone-incoming",
  "repeat",
  "star",
  "timer",
  "clock",
  "arrow-right-left",
  "ban",
  "receipt",
  "frown",
  "smile",
  "thumbs-down",
  "volume-x",
  "phone-off",
  "percent",
  "target",
  "trending-up",
  "gauge",
  "circle-check",
  "list-checks",
  "hash",
  "users",
  "shield-check",
  "calendar-check",
  "clipboard-check",
  "headset",
  "chart-line",
  "flag",
  "zap",
] as const
export type DisplayIconKey = (typeof DISPLAY_ICON_KEYS)[number]
export const displayIconKeySchema = z.enum(DISPLAY_ICON_KEYS)

export function isDisplayIconKey(value: unknown): value is DisplayIconKey {
  return typeof value === "string" && (DISPLAY_ICON_KEYS as readonly string[]).includes(value)
}
