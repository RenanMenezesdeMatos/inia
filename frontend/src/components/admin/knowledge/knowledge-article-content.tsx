"use client"

import { Component, Fragment, type ReactNode } from "react"

import { cn } from "@/lib/utils"

// O conteúdo de uma base "texto" é o que o admin colou no cadastro — na prática, markdown leve
// (# títulos, **negrito**, listas com "-"/numeradas, tabelas em pipe, citações e blocos de
// código), com quebras de linha que fazem parte do documento. Este renderizador é o irmão de
// leitura longa do RichContent (components/rich-content): mesma ideia (interpretar o que aparece na
// prática, nunca injetar HTML), mas com hierarquia real de títulos, parágrafos que respeitam a
// quebra de linha original e tipografia de artigo. Só produz elementos React — nada de
// dangerouslySetInnerHTML —, então o texto do banco nunca vira markup executável.
export function KnowledgeArticleContent({ text, omitLeadingHeading, className, inserts }: { text: string; omitLeadingHeading?: string; className?: string; inserts?: readonly ArticleInsert[] }) {
  return (
    <div className={cn("knowledge-article text-[15px] leading-7 text-foreground/90 sm:text-base", className)}>
      <ArticleErrorBoundary text={text}>
        <RenderedArticle text={text} omitLeadingHeading={omitLeadingHeading} inserts={inserts} />
      </ArticleErrorBoundary>
    </div>
  )
}

/** O que entra no meio do texto sem fazer parte dele (ex.: imagem de um PDF). `at` é a posição no texto, no fim de uma linha ou entre dois blocos. */
export type ArticleInsert = { at: number; key: string; node: ReactNode }

// Error Boundary de verdade: um conteúdo que quebre o parser vira texto puro, nunca uma página
// em branco (um try/catch em volta do JSX não pega nada — ele só é avaliado na reconciliação).
class ArticleErrorBoundary extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) return <p className="whitespace-pre-wrap">{this.props.text}</p>
    return this.props.children
  }
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbered"; items: string[]; start: number }
  | { kind: "quote"; lines: string[] }
  | { kind: "code"; code: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "rule" }

const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/
const BULLET = /^[-*•]\s+(.*)$/
const NUMBERED = /^(\d+)[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const RULE = /^(-{3,}|\*{3,}|_{3,})$/
const FENCE = /^```/
const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/

function lineKind(line: string): "blank" | "heading" | "bullet" | "numbered" | "quote" | "rule" | "fence" | "prose" {
  if (!line.trim()) return "blank"
  if (FENCE.test(line)) return "fence"
  if (HEADING.test(line)) return "heading"
  if (RULE.test(line.trim())) return "rule"
  if (BULLET.test(line)) return "bullet"
  if (NUMBERED.test(line)) return "numbered"
  if (QUOTE.test(line)) return "quote"
  return "prose"
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    // "\|" é uma barra dentro da célula, como escreve o Markdown vindo de PDF: não separa colunas.
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"))
}

export function parseArticle(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, ""))
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]!
    const trimmed = line.trim()
    const kind = lineKind(trimmed)

    if (kind === "blank") {
      index += 1
      continue
    }

    if (kind === "fence") {
      const code: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index]!.trim())) {
        code.push(lines[index]!)
        index += 1
      }
      index += 1 // fecha o bloco (ou chega ao fim sem fechar — o que houver vira código mesmo assim)
      blocks.push({ kind: "code", code: code.join("\n") })
      continue
    }

    // Tabela markdown: linha com "|" seguida da linha separadora (---|---). Checar as duas evita
    // confundir uma frase qualquer com barra vertical com uma tabela.
    if (trimmed.includes("|") && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1]!.trim())) {
      const header = splitTableRow(trimmed)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index]!.trim().includes("|")) {
        rows.push(splitTableRow(lines[index]!))
        index += 1
      }
      blocks.push({ kind: "table", header, rows })
      continue
    }

    if (kind === "heading") {
      const match = HEADING.exec(trimmed)!
      blocks.push({ kind: "heading", level: match[1]!.length, text: match[2]! })
      index += 1
      continue
    }

    if (kind === "rule") {
      blocks.push({ kind: "rule" })
      index += 1
      continue
    }

    if (kind === "bullet" || kind === "numbered") {
      const items: string[] = []
      const start = kind === "numbered" ? Number(NUMBERED.exec(trimmed)![1]) : 1
      while (index < lines.length) {
        const current = lines[index]!.trim()
        const currentKind = lineKind(current)
        if (currentKind === kind) {
          items.push(kind === "bullet" ? BULLET.exec(current)![1]! : NUMBERED.exec(current)![2]!)
          index += 1
          continue
        }
        // Linha indentada logo abaixo de um item é continuação dele (texto que o autor quebrou).
        if (currentKind === "prose" && /^\s{2,}/.test(lines[index]!) && items.length) {
          items[items.length - 1] = `${items[items.length - 1]} ${current}`
          index += 1
          continue
        }
        break
      }
      blocks.push(kind === "bullet" ? { kind: "bullets", items } : { kind: "numbered", items, start })
      continue
    }

    if (kind === "quote") {
      const quoteLines: string[] = []
      while (index < lines.length && lineKind(lines[index]!.trim()) === "quote") {
        quoteLines.push(QUOTE.exec(lines[index]!.trim())![1]!)
        index += 1
      }
      blocks.push({ kind: "quote", lines: quoteLines })
      continue
    }

    // Prosa: linhas consecutivas até a próxima linha em branco ou de outro tipo. As quebras de
    // linha internas são preservadas (viram <br/>), porque no texto colado elas são intencionais.
    const paragraph: string[] = []
    while (index < lines.length && lineKind(lines[index]!.trim()) === "prose") {
      paragraph.push(lines[index]!.trim())
      index += 1
    }
    blocks.push({ kind: "paragraph", lines: paragraph })
  }

  return blocks
}

function ArticleBlocks({ text, omitLeadingHeading }: { text: string; omitLeadingHeading?: string | undefined }) {
  let blocks = parseArticle(text)
  // O título da base já aparece em destaque no topo da página — se o texto começa repetindo-o
  // como "# Título", não mostramos duas vezes.
  const first = blocks[0]
  if (omitLeadingHeading && first?.kind === "heading" && normalize(first.text) === normalize(omitLeadingHeading)) {
    blocks = blocks.slice(1)
  }
  return <>{blocks.map((block, index) => renderBlock(block, index))}</>
}

function RenderedArticle({ text, omitLeadingHeading, inserts }: { text: string; omitLeadingHeading?: string | undefined; inserts?: readonly ArticleInsert[] | undefined }) {
  if (!inserts?.length) return <ArticleBlocks text={text} omitLeadingHeading={omitLeadingHeading} />
  const parts: ReactNode[] = []
  let cursor = 0
  for (const insert of [...inserts].sort((left, right) => left.at - right.at)) {
    const at = Math.min(Math.max(insert.at, 0), text.length)
    if (at > cursor) {
      parts.push(<ArticleBlocks key={`text-${cursor}`} text={text.slice(cursor, at)} omitLeadingHeading={cursor === 0 ? omitLeadingHeading : undefined} />)
      cursor = at
    }
    parts.push(<Fragment key={insert.key}>{insert.node}</Fragment>)
  }
  if (cursor < text.length) parts.push(<ArticleBlocks key={`text-${cursor}`} text={text.slice(cursor)} omitLeadingHeading={cursor === 0 ? omitLeadingHeading : undefined} />)
  return <>{parts}</>
}

function normalize(value: string) {
  return value.replace(/\*\*/g, "").trim().toLocaleLowerCase("pt-BR")
}

const HEADING_CLASSES: Record<number, string> = {
  1: "mt-10 mb-4 text-2xl font-semibold tracking-tight first:mt-0",
  2: "mt-10 mb-4 text-2xl font-semibold tracking-tight first:mt-0",
  3: "mt-8 mb-3 text-xl font-semibold tracking-tight first:mt-0",
  4: "mt-6 mb-2 text-lg font-semibold first:mt-0",
  5: "mt-6 mb-2 text-base font-semibold first:mt-0",
  6: "mt-4 mb-2 text-base font-semibold text-muted-foreground first:mt-0",
}

function renderBlock(block: Block, index: number): ReactNode {
  const key = `${block.kind}-${index}`
  switch (block.kind) {
    case "heading": {
      // O h1 é o título da página; o "#" do texto vira h2 para a hierarquia continuar válida.
      const Tag = (`h${Math.min(block.level + 1, 6)}` as "h2" | "h3" | "h4" | "h5" | "h6")
      return (
        <Tag key={key} className={HEADING_CLASSES[block.level]}>
          {renderInline(block.text)}
        </Tag>
      )
    }
    case "paragraph":
      return (
        <p key={key} className="my-4 first:mt-0 last:mb-0">
          {block.lines.map((line, lineIndex) => (
            <span key={lineIndex}>
              {lineIndex > 0 ? <br /> : null}
              {renderInline(line)}
            </span>
          ))}
        </p>
      )
    case "bullets":
      return (
        <ul key={key} className="my-4 list-disc space-y-1.5 pl-6 marker:text-muted-foreground">
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ul>
      )
    case "numbered":
      return (
        <ol key={key} start={block.start} className="my-4 list-decimal space-y-1.5 pl-6 marker:text-muted-foreground">
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ol>
      )
    case "quote":
      return (
        <blockquote key={key} className="my-4 border-l-2 border-primary/40 pl-4 text-muted-foreground">
          {block.lines.map((line, lineIndex) => (
            <span key={lineIndex}>
              {lineIndex > 0 ? <br /> : null}
              {renderInline(line)}
            </span>
          ))}
        </blockquote>
      )
    case "code":
      return (
        <pre key={key} className="my-4 overflow-x-auto rounded-lg border border-border bg-muted/60 p-4 text-[13px] leading-6">
          <code>{block.code}</code>
        </pre>
      )
    case "rule":
      return <hr key={key} className="my-8 border-border" />
    case "table":
      return (
        <div key={key} className="my-5 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/60">
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th key={cellIndex} className="border-b border-border px-3 py-2 font-semibold">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="even:bg-muted/30">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border-b border-border/60 px-3 py-2 align-top last:border-b-0">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

// Inline: código primeiro (dentro de crase nada é interpretado), depois negrito (senão "**x**"
// seria lido como dois itálicos), depois itálico e links [texto](https://...). Links só para
// http(s) — qualquer outro esquema fica como texto literal.
const INLINE_TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_TOKEN).map((part, index) => {
    if (!part) return null
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.88em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={index}>{part.slice(1, -1)}</em>
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part)
    if (link) {
      return (
        <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
          {link[1]}
        </a>
      )
    }
    return part
  })
}
