import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"

import { TooltipProvider } from "@/components/ui/tooltip"

/** Monta um componente com um QueryClient isolado (sem retry) e o TooltipProvider que o layout
 * raiz da aplicação já fornece — cada teste começa sem cache. */
export function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>
  )
  const result = render(wrap(ui))
  return { ...result, rerender: (next: ReactNode) => result.rerender(wrap(next)) }
}
