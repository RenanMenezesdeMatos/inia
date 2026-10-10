"use client"

import { useState } from "react"
import { Plus, Wand2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DATE_FORMATS, FIELD_TYPE_LABELS, TRANSFORM_KINDS, TRANSFORM_LABELS, type DataContract, type FeedMapping, type FieldMapping, type Transform, type TransformKind } from "@/schemas/admin/data-hub.schema"
import { cn } from "@/lib/utils"

/**
 * Editor de mapeamento: campo de origem → campo INIA, com transformações declarativas e
 * determinísticas (nunca JavaScript, nunca IA). A sugestão automática por nome vem do backend;
 * o usuário confirma.
 */
const NONE = "__none__"
const CONSTANT = "__constant__"

function transformSummary(transform: Transform): string {
  switch (transform.kind) {
    case "PARSE_DATE":
      return `Data ${String(transform.format)}`
    case "PARSE_DECIMAL":
      return `Decimal "${String(transform.decimalSeparator)}"`
    case "DEFAULT":
      return `Padrão "${String(transform.value)}"`
    case "CONSTANT":
      return `Fixo "${String(transform.value)}"`
    case "CODE_MAP":
      return `Códigos (${Object.keys((transform.map as Record<string, string>) ?? {}).length})`
    case "BOOLEAN_MAP":
      return "Sim/Não"
    default:
      return TRANSFORM_LABELS[transform.kind]
  }
}

function defaultTransform(kind: TransformKind): Transform {
  switch (kind) {
    case "PARSE_DATE":
      return { kind, format: "dd/MM/yyyy" }
    case "PARSE_DECIMAL":
      return { kind, decimalSeparator: "," }
    case "BOOLEAN_MAP":
      return { kind, trueValues: ["sim", "true", "1"], falseValues: ["não", "nao", "false", "0"] }
    case "DEFAULT":
    case "CONSTANT":
      return { kind, value: "" }
    case "CODE_MAP":
      return { kind, map: {}, otherwise: "KEEP" }
    default:
      return { kind }
  }
}

function TransformEditor({ transform, onChange }: { transform: Transform; onChange: (next: Transform) => void }) {
  switch (transform.kind) {
    case "PARSE_DATE":
      return (
        <Select value={String(transform.format)} onValueChange={(format) => onChange({ ...transform, format })}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_FORMATS.map((format) => (
              <SelectItem key={format} value={format}>
                {format}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case "PARSE_DECIMAL":
      return (
        <Select value={String(transform.decimalSeparator)} onValueChange={(decimalSeparator) => onChange({ ...transform, decimalSeparator })}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value=",">Vírgula (123,45)</SelectItem>
            <SelectItem value=".">Ponto (123.45)</SelectItem>
          </SelectContent>
        </Select>
      )
    case "BOOLEAN_MAP":
      return (
        <div className="grid gap-2">
          <Input aria-label="Valores verdadeiros" value={(transform.trueValues as string[]).join(", ")} onChange={(event) => onChange({ ...transform, trueValues: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="verdadeiro: sim, true, 1" />
          <Input aria-label="Valores falsos" value={(transform.falseValues as string[]).join(", ")} onChange={(event) => onChange({ ...transform, falseValues: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="falso: não, false, 0" />
        </div>
      )
    case "DEFAULT":
    case "CONSTANT":
      return <Input aria-label="Valor" value={String(transform.value ?? "")} onChange={(event) => onChange({ ...transform, value: event.target.value })} placeholder="Valor" />
    case "CODE_MAP": {
      const map = (transform.map as Record<string, string>) ?? {}
      const text = Object.entries(map)
        .map(([from, to]) => `${from}=${to}`)
        .join("\n")
      return (
        <textarea
          aria-label="Mapa de códigos"
          className="min-h-20 w-full rounded-md border border-input bg-transparent px-2 py-1 font-mono text-xs"
          defaultValue={text}
          placeholder={"Atendente=OPERATOR\nSupervisor=SUPERVISOR"}
          onBlur={(event) => {
            const next: Record<string, string> = {}
            for (const line of event.target.value.split("\n")) {
              const [from, ...rest] = line.split("=")
              if (from?.trim() && rest.length) next[from.trim()] = rest.join("=").trim()
            }
            onChange({ ...transform, map: next })
          }}
        />
      )
    }
    default:
      return null
  }
}

function FieldRow({ field, mapping, columns, onChange }: { field: DataContract["fields"][number]; mapping: FieldMapping | undefined; columns: string[]; onChange: (next: FieldMapping | null) => void }) {
  const [adding, setAdding] = useState<TransformKind | "">("")
  const hasConstant = mapping?.transforms.some((transform) => transform.kind === "CONSTANT")
  const sourceValue = !mapping ? NONE : mapping.source === null ? CONSTANT : mapping.source
  const options = mapping?.source && !columns.includes(mapping.source) ? [mapping.source, ...columns] : columns

  function setSource(value: string) {
    if (value === NONE) return onChange(null)
    if (value === CONSTANT) return onChange({ target: field.key, source: null, transforms: hasConstant ? (mapping?.transforms ?? []) : [{ kind: "CONSTANT", value: "" }] })
    onChange({ target: field.key, source: value, transforms: (mapping?.transforms ?? []).filter((transform) => transform.kind !== "CONSTANT") })
  }

  function updateTransforms(transforms: Transform[]) {
    onChange({ target: field.key, source: mapping?.source ?? null, transforms })
  }

  return (
    <div className={cn("grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:items-start", field.required && !mapping && "border-amber-300 dark:border-amber-800")}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{field.label}</span>
          {field.required ? <Badge variant="outline">obrigatório</Badge> : null}
          {field.identity ? <Badge variant="secondary">identidade</Badge> : null}
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {field.key} · {FIELD_TYPE_LABELS[field.type] ?? field.type}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{field.description}</p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground" htmlFor={`map-${field.key}`}>
          Campo de origem
        </Label>
        <Select value={sourceValue} onValueChange={setSource}>
          <SelectTrigger id={`map-${field.key}`} className="w-full">
            <SelectValue placeholder="— não mapeado —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>— não mapeado —</SelectItem>
            <SelectItem value={CONSTANT}>Valor fixo / padrão</SelectItem>
            {options.map((column) => (
              <SelectItem key={column} value={column}>
                {column}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Transformações</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {(mapping?.transforms ?? []).map((transform, index) => (
            <Popover key={`${transform.kind}-${index}`}>
              <PopoverTrigger asChild>
                <button type="button" className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs hover:bg-muted/70">
                  {transformSummary(transform)}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-2">
                <p className="text-sm font-medium">{TRANSFORM_LABELS[transform.kind]}</p>
                <TransformEditor transform={transform} onChange={(next) => updateTransforms((mapping?.transforms ?? []).map((entry, position) => (position === index ? next : entry)))} />
                <Button size="sm" variant="ghost" onClick={() => updateTransforms((mapping?.transforms ?? []).filter((_, position) => position !== index))}>
                  <X /> Remover
                </Button>
              </PopoverContent>
            </Popover>
          ))}
          {mapping ? (
            <Select
              value={adding}
              onValueChange={(kind) => {
                updateTransforms([...(mapping.transforms ?? []), defaultTransform(kind as TransformKind)])
                setAdding("")
              }}
            >
              <SelectTrigger size="sm" className="h-7 w-auto gap-1 text-xs" aria-label={`Adicionar transformação em ${field.label}`}>
                <Plus className="size-3" />
                <span>Adicionar</span>
              </SelectTrigger>
              <SelectContent>
                {TRANSFORM_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {TRANSFORM_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      </div>
    </div>
  )
}

export function MappingEditor({ contract, columns, value, onChange, suggestion }: { contract: DataContract; columns: string[]; value: FeedMapping; onChange: (next: FeedMapping) => void; suggestion?: FeedMapping | null }) {
  const byTarget = new Map(value.fields.map((field) => [field.target, field]))
  const mappedRequired = contract.fields.filter((field) => field.required && byTarget.has(field.key)).length
  const totalRequired = contract.fields.filter((field) => field.required).length

  function setField(target: string, next: FieldMapping | null) {
    const others = value.fields.filter((field) => field.target !== target)
    onChange({ ...value, fields: next ? [...others, next] : others })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {mappedRequired}/{totalRequired} obrigatórios mapeados · {value.fields.length} campo(s) no total
        </p>
        {suggestion ? (
          <Button size="sm" variant="outline" onClick={() => onChange({ ...value, fields: suggestion.fields })}>
            <Wand2 /> Sugerir por nome
          </Button>
        ) : null}
      </div>
      <div className="space-y-2">
        {contract.fields.map((field) => (
          <FieldRow key={field.key} field={field} mapping={byTarget.get(field.key)} columns={columns} onChange={(next) => setField(field.key, next)} />
        ))}
      </div>
    </div>
  )
}
