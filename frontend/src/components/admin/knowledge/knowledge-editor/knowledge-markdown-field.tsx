"use client"

import { useRef, useState } from "react"
import { Bold, Eye, Heading2, Heading3, List, ListOrdered, PenLine, Quote, Table } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import { KnowledgeArticleContent } from "../knowledge-article-content"

type Edit = { text: string; selectionStart: number; selectionEnd: number }

/** Envolve a seleção (ou um texto de exemplo) com a marcação: **negrito**. */
function wrapSelection(value: string, start: number, end: number, mark: string, placeholder: string): Edit {
  const selected = value.slice(start, end) || placeholder
  const text = `${value.slice(0, start)}${mark}${selected}${mark}${value.slice(end)}`
  return { text, selectionStart: start + mark.length, selectionEnd: start + mark.length + selected.length }
}

/** Marca cada linha da seleção (ou a linha do cursor) com o prefixo: "## ", "- ", "1. ", "> ". Prefixo igual já presente é trocado, não somado. */
function prefixLines(value: string, start: number, end: number, prefix: (index: number) => string): Edit {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1
  const nextBreak = value.indexOf("\n", end)
  const lineEnd = nextBreak === -1 ? value.length : nextBreak
  const block = value.slice(lineStart, lineEnd)
  const marked = block
    .split("\n")
    .map((line, index) => `${prefix(index)}${line.replace(/^(#{1,6}\s+|[-*•]\s+|\d+[.)]\s+|>\s?)/, "")}`)
    .join("\n")
  const text = `${value.slice(0, lineStart)}${marked}${value.slice(lineEnd)}`
  // Cursor no fim do que foi marcado: digitar em seguida continua o texto, nunca substitui a linha.
  return { text, selectionStart: lineStart + marked.length, selectionEnd: lineStart + marked.length }
}

const TABLE_TEMPLATE = "| Coluna 1 | Coluna 2 |\n| --- | --- |\n| Valor | Valor |"

function insertBlock(value: string, start: number, block: string): Edit {
  const before = value.slice(0, start)
  const glue = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n"
  const text = `${before}${glue}${block}\n${value.slice(start)}`
  const at = before.length + glue.length
  return { text, selectionStart: at + block.length, selectionEnd: at + block.length }
}

/** A barra de formatação: cada botão só transforma o texto e a seleção. */
const TOOLS: { label: string; icon: typeof Bold; edit: (text: string, start: number, end: number) => Edit }[] = [
  { label: "Título de seção", icon: Heading2, edit: (text, start, end) => prefixLines(text, start, end, () => "## ") },
  { label: "Subtítulo", icon: Heading3, edit: (text, start, end) => prefixLines(text, start, end, () => "### ") },
  { label: "Negrito", icon: Bold, edit: (text, start, end) => wrapSelection(text, start, end, "**", "texto em destaque") },
  { label: "Lista", icon: List, edit: (text, start, end) => prefixLines(text, start, end, () => "- ") },
  { label: "Lista numerada", icon: ListOrdered, edit: (text, start, end) => prefixLines(text, start, end, (index) => `${index + 1}. `) },
  { label: "Citação", icon: Quote, edit: (text, start, end) => prefixLines(text, start, end, () => "> ") },
  { label: "Tabela", icon: Table, edit: (text, start) => insertBlock(text, start, TABLE_TEMPLATE) },
]

/** Quantos títulos, caracteres e palavras: o texto da base é dividido em trechos pelos títulos, e é assim que a IA o recebe. */
export function contentStats(text: string) {
  const headings = text.split("\n").filter((line) => /^#{1,6}\s+\S/.test(line.trim())).length
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return { headings, words, chars: text.length }
}

/**
 * Conteúdo em Markdown — o mesmo de sempre (títulos com #, listas, **negrito**, tabelas, citações) — com uma barra que só insere a
 * marcação e a aba "Visualizar" com a leitura formatada exatamente como a base é exibida (`KnowledgeArticleContent`). Nada é convertido:
 * o que fica salvo é o texto com as marcações.
 */
export function KnowledgeMarkdownField({ id, label, value, onChange, readOnly, title, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; readOnly?: boolean; title: string; placeholder?: string }) {
  const [mode, setMode] = useState<"write" | "preview">("write")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const stats = contentStats(value)

  function apply(edit: (value: string, start: number, end: number) => Edit) {
    const element = textareaRef.current
    if (!element) return
    const next = edit(value, element.selectionStart, element.selectionEnd)
    onChange(next.text)
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(next.selectionStart, next.selectionEnd)
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <Tabs value={mode} onValueChange={(next) => setMode(next as "write" | "preview")}>
          <TabsList>
            <TabsTrigger value="write"><PenLine />Escrever</TabsTrigger>
            <TabsTrigger value="preview"><Eye />Visualizar</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {mode === "write" ? (
        <div className="overflow-hidden rounded-xl border border-input focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          {readOnly ? null : (
            <div role="toolbar" aria-label="Formatação em Markdown" className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-1.5 py-1">
              {TOOLS.map((tool) => (
                <Button key={tool.label} type="button" size="icon" variant="ghost" className="size-8" title={tool.label} aria-label={tool.label} onClick={() => apply(tool.edit)}>
                  <tool.icon />
                </Button>
              ))}
            </div>
          )}
          <Textarea
            ref={textareaRef}
            id={id}
            value={value}
            readOnly={readOnly}
            rows={18}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-80 resize-y rounded-none border-0 font-mono text-[13px] leading-6 shadow-none focus-visible:ring-0"
          />
        </div>
      ) : (
        <div className={cn("min-h-80 rounded-xl border border-border px-4 py-5 sm:px-6")} data-testid="knowledge-markdown-preview">
          {value.trim() ? <KnowledgeArticleContent text={value} omitLeadingHeading={title.trim() || undefined} /> : <p className="text-sm italic text-muted-foreground">Nada escrito ainda.</p>}
        </div>
      )}

      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Títulos com <code>#</code>, listas com <code>-</code> ou <code>1.</code>, <code>**negrito**</code> e tabelas aparecem formatados na leitura. A IA recebe o texto dividido em trechos pelos títulos.
        </span>
        <span className="tabular-nums" aria-live="polite">{`${stats.headings} ${stats.headings === 1 ? "título" : "títulos"} · ${stats.words.toLocaleString("pt-BR")} ${stats.words === 1 ? "palavra" : "palavras"} · ${stats.chars.toLocaleString("pt-BR")} caracteres`}</span>
      </p>
    </div>
  )
}
