"use client"

import { useState } from "react"
import { Check, Pencil, Power, RotateCcw, ShieldCheck, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { useReviewPatternMutation } from "@/queries/best-practices/use-best-practices"
import type { PatternDetail, ReviewAction } from "@/schemas/best-practices/best-practices.schema"

type ReasonAction = Extract<ReviewAction, "REJECT" | "DEACTIVATE" | "CONFIRM_NOT_OBLIGATION">
const REASON_COPY: Record<ReasonAction, { label: string; title: string; placeholder: string }> = {
  REJECT: { label: "Rejeitar", title: "Por que rejeitar?", placeholder: "Ex.: o comportamento é uma etapa exigida pelo procedimento X." },
  DEACTIVATE: { label: "Desativar", title: "Por que desativar?", placeholder: "Ex.: orientação em revisão pela qualidade." },
  CONFIRM_NOT_OBLIGATION: { label: "Confirmar que não é obrigação", title: "Como você confirmou?", placeholder: "Ex.: revisei os procedimentos e o argumentário do contexto: não é exigido." },
}

/**
 * Revisão humana do padrão (só quem administra a população dele). Aprovar exige obrigação resolvida e evidência sustentada (o backend
 * confere); rejeitar, desativar e confirmar a obrigação pedem o motivo num popover; editar o texto devolve o padrão para revisão.
 * Números e evidências nunca são editáveis.
 */
export function PatternReviewActions({ pattern }: { pattern: PatternDetail }) {
  const review = useReviewPatternMutation(pattern.id)
  const [editing, setEditing] = useState(false)
  const status = pattern.reviewStatus
  const obligationPending = pattern.obligationStatus === "UNDETERMINED" && !pattern.obligationConfirmedByReview
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(status === "PENDING_REVIEW" || status === "REJECTED") && (
          <Button size="sm" disabled={review.isPending || obligationPending} title={obligationPending ? "Confirme antes que não é obrigação do processo." : undefined} onClick={() => review.mutate({ action: "APPROVE" })}><Check /> Aprovar</Button>
        )}
        {status === "INACTIVE" && <Button size="sm" disabled={review.isPending || obligationPending} onClick={() => review.mutate({ action: "REACTIVATE" })}><RotateCcw /> Reativar</Button>}
        {obligationPending && <ReasonButton action="CONFIRM_NOT_OBLIGATION" icon={<ShieldCheck />} pending={review.isPending} onConfirm={(reason) => review.mutate({ action: "CONFIRM_NOT_OBLIGATION", reason })} />}
        {(status === "PENDING_REVIEW" || status === "APPROVED") && <ReasonButton action="REJECT" icon={<X />} pending={review.isPending} onConfirm={(reason) => review.mutate({ action: "REJECT", reason })} />}
        {status === "APPROVED" && <ReasonButton action="DEACTIVATE" icon={<Power />} pending={review.isPending} onConfirm={(reason) => review.mutate({ action: "DEACTIVATE", reason })} />}
        {(status === "PENDING_REVIEW" || status === "APPROVED") && !editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil /> Editar texto</Button>}
      </div>
      {editing ? <EditForm pattern={pattern} pending={review.isPending} onCancel={() => setEditing(false)} onSave={(changes) => review.mutate({ action: "EDIT", changes }, { onSuccess: () => setEditing(false) })} /> : null}
    </div>
  )
}

function ReasonButton({ action, icon, pending, onConfirm }: { action: ReasonAction; icon: React.ReactNode; pending: boolean; onConfirm: (reason: string) => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const copy = REASON_COPY[action]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={pending}>{icon} {copy.label}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        <Label htmlFor={`reason-${action}`}>{copy.title}</Label>
        <Textarea id={`reason-${action}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={copy.placeholder} rows={3} />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button size="sm" disabled={reason.trim().length < 3 || pending} onClick={() => { onConfirm(reason.trim()); setOpen(false); setReason("") }}>Confirmar</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function EditForm({ pattern, pending, onCancel, onSave }: { pattern: PatternDetail; pending: boolean; onCancel: () => void; onSave: (changes: { name: string; description: string; guidance: string; suggestedPhrasing: string | null; notApplicableWhen: string | null; howItHelps: string | null }) => void }) {
  const [name, setName] = useState(pattern.name)
  const [description, setDescription] = useState(pattern.description)
  const [guidance, setGuidance] = useState(pattern.guidance)
  const [phrasing, setPhrasing] = useState(pattern.suggestedPhrasing ?? "")
  const [notApplicable, setNotApplicable] = useState(pattern.notApplicableWhen ?? "")
  const [howItHelps, setHowItHelps] = useState(pattern.howItHelps ?? "")
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">Editar o texto devolve o padrão para revisão. Números, contextos e evidências não mudam.</p>
      <div className="space-y-1"><Label htmlFor="bp-name">Nome</Label><Input id="bp-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="bp-description">Descrição</Label><Textarea id="bp-description" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="bp-guidance">Como aplicar</Label><Textarea id="bp-guidance" rows={2} value={guidance} onChange={(event) => setGuidance(event.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="bp-phrasing">Sugestão de fala (exemplo, sem dado pessoal)</Label><Textarea id="bp-phrasing" rows={2} value={phrasing} onChange={(event) => setPhrasing(event.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="bp-not-applicable">Não se aplica quando</Label><Input id="bp-not-applicable" value={notApplicable} onChange={(event) => setNotApplicable(event.target.value)} /></div>
      <div className="space-y-1">
        <Label htmlFor="bp-how-it-helps">Como isso ajuda no resultado (opcional)</Label>
        <Textarea id="bp-how-it-helps" rows={2} value={howItHelps} aria-describedby="bp-how-it-helps-hint" onChange={(event) => setHowItHelps(event.target.value)} />
        <p id="bp-how-it-helps-hint" className="text-xs text-muted-foreground">Como a prática ajuda em {pattern.indicatorName}, pelo que ela muda na chamada, sem prometer resultado. O feedback só liga a prática ao resultado com este texto.</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" disabled={pending || name.trim().length < 3 || guidance.trim().length < 3} onClick={() => onSave({ name: name.trim(), description: description.trim(), guidance: guidance.trim(), suggestedPhrasing: phrasing.trim() || null, notApplicableWhen: notApplicable.trim() || null, howItHelps: howItHelps.trim() || null })}>Salvar e voltar para revisão</Button>
      </div>
    </div>
  )
}
