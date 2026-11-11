"use client"

import { RouteErrorBoundary } from "@/components/error-states/route-error-boundary"

/**
 * Fallback das fronteiras de erro de rota (`app/error.tsx`, `app/(app)/error.tsx`, `app/global-error.tsx`): a tela de erro da
 * INIA (arte, texto, ação segura, código e referência) no lugar da página padrão do Next. Dentro da área autenticada o cabeçalho
 * continua. A mensagem interna do erro nunca é mostrada — vai só, sanitizada, para o registro no servidor.
 */
export function RouteErrorState({ error, onRetry }: { error: Error & { digest?: string }; onRetry: () => void }) {
  return <RouteErrorBoundary error={error} retry={onRetry} />
}
