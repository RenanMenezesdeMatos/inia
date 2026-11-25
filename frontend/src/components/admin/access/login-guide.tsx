"use client"

import { useState } from "react"
import { Check, Copy, KeyRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { LoginGuide } from "@/schemas/access/access.schema"

/** O que a INIA confere no AD, quando ajuda a entender (login diferente do digitado, ou ainda não se sabe). */
export function directoryNote(guide: LoginGuide): string | null {
  if (guide.kind === "EMAIL" || guide.directoryLogins.length === 0) return null
  if (guide.directoryLogins.length > 1) return `No AD pode ser ${guide.directoryLogins.join(" ou ")}: a INIA descobre no primeiro acesso.`
  return guide.directoryLogins[0] === guide.typed ? null : `No AD o login é ${guide.directoryLogins[0]}: a INIA usa sozinha, a pessoa não digita.`
}

/** Frase pronta para orientar a pessoa. */
export const loginInstruction = (guide: LoginGuide) => (guide.kind === "EMAIL" ? `Login: ${guide.typed} (e-mail) e senha da INIA` : `Login: ${guide.typed} e a senha do Windows`)

/** QUAL LOGIN USAR — sinalização para quem administra acessos, com botão de copiar a orientação. */
export function LoginGuideLine({ guide, personName }: { guide: LoginGuide; personName: string }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const note = directoryNote(guide)
  async function copy() {
    try {
      await navigator.clipboard.writeText(loginInstruction(guide))
      setCopyFailed(false)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Sem área de transferência (http fora do localhost): avisa; o login está escrito na linha.
      setCopied(false)
      setCopyFailed(true)
    }
  }
  return (
    <div className="space-y-0.5" data-testid="login-guide">
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
        <KeyRound className="size-3.5 text-primary" aria-hidden />
        <span className="text-muted-foreground">Login na INIA:</span>
        <span className="inline-flex min-w-0 items-center gap-0.5">
          <span className="font-mono font-semibold break-all">{guide.typed}</span>
          <Button type="button" size="icon-xs" variant="ghost" onClick={() => void copy()} aria-label={`Copiar o login de ${personName}`}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}</Button>
        </span>
        <span className="text-muted-foreground">{guide.kind === "EMAIL" ? "+ senha da INIA" : "+ senha do Windows"}</span>
        {copyFailed ? <span role="status" className="text-muted-foreground">O navegador não deixou copiar: copie o texto da linha.</span> : null}
      </p>
      {note ? <p className="pl-5 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  )
}
