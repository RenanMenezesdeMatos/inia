"use client"

import { useRef, useState } from "react"
import { Bold, Heading2, ImagePlus, Italic, List } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { broadcastImageSchema } from "@/schemas/profile/broadcast.schema"

type EditorValue = { html: string; text: string }

export function BroadcastRichTextEditor({ value, onChange }: { value: EditorValue; onChange: (value: EditorValue) => void }) {
  const editorRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [formats, setFormats] = useState<string[]>([])
  const [imageError, setImageError] = useState("")

  function emitValue() {
    const editor = editorRef.current
    if (editor) onChange({ html: editor.innerHTML, text: editor.innerText })
  }

  function runCommand(command: "bold" | "italic" | "insertUnorderedList") {
    editorRef.current?.focus()
    document.execCommand(command, false)
    emitValue()
  }

  function changeFormats(next: string[]) {
    const changed = [...next, ...formats].find((format) => next.includes(format) !== formats.includes(format))
    setFormats(next)
    if (changed === "bold") runCommand("bold")
    if (changed === "italic") runCommand("italic")
    if (changed === "list") runCommand("insertUnorderedList")
  }

  function setBlock(block: "p" | "h2") {
    editorRef.current?.focus()
    document.execCommand("formatBlock", false, block)
    emitValue()
  }

  function setColor(color: string) {
    editorRef.current?.focus()
    document.execCommand("foreColor", false, color)
    emitValue()
  }

  function insertImage(file: File) {
    const parsed = broadcastImageSchema.safeParse(file)
    if (!parsed.success) return setImageError(parsed.error.issues[0]?.message ?? "Imagem inválida.")
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== "string") return
      editorRef.current?.focus()
      document.execCommand("insertImage", false, reader.result)
      setImageError("")
      emitValue()
    }
    reader.readAsDataURL(parsed.data)
  }

  return <div className="overflow-hidden rounded-xl bg-muted/55">
    <div className="flex flex-wrap items-center gap-1 p-2">
      <ToggleGroup type="multiple" value={formats} onValueChange={changeFormats} className="bg-card" aria-label="Formatação do texto">
        <ToggleGroupItem value="bold" aria-label="Negrito" onMouseDown={(event) => event.preventDefault()}><Bold/></ToggleGroupItem>
        <ToggleGroupItem value="italic" aria-label="Itálico" onMouseDown={(event) => event.preventDefault()}><Italic/></ToggleGroupItem>
        <ToggleGroupItem value="list" aria-label="Lista com marcadores" onMouseDown={(event) => event.preventDefault()}><List/></ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup type="single" defaultValue="p" className="bg-card" aria-label="Estilo do parágrafo"><ToggleGroupItem value="p" onMouseDown={(event) => event.preventDefault()} onClick={() => setBlock("p")}>Texto</ToggleGroupItem><ToggleGroupItem value="h2" aria-label="Título interno" onMouseDown={(event) => event.preventDefault()} onClick={() => setBlock("h2")}><Heading2/></ToggleGroupItem></ToggleGroup>
      <Tooltip><TooltipTrigger asChild><label className="flex size-8 cursor-pointer items-center justify-center rounded-md bg-card"><Input type="color" defaultValue="#660099" className="size-5 cursor-pointer border-0 p-0" aria-label="Cor do texto" onChange={(event) => setColor(event.target.value)}/></label></TooltipTrigger><TooltipContent>Cor do texto</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className="bg-card" aria-label="Inserir imagem" onClick={() => imageInputRef.current?.click()}><ImagePlus/></Button></TooltipTrigger><TooltipContent>Inserir imagem</TooltipContent></Tooltip>
      <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) insertImage(file) }}/>
    </div>
    <div ref={editorRef} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Conteúdo do comunicado" data-placeholder="Escreva como em um blog..." className="inia-rich-editor min-h-44 bg-card px-4 py-3 text-sm font-light leading-6 outline-none" onInput={emitValue} onPaste={(event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")) }}/>
    <div className="flex justify-between px-3 py-2 text-xs text-muted-foreground"><span className="text-destructive">{imageError}</span><span>{value.text.length}/5000</span></div>
  </div>
}
