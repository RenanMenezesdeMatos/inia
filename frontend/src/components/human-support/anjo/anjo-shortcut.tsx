"use client"

import Link from "next/link"
import { HeartHandshake } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAnjoWorkspace, type AnjoAttention } from "@/queries/human-support/anjo-workspace-provider"

/** O que o atalho diz (nome acessível e dica): atendimentos, mensagens novas e atendimento sem resposta. */
export function anjoShortcutLabel(attention: AnjoAttention): string {
  const parts = [
    attention.attendances > 0 ? (attention.attendances === 1 ? "1 atendimento em andamento" : `${attention.attendances} atendimentos em andamento`) : null,
    attention.unread > 0 ? (attention.unread === 1 ? "1 mensagem nova" : `${attention.unread} mensagens novas`) : null,
    attention.awaitingResponse ? "atendimento sem resposta" : null,
  ].filter(Boolean)
  return parts.length > 0 ? `Área do Anjo — ${parts.join(", ")}` : "Área do Anjo"
}

/**
 * Atalho da área do Anjo no cabeçalho (só para quem tem o papel Anjo): leva à aba "Apoio" do perfil e, fora dela, mostra o que pede
 * atenção — o número de mensagens novas do operador ou, sem mensagem nova, um ponto quando há atendimento sem resposta. Com a área na
 * tela, ele some (o número já está nas abas dela). Os números vêm do servidor, pelo provedor do shell.
 */
export function AnjoShortcut({ profileHref }: { profileHref: string }) {
  const { available, areaVisible, attention } = useAnjoWorkspace()
  if (!available || areaVisible) return null
  const label = anjoShortcutLabel(attention)
  const dot = attention.unread === 0 && attention.awaitingResponse
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="secondary" size="icon" className="relative h-10 w-10 rounded-full border border-topbar-foreground/25 bg-topbar-foreground/10 text-topbar-foreground hover:bg-topbar-foreground/20 focus-visible:ring-topbar-foreground/60" aria-label={label}>
          <Link href={`${profileHref}?tab=apoio`} data-testid="anjo-shortcut">
            <HeartHandshake className="h-5 w-5" aria-hidden />
            {attention.unread > 0 ? (
              <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white" aria-hidden data-testid="anjo-shortcut-count">
                {attention.unread > 99 ? "99+" : attention.unread}
              </span>
            ) : dot ? (
              <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-red-500 ring-2 ring-topbar" aria-hidden data-testid="anjo-shortcut-dot" />
            ) : null}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="inia-tooltip-genie">{label}</TooltipContent>
    </Tooltip>
  )
}
