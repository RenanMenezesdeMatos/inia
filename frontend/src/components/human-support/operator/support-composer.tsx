"use client"

import { useState } from "react"
import { SendHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { HUMAN_SUPPORT_TEXT_LIMITS } from "@/schemas/human-support/catalogs.schema"

/**
 * CAMPO DA SALA DE APOIO: texto, sem microfone (a conversa com o Anjo nunca passa pela voz nem pela INIA). Enter envia, Shift+Enter
 * quebra a linha. Falha ao enviar: o texto fica no campo e o erro aparece. `onInput` recebe cada mudança do texto (o "digitando"
 * que o Anjo vê; o texto em si nunca sai daqui antes do envio).
 */
export function SupportComposer({ placeholder, hint, disabled, onSend, onInput }: { placeholder: string; hint?: string | null; disabled?: boolean; onSend: (body: string) => Promise<void>; onInput?: (text: string) => void }) {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const body = text.trim()
  const send = async () => {
    if (!body || sending || disabled) return
    setSending(true)
    setError(null)
    try {
      await onSend(body)
      setText("")
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível enviar. Sua mensagem continua aqui.")
    } finally {
      setSending(false)
    }
  }
  return (
    <form
      className="space-y-1 px-4 pt-3 pb-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <div className="flex items-end gap-2">
        <Textarea
          aria-label={placeholder}
          placeholder={placeholder}
          value={text}
          rows={2}
          maxLength={HUMAN_SUPPORT_TEXT_LIMITS.message}
          disabled={disabled}
          className="min-h-11 resize-none rounded-xl"
          onChange={(event) => {
            setText(event.target.value)
            onInput?.(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <Button type="submit" size="icon" className="size-11 shrink-0 rounded-full" aria-label="Enviar mensagem para o Anjo" disabled={!body || sending || disabled}>
          <SendHorizontal />
        </Button>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </form>
  )
}
