"use client"

import { RouteErrorBoundary } from "@/components/error-states/route-error-boundary"

/** Erro inesperado numa tela da área autenticada: o shell (cabeçalho e navegação) continua, só a tela vira o aviso. */
export default function AppRouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorBoundary error={error} retry={retry} />
}
