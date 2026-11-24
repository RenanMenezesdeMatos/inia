"use client"

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react"

import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDataContractsQuery } from "@/queries/admin/use-data-hub-queries"
import type { DataContract, FeedMapping, Preview } from "@/schemas/admin/data-hub.schema"
import { cn } from "@/lib/utils"

/** Preview ✓/✕ por registro, com erro por campo. Zero efeito operacional: só leitura e cálculo. */
export function PreviewTable({ preview, contract, mapping }: { preview: Preview; contract: DataContract; mapping: FeedMapping }) {
  const codeLabels = new Map(useDataContractsQuery().data?.errorCodes.record.map((entry) => [entry.code, entry.label.replace(/\.$/, "")]))
  // Só os campos mapeados (mesmo vazios na amostra) e os que têm erro: campo não mapeado só empurrava o que importa para fora da tela.
  const mapped = new Set(mapping.fields.map((field) => field.target))
  const fields = contract.fields.filter((field) => field.required || mapped.has(field.key) || preview.rows.some((row) => (row.record[field.key] ?? "") !== "" || row.errors.some((error) => error.field === field.key)))
  const hidden = contract.fields.length - fields.length
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-4" aria-hidden /> {preview.valid} válido(s)
        </span>
        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-300">
          <XCircle className="size-4" aria-hidden /> {preview.rejected} com erro
        </span>
        <span className="text-muted-foreground">de {preview.sampled} registro(s) da amostra</span>
      </div>
      {preview.mappingProblems.length > 0 ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p className="flex items-center gap-1 font-medium">
            <AlertTriangle className="size-4" aria-hidden /> Mapeamento incompleto
          </p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {preview.mappingProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.schemaWarnings.some((warning) => warning.required) ? (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          A amostra não contém {preview.schemaWarnings.filter((warning) => warning.required).map((warning) => `"${warning.source}"`).join(", ")} — coluna(s) mapeada(s) para campo obrigatório.
        </div>
      ) : null}
      {preview.errorSummary.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {preview.errorSummary.map((entry) => (
            <span key={entry.code} className="rounded-md bg-muted px-2 py-0.5" title={entry.code}>
              {entry.count} × {codeLabels.get(entry.code) ?? entry.code}
            </span>
          ))}
        </div>
      ) : null}
      <div className={cn(TABLE_FRAME, "max-h-96 overflow-auto")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead className="w-16">OK?</TableHead>
              {fields.map((field) => (
                <TableHead key={field.key} className="whitespace-nowrap text-xs" title={field.key}>
                  {field.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.rows.map((row) => {
              const errorsByField = new Map(row.errors.map((error) => [error.field ?? "*", error]))
              const general = row.errors.filter((error) => !error.field || !fields.some((field) => field.key === error.field))
              return (
                <TableRow key={row.recordNumber} className={cn(!row.valid && "bg-red-50/50 dark:bg-red-950/30")}>
                  <TableCell className="tabular-nums text-muted-foreground">{row.recordNumber}</TableCell>
                  <TableCell>
                    {row.valid ? (
                      <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-300" aria-label="Válido" />
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <XCircle className="size-4 text-red-600 dark:text-red-300" aria-label="Com erro" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <ul className="list-inside list-disc">
                            {row.errors.map((error, index) => (
                              <li key={index}>
                                {error.field ? <span>{fields.find((field) => field.key === error.field)?.label ?? error.field}: </span> : null}
                                {error.message}
                              </li>
                            ))}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                  {fields.map((field) => {
                    const error = errorsByField.get(field.key)
                    const value = row.record[field.key]
                    const normalized = field.key in row.normalized ? row.normalized[field.key] : undefined
                    return (
                      <TableCell key={field.key} className={cn("max-w-72 text-xs whitespace-normal wrap-anywhere", error && "text-red-700 underline decoration-red-400 decoration-wavy dark:text-red-300")} title={error ? `${error.code}: ${error.message}` : normalized !== undefined ? `Valor de origem: ${String(value)} · normalizado: ${normalized ?? "não reconhecido"}` : undefined}>
                        {value === null || value === undefined || value === "" ? <span className="text-muted-foreground">∅</span> : String(value)}
                        {/* Origem × normalizado (situação funcional, regime): "FER → FÉRIAS"; desconhecido fica explícito. */}
                        {normalized !== undefined && String(value) !== normalized ? <span className={cn("ml-1", normalized ? "text-muted-foreground" : "text-red-700 dark:text-red-300")} data-testid="preview-normalized">→ {normalized ?? "não reconhecido"}</span> : null}
                      </TableCell>
                    )
                  })}
                  {general.length > 0 ? <TableCell className="text-xs text-red-700 dark:text-red-300">{general.map((error) => error.message).join(" ")}</TableCell> : null}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {hidden > 0 ? <p className="text-xs text-muted-foreground">{hidden === 1 ? "1 campo não mapeado não é mostrado." : `${hidden} campos não mapeados não são mostrados.`}</p> : null}
    </div>
  )
}
