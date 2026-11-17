"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SURFACE_CARD } from "@/components/ui/surface"
import { copyText } from "@/lib/clipboard/copy-text"
import { cn } from "@/lib/utils"

/**
 * PROMPT PARA COPIAR (Wiki): o texto inteiro à vista, numa caixa que rola por dentro, e "Copiar prompt". Sem permissão de área de
 * transferência, avisa para selecionar o texto à mão.
 */
export function CopyablePrompt({ text, title, description }: { text: string; title: string; description: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle")
  const copy = async () => setState((await copyText(text)) ? "ok" : "fail")
  return (
    <div className={cn(SURFACE_CARD, "space-y-3 p-4")} data-testid="copyable-prompt">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button type="button" size="sm" className="rounded-full" onClick={() => void copy()}>
          {state === "ok" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {state === "ok" ? "Copiado" : "Copiar prompt"}
        </Button>
      </div>
      <p role="status" className={cn("text-xs", state === "fail" ? "text-destructive" : "sr-only")}>
        {state === "fail" ? "Não foi possível copiar. Selecione o texto abaixo e copie com Ctrl+C (⌘+C no Mac)." : state === "ok" ? "Prompt copiado." : ""}
      </p>
      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed" tabIndex={0} aria-label={title}>
        {text}
      </pre>
    </div>
  )
}
