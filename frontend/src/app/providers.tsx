"use client"

import { OfflineMonitor } from "@/components/error-states/offline-screen"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AccessibilityProvider } from "@/lib/accessibility/accessibility-provider"
import { QueryProvider } from "@/lib/query/query-provider"
import { CspNonceProvider, pinDocumentNonce } from "@/lib/security/csp-nonce"
// Zod sem a sonda de eval (a CSP não tem 'unsafe-eval'): precisa rodar antes de qualquer validação no navegador.
import "@/lib/security/zod-without-eval"

type ProvidersProps = {
  children: React.ReactNode
  /** Nonce da CSP da requisição: o next-themes injeta um script inline (tema antes da pintura) que só roda com ele, e os <style>
   * criados no navegador (gráficos, viewports e trava de rolagem do Radix, troca de tema) também precisam dele
   * (`CspNonceProvider`, R-07). No navegador vale sempre o do documento (`pinDocumentNonce`). */
  nonce?: string
}

/**
 * Composição ÚNICA dos providers de cliente da raiz — o RootLayout só renderiza `<Providers>`. Cada provider existe uma vez:
 * antes o layout e este arquivo montavam ThemeProvider e AccessibilityProvider cada um (duas instâncias de acessibilidade
 * gravando o mesmo localStorage e as mesmas classes do <html>). O Toaster fica DENTRO do ThemeProvider (usa `useTheme`).
 */
export function Providers({ children, nonce: requestNonce }: ProvidersProps) {
  const nonce = pinDocumentNonce(requestNonce)
  return (
    <CspNonceProvider nonce={nonce}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
        <AccessibilityProvider>
          <QueryProvider>
            <TooltipProvider>
              {children}
              {/* Sem conexão com o app aberto: aviso por cima da tela (o que foi digitado continua). */}
              <OfflineMonitor />
              <Toaster />
            </TooltipProvider>
          </QueryProvider>
        </AccessibilityProvider>
      </ThemeProvider>
    </CspNonceProvider>
  )
}
