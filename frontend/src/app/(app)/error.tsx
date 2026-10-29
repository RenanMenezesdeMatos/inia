"use client"

import { RouteErrorState } from "@/components/layout/route-error-state"

/** Erro inesperado numa tela da área autenticada: o shell (cabeçalho e navegação) continua, só a tela vira o aviso. */
export default function AppRouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorState error={error} onRetry={retry} />
}
