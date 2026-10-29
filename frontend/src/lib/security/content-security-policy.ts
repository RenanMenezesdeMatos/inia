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
 * Estilos (R-07, isolado em 29/10/2026): `style-src-elem` aceita só <style> com o nonce — o Next o aplica aos próprios, o
 * next-themes o recebe pelo RootLayout, o Radix (trava de rolagem) pelo `get-nonce` e o `ChartStyle` pelo contexto
 * (`csp-nonce.tsx`) — e o CSS fixo do `sonner` e da 404 padrão do Next pelo hash. `style-src-attr` mantém 'unsafe-inline' só para atributos `style=""`,
 * que o HTML do servidor e as posições do React Flow, Radix, motion e recharts exigem. O que sobra: CSS num atributo de um
 * elemento, sem seletores. Interruptor `INIA_CSP_STYLES` (ver `resolveStyleMode`) para observar ou voltar atrás sem novo build.
 */
export const CSP_NONCE_HEADER = "x-nonce"

/**
 * CSS fixo que o `sonner` (toasts) injeta num <style> próprio, sem aceitar nonce: liberado pelo hash do texto exato. Atualizar
 * o `sonner` muda o texto — o teste recalcula o hash a partir do pacote instalado e falha até ele ser trocado aqui.
 */
export const SONNER_STYLE_HASH = "'sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY='"
/** O `sonner` insere o <style> VAZIO e só depois o texto (o navegador confere de novo com o texto, e aí vale o hash acima).
 * Liberar o vazio não abre nada: um <style> sem conteúdo não aplica regra, e qualquer texto inserido depois é conferido. */
export const EMPTY_STYLE_HASH = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='"
/** CSS fixo da página 404 padrão do Next (`HTTPAccessErrorFallback`, sem `not-found.tsx` próprio): cores e modo escuro num
 * <style> sem nonce. Atualizar o Next pode mudar o texto — o teste recalcula o hash a partir do pacote instalado. */
export const NEXT_NOT_FOUND_STYLE_HASH = "'sha256-Z5XTK23DFuEMs0PwnyZDO9SWxemQ5HxcpVaBNuUJyWY='"

/** STRICT = estilos isolados (padrão em produção); REPORT_ONLY = política antiga valendo + a nova só relatando no console do
 * navegador (para conferir telas antes de ligar); RELAXED = política antiga (padrão no desenvolvimento, onde o Next injeta
 * estilos de recarregamento sem nonce). */
export type CspStyleMode = "STRICT" | "REPORT_ONLY" | "RELAXED"

export function resolveStyleMode(value: string | undefined, isDevelopment: boolean): CspStyleMode {
  const normalized = value?.trim().toUpperCase()
  if (normalized === "STRICT" || normalized === "REPORT_ONLY" || normalized === "RELAXED") return normalized
  return isDevelopment ? "RELAXED" : "STRICT"
}

function strictStyleDirectives(nonce: string): string[] {
  const elements = `'self' 'nonce-${nonce}' ${SONNER_STYLE_HASH} ${EMPTY_STYLE_HASH} ${NEXT_NOT_FOUND_STYLE_HASH}`
  // `style-src` repete as regras dos elementos para o navegador sem CSP 3 (sem `-elem`/`-attr`): lá os atributos ficam bloqueados.
  return [`style-src ${elements}`, `style-src-elem ${elements}`, "style-src-attr 'unsafe-inline'"]
}

/** Cabeçalho `Content-Security-Policy-Report-Only` do modo REPORT_ONLY: só as regras novas de estilo. */
export function buildStyleReportOnlyPolicy(nonce: string): string {
  return strictStyleDirectives(nonce).join("; ")
}

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
  /** Padrão: STRICT em produção e RELAXED no desenvolvimento. REPORT_ONLY usa aqui a política antiga (a nova vai à parte). */
  styleMode?: CspStyleMode
}

export function buildContentSecurityPolicy({ nonce, isDevelopment, apiOrigin, styleMode = resolveStyleMode(undefined, isDevelopment) }: ContentSecurityPolicyOptions): string {
  const api = apiOrigin ? ` ${apiOrigin}` : ""
  return [
    "default-src 'self'",
    // 'unsafe-eval' só no desenvolvimento: o React usa eval para reconstruir no navegador a pilha de erros do servidor.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    ...(styleMode === "STRICT" ? strictStyleDirectives(nonce) : ["style-src 'self' 'unsafe-inline'"]),
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
