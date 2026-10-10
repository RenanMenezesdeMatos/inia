"use client"

import { useState } from "react"
import { Building2, Megaphone, Send, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { sanitizeRichText } from "@/lib/security/sanitize-rich-text"
import { broadcastSchema, type BroadcastInput } from "@/schemas/profile/broadcast.schema"
import { BroadcastRichTextEditor } from "./broadcast-rich-text-editor"

export type BroadcastAudience = "team" | "company"
type BroadcastTag = BroadcastInput["tags"][number]
export type BroadcastDraft = Pick<BroadcastInput, "title" | "contentHtml" | "plainText" | "audience" | "tags">

export function SupervisorBroadcastDialog({ onPublish }: { onPublish: (draft: BroadcastDraft) => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState({ html: "", text: "" })
  const [audience, setAudience] = useState<BroadcastAudience>("team")
  const [tags, setTags] = useState<BroadcastTag[]>(["Aviso"])
  const [error, setError] = useState("")

  function publish() {
    const candidate = { title, contentHtml: sanitizeRichText(content.html), plainText: content.text, audience, tags }
    const parsed = broadcastSchema.safeParse(candidate)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Revise o comunicado.")
    onPublish(parsed.data)
    setTitle("")
    setContent({ html: "", text: "" })
    setTags(["Aviso"])
    setError("")
    setOpen(false)
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    <Tooltip><TooltipTrigger asChild><DialogTrigger asChild><Button variant="ghost" size="icon" className="mb-0.5 text-primary" aria-label="Falar com o time"><Megaphone/></Button></DialogTrigger></TooltipTrigger><TooltipContent>Falar com o time</TooltipContent></Tooltip>
    <DialogContent className="w-[min(calc(100vw-2rem),42rem)] sm:max-w-2xl">
      <DialogHeader><DialogTitle>Novo comunicado</DialogTitle><DialogDescription>Crie uma publicação para sua equipe ou para toda a empresa.</DialogDescription></DialogHeader>
      <div className="max-h-[70dvh] space-y-4 overflow-y-auto pr-1">
        <div><label htmlFor="broadcast-title" className="mb-2 block text-xs font-medium text-muted-foreground">Título</label><Input id="broadcast-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Título do comunicado" className="font-heading text-base"/></div>
        <div><p className="mb-2 text-xs font-medium text-muted-foreground">Publicar para</p><ToggleGroup type="single" value={audience} onValueChange={(value) => { if (value === "team" || value === "company") setAudience(value) }}><ToggleGroupItem value="team"><Users/>Minha equipe</ToggleGroupItem><ToggleGroupItem value="company"><Building2/>Toda a empresa</ToggleGroupItem></ToggleGroup></div>
        <div><p className="mb-2 text-xs font-medium text-muted-foreground">Categorias</p><ToggleGroup type="multiple" value={tags} onValueChange={(values) => setTags(values.filter((value): value is BroadcastTag => value === "Aviso" || value === "Processos" || value === "Campanha"))} className="max-w-full flex-wrap"><ToggleGroupItem value="Aviso">Avisos</ToggleGroupItem><ToggleGroupItem value="Processos">Processos</ToggleGroupItem><ToggleGroupItem value="Campanha">Campanha</ToggleGroupItem></ToggleGroup></div>
        <BroadcastRichTextEditor value={content} onChange={setContent}/>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={publish}><Send/>Publicar</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
