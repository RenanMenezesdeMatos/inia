"use client"

import { Component, type ReactNode } from "react"
import Markdown, { defaultUrlTransform, type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

/**
 * Renderer ÚNICO para conteúdo textual rico produzido por Agent/Workflow/INIA (monitorias,
 * Outputs, análises persistidas, respostas do chat, detalhe de Human Review). O conteúdo chega
 * em Markdown (o modelo escreve **negrito**, ### títulos, listas, tabelas) e antes vazava como
 * texto cru com asteriscos. Não é usado em campos que são texto puro (nome, título curto, badge).
 *
 * Segurança: nada aqui vira HTML injetado — react-markdown produz elementos React e `skipHtml`
 * descarta qualquer HTML embutido no texto (nunca há rehype-raw). URLs passam por
 * `defaultUrlTransform` (só http/https/mailto/tel/relativas — `javascript:` é descartado). Só endereço
 * DA PRÓPRIA INIA (caminho relativo, ex.: `/materiais/…`) vira link clicável, em nova aba com `rel="noopener noreferrer nofollow"`:
 * o texto pode ter sido induzido por uma transcrição ou documento (fala do cliente, trecho de base), e um link externo
 * numa resposta "da INIA" é isca de phishing ou leva dados da conversa na URL com um clique (achado AI-08 da auditoria de
 * 17/10/2026). Link externo aparece como texto, com o domínio à vista — salvo os domínios que a instalação confia
 * (`NEXT_PUBLIC_INIA_TRUSTED_LINK_HOSTS`, ex.: a intranet dos procedimentos).
 *
 * Layout: tudo é preparado para caber na largura disponível — texto quebra (`break-words`),
 * tokens/URLs longos quebram (`break-all` só em links/código inline), e tabelas e blocos de
 * código rolam horizontalmente DENTRO do próprio bloco, nunca empurrando a página.
 */
export type RichContentProps = {
  text: string
  className?: string
  /** `compact`: tipografia de card/feed (padrão). `detail`: um pouco mais de respiro para painéis e drawers. */
  density?: "compact" | "detail"
}

export function RichContent({ text, className, density = "compact" }: RichContentProps) {
  const content = text.trim()
  if (content.length === 0) return null
  return (
    <div className={cn("rich-content min-w-0 max-w-full break-words", density === "detail" ? "space-y-3 text-sm leading-6" : "space-y-2 text-sm leading-6", className)}>
      <RichContentErrorBoundary text={content}>
        <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={defaultUrlTransform} components={components}>
          {content}
        </Markdown>
      </RichContentErrorBoundary>
    </div>
  )
}

// Títulos internos nunca viram "página de documentação" dentro de um card: h1/h2 e h3+ colapsam
// em dois níveis discretos, no mesmo tamanho do texto ao redor.
const components: Components = {
  h1: ({ children }) => <p className="font-semibold text-foreground">{children}</p>,
  h2: ({ children }) => <p className="font-semibold text-foreground">{children}</p>,
  h3: ({ children }) => <p className="font-semibold text-foreground">{children}</p>,
  h4: ({ children }) => <p className="font-medium text-foreground">{children}</p>,
  h5: ({ children }) => <p className="font-medium text-foreground">{children}</p>,
  h6: ({ children }) => <p className="font-medium text-foreground">{children}</p>,
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="[&>p]:inline">{children}</li>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 text-muted-foreground [&>p]:my-0">{children}</blockquote>,
  hr: () => <hr className="border-border" />,
  a: ({ href, children }) => {
    if (isInternalHref(href) || isTrustedExternalHref(href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-primary underline underline-offset-2 hover:text-primary/80">
          {children}
        </a>
      )
    }
    const host = hostOf(href)
    const label = typeof children === "string" ? children : null
    return (
      <span className="break-all" data-external-link="">
        {children}
        {host && label !== href ? <span className="text-muted-foreground"> ({host})</span> : null}
      </span>
    )
  },
  code: ({ className, children }) => {
    // react-markdown passa `language-*` só para blocos (```); código inline não tem className.
    const isBlock = typeof className === "string" && className.startsWith("language-")
    if (isBlock) return <code className={cn("font-mono text-xs", className)}>{children}</code>
    return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] break-all">{children}</code>
  },
  pre: ({ children }) => (
    <pre className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 whitespace-pre">{children}</pre>
  ),
  // Tabela com a identidade do produto: moldura arredondada, cabeçalho no roxo da marca (tom claro, legível nos dois temas), linhas
  // alternadas e números alinhados — rola dentro da moldura no celular, nunca a página.
  table: ({ children }) => (
    <div className="my-1 max-w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-sm tabular-nums [&_td:first-child]:font-medium">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-primary/10 text-foreground">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-border/60 last:border-b-0 even:bg-muted/40">{children}</tr>,
  th: ({ children }) => <th className="border-b border-primary/20 px-3 py-2 text-xs font-semibold whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 align-top">{children}</td>,
  img: ({ alt }) => <span className="text-muted-foreground">[imagem{alt ? `: ${alt}` : ""}]</span>,
}

/** Caminho da própria INIA (`/materiais/…`, `/reports/…`): relativo à origem, nunca `//host` nem `/\\host`. */
function isInternalHref(href: string | undefined): href is string {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\")
}

/**
 * Domínios externos que a instalação confia (intranet com os procedimentos, portal corporativo): `NEXT_PUBLIC_INIA_TRUSTED_LINK_HOSTS`
 * no frontend/.env.local, separados por vírgula — `intranet.empresa.com` ou `*.empresa.com`. Vazio (padrão) = nenhum. Entra no build.
 */
function trustedLinkHosts(): string[] {
  return (process.env.NEXT_PUBLIC_INIA_TRUSTED_LINK_HOSTS ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean)
}

function isTrustedExternalHref(href: string | undefined): boolean {
  if (!href) return false
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false
  const host = url.hostname.toLowerCase()
  return trustedLinkHosts().some((entry) => (entry.startsWith("*.") ? host.endsWith(entry.slice(1)) : host === entry))
}

function hostOf(href: string | undefined): string | null {
  if (!href) return null
  try {
    const url = new URL(href)
    return url.protocol === "http:" || url.protocol === "https:" ? url.host : url.protocol.replace(/:$/, "")
  } catch {
    return null
  }
}

// Error Boundary de verdade (JSX só é avaliado na reconciliação — try/catch não pega): um texto
// que quebre o parser nunca deve virar card em branco nem derrubar a tela.
class RichContentErrorBoundary extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) return <p className="whitespace-pre-wrap">{this.props.text}</p>
    return this.props.children
  }
}
