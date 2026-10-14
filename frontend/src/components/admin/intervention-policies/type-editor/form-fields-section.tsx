"use client"

import { useId } from "react"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { FormField } from "@/schemas/interventions/intervention.schema"

import { OptionSelect } from "../shared/fields"
import { FORM_FIELD_KIND_LABELS } from "../shared/labels"
import { FIELD_KEY_PATTERN, newFormField, normalizeFieldKey } from "./type-rules"

const MAX_FIELDS = 20

/** Formulário DECLARATIVO que o responsável preenche na intervenção (até 20 campos; nada de script). */
export function FormFieldsSection({ fields, disabled, onChange }: { fields: FormField[]; disabled: boolean; onChange: (fields: FormField[]) => void }) {
  const setField = (index: number, next: FormField) => onChange(fields.map((field, position) => (position === index ? next : field)))
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Formulário</h3>
          <p className="text-xs text-muted-foreground">Campos que quem conduz a intervenção preenche. Opcional.</p>
        </div>
        {disabled ? null : (
          <Button type="button" size="sm" variant="outline" disabled={fields.length >= MAX_FIELDS} onClick={() => onChange([...fields, newFormField(fields)])}>
            <Plus /> Adicionar campo
          </Button>
        )}
      </div>
      {fields.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum campo.</p> : null}
      <ul className="space-y-2">
        {fields.map((field, index) => (
          <li key={index}>
            <FieldRow field={field} duplicated={fields.filter((other) => other.key === field.key).length > 1} disabled={disabled} onChange={(next) => setField(index, next)} onRemove={() => onChange(fields.filter((_, position) => position !== index))} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function FieldRow({ field, duplicated, disabled, onChange, onRemove }: { field: FormField; duplicated: boolean; disabled: boolean; onChange: (next: FormField) => void; onRemove: () => void }) {
  const labelId = useId()
  const keyId = useId()
  const helpId = useId()
  const optionsId = useId()
  const requiredId = useId()
  const keyValid = FIELD_KEY_PATTERN.test(field.key)
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={labelId} className="text-xs">
            Rótulo *
          </Label>
          <Input id={labelId} value={field.label} maxLength={120} disabled={disabled} onChange={(event) => onChange({ ...field, label: event.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={keyId} className="text-xs">
            Chave do campo *
          </Label>
          <Input id={keyId} className="font-mono" value={field.key} maxLength={40} disabled={disabled} aria-invalid={!keyValid || duplicated || undefined} onChange={(event) => onChange({ ...field, key: normalizeFieldKey(event.target.value) })} />
          <p className={cn("text-xs", keyValid && !duplicated ? "text-muted-foreground" : "text-destructive")}>{duplicated ? "Outra linha usa esta chave." : "Começa com letra minúscula; letras, números e _."}</p>
        </div>
        <OptionSelect
          label="Tipo do campo"
          value={field.kind}
          disabled={disabled}
          options={(Object.keys(FORM_FIELD_KIND_LABELS) as FormField["kind"][]).map((kind) => ({ value: kind, label: FORM_FIELD_KIND_LABELS[kind] }))}
          onChange={(kind) => {
            const { options: _options, ...rest } = field
            void _options
            onChange(kind === "SELECT" ? { ...rest, kind, options: field.options && field.options.length >= 2 ? field.options : ["Opção 1", "Opção 2"] } : { ...rest, kind })
          }}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={helpId} className="text-xs">
            Ajuda (opcional)
          </Label>
          <Input id={helpId} value={field.help ?? ""} maxLength={300} disabled={disabled} onChange={(event) => onChange({ ...field, help: event.target.value || undefined })} />
        </div>
        {field.kind === "SELECT" ? (
          <div className="space-y-1">
            <Label htmlFor={optionsId} className="text-xs">
              Opções (uma por linha) *
            </Label>
            <Textarea
              id={optionsId}
              rows={3}
              disabled={disabled}
              value={(field.options ?? []).join("\n")}
              onChange={(event) => onChange({ ...field, options: event.target.value.split("\n").map((option) => option.slice(0, 80)).slice(0, 30) })}
              onBlur={() => onChange({ ...field, options: (field.options ?? []).map((option) => option.trim()).filter(Boolean) })}
            />
            {(field.options ?? []).filter((option) => option.trim()).length < 2 ? <p className="text-xs text-destructive">Uma lista precisa de pelo menos duas opções.</p> : null}
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch id={requiredId} checked={field.required} disabled={disabled} onCheckedChange={(required) => onChange({ ...field, required })} />
          <Label htmlFor={requiredId} className="text-sm">
            Obrigatório
          </Label>
        </div>
        {disabled ? null : (
          <Button type="button" size="sm" variant="ghost" aria-label={`Remover campo ${field.label}`} onClick={onRemove}>
            <Trash2 /> Remover
          </Button>
        )}
      </div>
    </div>
  )
}
