"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy, KeyRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDateTime } from "@/lib/format/date"
import type { IssuedTemporaryPassword } from "@/schemas/access/access.schema"

/**
 * A senha temporária aparece AQUI, uma única vez: o backend só guarda o hash e nenhuma tela consegue mostrá-la de novo (só
 * gerando outra). Fechar descarta o valor. Clique fora não fecha (seria fácil perder a senha sem querer); Esc e "Concluído" sim.
 */
export function TemporaryPasswordDialog({ issued, onClose }: { issued: IssuedTemporaryPassword | null; onClose: () => void }) {
  return (
    <Dialog open={issued !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent onInteractOutside={(event) => event.preventDefault()}>
        {issued ? <IssuedPassword key={`${issued.accountId}:${issued.expiresAt}`} issued={issued} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function IssuedPassword({ issued, onClose }: { issued: IssuedTemporaryPassword; onClose: () => void }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle")
  const fieldRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (copy !== "copied") return
    const timer = window.setTimeout(() => setCopy("idle"), 2500)
    return () => window.clearTimeout(timer)
  }, [copy])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(issued.temporaryPassword)
      setCopy("copied")
    } catch {
      // Sem acesso à área de transferência (ex.: http fora do localhost): deixa a senha selecionada para copiar à mão.
      fieldRef.current?.select()
      setCopy("failed")
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><KeyRound className="size-4 text-primary" aria-hidden />Senha temporária de {issued.name}</DialogTitle>
        <DialogDescription>Entregue a senha à pessoa por um canal seguro. Por segurança, ela não será exibida de novo.</DialogDescription>
      </DialogHeader>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Login</dt>
          <dd className="font-medium">{issued.email}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Senha temporária</dt>
          <dd className="mt-1 flex items-center gap-2">
            <input
              ref={fieldRef}
              readOnly
              value={issued.temporaryPassword}
              aria-label="Senha temporária"
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border bg-muted/40 px-3 py-2 font-mono text-lg tracking-wider outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <Button type="button" variant="outline" onClick={() => void handleCopy()} aria-label="Copiar senha temporária">
              {copy === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copy === "copied" ? "Copiada" : "Copiar"}
            </Button>
          </dd>
          <p className="mt-1 text-xs" role="status" aria-live="polite">
            {copy === "copied" ? <span className="text-primary">Senha copiada para a área de transferência.</span> : copy === "failed" ? <span className="text-destructive">Não foi possível copiar automaticamente — a senha está selecionada para você copiar.</span> : null}
          </p>
        </div>
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Válida até <time dateTime={issued.expiresAt}>{formatDateTime(issued.expiresAt)}</time>. No primeiro acesso, a pessoa vai precisar criar a própria senha.
        </p>
      </dl>
      <DialogFooter>
        <Button type="button" onClick={onClose}>Concluído</Button>
      </DialogFooter>
    </>
  )
}
