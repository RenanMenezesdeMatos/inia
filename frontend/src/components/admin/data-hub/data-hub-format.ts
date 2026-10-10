/** Formatação da Central de Dados — pt-BR, sem depender de biblioteca de datas para "há X min". */
const numberFormatter = new Intl.NumberFormat("pt-BR")
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
const timeFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" })

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return numberFormatter.format(value)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  return dateTimeFormatter.format(new Date(value))
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—"
  return timeFormatter.format(new Date(value))
}

/** "há 12 min", "há 3 h", "há 2 dias" — relativo ao agora (ou a `now` para testes). */
export function formatRelative(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "nunca"
  const diffMs = now.getTime() - new Date(value).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return "agora mesmo"
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.round(hours / 24)
  return `há ${days} dia${days === 1 ? "" : "s"}`
}

export function formatFuture(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "—"
  const diffMs = new Date(value).getTime() - now.getTime()
  if (diffMs <= 0) return "agora"
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 60) return `em ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `em ${hours} h`
  return formatDateTime(value)
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—"
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} min ${Math.round(seconds % 60)} s`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
}
