"use client"

import type { ReactNode } from "react"
import { AlertTriangle, Bot, Brain, CheckCircle2, CircleDashed, Clock, Cpu, HelpCircle, Info, Plug, Server, Sparkles, WifiOff, XCircle, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { StatusPill } from "@/components/admin/data-hub/status-badges"
import { cn } from "@/lib/utils"
import { formatAiDateTime, formatCostByCurrency, formatLatency, formatPerMillion, LOCAL_API_COST_ZERO_LABEL, moneyEntries } from "@/lib/admin/ai-format"
import {
  AI_CAPABILITIES,
  AI_CAPABILITY_LABELS,
  CAPABILITY_SOURCE_LABELS,
  CONNECTION_HEALTH_LABELS,
  CONNECTION_TEST_STATUS_LABELS,
  type AiCapability,
  type AiModel,
  type CapabilityClaim,
} from "@/schemas/admin/ai-management.schema"

/**
 * Peças comuns da administração de IA. Status sempre com ícone + texto (nunca só cor), reusando o
 * `StatusPill` da Central de Dados — mesma linguagem visual para "saúde da conexão".
 */

const PROVIDER_ICONS: Record<string, LucideIcon> = { sparkles: Sparkles, brain: Brain, bot: Bot, server: Server, cpu: Cpu, plug: Plug }

export function ProviderIcon({ icon, className }: { icon: string | null | undefined; className?: string }) {
  const Icon = PROVIDER_ICONS[icon ?? ""] ?? Plug
  return <Icon className={cn("size-4", className)} aria-hidden />
}

export function InfoCallout({ children, tone = "info", className }: { children: ReactNode; tone?: "info" | "warn"; className?: string }) {
  const Icon = tone === "warn" ? AlertTriangle : Info
  return (
    <div
      role="note"
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2 text-xs",
        tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" : "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
        className,
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="space-y-1">{children}</div>
    </div>
  )
}

const TEST_STATUS_META: Record<string, { icon: LucideIcon; tone: "ok" | "warn" | "error" | "muted" }> = {
  CONNECTED: { icon: CheckCircle2, tone: "ok" },
  AUTH_ERROR: { icon: XCircle, tone: "error" },
  NETWORK_ERROR: { icon: WifiOff, tone: "error" },
  RATE_LIMITED: { icon: Clock, tone: "warn" },
  INVALID_ENDPOINT: { icon: XCircle, tone: "error" },
  UNSUPPORTED: { icon: CircleDashed, tone: "muted" },
  UNKNOWN_ERROR: { icon: AlertTriangle, tone: "error" },
}

export function ConnectionTestStatusBadge({ status, tooltip }: { status: string | null; tooltip?: ReactNode }) {
  if (!status) return <StatusPill icon={CircleDashed} tone="muted" label="Não testada" tooltip={tooltip ?? "A conexão ainda não foi testada."} />
  const meta = TEST_STATUS_META[status] ?? { icon: HelpCircle, tone: "muted" as const }
  return <StatusPill icon={meta.icon} tone={meta.tone} label={CONNECTION_TEST_STATUS_LABELS[status] ?? status} tooltip={tooltip} />
}

/** Resultado do "Testar conexão": status + latência + mensagem segura + quando. */
export function ConnectionTestResultView({ result, className }: { result: { status: string; latencyMs: number | null; message: string | null; checkedAt: string | null; modelCount?: number | null }; className?: string }) {
  return (
    <div className={cn("space-y-1 text-xs", className)} data-testid="connection-test-result">
      <div className="flex flex-wrap items-center gap-2">
        <ConnectionTestStatusBadge status={result.status} />
        <span className="text-muted-foreground">Latência: {formatLatency(result.latencyMs)}</span>
        {result.modelCount !== null && result.modelCount !== undefined ? <span className="text-muted-foreground">{result.modelCount} modelo(s) visível(is)</span> : null}
      </div>
      {result.message ? <p className="text-muted-foreground">{result.message}</p> : null}
      {result.checkedAt ? <p className="text-muted-foreground">Testado em {formatAiDateTime(result.checkedAt)}</p> : null}
    </div>
  )
}

const HEALTH_META: Record<string, { icon: LucideIcon; tone: "ok" | "warn" | "error" | "muted"; tip: string }> = {
  HEALTHY: { icon: CheckCircle2, tone: "ok", tip: "Último teste OK ou chamadas recentes com sucesso, sem sinais de degradação." },
  DEGRADED: { icon: AlertTriangle, tone: "warn", tip: "Erro em ao menos 20% das tentativas das últimas 24h ou rate limit recente." },
  OFFLINE: { icon: XCircle, tone: "error", tip: "O último teste falhou sem sucesso depois, ou todas as tentativas recentes falharam." },
  UNKNOWN: { icon: HelpCircle, tone: "muted", tip: "Sem teste e sem uso nas últimas 24h (ou conexão desabilitada)." },
}

export function HealthBadge({ status }: { status: string }) {
  const meta = HEALTH_META[status] ?? HEALTH_META.UNKNOWN!
  return <StatusPill icon={meta.icon} tone={meta.tone} label={CONNECTION_HEALTH_LABELS[status] ?? status} tooltip={meta.tip} />
}

export function EnabledBadge({ enabled, onLabel = "Habilitada", offLabel = "Desabilitada" }: { enabled: boolean; onLabel?: string; offLabel?: string }) {
  return <Badge variant={enabled ? "secondary" : "outline"}>{enabled ? onLabel : offLabel}</Badge>
}

/** Capacidades SUPORTADAS; a origem da afirmação (descoberta/declarada/inferida) fica no tooltip. */
export function CapabilityBadges({ capabilities, highlight = [] }: { capabilities: Record<string, CapabilityClaim>; highlight?: readonly string[] }) {
  const supported = AI_CAPABILITIES.filter((capability) => capabilities[capability]?.supported)
  if (supported.length === 0) return <span className="text-xs text-muted-foreground">Nenhuma declarada</span>
  return (
    <div className="flex flex-wrap gap-1">
      {supported.map((capability) => (
        <CapabilityBadge key={capability} capability={capability} claim={capabilities[capability]!} emphasized={highlight.includes(capability)} />
      ))}
    </div>
  )
}

function CapabilityBadge({ capability, claim, emphasized }: { capability: AiCapability; claim: CapabilityClaim; emphasized: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Badge variant={emphasized ? "default" : "outline"} className="gap-1 text-[11px] font-normal">
            {AI_CAPABILITY_LABELS[capability]}
            {claim.source === "MANUAL" ? <span aria-hidden className="text-muted-foreground">·M</span> : claim.source === "INFERRED" ? <span aria-hidden className="text-muted-foreground">·I</span> : null}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>{CAPABILITY_SOURCE_LABELS[claim.source] ?? claim.source}</TooltipContent>
    </Tooltip>
  )
}

/** Custo por moeda, uma linha por moeda (nunca somadas). */
export function MoneyList({ costByCurrency, empty = "Sem custo conhecido" }: { costByCurrency: Readonly<Record<string, string>>; empty?: string }) {
  const entries = moneyEntries(costByCurrency)
  if (entries.length === 0) return <span className="text-muted-foreground">{empty}</span>
  return (
    <span className="flex flex-col" aria-label={formatCostByCurrency(costByCurrency)}>
      {entries.map((entry) => (
        <span key={entry.currency} className="tabular-nums">
          {entry.label}
        </span>
      ))}
    </span>
  )
}

/** Preço vigente do modelo; modelo local sem tarifa mostra o rótulo de custo de API (nunca "grátis"). */
export function ModelPriceCell({ model }: { model: Pick<AiModel, "currentPricing" | "costLabel" | "isLocal"> }) {
  if (model.costLabel === "API_COST_ZERO") return <span className="text-xs text-muted-foreground">{LOCAL_API_COST_ZERO_LABEL}</span>
  if (!model.currentPricing) {
    return <span className="text-xs text-muted-foreground">{model.costLabel === "API_COST_UNKNOWN" ? "Sem preço · custo de API desconhecido" : "Sem preço"}</span>
  }
  const pricing = model.currentPricing
  return (
    <span className="flex flex-col text-xs tabular-nums">
      <span>Entrada {formatPerMillion(pricing.inputPerMillion, pricing.currency)}</span>
      <span>Saída {formatPerMillion(pricing.outputPerMillion, pricing.currency)}</span>
    </span>
  )
}
