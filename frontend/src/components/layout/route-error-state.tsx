"use client"

import { useEffect } from "react"

import { Button } from "@/components/ui/button"

/**
 * Fallback das fronteiras de erro de rota (`app/error.tsx`, `app/(app)/error.tsx`): uma exceção inesperada ao renderizar a
 * tela deixa de trocar a aplicação inteira pela página de erro padrão do Next (em inglês, sem navegação) — dentro da área
 * autenticada o cabeçalho continua e a pessoa pode tentar de novo. A mensagem do erro não é mostrada (pode ser interna).
 */
export function RouteErrorState({ error, onRetry }: { error: Error & { digest?: string }; onRetry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-1 items-start justify-center px-4 py-10">
      <div role="alert" className="w-full max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-sm font-medium">Não foi possível exibir esta tela.</p>
        <p className="mt-1 text-sm text-muted-foreground">Tente de novo. Se o problema continuar, avise o suporte.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    </div>
  )
}
