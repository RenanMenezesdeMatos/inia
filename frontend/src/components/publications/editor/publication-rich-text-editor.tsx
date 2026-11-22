"use client"

import { useEffect, useRef, useState } from "react"
import { Bold, Heading2, Heading3, ImagePlus, Italic, Link2, Link2Off, List, ListOrdered, Pilcrow } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { RICH_TEXT_LINK_HREF, sanitizeRichText } from "@/lib/security/sanitize-rich-text"
import { broadcastImageSchema, COMMUNICATION_IMAGE_TYPES } from "@/schemas/communications/communication.schema"

export type EditorValue = { html: string; text: string }

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Endereço digitado sem esquema ("www.telnova.com.br") vira https; o resto passa pela MESMA regra do saneador (e do servidor). */
export function normalizeLinkHref(raw: string): string | null {
  const value = raw.trim()
  if (value === "") return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("/") ? value : `https://${value}`
  return RICH_TEXT_LINK_HREF.test(withScheme) ? withScheme : null
}

function ToolButton({ label, onClick, children, active = false }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={active} className={cn(active && "bg-primary/10 text-primary")} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Editor de texto rico da área editorial (Publicações). Formatação que a operação usa: texto, subtítulo e seção, negrito, itálico,
 * listas, link, cor e imagem. O que sai daqui é só RASCUNHO de HTML: o saneador da tela roda ao salvar e o servidor refaz tudo pela
 * lista fechada dele (`communication-content.ts`) — link só http(s) ou caminho interno, sempre em outra aba.
 * Colar entra como texto puro (não traz estilos de outra fonte). `initialHtml` = conteúdo salvo, carregado uma vez, saneado.
 */
export function PublicationRichTextEditor({ value, onChange, initialHtml, label = "Conteúdo da publicação", readOnly = false }: { value: EditorValue; onChange: (value: EditorValue) => void; initialHtml?: string; label?: string; readOnly?: boolean }) {
  const editorRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)
  const selectionRef = useRef<Range | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [imageError, setImageError] = useState("")
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkText, setLinkText] = useState("")
  const [linkHref, setLinkHref] = useState("")
  const [linkError, setLinkError] = useState("")
  const [active, setActive] = useState<{ bold: boolean; italic: boolean; ul: boolean; ol: boolean; block: string }>({ bold: false, italic: false, ul: false, ol: false, block: "p" })

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || loadedRef.current || initialHtml === undefined) return
    loadedRef.current = true
    editor.innerHTML = sanitizeRichText(initialHtml)
    onChange({ html: editor.innerHTML, text: editor.innerText ?? editor.textContent ?? "" })
  }, [initialHtml, onChange])

  useEffect(() => {
    // Estado da barra (negrito, lista, bloco) acompanha o cursor dentro do editor.
    const update = () => {
      const editor = editorRef.current
      const selection = document.getSelection()
      if (!editor || !selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) return
      let block = "p"
      for (let node: Node | null = selection.anchorNode; node && node !== editor; node = node.parentNode) {
        if (node instanceof HTMLElement && ["H2", "H3"].includes(node.tagName)) {
          block = node.tagName.toLowerCase()
          break
        }
      }
      setActive({ bold: document.queryCommandState("bold"), italic: document.queryCommandState("italic"), ul: document.queryCommandState("insertUnorderedList"), ol: document.queryCommandState("insertOrderedList"), block })
    }
    document.addEventListener("selectionchange", update)
    return () => document.removeEventListener("selectionchange", update)
  }, [])

  function emitValue() {
    const editor = editorRef.current
    if (editor) onChange({ html: editor.innerHTML, text: editor.innerText ?? editor.textContent ?? "" })
  }

  function run(command: string, argument?: string) {
    editorRef.current?.focus()
    document.execCommand(command, false, argument)
    emitValue()
  }

  function rememberSelection() {
    const selection = document.getSelection()
    const editor = editorRef.current
    if (selection && selection.rangeCount > 0 && editor?.contains(selection.anchorNode)) selectionRef.current = selection.getRangeAt(0).cloneRange()
    else selectionRef.current = null
    setLinkText(selectionRef.current?.toString() ?? "")
    setLinkHref("")
    setLinkError("")
  }

  function restoreSelection() {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    const selection = document.getSelection()
    if (!selection) return
    selection.removeAllRanges()
    if (selectionRef.current) selection.addRange(selectionRef.current)
    else {
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      selection.addRange(range)
    }
  }

  function insertLink() {
    const href = normalizeLinkHref(linkHref)
    if (!href) return setLinkError("Use um endereço que comece com https:// ou um caminho do app (ex.: /operator).")
    restoreSelection()
    const selected = selectionRef.current && !selectionRef.current.collapsed
    if (selected && linkText === selectionRef.current?.toString()) document.execCommand("createLink", false, href)
    else document.execCommand("insertHTML", false, `<a href="${escapeHtml(href)}">${escapeHtml(linkText.trim() || href)}</a>`)
    emitValue()
    setLinkOpen(false)
  }

  function insertImage(file: File) {
    const parsed = broadcastImageSchema.safeParse(file)
    if (!parsed.success) return setImageError(parsed.error.issues[0]?.message ?? "Imagem inválida.")
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== "string") return
      run("insertImage", reader.result)
      setImageError("")
    }
    reader.readAsDataURL(parsed.data)
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div role="toolbar" aria-label="Formatação" className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-border bg-card/95 px-2 py-1.5 backdrop-blur">
        <ToolButton label="Texto" active={active.block === "p"} onClick={() => run("formatBlock", "p")}><Pilcrow /></ToolButton>
        <ToolButton label="Subtítulo" active={active.block === "h2"} onClick={() => run("formatBlock", "h2")}><Heading2 /></ToolButton>
        <ToolButton label="Seção" active={active.block === "h3"} onClick={() => run("formatBlock", "h3")}><Heading3 /></ToolButton>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ToolButton label="Negrito" active={active.bold} onClick={() => run("bold")}><Bold /></ToolButton>
        <ToolButton label="Itálico" active={active.italic} onClick={() => run("italic")}><Italic /></ToolButton>
        <ToolButton label="Lista com marcadores" active={active.ul} onClick={() => run("insertUnorderedList")}><List /></ToolButton>
        <ToolButton label="Lista numerada" active={active.ol} onClick={() => run("insertOrderedList")}><ListOrdered /></ToolButton>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Popover open={linkOpen} onOpenChange={(open) => { if (open) rememberSelection(); setLinkOpen(open) }}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Inserir link" onMouseDown={(event) => event.preventDefault()}><Link2 /></Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Inserir link</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-80 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="publication-link-text">Texto do link</Label>
              <Input id="publication-link-text" value={linkText} onChange={(event) => setLinkText(event.target.value)} placeholder="Ex.: Segunda via da fatura" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="publication-link-href">Endereço</Label>
              <Input id="publication-link-href" value={linkHref} onChange={(event) => setLinkHref(event.target.value)} placeholder="https://… ou /operator" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); insertLink() } }} />
              {linkError ? <p role="alert" className="text-xs text-destructive">{linkError}</p> : <p className="text-xs text-muted-foreground">Abre em outra aba.</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setLinkOpen(false)}>Cancelar</Button>
              <Button type="button" size="sm" onClick={insertLink}>Inserir</Button>
            </div>
          </PopoverContent>
        </Popover>
        <ToolButton label="Remover link" onClick={() => run("unlink")}><Link2Off /></ToolButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted">
              <Input type="color" defaultValue="#660099" className="size-5 cursor-pointer border-0 p-0" aria-label="Cor do texto" onChange={(event) => run("foreColor", event.target.value)} />
            </label>
          </TooltipTrigger>
          <TooltipContent>Cor do texto</TooltipContent>
        </Tooltip>
        <ToolButton label="Inserir imagem" onClick={() => imageInputRef.current?.click()}><ImagePlus /></ToolButton>
        <input ref={imageInputRef} type="file" accept={COMMUNICATION_IMAGE_TYPES.join(",")} className="sr-only" tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) insertImage(file) }} />
      </div>
      <div
        ref={editorRef}
        contentEditable={!readOnly}
        aria-readonly={readOnly || undefined}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder="Escreva a publicação. Use subtítulos e listas para facilitar a leitura na operação."
        className="inia-rich-editor min-h-[22rem] flex-1 px-1 py-4 text-[0.9375rem] leading-7 outline-none sm:px-2"
        onInput={emitValue}
        onPaste={(event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")) }}
      />
      <div className="flex justify-between gap-2 border-t border-border px-1 py-2 text-xs text-muted-foreground">
        <span className="text-destructive" role={imageError ? "alert" : undefined}>{imageError}</span>
        <span className={cn(value.text.length > 5000 && "text-destructive")}>{value.text.length.toLocaleString("pt-BR")}/5.000 caracteres</span>
      </div>
    </div>
  )
}
