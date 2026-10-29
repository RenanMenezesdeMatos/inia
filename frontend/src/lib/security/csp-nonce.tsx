"use client"

import { setNonce } from "get-nonce"
import { createContext, useContext } from "react"

const CspNonceContext = createContext<string | undefined>(undefined)

let documentNonce: string | undefined

/**
 * No navegador vale o nonce do DOCUMENTO: a CSP chegou no cabeçalho da primeira resposta e não muda sem recarregar a página.
 * O `router.refresh()` (salvar o perfil, mudar acessos) re-renderiza o RootLayout com o nonce NOVO daquela requisição, que a
 * página não conhece — todo <style> montado depois seria bloqueado. O primeiro nonce visto (o da hidratação) fica fixo
 * enquanto o documento viver; no servidor cada requisição usa o seu.
 */
export function pinDocumentNonce(nonce: string | undefined): string | undefined {
  if (typeof document === "undefined") return nonce
  documentNonce ??= nonce
  return documentNonce
}

/**
 * Nonce da CSP desta página para quem cria <style> no navegador (R-07, `style-src-elem` com nonce): componentes leem pelo
 * `useCspNonce` (ex.: `ChartStyle`, viewports do Radix), e a trava de rolagem do Radix (react-remove-scroll →
 * react-style-singleton) pelo `get-nonce`. O `setNonce` roda ANTES dos filhos renderizarem — um diálogo aberto já na primeira
 * pintura injeta o <style> no efeito dele, que roda antes de qualquer efeito deste provider. Recebe o nonce já fixado
 * (`pinDocumentNonce`).
 */
export function CspNonceProvider({ nonce, children }: { nonce?: string; children: React.ReactNode }) {
  if (nonce && typeof document !== "undefined") setNonce(nonce)
  return <CspNonceContext.Provider value={nonce}>{children}</CspNonceContext.Provider>
}

export function useCspNonce(): string | undefined {
  return useContext(CspNonceContext)
}
