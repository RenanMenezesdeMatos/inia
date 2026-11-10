"use client"

import { useId, useRef, useState } from "react"
import { SendHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CharacterCounter, characterCountState } from "@/components/ui/character-counter"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api/api-client"
import { HUMAN_SUPPORT_TEXT_LIMITS } from "@/schemas/human-support/catalogs.schema"
import type { MessageView } from "@/schemas/human-support/state.schema"
import { sendSupportMessage } from "@/services/human-support/human-support-service"

/**
 * CAMPO "Mensagem para o operador" (design_draft.md seção 10). Só texto — sem microfone, sem anexo, e nada daqui passa por modelo de
 * IA. Enter envia, Shift+Enter quebra a linha. Cada envio leva uma chave de idempotência (`clientMessageId`); reenviar o MESMO texto
 * depois de uma falha reaproveita a chave (se a primeira tentativa chegou ao servidor, ele devolve a mensagem que já existe). Na
 * falha, o texto continua no campo e o erro aparece logo abaixo.
 */
export type AnjoComposerProps = {
  requestId: string
  onSent: (message: MessageView) => void
  /** O servidor recusou porque o pedido mudou (ex.: já encerrado): a área busca o estado de novo. */
  onStale?: () => void
  /** A cada mudança do texto ("digitando" para o operador; nunca o texto em si). */
  onInput?: (text: string) => void
}

const LIMITS = { min: 1, max: HUMAN_SUPPORT_TEXT_LIMITS.message }

export function AnjoComposer({ requestId, onSent, onStale, onInput }: AnjoComposerProps) {
  const id = useId()
  const [text, setText] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attemptRef = useRef<{ body: string; clientMessageId: string } | null>(null)
  const count = characterCountState(text, LIMITS)
  const canSend = !pending && !count.over && text.trim().length > 0

  const send = async () => {
    if (!canSend) return
    const body = text
    const attempt = attemptRef.current?.body === body ? attemptRef.current : { body, clientMessageId: crypto.randomUUID() }
    attemptRef.current = attempt
    setPending(true)
    setError(null)
    try {
      const message = await sendSupportMessage(requestId, { clientMessageId: attempt.clientMessageId, body })
      attemptRef.current = null
      setText((current) => (current === body ? "" : current))
      onSent(message)
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível enviar. Sua mensagem continua aqui — tente de novo.")
      if (failure instanceof ApiError && failure.status === 409) onStale?.()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-1.5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <Label htmlFor={`${id}-message`}>Mensagem para o operador</Label>
      <div className="flex items-end gap-2">
        <Textarea
          id={`${id}-message`}
          value={text}
          rows={2}
          className="max-h-40 min-h-16 flex-1 resize-y rounded-xl bg-card"
          aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`}
          aria-invalid={count.over || undefined}
          onChange={(event) => {
            setText(event.target.value)
            onInput?.(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            void send()
          }}
        />
        <Button type="submit" className="h-11 rounded-full px-5" disabled={!canSend} aria-label={pending ? "Enviando…" : "Enviar mensagem"}>
          <SendHorizontal aria-hidden />
          <span className="hidden sm:inline">{pending ? "Enviando…" : "Enviar"}</span>
        </Button>
      </div>
      <CharacterCounter id={`${id}-count`} value={text} limits={LIMITS} />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  )
}
