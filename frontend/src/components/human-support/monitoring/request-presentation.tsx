"use client"

import { HandHelping, Sparkles, ThumbsDown, type LucideIcon } from "lucide-react"

import { PersonAvatar } from "@/components/profile/person-avatar"
import { cn } from "@/lib/utils"
import { REQUEST_ORIGIN_LABELS, REQUEST_STATUS_LABELS, type RequestOrigin, type RequestStatus } from "@/schemas/human-support/catalogs.schema"

/**
 * Apresentação comum da lista e da leitura de um pedido no painel do apoio, no mesmo formato de "Conversas com a INIA": de onde o
 * pedido veio (com o ícone), o estado com um ponto de cor e a foto do operador. Só formata o que veio do servidor.
 */
const ORIGIN_ICONS: Record<RequestOrigin, LucideIcon> = { BUTTON: HandHelping, DISLIKE: ThumbsDown, SIGNAL: Sparkles }

export const requestOriginOf = (origin: RequestOrigin): { label: string; icon: LucideIcon } => ({ label: REQUEST_ORIGIN_LABELS[origin], icon: ORIGIN_ICONS[origin] })

export const messagesLabel = (count: number) => `${count.toLocaleString("pt-BR")} ${count === 1 ? "mensagem" : "mensagens"}`

export function OperatorAvatar({ name, avatarUrl, className }: { name: string; avatarUrl: string | null; className?: string }) {
  return <PersonAvatar name={name} avatarUrl={avatarUrl} className={cn("size-9", className)} fallbackClassName="bg-secondary text-xs" />
}

/** Estado com um ponto de cor (em atendimento = verde, na fila = âmbar, os demais = neutro) e o rótulo escrito ao lado. */
export function RequestStatusLabel({ status, className }: { status: RequestStatus; className?: string }) {
  const live = status === "IN_PROGRESS"
  const waiting = status === "WAITING"
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", live || waiting ? "font-medium text-foreground" : "text-muted-foreground", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", live ? "bg-emerald-500" : waiting ? "bg-amber-500" : "bg-muted-foreground/40")} aria-hidden />
      {REQUEST_STATUS_LABELS[status]}
    </span>
  )
}
