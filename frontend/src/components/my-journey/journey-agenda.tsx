"use client"

import { Check, ClipboardList, Coffee, LogIn, LogOut, Moon, Undo2, type LucideIcon } from "lucide-react"

import { StatusChip, SURFACE_CARD } from "@/components/ui/surface"
import { cn } from "@/lib/utils"
import type { JourneyBlock } from "@/schemas/my-journey/my-journey.schema"

import { formatDuration, minuteToClock } from "./journey-format"
import { journeyMilestones, type JourneyMilestoneKind } from "./journey-moments"

const MILESTONE_STYLE: Record<JourneyMilestoneKind, { icon: LucideIcon; dot: string }> = {
  LOGIN: { icon: LogIn, dot: "bg-primary text-primary-foreground" },
  SHIFT_START: { icon: LogIn, dot: "bg-primary/70 text-primary-foreground" },
  BREAK: { icon: Coffee, dot: "bg-amber-400 text-amber-950 dark:bg-amber-300" },
  ACTIVITY: { icon: ClipboardList, dot: "bg-sky-500 text-white" },
  RETURN: { icon: Undo2, dot: "bg-primary text-primary-foreground" },
  LOGOUT: { icon: LogOut, dot: "bg-foreground text-background" },
  SHIFT_END: { icon: LogOut, dot: "bg-foreground/80 text-background" },
  CONTINUES: { icon: Moon, dot: "bg-primary/70 text-primary-foreground" },
  OVERNIGHT: { icon: Moon, dot: "bg-foreground/80 text-background" },
}

/**
 * AGENDA DO DIA — os horários de cada mudança, sempre escritos: Login, cada pausa (com duração e hora da volta), Retorno, outras
 * atividades e Logout. Em "hoje", o que já passou fica apagado com ✓, e o próximo marco ganha o selo "Próximo · em 20 min".
 */
export function JourneyAgenda({ blocks, nowMinute }: { blocks: JourneyBlock[]; nowMinute: number | null }) {
  const milestones = journeyMilestones(blocks)
  if (milestones.length === 0) return null
  const nextIndex = nowMinute === null ? -1 : milestones.findIndex((milestone) => milestone.minute > nowMinute)
  return (
    <div className={cn(SURFACE_CARD, "p-4 sm:p-5")}>
      <ol className="relative space-y-1" aria-label="Horários do dia">
        {milestones.map((milestone, index) => {
          const style = MILESTONE_STYLE[milestone.kind]
          const Icon = style.icon
          const past = nowMinute !== null && milestone.minute <= nowMinute
          const isNext = index === nextIndex
          return (
            <li key={`${milestone.kind}-${milestone.minute}-${index}`} aria-current={isNext ? "step" : undefined} className={cn("relative flex items-start gap-3 rounded-xl px-2 py-2", isNext && "bg-primary/5 ring-1 ring-primary/30")}>
              {index < milestones.length - 1 ? <span aria-hidden className="absolute top-10 bottom-[-0.5rem] left-[4.6rem] w-px bg-border" /> : null}
              <span className={cn("w-12 shrink-0 pt-1.5 text-right text-sm font-semibold tabular-nums", past && "text-muted-foreground")}>{milestone.minute === 1440 ? "0h00" : minuteToClock(milestone.minute)}</span>
              <span className={cn("relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full", past ? "bg-muted text-muted-foreground" : style.dot)} aria-hidden>
                {past ? <Check className="size-4" /> : <Icon className="size-4" />}
              </span>
              <div className={cn("min-w-0 flex-1 pt-0.5", past && "text-muted-foreground")}>
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {milestone.title}
                  {isNext && nowMinute !== null ? <StatusChip tone="info" className="px-2 py-0.5">Próximo · em {formatDuration(milestone.minute - nowMinute)}</StatusChip> : null}
                </p>
                {milestone.detail ? <p className="text-sm text-muted-foreground">{milestone.detail}</p> : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
