"use client"

import { useState, useSyncExternalStore } from "react"

import { ErrorScreen } from "@/components/error-states/error-screen"
import { RouteErrorBoundary } from "@/components/error-states/route-error-boundary"
import { ApiError } from "@/lib/api/api-client"
import { CLIENT_ERROR_CODES, newReference } from "@/lib/errors/client-error-codes"
import { describeFailure } from "@/lib/errors/failure"

const STATES = ["400", "401", "403", "404", "500", "offline", "proxy"] as const

/** Erro sintético por estado — o mesmo tipo que a tela recebe de verdade (ApiError da API, falha de rede, exceção de render). */
function errorFor(state: string): Error {
  const reference = newReference()
  switch (state) {
    case "400": return new ApiError("Dados inválidos.", 400, "VALIDATION_ERROR", undefined, { reference })
    case "401": return new ApiError("Sessão ausente ou expirada.", 401, "UNAUTHENTICATED", undefined, { reference })
    case "403": return new ApiError("Você não tem permissão para este recurso.", 403, "FORBIDDEN", undefined, { reference })
    case "404": return new ApiError("Recurso não encontrado.", 404, "NOT_FOUND", undefined, { reference })
    case "offline": return new ApiError("Sem conexão com a internet.", 0, CLIENT_ERROR_CODES.offline, undefined, { reference: `web-${reference}`, referenceScope: "local" })
    case "proxy": return new ApiError("A INIA está temporariamente indisponível.", 502, CLIENT_ERROR_CODES.proxyUnavailable, undefined, { reference, referenceScope: "proxy" })
    default: return new Error("Falha de renderização provocada pela galeria de estados de erro")
  }
}

const noSubscription = () => () => {}

export function ErrorStatesPreview({ state }: { state: string | null }) {
  // Só no navegador: cada abertura gera uma referência nova (nunca uma no HTML do servidor e outra na hidratação).
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false)
  return mounted ? <PreviewBody state={state} /> : null
}

function PreviewBody({ state }: { state: string | null }) {
  const [error] = useState(() => (state ? errorFor(state) : null))
  const [retries, setRetries] = useState(0)
  if (state && error) {
    return (
      <main className="min-h-screen bg-canvas text-foreground" data-retries={retries}>
        <RouteErrorBoundary key={retries} error={error} retry={() => setRetries((count) => count + 1)} />
      </main>
    )
  }
  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-6 bg-canvas p-4 text-foreground sm:p-8">
      <h1 className="text-2xl font-semibold">Estados de erro (contextuais)</h1>
      <nav className="flex flex-wrap gap-2 text-sm">
        {STATES.map((item) => (
          <a key={item} className="rounded-full border border-border px-3 py-1" href={`?estado=${item}`}>
            {item} em tela cheia
          </a>
        ))}
      </nav>
      {STATES.filter((item) => item !== "proxy").map((item) => (
        <ErrorScreen key={item} variant="contextual" failure={{ ...describeFailure(errorFor(item)), needsReport: false }} action={{ label: "Ação", onClick: () => {} }} />
      ))}
    </main>
  )
}
