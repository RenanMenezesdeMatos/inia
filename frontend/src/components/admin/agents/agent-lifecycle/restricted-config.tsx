"use client"

import type { ReactNode } from "react"
import { Lock } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Rascunho, versão, execução ou alteração de um alcance que quem lê não alcança: o servidor manda só número, situação, datas e
 * autor (`restricted`). A tela diz isso no lugar dos campos — nunca campos vazios — e as ações que o servidor recusaria ficam
 * indisponíveis, com o motivo.
 */
export const RESTRICTED_CONFIG_LABEL = "Configuração de um alcance fora do seu escopo"

export const RESTRICTED_DRAFT_REASON = "O rascunho em andamento é de um alcance fora do seu escopo: só quem administra esse alcance pode salvá-lo, publicá-lo, testá-lo ou descartá-lo."
export const RESTRICTED_VERSION_REASON = "Esta versão é de um alcance fora do seu escopo: só quem administra esse alcance pode testá-la ou revertê-la."
export const RESTRICTED_DRAFT_REVERT_REASON = "Reverter descartaria o rascunho em andamento, que é de um alcance fora do seu escopo."

export function RestrictedConfigNotice({ detail, className }: { detail?: string; className?: string }) {
  return (
    <p data-testid="restricted-config" className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)}>
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {RESTRICTED_CONFIG_LABEL}
        {detail ? `: ${detail}` : "."}
      </span>
    </p>
  )
}

/** Ação indisponível com o motivo no tooltip (o botão desabilitado não recebe foco; o invólucro recebe). */
export function UnavailableAction({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{children}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{reason}</TooltipContent>
    </Tooltip>
  )
}
