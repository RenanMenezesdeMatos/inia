import type { QaPerson } from "@/schemas/admin/qa-lab.schema"
import { ROLE_LABELS, type PlatformRole } from "@/schemas/auth/auth.schema"

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)
}

export function formatNumber(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: fractionDigits, minimumFractionDigits: 0 }).format(value)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`
  return `${Math.round(ms / 60_000)} min`
}

export function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role as PlatformRole] ?? role
}

/** "Carlos (Supervisor)" — nunca UUID cru. */
export function personLabel(people: Record<string, QaPerson>, id: string): string {
  const person = people[id]
  if (!person) return "pessoa não encontrada"
  return `${person.name} (${roleLabel(person.role)})`
}

/** Converte "YYYY-MM-DDTHH:mm" (input datetime-local, no fuso do navegador) em ISO. */
export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function nowLocalInput(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}
