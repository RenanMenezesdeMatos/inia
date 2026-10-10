"use client"

import type { ReactNode } from "react"
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Database, FileSpreadsheet, Globe, HelpCircle, Loader2, PauseCircle, Send, Server, XCircle, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  CONNECTION_HEALTH_LABELS,
  FEED_STATUS_LABELS,
  FRESHNESS_LABELS,
  RUN_ACTIVE_STATUSES,
  RUN_STATUS_LABELS,
  SOURCE_KIND_LABELS,
  SOURCE_STATUS_LABELS,
  type ConnectionHealth,
  type FeedStatus,
  type FreshnessState,
  type RunStatus,
  type SourceKind,
  type SourceStatus,
} from "@/schemas/admin/data-hub.schema"

/**
 * Status com ícone + texto (+ tooltip quando há explicação): nunca só cor. Três conceitos que
 * nunca se misturam: status da fonte (decisão administrativa), saúde da conexão (consigo
 * chegar?) e atualidade dos dados (chegou dado válido recentemente?).
 */
type Tone = "ok" | "warn" | "error" | "muted" | "info"

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  error: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  muted: "border-border bg-muted text-muted-foreground",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
}

export function StatusPill({ icon: Icon, tone, label, tooltip, spin = false, className }: { icon: LucideIcon; tone: Tone; label: string; tooltip?: ReactNode; spin?: boolean; className?: string }) {
  const pill = (
    <Badge variant="outline" className={cn("gap-1", TONE_CLASS[tone], className)}>
      <Icon className={cn(spin && "animate-spin")} aria-hidden />
      <span>{label}</span>
    </Badge>
  )
  if (!tooltip) return pill
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{pill}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export function SourceStatusBadge({ status }: { status: SourceStatus }) {
  const meta: Record<SourceStatus, { icon: LucideIcon; tone: Tone; tip: string }> = {
    DRAFT: { icon: CircleDashed, tone: "muted", tip: "Fonte ainda não ativada: configure e ative o primeiro feed." },
    ACTIVE: { icon: CheckCircle2, tone: "ok", tip: "Fonte ativa: feeds ativos são sincronizados na cadência configurada." },
    PAUSED: { icon: PauseCircle, tone: "warn", tip: "Fonte pausada: nenhuma carga automática até retomar." },
    ERROR: { icon: XCircle, tone: "error", tip: "A última tentativa falhou por credencial recusada. Rotacione a credencial e retome." },
  }
  return <StatusPill icon={meta[status].icon} tone={meta[status].tone} label={SOURCE_STATUS_LABELS[status]} tooltip={meta[status].tip} />
}

export function FeedStatusBadge({ status }: { status: FeedStatus }) {
  const meta: Record<FeedStatus, { icon: LucideIcon; tone: Tone; tip: string }> = {
    DRAFT: { icon: CircleDashed, tone: "muted", tip: "Feed em rascunho: complete o mapeamento e ative." },
    ACTIVE: { icon: CheckCircle2, tone: "ok", tip: "Feed ativo." },
    PAUSED: { icon: PauseCircle, tone: "warn", tip: "Feed pausado: sem cargas automáticas." },
    DEGRADED: { icon: AlertTriangle, tone: "error", tip: "A origem deixou de entregar uma coluna obrigatória. Ajuste o mapeamento e reative." },
  }
  return <StatusPill icon={meta[status].icon} tone={meta[status].tone} label={FEED_STATUS_LABELS[status]} tooltip={meta[status].tip} />
}

export function ConnectionHealthBadge({ health, error, checkedAt }: { health: ConnectionHealth; error?: string | null; checkedAt?: string | null }) {
  const meta: Record<ConnectionHealth, { icon: LucideIcon; tone: Tone }> = { HEALTHY: { icon: CheckCircle2, tone: "ok" }, ERROR: { icon: XCircle, tone: "error" }, UNKNOWN: { icon: HelpCircle, tone: "muted" } }
  const tip = health === "ERROR" ? (error ?? "A INIA não conseguiu alcançar ou autenticar na fonte.") : health === "HEALTHY" ? `A INIA alcança e autentica na fonte${checkedAt ? ` (verificado em ${new Date(checkedAt).toLocaleString("pt-BR")})` : ""}. Conexão OK não significa dados atualizados.` : "A conexão ainda não foi testada."
  return <StatusPill icon={meta[health].icon} tone={meta[health].tone} label={CONNECTION_HEALTH_LABELS[health]} tooltip={tip} />
}

export function FreshnessBadge({ freshness, lastSuccessAt }: { freshness: FreshnessState | null; lastSuccessAt?: string | null }) {
  if (!freshness) return <StatusPill icon={CircleDashed} tone="muted" label="Sem feed" tooltip="Nenhum feed ativo entrega este conjunto de dados ainda." />
  const meta: Record<FreshnessState, { icon: LucideIcon; tone: Tone; tip: string }> = {
    FRESH: { icon: CheckCircle2, tone: "ok", tip: "A última carga bem-sucedida está dentro da cadência esperada." },
    STALE: { icon: Clock, tone: "warn", tip: `A última carga bem-sucedida passou de 2× a cadência esperada${lastSuccessAt ? ` (${new Date(lastSuccessAt).toLocaleString("pt-BR")})` : ""}. A conexão pode estar OK e ainda assim os dados estarem atrasados.` },
    NEVER: { icon: CircleDashed, tone: "muted", tip: "Nenhuma carga bem-sucedida até agora." },
  }
  return <StatusPill icon={meta[freshness].icon} tone={meta[freshness].tone} label={FRESHNESS_LABELS[freshness]} tooltip={meta[freshness].tip} />
}

export function RunStatusBadge({ status, errorMessage }: { status: RunStatus; errorMessage?: string | null }) {
  const active = RUN_ACTIVE_STATUSES.includes(status)
  const meta: Partial<Record<RunStatus, { icon: LucideIcon; tone: Tone }>> = {
    QUEUED: { icon: Clock, tone: "muted" },
    COMPLETED: { icon: CheckCircle2, tone: "ok" },
    PARTIAL: { icon: AlertTriangle, tone: "warn" },
    FAILED: { icon: XCircle, tone: "error" },
    CANCELLED: { icon: CircleDashed, tone: "muted" },
  }
  const resolved = meta[status] ?? { icon: Loader2, tone: "info" as Tone }
  const tip = status === "PARTIAL" ? "Registros válidos foram aplicados; os inválidos estão na quarentena." : status === "FAILED" ? (errorMessage ?? "A carga falhou.") : active && status !== "QUEUED" ? "Carga em andamento." : undefined
  return <StatusPill icon={resolved.icon} tone={resolved.tone} label={RUN_STATUS_LABELS[status]} tooltip={tip} spin={active && status !== "QUEUED"} />
}

export const SOURCE_KIND_ICONS: Record<SourceKind, LucideIcon> = { FILE_UPLOAD: FileSpreadsheet, DATABASE: Database, API_PULL: Globe, API_PUSH: Send, SFTP: Server }

export function SourceKindBadge({ kind }: { kind: SourceKind }) {
  const Icon = SOURCE_KIND_ICONS[kind]
  return (
    <Badge variant="secondary" className="gap-1">
      <Icon aria-hidden />
      {SOURCE_KIND_LABELS[kind]}
    </Badge>
  )
}
