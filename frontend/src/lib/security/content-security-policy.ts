/**
 * Content-Security-Policy das páginas da interface (auditoria de segurança, docs/security/configuracao-segura.md, R-07).
 *
 * Montada POR REQUISIÇÃO no proxy (src/proxy.ts) com um nonce novo. `script-src` só aceita script que carregue esse nonce: o
 * Next aplica o nonce sozinho aos próprios scripts (lê o `script-src` do cabeçalho da requisição) e o script de tema do
 * next-themes o recebe pelo RootLayout. 'strict-dynamic' deixa esses scripts confiáveis carregarem os chunks seguintes, o
 * worker do PDF e o worklet do microfone; 'self' só vale para navegador sem CSP 3 (os atuais o ignoram junto de
 * 'strict-dynamic'). Script injetado sem o nonce — inline, atributo on*, `javascript:` ou <script src> da própria origem
 * (em produção a API divide a origem com a interface) — não roda.
 *
 * Estilos continuam com 'unsafe-inline': React Flow, Radix, motion e recharts escrevem `style=""` e <style>, e um nonce em
 * `style-src` desligaria o 'unsafe-inline' desses atributos.
 */
export const CSP_NONCE_HEADER = "x-nonce"

const GEMINI_LIVE = ["https://generativelanguage.googleapis.com", "wss://generativelanguage.googleapis.com"]

/** 128 bits aleatórios em base64 — o formato que o Next reconhece em `'nonce-…'`. */
export function createCspNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
}

export function originOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

type ContentSecurityPolicyOptions = {
  nonce: string
  isDevelopment: boolean
  /** Origem de `NEXT_PUBLIC_INIA_API_URL` (fotos de perfil e chamadas do navegador à API). */
  apiOrigin: string | null
}

export function buildContentSecurityPolicy({ nonce, isDevelopment, apiOrigin }: ContentSecurityPolicyOptions): string {
  const api = apiOrigin ? ` ${apiOrigin}` : ""
  return [
    "default-src 'self'",
    // 'unsafe-eval' só no desenvolvimento: o React usa eval para reconstruir no navegador a pilha de erros do servidor.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${api}`,
    "font-src 'self' data:",
    // blob:/data: — o carregador do avatar 3D (GLTFLoader) busca por fetch as texturas embutidas no .glb como blob.
    `connect-src 'self' blob: data:${api} ${GEMINI_LIVE.join(" ")}${isDevelopment ? " ws: wss:" : ""}`,
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}
