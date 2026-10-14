"use client"

import { CheckCircle2, Circle, CircleSlash } from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatCivilDate, formatDateTime } from "@/lib/format/date"
import { useInterventionCommand } from "@/queries/interventions/use-intervention-queries"
import { EVENT_LABELS, LEARNING_RESULT_LABELS, OPERATIONAL_RESULT_LABELS, type InterventionDetail, type InterventionItem } from "@/schemas/interventions/intervention.schema"
import { addInterventionItem, completeIntervention, updateInterventionItem } from "@/services/interventions/intervention-service"

const KIND_LABELS: Record<InterventionItem["kind"], string> = { TASK: "Tarefa", CHECKPOINT: "Checkpoint", ACTIVITY: "Atividade" }

function ItemRow({ detail, item }: { detail: InterventionDetail; item: InterventionItem }) {
  const canUpdate = detail.availableActions.includes("UPDATE_ITEM") && detail.status === "IN_PROGRESS"
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const update = useInterventionCommand((body: { status: "PENDING" | "DONE" | "SKIPPED"; note?: string; reading?: string }) => updateInterventionItem(detail.id, item.id, { expectedRevision: detail.revision, ...body }))
  const Icon = item.status === "DONE" ? CheckCircle2 : item.status === "SKIPPED" ? CircleSlash : Circle
  const reading = typeof item.result?.reading === "string" ? item.result.reading : null
  const note = typeof item.result?.note === "string" ? item.result.note : null
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="flex min-w-0 gap-2">
        <Icon className={item.status === "DONE" ? "mt-0.5 size-4 shrink-0 text-emerald-600" : "mt-0.5 size-4 shrink-0 text-muted-foreground"} />
        <div className="min-w-0 text-sm">
          <p className="font-medium">
            {item.title} <span className="text-xs font-normal text-muted-foreground">· {KIND_LABELS[item.kind]}</span>
          </p>
          {item.description ? <p className="text-xs text-muted-foreground">{item.description}</p> : null}
          <p className="text-xs text-muted-foreground">
            {item.ownerName ? `${item.ownerName} · ` : ""}
            {item.dueAt ? `prazo ${formatCivilDate(item.dueAt)}` : "sem prazo"}
            {item.overdue ? <Badge variant="outline" className="ml-1 border-amber-500/40 text-amber-700">vencido</Badge> : null}
          </p>
          {reading ? <p className="text-xs">Leitura: {reading}</p> : null}
          {note ? <p className="text-xs text-muted-foreground">Nota: {note}</p> : null}
          {item.completedAt ? <p className="text-xs text-muted-foreground">Registrado em {formatDateTime(item.completedAt)}{item.completedByName ? ` por ${item.completedByName}` : ""}</p> : null}
        </div>
      </div>
      {canUpdate && item.status === "PENDING" ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">{item.kind === "CHECKPOINT" ? "Registrar leitura" : "Registrar"}</Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-2">
            <Label>{item.kind === "CHECKPOINT" ? "O que foi observado e o valor do indicador" : "Nota (obrigatória para dispensar)"}</Label>
            <Textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} />
            <div className="flex gap-2">
              <Button size="sm" disabled={update.isPending || (item.kind === "CHECKPOINT" && text.trim().length < 5)} onClick={() => update.mutate(item.kind === "CHECKPOINT" ? { status: "DONE", reading: text.trim() } : { status: "DONE", note: text.trim() }, { onSuccess: () => setOpen(false) })}>
                Concluir
              </Button>
              <Button size="sm" variant="ghost" disabled={update.isPending || text.trim().length < 5} onClick={() => update.mutate({ status: "SKIPPED", note: text.trim() }, { onSuccess: () => setOpen(false) })}>
                Dispensar
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : canUpdate && item.status !== "PENDING" ? (
        <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ status: "PENDING" })}>
          Reabrir
        </Button>
      ) : null}
    </li>
  )
}

function AddItem({ detail }: { detail: InterventionDetail }) {
  const kinds = (["TASK", "CHECKPOINT", "ACTIVITY"] as const).filter((kind) => (kind === "TASK" ? detail.type.capabilities.some((c) => c.key === "TASKS" || c.key === "ACTION_PLAN") : kind === "CHECKPOINT" ? detail.type.capabilities.some((c) => c.key === "CHECKPOINTS" || c.key === "ACTION_PLAN") : detail.type.capabilities.some((c) => c.key === "TRAINING")))
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<InterventionItem["kind"]>(kinds[0] ?? "TASK")
  const [title, setTitle] = useState("")
  const [dueAt, setDueAt] = useState(detail.dueAt)
  const [owner, setOwner] = useState<"COLLABORATOR" | "RESPONSIBLE">("COLLABORATOR")
  const add = useInterventionCommand(() => addInterventionItem(detail.id, { expectedRevision: detail.revision, kind, title: title.trim(), dueAt, ownerId: owner === "COLLABORATOR" ? detail.person.id : detail.responsible.id }), "Item incluído.")
  if (kinds.length === 0 || !detail.availableActions.includes("UPDATE_ITEM")) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">Incluir item</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        <Select value={kind} onValueChange={(value) => setKind(value as InterventionItem["kind"])}>
          <SelectTrigger className="w-full" aria-label="Tipo de item"><SelectValue /></SelectTrigger>
          <SelectContent>{kinds.map((value) => <SelectItem key={value} value={value}>{KIND_LABELS[value]}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título" aria-label="Título" />
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} aria-label="Prazo" />
          <Select value={owner} onValueChange={(value) => setOwner(value as "COLLABORATOR" | "RESPONSIBLE")}>
            <SelectTrigger className="w-full" aria-label="Responsável pelo item"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="COLLABORATOR">{detail.person.name}</SelectItem>
              <SelectItem value="RESPONSIBLE">{detail.responsible.name}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="w-full" disabled={!title.trim() || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => { setOpen(false); setTitle("") } })}>
          Incluir
        </Button>
      </PopoverContent>
    </Popover>
  )
}

export function InterventionItems({ detail }: { detail: InterventionDetail }) {
  if (detail.items.length === 0 && !detail.availableActions.includes("UPDATE_ITEM")) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Tarefas, checkpoints e atividades{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {detail.counts.tasksDone}/{detail.counts.tasksTotal} tarefas · {detail.counts.checkpointsDone}/{detail.counts.checkpointsTotal} checkpoints · {detail.counts.activitiesDone}/{detail.counts.activitiesTotal} atividades
          </span>
        </p>
        <AddItem detail={detail} />
      </div>
      {detail.items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum item ainda.</p> : <ul className="divide-y">{detail.items.map((item) => <ItemRow key={item.id} detail={detail} item={item} />)}</ul>}
    </div>
  )
}

/**
 * Conclusão — TRÊS registros separados: as atividades (contadas pelo sistema), a aprendizagem e a evolução OPERACIONAL do
 * indicador. Concluir tarefas ou um curso não comprova melhora: "melhorou" exige a leitura que sustenta.
 */
export function CompleteIntervention({ detail }: { detail: InterventionDetail }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const [learning, setLearning] = useState<"ACHIEVED" | "PARTIAL" | "NOT_ACHIEVED" | "">("")
  const [operational, setOperational] = useState<"IMPROVED" | "UNCHANGED" | "WORSENED" | "NOT_MEASURED" | "">("")
  const [reading, setReading] = useState("")
  const complete = useInterventionCommand(() => completeIntervention(detail.id, { expectedRevision: detail.revision, note: note.trim(), learning: learning ? { result: learning, note: "" } : null, operational: operational ? { result: operational, reading: reading.trim() } : null }), "Intervenção concluída.")
  if (!detail.availableActions.includes("COMPLETE")) return null
  const issues = (complete.error as { details?: { issues?: { message: string }[] } } | null)?.details?.issues ?? []
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>Registrar resultado e concluir</Button>
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">Resultado da intervenção</p>
      <p className="text-xs text-muted-foreground">
        Atividades: {detail.counts.tasksDone}/{detail.counts.tasksTotal} tarefas e {detail.counts.activitiesDone}/{detail.counts.activitiesTotal} atividades concluídas (contado pelo sistema). Concluir as tarefas não comprova melhora do indicador.
      </p>
      {detail.completion.requireLearningAssessment || detail.type.capabilities.some((c) => c.key === "TRAINING") ? (
        <div className="space-y-1">
          <Label>Avaliação de aprendizagem{detail.completion.requireLearningAssessment ? " (obrigatória)" : ""}</Label>
          <Select value={learning || undefined} onValueChange={(value) => setLearning(value as typeof learning)}>
            <SelectTrigger className="w-full" aria-label="Avaliação de aprendizagem"><SelectValue placeholder="Escolha" /></SelectTrigger>
            <SelectContent>{Object.entries(LEARNING_RESULT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="space-y-1">
        <Label>Evolução operacional{detail.completion.requireOperationalReading ? " (obrigatória)" : ""}</Label>
        <Select value={operational || undefined} onValueChange={(value) => setOperational(value as typeof operational)}>
          <SelectTrigger className="w-full" aria-label="Evolução operacional"><SelectValue placeholder="Escolha" /></SelectTrigger>
          <SelectContent>{Object.entries(OPERATIONAL_RESULT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        {operational && operational !== "NOT_MEASURED" ? <Textarea value={reading} onChange={(event) => setReading(event.target.value)} rows={2} placeholder="Leitura do indicador: período, valor antes e depois" aria-label="Leitura do indicador" /> : null}
      </div>
      <div className="space-y-1">
        <Label>O que aconteceu{detail.completion.requireOutcomeNote ? " (obrigatório)" : ""}</Label>
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} aria-label="Resultado" />
      </div>
      {issues.length > 0 ? <ul className="text-xs text-destructive">{issues.map((issue) => <li key={issue.message}>• {issue.message}</li>)}</ul> : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={complete.isPending} onClick={() => complete.mutate(undefined)}>Concluir intervenção</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Voltar</Button>
      </div>
    </div>
  )
}

export function InterventionOutcome({ detail }: { detail: InterventionDetail }) {
  const outcome = detail.outcome as { activities?: { tasksDone: number; tasksTotal: number; activitiesDone: number; activitiesTotal: number }; learning?: { result: string } | null; operational?: { result: string; reading: string } | null; note?: string; continuity?: { label: string; justification: string }; cancellation?: { reason: string } } | null
  if (!outcome) return null
  return (
    <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
      {outcome.continuity ? (
        <>
          <p className="font-medium">Decisão: {outcome.continuity.label}</p>
          <p className="text-muted-foreground">{outcome.continuity.justification}</p>
          <p className="text-xs text-muted-foreground">Nenhuma situação funcional foi alterada pela INIA.</p>
        </>
      ) : null}
      {outcome.cancellation ? <p className="text-muted-foreground">Cancelada: {outcome.cancellation.reason}</p> : null}
      {outcome.activities ? <p>Atividades: {outcome.activities.tasksDone}/{outcome.activities.tasksTotal} tarefas · {outcome.activities.activitiesDone}/{outcome.activities.activitiesTotal} atividades</p> : null}
      {outcome.learning ? <p>Aprendizagem: {LEARNING_RESULT_LABELS[outcome.learning.result] ?? outcome.learning.result}</p> : null}
      {outcome.operational ? <p>Evolução operacional: {OPERATIONAL_RESULT_LABELS[outcome.operational.result] ?? outcome.operational.result}{outcome.operational.reading ? ` — ${outcome.operational.reading}` : ""}</p> : null}
      {outcome.note ? <p className="text-muted-foreground">{outcome.note}</p> : null}
    </div>
  )
}

export function InterventionHistory({ detail }: { detail: InterventionDetail }) {
  return (
    <ol className="space-y-1.5 text-sm">
      {detail.events.map((event) => (
        <li key={event.id} className="flex flex-wrap gap-x-2">
          <span className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</span>
          <span className="font-medium">{EVENT_LABELS[event.eventType] ?? event.eventType}</span>
          <span className="text-muted-foreground">{event.actorName ?? (event.actorKind === "WORKFLOW" ? "pelo Workflow" : "pelo sistema")}</span>
          {typeof event.payload.reason === "string" ? <span className="w-full text-xs text-muted-foreground">{event.payload.reason}</span> : null}
          {typeof event.payload.reading === "string" && event.payload.reading ? <span className="w-full text-xs text-muted-foreground">Leitura: {event.payload.reading}</span> : null}
        </li>
      ))}
    </ol>
  )
}
