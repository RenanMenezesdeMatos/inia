"use client"

import { useState } from "react"
import { AlertCircle, CheckCircle2, Code2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function humanizeKey(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase())
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function renderScalar(value: unknown) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>
  if (typeof value === "boolean") return value ? "Sim" : "Não"
  if (typeof value === "number") return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)
  return <span className="whitespace-pre-wrap">{String(value)}</span>
}

type StructuredResultValidation =
  | { valid: true; fields: { path: string; label: string; displayValue: string }[] }
  | { valid: false; issues: { path: string; message: string }[]; rawResult: Record<string, unknown> | null }

function isStructuredResultValidation(value: unknown): value is StructuredResultValidation {
  return isPlainObject(value) && typeof value.valid === "boolean" && (Array.isArray(value.fields) || Array.isArray(value.issues))
}

/**
 * Resultado estruturado do Orquestrador validado contra a definição única (construtor visual):
 * "válido ✓" com os campos rotulados ("Análise › Severidade: Alta"), ou "inválido" com o
 * motivo de cada campo — nunca só o JSON cru. O JSON continua em "Ver JSON".
 */
export function StructuredResultValidationView({ value }: { value: StructuredResultValidation }) {
  if (value.valid) {
    return (
      <div className="space-y-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3" data-testid="structured-result-valid">
        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" /> Resultado estruturado válido
        </div>
        {value.fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum campo preenchido.</p>
        ) : (
          <dl className="space-y-1">
            {value.fields.map((field) => (
              <div key={field.path} className="flex flex-wrap gap-x-2 text-sm">
                <dt className="text-xs font-medium text-muted-foreground">{field.label}:</dt>
                <dd className="text-sm">{field.displayValue}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-1.5 rounded-md border border-red-500/30 bg-red-500/5 p-3" data-testid="structured-result-invalid">
      <div className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
        <AlertCircle className="h-3.5 w-3.5" /> Resultado estruturado inválido
      </div>
      <p className="text-xs text-muted-foreground">O JSON devolvido pela IA não segue a definição do Orquestrador — nenhum campo foi disponibilizado para Condições/Outputs.</p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs">
        {value.issues.map((issue, index) => (
          <li key={`${issue.path}-${index}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  )
}

function StructuredTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isPlainObject(value)) {
    const validation = isStructuredResultValidation(value.structuredResultValidation) ? value.structuredResultValidation : null
    // Com a validação presente, o bloco rotulado substitui o `structuredResult` cru (que continua no JSON).
    const entries = Object.entries(value).filter(([key]) => !(validation && key === "structuredResult"))
    if (entries.length === 0) return <span className="text-muted-foreground">(vazio)</span>
    return (
      <dl className={cn("space-y-1.5", depth > 0 && "mt-1 border-l border-border pl-3")}>
        {entries.map(([key, child]) => (
          <div key={key} className="text-sm">
            {key === "structuredResultValidation" && validation ? (
              <>
                <dt className={cn("text-xs font-medium text-muted-foreground", depth === 0 && "text-sm font-semibold text-foreground")}>Resultado estruturado</dt>
                <dd className="text-sm">
                  <StructuredResultValidationView value={validation} />
                </dd>
              </>
            ) : (
              <>
                <dt className={cn("text-xs font-medium text-muted-foreground", depth === 0 && "text-sm font-semibold text-foreground")}>{humanizeKey(key)}</dt>
                <dd className="text-sm">{isPlainObject(child) || Array.isArray(child) ? <StructuredTree value={child} depth={depth + 1} /> : renderScalar(child)}</dd>
              </>
            )}
          </div>
        ))}
      </dl>
    )
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">(nenhum)</span>
    return (
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
        {value.map((item, index) => (
          <li key={index}>{isPlainObject(item) || Array.isArray(item) ? <StructuredTree value={item} depth={depth + 1} /> : renderScalar(item)}</li>
        ))}
      </ul>
    )
  }
  return <>{renderScalar(value)}</>
}

/** Structured Output amigável (Parte 41): "Diagnóstico › Severidade: HIGH" como visão
 * principal; JSON cru só sob demanda ("Ver JSON"). */
export function StructuredOutput({ value, title }: { value: unknown; title?: string }) {
  const [showJson, setShowJson] = useState(false)
  if (value === null || value === undefined) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        {title ? <p className="text-sm font-medium">{title}</p> : <span />}
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setShowJson((current) => !current)}>
          <Code2 className="h-3.5 w-3.5" />
          {showJson ? "Ver amigável" : "Ver JSON"}
        </Button>
      </div>
      {showJson ? (
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>
      ) : (
        <StructuredTree value={value} />
      )}
    </div>
  )
}
