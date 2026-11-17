"use client"

import { useState } from "react"
import { Building2, Loader2, Megaphone, Save, Send, Users } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { sanitizeRichText } from "@/lib/security/sanitize-rich-text"
import { useEditCommunicationMutation, usePublishCommunicationMutation } from "@/queries/communications/use-communications"
import { broadcastSchema, COMMUNICATION_TAGS, type BroadcastInput, type Communication } from "@/schemas/communications/communication.schema"
import { BroadcastRichTextEditor } from "./broadcast-rich-text-editor"

type BroadcastAudience = BroadcastInput["audience"]
type BroadcastTag = BroadcastInput["tags"][number]
const isTag = (value: string): value is BroadcastTag => (COMMUNICATION_TAGS as readonly string[]).includes(value)

/**
 * Novo comunicado da liderança. Publica no servidor (`POST /communications`), que refaz o conteúdo, calcula o público pela
 * estrutura de quem publica (ou a organização inteira, com a permissão própria) e grava a auditoria; o comunicado entra no
 * Acompanhamento de quem publicou e de cada destinatário. "Toda a empresa" só aparece para quem tem a permissão de organização.
 */
export function SupervisorBroadcastDialog({ canPublishOrganization }: { canPublishOrganization: boolean }) {
  const [open, setOpen] = useState(false)
  return <Dialog open={open} onOpenChange={setOpen}>
    <Tooltip><TooltipTrigger asChild><DialogTrigger asChild><Button variant="ghost" size="icon" className="mb-0.5 text-primary" aria-label="Falar com o time"><Megaphone/></Button></DialogTrigger></TooltipTrigger><TooltipContent>Falar com o time</TooltipContent></Tooltip>
    {open ? <CommunicationForm canPublishOrganization={canPublishOrganization} onDone={() => setOpen(false)}/> : null}
  </Dialog>
}

/**
 * Edição pelo autor (`PATCH /communications/:id`): título, conteúdo e categorias. O público foi fixado na publicação e não muda; a
 * versão anterior fica guardada no servidor e quem recebeu passa a ver a nova, marcada como editada.
 */
export function EditCommunicationDialog({ communication, open, onOpenChange }: { communication: Communication; open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    {open ? <CommunicationForm editing={communication} canPublishOrganization={false} onDone={() => onOpenChange(false)}/> : null}
  </Dialog>
}

function CommunicationForm({ editing, canPublishOrganization, onDone }: { editing?: Communication; canPublishOrganization: boolean; onDone: () => void }) {
  const [title, setTitle] = useState(editing?.title ?? "")
  const [content, setContent] = useState({ html: "", text: "" })
  const [audience, setAudience] = useState<BroadcastAudience>(editing?.audience ?? "TEAM")
  const [tags, setTags] = useState<BroadcastTag[]>(editing ? editing.tags.filter(isTag) : ["Aviso"])
  const [error, setError] = useState("")
  const publishing = usePublishCommunicationMutation()
  const editingMutation = useEditCommunicationMutation()
  const pending = publishing.isPending || editingMutation.isPending
  const failed = (failure: unknown) => setError(failure instanceof Error && failure.message ? failure.message : editing ? "Não foi possível salvar a edição. Tente novamente." : "Não foi possível publicar o comunicado. Tente novamente.")

  function submit() {
    const candidate = { title, contentHtml: sanitizeRichText(content.html), plainText: content.text, audience: editing ? editing.audience : canPublishOrganization ? audience : "TEAM", tags }
    const parsed = broadcastSchema.safeParse(candidate)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Revise o comunicado.")
    setError("")
    if (editing) {
      editingMutation.mutate({ id: editing.id, input: { title: parsed.data.title, contentHtml: parsed.data.contentHtml, tags: parsed.data.tags } }, { onSuccess: () => { toast.success("Comunicado atualizado."); onDone() }, onError: failed })
      return
    }
    publishing.mutate(
      { title: parsed.data.title, contentHtml: parsed.data.contentHtml, audience: parsed.data.audience, tags: parsed.data.tags },
      { onSuccess: (published) => { toast.success(`Comunicado publicado para ${published.recipientCount.toLocaleString("pt-BR")} ${published.recipientCount === 1 ? "pessoa" : "pessoas"}.`); onDone() }, onError: failed },
    )
  }

  const description = editing
    ? `O público não muda (${editing.audience === "ORGANIZATION" ? "toda a empresa" : "sua equipe"}). A versão anterior fica guardada.`
    : canPublishOrganization ? "Crie uma publicação para sua equipe ou para toda a empresa." : "Crie uma publicação para toda a sua equipe."

  return <DialogContent className="w-[min(calc(100vw-2rem),42rem)] sm:max-w-2xl">
    <DialogHeader><DialogTitle>{editing ? "Editar comunicado" : "Novo comunicado"}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    <div className="max-h-[70dvh] space-y-4 overflow-y-auto pr-1">
      <div><label htmlFor="broadcast-title" className="mb-2 block text-xs font-medium text-muted-foreground">Título</label><Input id="broadcast-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Título do comunicado" className="font-heading text-base"/></div>
      {!editing && canPublishOrganization ? <div><p className="mb-2 text-xs font-medium text-muted-foreground">Publicar para</p><ToggleGroup type="single" value={audience} onValueChange={(value) => { if (value === "TEAM" || value === "ORGANIZATION") setAudience(value) }}><ToggleGroupItem value="TEAM"><Users/>Minha equipe</ToggleGroupItem><ToggleGroupItem value="ORGANIZATION"><Building2/>Toda a empresa</ToggleGroupItem></ToggleGroup></div> : null}
      <div><p className="mb-2 text-xs font-medium text-muted-foreground">Categorias</p><ToggleGroup type="multiple" value={tags} onValueChange={(values) => setTags(values.filter(isTag))} className="max-w-full flex-wrap"><ToggleGroupItem value="Aviso">Avisos</ToggleGroupItem><ToggleGroupItem value="Processos">Processos</ToggleGroupItem><ToggleGroupItem value="Campanha">Campanha</ToggleGroupItem></ToggleGroup></div>
      <BroadcastRichTextEditor value={content} onChange={setContent} initialHtml={editing?.contentHtml}/>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
    <DialogFooter><Button variant="outline" onClick={onDone} disabled={pending}>Cancelar</Button><Button onClick={submit} disabled={pending}>{pending ? <Loader2 className="animate-spin"/> : editing ? <Save/> : <Send/>}{editing ? "Salvar" : "Publicar"}</Button></DialogFooter>
  </DialogContent>
}
