"use client"

import { RouteErrorState } from "@/components/layout/route-error-state"

/** Erro inesperado fora da área autenticada (login, wiki) ou no próprio shell autenticado. Erro no layout raiz não chega aqui. */
export default function RootRouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorState error={error} onRetry={retry} />
}
