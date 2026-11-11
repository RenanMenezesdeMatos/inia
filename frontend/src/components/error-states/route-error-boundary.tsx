"use client"

import { useEffect, useMemo, useState } from "react"

import { ErrorScreen, type ErrorScreenAction } from "@/components/error-states/error-screen"
import { ApiError } from "@/lib/api/api-client"
import { loginWithReturn } from "@/lib/auth/safe-return"
import { describeFailure, FAILURE_COPY, publicRoute, type Failure } from "@/lib/errors/failure"
import { reportClientFailure } from "@/lib/errors/report-client-failure"

/**
 * Conteúdo das fronteiras de erro (`app/error.tsx`, `app/(app)/error.tsx`, `app/global-error.tsx`): escolhe a tela pela falha,
 * registra no servidor a que nasceu no navegador (referência local até a API confirmar) e oferece só ações seguras — "Tentar
 * novamente" re-renderiza a tela (refaz LEITURAS); nenhuma gravação é reenviada sozinha.
 */
export function actionsFor(failure: Failure, retry: () => void): { action: ErrorScreenAction | null; secondary: ErrorScreenAction | null; askAdministrator: boolean } {
  const home: ErrorScreenAction = { label: "Voltar ao início", href: "/" }
  switch (failure.kind) {
    case "401":
      return { action: { label: FAILURE_COPY["401"].actionLabel, href: typeof window === "undefined" ? "/auth/login" : loginWithReturn(`${window.location.pathname}${window.location.search}`) }, secondary: null, askAdministrator: false }
    case "403":
      return { action: { ...home, label: FAILURE_COPY["403"].actionLabel }, secondary: null, askAdministrator: true }
    case "404":
      return { action: { ...home, label: FAILURE_COPY["404"].actionLabel }, secondary: null, askAdministrator: false }
    case "400":
      return {
        action: { label: FAILURE_COPY["400"].actionLabel, onClick: () => (window.history.length > 1 ? window.history.back() : retry()) },
        secondary: null,
        askAdministrator: false,
      }
    case "offline":
      return { action: { label: FAILURE_COPY.offline.actionLabel, onClick: retry }, secondary: null, askAdministrator: false }
    default:
      return { action: { label: FAILURE_COPY["500"].actionLabel, onClick: retry }, secondary: { ...home, variant: "outline" }, askAdministrator: true }
  }
}

export function RouteErrorBoundary({ error, retry, variant = "page" }: { error: Error & { digest?: string }; retry: () => void; variant?: "page" | "contextual" }) {
  const failure = useMemo(() => describeFailure(error), [error])
  const [recorded, setRecorded] = useState<boolean | undefined>(failure.needsReport ? false : undefined)

  useEffect(() => {
    console.error(error)
    if (!failure.needsReport) return
    let active = true
    void reportClientFailure(failure, { route: publicRoute(window.location.pathname), release: error instanceof ApiError ? error.release : null }).then((outcome) => {
      if (active) setRecorded(outcome === "recorded")
    })
    return () => {
      active = false
    }
  }, [error, failure])

  // Volta da conexão: tenta de novo sozinho só a LEITURA da tela (re-render), nunca uma gravação.
  useEffect(() => {
    if (failure.kind !== "offline") return
    window.addEventListener("online", retry)
    return () => window.removeEventListener("online", retry)
  }, [failure.kind, retry])

  const { action, secondary, askAdministrator } = actionsFor(failure, retry)
  return <ErrorScreen failure={failure} variant={variant} action={action} secondaryAction={secondary} askAdministrator={askAdministrator} recorded={recorded} release={error instanceof ApiError ? error.release : null} />
}
