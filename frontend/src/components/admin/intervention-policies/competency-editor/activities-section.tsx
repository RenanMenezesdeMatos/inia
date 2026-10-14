"use client"

import { useId } from "react"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { CompetencyActivity } from "@/schemas/admin/intervention-policy.schema"

import { NumberField, OptionSelect } from "../shared/fields"
import { ACTIVITY_KIND_LABELS } from "../shared/labels"
import type { LinkedDocument } from "./documents-section"

const MAX_ACTIVITIES = 20
export const ACTIVITY_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/
const NO_DOCUMENT = "__NONE__"

export function normalizeActivityKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40)
}

function newActivity(activities: CompetencyActivity[]): CompetencyActivity {
  const taken = new Set(activities.map((activity) => activity.key))
  let index = activities.length + 1
  while (taken.has(`atividade-${index}`)) index += 1
  return { key: `atividade-${index}`, title: `Atividade ${index}`, description: "", kind: "STUDY", documentId: null, estimatedMinutes: null }
}

/** Atividades sugeridas quando um treinamento usa esta competência (estudo, prática, simulação…), opcionalmente ligadas a um documento. */
export function ActivitiesSection({ activities, documents, disabled, onChange }: { activities: CompetencyActivity[]; documents: LinkedDocument[]; disabled: boolean; onChange: (activities: CompetencyActivity[]) => void }) {
  const setActivity = (index: number, next: CompetencyActivity) => onChange(activities.map((activity, position) => (position === index ? next : activity)))
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Atividades</h3>
          <p className="text-xs text-muted-foreground">Até {MAX_ACTIVITIES}. O documento de uma atividade precisa estar entre os vinculados acima.</p>
        </div>
        {disabled ? null : (
          <Button type="button" size="sm" variant="outline" disabled={activities.length >= MAX_ACTIVITIES} onClick={() => onChange([...activities, newActivity(activities)])}>
            <Plus /> Adicionar atividade
          </Button>
        )}
      </div>
      {activities.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma atividade.</p> : null}
      <ul className="space-y-2">
        {activities.map((activity, index) => (
          <li key={index}>
            <ActivityRow activity={activity} documents={documents} duplicated={activities.filter((other) => other.key === activity.key).length > 1} disabled={disabled} onChange={(next) => setActivity(index, next)} onRemove={() => onChange(activities.filter((_, position) => position !== index))} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ActivityRow({ activity, documents, duplicated, disabled, onChange, onRemove }: { activity: CompetencyActivity; documents: LinkedDocument[]; duplicated: boolean; disabled: boolean; onChange: (next: CompetencyActivity) => void; onRemove: () => void }) {
  const titleId = useId()
  const keyId = useId()
  const descriptionId = useId()
  const keyValid = ACTIVITY_KEY_PATTERN.test(activity.key)
  const documentOptions = [{ value: NO_DOCUMENT, label: "Nenhum documento" }, ...documents.map((document) => ({ value: document.id, label: document.title }))]
  if (activity.documentId && !documents.some((document) => document.id === activity.documentId)) documentOptions.push({ value: activity.documentId, label: "Documento não vinculado" })
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={titleId} className="text-xs">
            Título *
          </Label>
          <Input id={titleId} value={activity.title} maxLength={200} disabled={disabled} onChange={(event) => onChange({ ...activity, title: event.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={keyId} className="text-xs">
            Chave *
          </Label>
          <Input id={keyId} className="font-mono" value={activity.key} maxLength={40} disabled={disabled} aria-invalid={!keyValid || duplicated || undefined} onChange={(event) => onChange({ ...activity, key: normalizeActivityKey(event.target.value) })} />
          <p className={cn("text-xs", keyValid && !duplicated ? "text-muted-foreground" : "text-destructive")}>{duplicated ? "Outra atividade usa esta chave." : "Minúsculas, números, _ ou -."}</p>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={descriptionId} className="text-xs">
          Descrição
        </Label>
        <Textarea id={descriptionId} rows={2} maxLength={1000} disabled={disabled} value={activity.description} onChange={(event) => onChange({ ...activity, description: event.target.value })} />
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <OptionSelect className="min-w-44" label="Tipo de atividade" value={activity.kind} disabled={disabled} options={(Object.keys(ACTIVITY_KIND_LABELS) as CompetencyActivity["kind"][]).map((kind) => ({ value: kind, label: ACTIVITY_KIND_LABELS[kind] }))} onChange={(kind) => onChange({ ...activity, kind })} />
        <OptionSelect className="min-w-56" label="Documento" value={activity.documentId ?? NO_DOCUMENT} disabled={disabled} options={documentOptions} onChange={(value) => onChange({ ...activity, documentId: value === NO_DOCUMENT ? null : value })} />
        <NumberField label="Duração estimada (min)" allowEmpty emptyPlaceholder="—" value={activity.estimatedMinutes} min={1} max={2400} disabled={disabled} onChange={(estimatedMinutes) => onChange({ ...activity, estimatedMinutes })} />
        {disabled ? null : (
          <Button type="button" size="sm" variant="ghost" className="ml-auto self-end" aria-label={`Remover atividade ${activity.title}`} onClick={onRemove}>
            <Trash2 /> Remover
          </Button>
        )}
      </div>
    </div>
  )
}
