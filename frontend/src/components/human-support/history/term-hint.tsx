"use client"

import { Info } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * O QUE CADA TERMO SIGNIFICA (ícone ⓘ com dica; regras do responsável em 2026-11-11). Uma só fonte para o painel e a área do Anjo:
 * Indisponível é o MESMO estado que offline; fazer login ou abrir a área não deixa o Anjo Disponível; Dia produtivo explica o que entra.
 */
export const TERM_HINTS = {
  online: "Tempo em serviço: Disponível + Em atendimento + Em pausa. Indisponível (o mesmo que offline) não conta. É a base de todos os percentuais.",
  available:
    "Pronto para receber acionamentos, com a área do Anjo aberta — inclui a espera entre um atendimento e outro. Só fica Disponível quem escolhe Disponível na área do Anjo: fazer login ou abrir a área não basta.",
  attendance: "Com ao menos um atendimento em andamento, do acolhimento ao encerramento. Atendimentos ao mesmo tempo contam uma vez.",
  unavailable:
    "Indisponível é o mesmo que offline: o Anjo escolheu Indisponível, fechou a área, perdeu a conexão ou a sessão terminou. Não recebe acionamentos e fica fora do tempo online. Entrar de novo não o deixa Disponível: ele precisa escolher Disponível na área do Anjo.",
  productive: "Disponível aguardando + Em atendimento, divididos pelo tempo online. A pausa conta no tempo online, mas não no produtivo; Indisponível não entra em nenhum dos dois.",
  handling: "Tempo médio de atendimento: do acolhimento (o Anjo recebe o atendimento) até o encerramento, nos atendimentos encerrados.",
  welcome: "Tempo médio de acolhimento: depois de receber o atendimento, quanto o Anjo leva para dar a primeira resposta ao operador. A atribuição é direta, sem oferta para aceitar.",
  wait: "Espera do operador: da entrada na fila até um Anjo assumir. Pedido devolvido à fila conta desde a primeira entrada.",
} as const
export type Term = keyof typeof TERM_HINTS

export function TermHint({ term, label, className }: { term: Term; label: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`O que é ${label}`}
          className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50", className)}
          onClick={(event) => event.stopPropagation()}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs leading-snug">{TERM_HINTS[term]}</TooltipContent>
    </Tooltip>
  )
}

/** Rótulo com o ⓘ ao lado. */
export function TermLabel({ term, children, className }: { term: Term; children: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {children}
      <TermHint term={term} label={children} />
    </span>
  )
}
