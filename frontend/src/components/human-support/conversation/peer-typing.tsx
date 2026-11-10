"use client"

import type { ReactNode } from "react"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageAvatar, MessageContent, MessageFooter } from "@/components/ui/message"
import { TypingDots } from "@/components/ui/typing-dots"
import { useExpiringFlag } from "./use-expiring-flag"

/**
 * "FULANO ESTÁ DIGITANDO…" no lugar da próxima mensagem da outra pessoa: balão com os três pontos e o texto embaixo. Some sozinho
 * quando o prazo do aviso acaba (`typingMs`, contado a partir de cada resposta do estado — `stamp`) ou quando a próxima resposta
 * diz que parou (a mensagem dela chegou, ou ela apagou o que escrevia).
 */
export function PeerTyping({ name, typingMs, stamp, avatar }: { name: string; typingMs: number | null; stamp: unknown; avatar?: ReactNode }) {
  const visible = useExpiringFlag(typingMs, stamp)
  if (!visible) return null
  return (
    <Message align="start" data-testid="peer-typing">
      {avatar ? <MessageAvatar>{avatar}</MessageAvatar> : null}
      <MessageContent>
        <Bubble variant="outline">
          <BubbleContent className="flex h-9 items-center border-border bg-card px-3.5 text-muted-foreground">
            <TypingDots />
          </BubbleContent>
        </Bubble>
        <MessageFooter role="status" className="px-1 font-normal">
          {name} está digitando…
        </MessageFooter>
      </MessageContent>
    </Message>
  )
}
