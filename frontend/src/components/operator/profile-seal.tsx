"use client"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type SealLevel = "default" | "bronze" | "silver" | "gold"

export const sealLevelPriority: Record<SealLevel, number> = { default: 0, bronze: 1, silver: 2, gold: 3 }
const sealLevelLabel: Record<SealLevel, string> = { default: "Padrão", bronze: "Bronze", silver: "Prata", gold: "Ouro" }
const sealLevelStyles: Record<SealLevel, string> = {
  default: "bg-muted text-primary",
  bronze: "bg-[#a65f2d]/15 text-[#a65f2d] ring-1 ring-[#a65f2d]/35",
  silver: "bg-slate-300/35 text-slate-600 ring-1 ring-slate-400/60 shadow-sm dark:text-slate-200",
  gold: "inia-seal-gold border-2 border-amber-400 bg-amber-300/30 text-amber-600 dark:border-amber-300 dark:text-amber-300",
}

export function ProfileSeal({ icon, label, level, count }: { icon: React.ReactNode; label: string; level: SealLevel; count?: number }) {
  const accessibleLabel = `${label} · ${sealLevelLabel[level]}${count ? ` · ${count}` : ""}`
  return <Tooltip><TooltipTrigger asChild><span tabIndex={0} aria-label={accessibleLabel} className={cn("relative flex size-9 shrink-0 items-center justify-center rounded-full outline-none transition-all hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 lg:size-10", sealLevelStyles[level])}>{icon}{count ? <span className="absolute -bottom-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-4 text-primary-foreground ring-2 ring-card">{count}</span> : null}</span></TooltipTrigger><TooltipContent className="inia-tooltip-genie">{accessibleLabel}</TooltipContent></Tooltip>
}
