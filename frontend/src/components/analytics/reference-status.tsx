import { AlertCircle, CheckCircle2, CircleDashed } from "lucide-react"

import { cn } from "@/lib/utils"

export type ReferenceStatus = "WITHIN" | "BELOW" | "NO_DATA"

const STATUS: Record<ReferenceStatus, { label: string; icon: typeof CheckCircle2; className: string; iconClassName: string }> = {
  WITHIN: { label: "Dentro da referência", icon: CheckCircle2, className: "text-emerald-700 dark:text-emerald-300", iconClassName: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  BELOW: { label: "Abaixo da referência", icon: AlertCircle, className: "text-amber-700 dark:text-amber-300", iconClassName: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  NO_DATA: { label: "Sem dados", icon: CircleDashed, className: "text-muted-foreground", iconClassName: "bg-muted text-muted-foreground" },
}

export function referenceStatusFrom(withinTarget: boolean | null): ReferenceStatus {
  if (withinTarget === null) return "NO_DATA"
  return withinTarget ? "WITHIN" : "BELOW"
}

export function referenceStatusFromAchievement(achievementPercent: number | null): ReferenceStatus {
  if (achievementPercent === null) return "NO_DATA"
  return achievementPercent >= 100 ? "WITHIN" : "BELOW"
}

/** Situação em relação à referência — ícone + texto, nunca só cor. */
export function ReferenceStatusIcon({ status, className }: { status: ReferenceStatus; className?: string }) {
  const { icon: Icon, iconClassName, label } = STATUS[status]
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", iconClassName, className)} role="img" aria-label={label}>
      <Icon className="size-4" aria-hidden />
    </span>
  )
}

export function ReferenceStatusText({ status, className }: { status: ReferenceStatus; className?: string }) {
  return <span className={cn("text-[11px] font-medium", STATUS[status].className, className)}>{STATUS[status].label}</span>
}
