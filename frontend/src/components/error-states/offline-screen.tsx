"use client"

import { useCallback, useEffect, useState } from "react"

import { ErrorScreen } from "@/components/error-states/error-screen"
import { CLIENT_ERROR_CODES, newReference } from "@/lib/errors/client-error-codes"
import { FAILURE_COPY, publicRoute, type Failure } from "@/lib/errors/failure"
import { flushPendingClientFailures, reportClientFailure } from "@/lib/errors/report-client-failure"

/**
 * SEM CONEXÃO com o app aberto: o navegador avisa (`offline`) e a INIA cobre a tela com o aviso — por CIMA da página, que continua
 * montada (o que foi digitado não se perde). Cada queda é uma ocorrência nova (referência local, arte alternada); a tela fica
 * igual enquanto aberta. "Tentar novamente" confere a rede de verdade (healthz da interface) antes de liberar; ao voltar sozinha
 * (`online`), a tela some e a ocorrência guardada é enviada ao servidor.
 *
 * Abertura a frio sem rede NÃO passa por aqui: a INIA não tem service worker (estratégia de cache = só estáticos com `?v`), então
 * o navegador mostra a página de "sem internet" dele. Ver docs/operacao/inventario-de-falhas.md.
 */
async function networkIsBack(): Promise<boolean> {
  if (navigator.onLine === false) return false
  try {
    const response = await fetch(`/healthz?t=${Date.now()}`, { cache: "no-store" })
    return response.ok
  } catch {
    return false
  }
}

export function OfflineMonitor() {
  const [failure, setFailure] = useState<Failure | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    // Ao abrir o app: o que ficou na fila de uma queda anterior é enviado.
    void flushPendingClientFailures()
    const goOffline = () => {
      // Ocorrência criada no EVENTO (não no render): uma por queda, nunca duas pelo render duplo do StrictMode.
      const occurrence: Failure = { kind: "offline", status: null, code: CLIENT_ERROR_CODES.offline, reference: newReference("web-"), referenceScope: "local", occurredAt: new Date().toISOString(), needsReport: true }
      setFailure((current) => current ?? occurrence)
      void reportClientFailure(occurrence, { route: publicRoute(window.location.pathname) })
    }
    const goOnline = () => {
      setFailure(null)
      void flushPendingClientFailures()
    }
    if (navigator.onLine === false) goOffline()
    window.addEventListener("offline", goOffline)
    window.addEventListener("online", goOnline)
    return () => {
      window.removeEventListener("offline", goOffline)
      window.removeEventListener("online", goOnline)
    }
  }, [])

  const retry = useCallback(async () => {
    setChecking(true)
    const back = await networkIsBack()
    setChecking(false)
    if (back) {
      setFailure(null)
      void flushPendingClientFailures()
    }
  }, [])

  if (!failure) return null
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-canvas" data-offline-overlay>
      <ErrorScreen key={failure.reference} failure={failure} action={{ label: checking ? "Conferindo a conexão…" : FAILURE_COPY.offline.actionLabel, onClick: () => void retry() }} />
    </div>
  )
}
