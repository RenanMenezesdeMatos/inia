"use client"

import { RouteErrorBoundary } from "@/components/error-states/route-error-boundary"

/** Erro inesperado fora da área autenticada (login, wiki) ou no próprio shell autenticado. Erro no layout raiz não chega aqui. */
export default function RootRouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorBoundary error={error} retry={retry} />
}
