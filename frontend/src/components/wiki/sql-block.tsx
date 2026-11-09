"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"

const COPY_LABEL = { idle: "Copiar", copied: "Copiado", failed: "Selecionado: copie com Ctrl+C" } as const

/** Bloco de SQL da Wiki com botão de copiar. Sem acesso à área de transferência, deixa o texto selecionado para copiar à mão. */
export function SqlBlock({ code, label }: { code: string; label: string }) {
  const codeRef = useRef<HTMLElement>(null)
  const [copy, setCopy] = useState<keyof typeof COPY_LABEL>("idle")

  useEffect(() => {
    if (copy === "idle") return
    const timer = window.setTimeout(() => setCopy("idle"), 2500)
    return () => window.clearTimeout(timer)
  }, [copy])

  async function handleCopy() {
    try {
      // Quebra de linha do Windows: é onde o SQL Server Management Studio roda, e nem todo caminho até lá preserva a do Unix.
      await navigator.clipboard.writeText(code.replace(/\r?\n/g, "\r\n"))
      setCopy("copied")
    } catch {
      if (codeRef.current) window.getSelection()?.selectAllChildren(codeRef.current)
      setCopy("failed")
    }
  }

  return (
    <figure className="overflow-hidden rounded-lg border border-border">
      <figcaption className="flex items-center justify-between gap-3 border-b border-border bg-muted/50 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void handleCopy()} aria-label={`Copiar: ${label}`}>
          {copy === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {COPY_LABEL[copy]}
        </Button>
      </figcaption>
      <pre tabIndex={0} className="max-h-96 overflow-auto p-3 font-mono text-xs leading-relaxed">
        <code ref={codeRef}>{code}</code>
      </pre>
    </figure>
  )
}
