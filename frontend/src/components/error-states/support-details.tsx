"use client"

import { useEffect, useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/api-client"
import { describeFailure, publicRoute, supportDetails, type Failure } from "@/lib/errors/failure"
import { isRecorded, onRecorded, reportClientFailure } from "@/lib/errors/report-client-failure"
import { cn } from "@/lib/utils"

/**
 * Código + referência + "Copiar detalhes para suporte" — a mesma faixa na tela de erro inteira e nos erros CONTEXTUAIS (painel,
 * lista, formulário), onde o resto da tela e o que foi digitado continuam. O texto copiado tem só código, referência, horário e
 * contexto público (rota sem parâmetros, versão).
 */
export function referenceNote(failure: Failure, recorded: boolean): string {
  if (failure.referenceScope === "server") return "registrada no servidor"
  if (failure.referenceScope === "interface") return "registrada no servidor da interface"
  if (recorded) return "registrada no servidor"
  if (failure.referenceScope === "proxy") return "procurar no registro do servidor de acesso (IIS)"
  return "local — ainda não enviada ao servidor"
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Sem permissão de área de transferência (HTTP, navegador antigo): seleção manual por um campo temporário.
    try {
      const field = document.createElement("textarea")
      field.value = text
      field.setAttribute("readonly", "")
      field.style.position = "fixed"
      field.style.opacity = "0"
      document.body.appendChild(field)
      field.select()
      const ok = document.execCommand("copy")
      field.remove()
      return ok
    } catch {
      return false
    }
  }
}


export function SupportDetails({ failure, recorded, release, askAdministrator = false, className }: { failure: Failure; recorded: boolean; release: string | null; askAdministrator?: boolean; className?: string }) {
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle")
  const handleCopy = async () => {
    const route = typeof window === "undefined" ? "/" : publicRoute(window.location.pathname)
    setCopied((await copyText(supportDetails(failure, { route, release, recorded }))) ? "ok" : "fail")
  }
  return (
    <div className={cn("mt-2 space-y-2 rounded-xl border border-border bg-muted/40 p-3 text-left text-xs", className)} data-support-details>
      {askAdministrator ? <p className="text-sm font-medium text-foreground">Procure o administrador e informe o código e a referência abaixo.</p> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {failure.code ? (
          <>
            <dt className="text-muted-foreground">Código</dt>
            <dd className="break-all font-mono text-foreground">{failure.code}</dd>
          </>
        ) : null}
        {failure.reference ? (
          <>
            <dt className="text-muted-foreground">Referência</dt>
            <dd className="font-mono text-foreground">
              <span className="break-all">{failure.reference}</span>
              <span className="block font-sans text-muted-foreground" data-reference-scope={recorded && failure.referenceScope !== "server" ? "recorded" : failure.referenceScope}>
                {referenceNote(failure, recorded)}
              </span>
            </dd>
          </>
        ) : null}
      </dl>
      <Button type="button" size="sm" variant="outline" onClick={() => void handleCopy()} aria-live="polite">
        {copied === "ok" ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied === "ok" ? "Detalhes copiados" : copied === "fail" ? "Não foi possível copiar — selecione o texto acima" : "Copiar detalhes para suporte"}
      </Button>
    </div>
  )
}

/**
 * Faixa de suporte a partir de um erro qualquer de consulta/envio (contextual). Mostra só quando há código ou referência; falha
 * nascida no navegador (rede, proxy) é registrada no servidor e a faixa passa a dizer "registrada" quando a API confirma.
 */
export function FailureSupport({ error, className }: { error: unknown; className?: string }) {
  const [failure] = useState(() => describeFailure(error))
  const [recorded, setRecorded] = useState(() => isRecorded(failure.reference))
  useEffect(() => {
    if (!failure.needsReport || !(error instanceof ApiError)) return
    void reportClientFailure(failure, { route: publicRoute(window.location.pathname) }).then((outcome) => setRecorded(outcome === "recorded"))
    return onRecorded((reference) => {
      if (reference === failure.reference) setRecorded(true)
    })
  }, [error, failure])
  if (!(error instanceof ApiError) || (!failure.code && !failure.reference)) return null
  const askAdministrator = failure.kind === "500" || failure.kind === "403"
  return <SupportDetails failure={failure} recorded={recorded} release={error.release} askAdministrator={askAdministrator} className={className} />
}
