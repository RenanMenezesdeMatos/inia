"use client"

import { RouteErrorBoundary } from "@/components/error-states/route-error-boundary"
import { useStoredThemeIsDark } from "@/lib/browser/use-stored-theme-is-dark"
import "./globals.css"

/**
 * Erro no próprio layout raiz (ou nos providers dele): o Next troca o documento INTEIRO por este, sem o layout, os providers nem
 * o CSS global. Por isso ele traz o próprio `<html>`/`<body>`, importa o `globals.css` e aplica o tema guardado pelo
 * `next-themes`. Erros dentro das telas ficam em `app/error.tsx` e `app/(app)/error.tsx`.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const dark = useStoredThemeIsDark()
  return (
    <html lang="pt-BR" className={dark ? "dark" : undefined}>
      <body className="min-h-screen bg-background font-sans text-foreground">
        <title>INIA</title>
        <RouteErrorBoundary error={error} retry={retry} />
      </body>
    </html>
  )
}
