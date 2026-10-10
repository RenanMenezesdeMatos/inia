"use client"

import { useState } from "react"
import { Bot } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageAvatar, MessageContent, MessageHeader } from "@/components/ui/message"
import { RichContent } from "@/components/rich-content/rich-content"
import { WAVEFORM_BAR_COUNT } from "./mic-level"

/** Apresentação longa na conversa da sessão: o feedback inteiro já está ao lado — aqui, recolhida até pedir. */
export function PresentationText({ text, compact }: { text: string; compact: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (!compact) return <RichContent text={text}/>
  // Recolhida: só a abertura (saudação + período) — o feedback já está escrito logo acima, na mesma coluna.
  const opening = text.split(/\n\s*\n/)[0] ?? text
  return <div>
    <RichContent text={expanded ? text : opening}/>
    <button type="button" className="mt-1 text-xs font-medium text-primary underline-offset-2 hover:underline dark:text-chart-4" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Recolher apresentação" : "Ler apresentação completa"}</button>
  </div>
}

// Bars are written to directly (`barRefs`), bypassing React state entirely.
// At ~19 level updates/second, running each through setState re-rendered
// the whole component that often — visibly janky, not the fluid waveform
// this was supposed to be. A CSS transition smooths each direct DOM write
// into fluid motion without React in the loop at all.
export function VoiceWaveform({ barRefs }: { barRefs: React.RefObject<(HTMLSpanElement | null)[]> }) {
  return (
    <div className="flex h-9 flex-1 items-center justify-center gap-[3px]" aria-hidden>
      {Array.from({ length: WAVEFORM_BAR_COUNT }).map((_, index) => (
        <span key={index} ref={(element) => { barRefs.current[index] = element }} className="w-[3px] shrink-0 rounded-full bg-primary transition-[height] duration-75 ease-out" style={{ height: "4px" }}/>
      ))}
    </div>
  )
}

export function TypingBubble({ align, name, avatarSrc, muted, children }: { align: "start" | "end"; name: string; avatarSrc?: string; muted: boolean; children: React.ReactNode }) {
  return <Message align={align}>
    <MessageAvatar><Avatar className="size-8">{avatarSrc ? <AvatarImage src={avatarSrc} alt={name}/> : null}<AvatarFallback className={muted ? "bg-primary text-primary-foreground" : "bg-secondary"}>{muted ? <Bot className="size-4"/> : name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</AvatarFallback></Avatar></MessageAvatar>
    <MessageContent className="max-w-[88%]">
      <MessageHeader className="px-1">{name}</MessageHeader>
      <Bubble variant={muted ? "muted" : "default"} className="max-w-full"><BubbleContent className="px-4 py-3">{children}</BubbleContent></Bubble>
    </MessageContent>
  </Message>
}

/** Separador da conversa COMPLEMENTAR: o colaborador está esclarecendo um feedback já recebido (a aplicação não muda). */
export function FollowUpSeparator({ hint = false }: { hint?: boolean }) {
  return <div role="separator" aria-label="Dúvidas após a conclusão" className="space-y-1 pt-2" data-testid="feedback-followup-separator">
    <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      <span className="h-px flex-1 bg-border" aria-hidden/>Dúvidas após a conclusão<span className="h-px flex-1 bg-border" aria-hidden/>
    </div>
    {hint ? <p className="text-center text-xs text-muted-foreground">A aplicação acima está concluída. Se tiver uma dúvida sobre este feedback, pergunte abaixo.</p> : null}
  </div>
}
