"use client"

import { useId } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { InterventionTypeDefinition } from "@/schemas/admin/intervention-policy.schema"

import { NumberField, OptionSelect, ToggleField } from "../shared/fields"

type Step = InterventionTypeDefinition["script"][number]
export const MAX_SCRIPT_STEPS = 12
const KIND_LABELS: Record<Step["kind"], string> = { TASK: "Tarefa", CHECKPOINT: "Checkpoint (leitura do indicador)" }
const OWNER_LABELS: Record<Step["owner"], string> = { RESPONSIBLE: "Quem conduz (o responsável)", COLLABORATOR: "O colaborador" }

/**
 * ROTEIRO do formato: os passos com que a intervenção JÁ NASCE (ex.: lado a lado = sessões, combinado e leitura do indicador).
 * Quem lidera recebe o acompanhamento proposto, com dono e prazo em cada passo, e ajusta o que precisar — em vez de montar
 * tudo do zero. Tarefa exige a capacidade Tarefas; checkpoint exige Checkpoints (Plano de ação traz as duas).
 */
export function ScriptSection({ definition, disabled, onChange, onVisibilityChange }: { definition: InterventionTypeDefinition; disabled: boolean; onChange: (script: Step[]) => void; onVisibilityChange: (collaboratorVisible: boolean) => void }) {
  const sensitive = definition.capabilities.includes("CONTINUITY_REVIEW")
  const steps = definition.script
  const setStep = (index: number, next: Step) => onChange(steps.map((step, position) => (position === index ? next : step)))
  const move = (index: number, delta: -1 | 1) => {
    const next = [...steps]
    const [moved] = next.splice(index, 1)
    next.splice(index + delta, 0, moved!)
    onChange(next)
  }
  return (
    <section className="space-y-3 rounded-xl border p-4" data-testid="type-script">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Roteiro de passos</h3>
          <p className="text-xs text-muted-foreground">Os passos com que a intervenção já nasce, cada um com dono e prazo. Quem lidera ajusta depois. Opcional.</p>
        </div>
        {disabled ? null : (
          <Button type="button" size="sm" variant="outline" disabled={steps.length >= MAX_SCRIPT_STEPS} onClick={() => onChange([...steps, { kind: "TASK", title: `Passo ${steps.length + 1}`, description: "", owner: "RESPONSIBLE", dueInDays: null }])}>
            <Plus /> Adicionar passo
          </Button>
        )}
      </div>
      {steps.length === 0 ? <p className="text-xs text-muted-foreground">Sem roteiro: a intervenção nasce vazia e quem lidera inclui as tarefas.</p> : null}
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={index}>
            <StepRow
              step={step}
              position={index + 1}
              defaultDueDays={definition.defaultDueDays}
              duplicated={steps.filter((other) => other.title.trim().toLowerCase() === step.title.trim().toLowerCase()).length > 1}
              disabled={disabled}
              onChange={(next) => setStep(index, next)}
              onMoveUp={index > 0 ? () => move(index, -1) : undefined}
              onMoveDown={index < steps.length - 1 ? () => move(index, 1) : undefined}
              onRemove={() => onChange(steps.filter((_, current) => current !== index))}
            />
          </li>
        ))}
      </ol>
      <ToggleField
        label="O colaborador vê este acompanhamento"
        description={sensitive ? "A avaliação de continuidade nunca aparece para o colaborador." : "Com a intervenção em execução, o colaborador vê no Acompanhamento dele o que foi combinado e os passos, e marca os que são dele. Nunca vê o motivo, a análise nem as anotações de quem conduz."}
        checked={definition.collaboratorVisible && !sensitive}
        disabled={disabled || sensitive}
        onChange={onVisibilityChange}
      />
    </section>
  )
}

function StepRow({ step, position, defaultDueDays, duplicated, disabled, onChange, onMoveUp, onMoveDown, onRemove }: { step: Step; position: number; defaultDueDays: number; duplicated: boolean; disabled: boolean; onChange: (next: Step) => void; onMoveUp?: (() => void) | undefined; onMoveDown?: (() => void) | undefined; onRemove: () => void }) {
  const titleId = useId()
  const descriptionId = useId()
  const late = step.dueInDays !== null && step.dueInDays > defaultDueDays
  return (
    <div className="space-y-3 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1">
          <Label htmlFor={titleId} className="text-xs">
            Passo {position} *
          </Label>
          <Input id={titleId} value={step.title} maxLength={200} disabled={disabled} aria-invalid={duplicated || step.title.trim() === "" || undefined} onChange={(event) => onChange({ ...step, title: event.target.value })} />
        </div>
        {disabled ? null : (
          <div className="flex gap-1">
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Mover o passo ${position} para cima`} disabled={!onMoveUp} onClick={onMoveUp}>
              <ArrowUp />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Mover o passo ${position} para baixo`} disabled={!onMoveDown} onClick={onMoveDown}>
              <ArrowDown />
            </Button>
            <Button type="button" size="sm" variant="ghost" aria-label={`Remover o passo ${position}`} onClick={onRemove}>
              <Trash2 /> Remover
            </Button>
          </div>
        )}
      </div>
      {duplicated ? <p className="text-xs text-destructive">Outro passo tem o mesmo nome.</p> : null}
      <div className="space-y-1">
        <Label htmlFor={descriptionId} className="text-xs">
          O que fazer (opcional)
        </Label>
        <Textarea id={descriptionId} rows={2} maxLength={2000} value={step.description} disabled={disabled} onChange={(event) => onChange({ ...step, description: event.target.value })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <OptionSelect label="Tipo do passo" value={step.kind} disabled={disabled} options={(Object.keys(KIND_LABELS) as Step["kind"][]).map((value) => ({ value, label: KIND_LABELS[value] }))} onChange={(kind) => onChange({ ...step, kind })} />
        <OptionSelect label="Quem faz" value={step.owner} disabled={disabled} options={(Object.keys(OWNER_LABELS) as Step["owner"][]).map((value) => ({ value, label: OWNER_LABELS[value] }))} onChange={(owner) => onChange({ ...step, owner })} />
        <div>
          <NumberField label="Prazo (dias após a abertura)" allowEmpty emptyPlaceholder={String(defaultDueDays)} value={step.dueInDays} min={1} max={365} disabled={disabled} hint={step.dueInDays === null ? `Vazio = o prazo da intervenção (${defaultDueDays} dias).` : undefined} onChange={(dueInDays) => onChange({ ...step, dueInDays })} />
          {late ? <p className="text-xs text-destructive">Vence depois do prazo padrão do tipo ({defaultDueDays} dias).</p> : null}
        </div>
      </div>
    </div>
  )
}
