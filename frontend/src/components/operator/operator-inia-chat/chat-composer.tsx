"use client"

import type { Ref } from "react"
import { ArrowUp, Mic, Square, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AvatarConversationState } from "@/lib/avatar/animation/types"
import type { ConversationSummary } from "@/lib/realtime/gemini-text-client"
import { cn } from "@/lib/utils"
import { MIC_GLOW_REST_STYLE, MIC_PULSE_REST_STYLE } from "./mic-level"
import { VoiceWaveform } from "./chat-visuals"

type ChatComposerProps = {
  sessionOpen: boolean
  readOnlyConversation: ConversationSummary | null
  feedbackCompleted: boolean
  composerRef: React.RefObject<HTMLDivElement | null>
  micOpen: boolean
  waveformBarRefs: React.RefObject<(HTMLSpanElement | null)[]>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  question: string
  setQuestion: React.Dispatch<React.SetStateAction<string>>
  textReplyPending: boolean
  conversationState: AvatarConversationState
  send: (override?: string) => Promise<void>
  composerLocked: boolean
  callActive: boolean
  toggleVoiceMuted: () => void
  voiceMuted: boolean
  handleMicClick: () => void
  micDisabled: boolean
  micLabel: string
  micPulseRef: Ref<HTMLSpanElement>
  voiceError: string
}

/**
 * Campo de mensagem com microfone, envio e (na sessão de feedback) o botão de silenciar a INIA. O pulso do microfone e as barras
 * da onda são pintados direto no DOM pelo chat (`micPulseRef`, `waveformBarRefs`) — nunca por estado.
 */
export function ChatComposer({ sessionOpen, readOnlyConversation, feedbackCompleted, composerRef, micOpen, waveformBarRefs, textareaRef, question, setQuestion, textReplyPending, conversationState, send, composerLocked, callActive, toggleVoiceMuted, voiceMuted, handleMicClick, micDisabled, micLabel, micPulseRef, voiceError }: ChatComposerProps) {
  const composerPlaceholder = readOnlyConversation
    ? "Conversa encerrada — volte à atual ou inicie uma nova"
    : sessionOpen
      ? feedbackCompleted ? "Tire uma dúvida sobre este feedback…" : "Converse com a INIA sobre este feedback…"
      : "Pergunte algo para a INIA..."
  return <div className={sessionOpen ? "px-4 py-3 sm:px-5" : "p-3"}>
    <div ref={composerRef} className="flex items-end gap-1 rounded-2xl bg-muted p-1 transition-shadow duration-150" style={micOpen ? MIC_GLOW_REST_STYLE : undefined}>
      {micOpen ? <VoiceWaveform barRefs={waveformBarRefs}/> : (
        <Textarea
          ref={textareaRef}
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value)
            const el = event.target
            el.style.height = "auto"
            el.style.height = `${Math.min(el.scrollHeight, 128)}px`
          }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!textReplyPending && conversationState !== "thinking") void send() } }}
          placeholder={composerPlaceholder}
          aria-label={composerPlaceholder}
          disabled={composerLocked}
          rows={1}
          className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none focus-visible:ring-0"
        />
      )}
      <div className="flex shrink-0 items-center gap-1 pb-0.5">
        {callActive && sessionOpen ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="icon-sm" variant="ghost" onClick={toggleVoiceMuted} aria-pressed={voiceMuted} aria-label={voiceMuted ? "Ativar a voz da INIA" : "Silenciar a INIA"} className={cn("rounded-full", voiceMuted && "text-muted-foreground")} data-testid="inia-voice-mute">
                {voiceMuted ? <VolumeX/> : <Volume2/>}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="inia-tooltip-genie">{voiceMuted ? "Ativar a voz da INIA" : "Silenciar a INIA (ela responde só por escrito)"}</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" size="icon-sm" variant={micOpen ? "default" : "ghost"} onClick={handleMicClick} disabled={micDisabled} aria-label={micLabel} className="relative rounded-full">
              {micOpen ? <span ref={micPulseRef} aria-hidden className="absolute inset-0 -z-10 rounded-full bg-primary/50" style={MIC_PULSE_REST_STYLE}/> : null}
              {micOpen ? <Square className="size-3 fill-current"/> : <Mic/>}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="inia-tooltip-genie">{micLabel}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" disabled={!question.trim() || textReplyPending || conversationState === "thinking" || composerLocked} onClick={() => void send()} aria-label="Enviar mensagem" className="shrink-0 rounded-full" data-usage-element="chat.send"><ArrowUp/></Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="inia-tooltip-genie">Enviar mensagem</TooltipContent>
        </Tooltip>
      </div>
    </div>
    {micOpen && sessionOpen ? <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] font-medium text-destructive" role="status"><span className="size-1.5 animate-pulse rounded-full bg-destructive motion-reduce:animate-none" aria-hidden/>Microfone ativo — toque no quadrado para enviar</p> : null}
    {voiceError ? <p className="mt-1.5 text-center text-[11px] text-destructive">{voiceError}</p> : null}
    <p className="mt-1.5 text-center text-[11px] text-muted-foreground" data-testid={sessionOpen && feedbackCompleted ? "feedback-followup-hint" : undefined}>
      {sessionOpen && feedbackCompleted ? "Suas dúvidas ficam registradas à parte: não reabrem a aplicação nem contam como ciência." : "A INIA pode cometer erros. Confirme orientações críticas."}
    </p>
  </div>
}
