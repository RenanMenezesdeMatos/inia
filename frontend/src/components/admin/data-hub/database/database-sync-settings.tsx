"use client"

import { ChevronDown, Info, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { COLUMN_CATEGORY_LABELS, DATABASE_BATCH_SIZE_DEFAULT, DATABASE_MAX_ROWS_PER_RUN_DEFAULT, type DatabaseColumn, type DatabaseObjectDescription, type DatabaseSync } from "@/schemas/admin/data-hub.schema"

/**
 * Como a INIA lê o conjunto de dados a cada carga. Incremental quando existe um campo confiável de atualização;
 * senão, leitura completa (a INIA relê tudo e só aplica o que mudou — nada duplica). Página, limite por carga e
 * releitura de segurança ficam recolhidos com padrões seguros.
 */
export type DatabaseSyncDraft = { mode: "INCREMENTAL" | "FULL"; cursorColumn: string; keyColumns: string[]; lookbackMinutes: number; batchSize: number; maxRowsPerRun: number }

const UPDATE_COLUMN = /(atualiz|alterad|modific|updated|changed|last_?upd|dt_?atu|data_?atu|ultima_?alter|dh_?alter)/i
const DATE_CATEGORIES = new Set(["DATETIME", "DATETIME_TZ", "DATE"])

/** Sugestão inicial — sempre revisável. Nunca escolhe um número crescente como "atualização" sozinho (só pegaria linhas novas). */
export function suggestSync(description: DatabaseObjectDescription): DatabaseSyncDraft {
  const keys = description.primaryKey.filter((name) => description.columns.find((column) => column.name === name)?.keyEligible).slice(0, 3)
  const cursor = description.columns.find((column) => column.cursorEligible && DATE_CATEGORIES.has(column.category) && UPDATE_COLUMN.test(column.name))
  if (cursor) return { mode: "INCREMENTAL", cursorColumn: cursor.name, keyColumns: keys.filter((key) => key !== cursor.name), lookbackMinutes: 0, batchSize: DATABASE_BATCH_SIZE_DEFAULT, maxRowsPerRun: DATABASE_MAX_ROWS_PER_RUN_DEFAULT }
  return { mode: "FULL", cursorColumn: "", keyColumns: keys, lookbackMinutes: 0, batchSize: DATABASE_BATCH_SIZE_DEFAULT, maxRowsPerRun: DATABASE_MAX_ROWS_PER_RUN_DEFAULT }
}

export function toDatabaseSync(draft: DatabaseSyncDraft): DatabaseSync {
  const keyColumns = draft.keyColumns.filter(Boolean)
  return draft.mode === "INCREMENTAL" ? { mode: "INCREMENTAL", cursorColumn: draft.cursorColumn, keyColumns: keyColumns.filter((key) => key !== draft.cursorColumn), lookbackMinutes: draft.lookbackMinutes } : { mode: "FULL", keyColumns }
}

export function syncDraftValid(draft: DatabaseSyncDraft): boolean {
  return draft.mode === "FULL" || Boolean(draft.cursorColumn)
}

export function describeSync(draft: DatabaseSyncDraft): string {
  if (draft.mode === "INCREMENTAL") return `Incremental por ${draft.cursorColumn}${draft.keyColumns.length ? ` (desempate: ${draft.keyColumns.join(", ")})` : ""}`
  return draft.keyColumns.length ? `Leitura completa em páginas por ${draft.keyColumns.join(", ")}` : "Leitura completa em uma consulta"
}

function columnLabel(column: DatabaseColumn): string {
  return `${column.name} · ${COLUMN_CATEGORY_LABELS[column.category] ?? column.nativeType}${column.primaryKeyPosition ? " · chave" : ""}`
}

export function DatabaseSyncSettings({ description, value, onChange }: { description: DatabaseObjectDescription; value: DatabaseSyncDraft; onChange: (next: DatabaseSyncDraft) => void }) {
  const set = <K extends keyof DatabaseSyncDraft>(key: K, next: DatabaseSyncDraft[K]) => onChange({ ...value, [key]: next })
  const cursorOptions = description.columns.filter((column) => column.cursorEligible)
  const keyOptions = description.columns.filter((column) => column.keyEligible)
  const cursor = description.columns.find((column) => column.name === value.cursorColumn)
  const canIncrement = cursorOptions.length > 0
  const keys = value.keyColumns

  return (
    <div className="space-y-4">
      <RadioGroup value={value.mode} onValueChange={(mode) => onChange({ ...value, mode: mode as DatabaseSyncDraft["mode"], cursorColumn: mode === "INCREMENTAL" ? value.cursorColumn || cursorOptions.find((column) => DATE_CATEGORIES.has(column.category))?.name || cursorOptions[0]?.name || "" : value.cursorColumn })} className="gap-3">
        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
          <RadioGroupItem value="INCREMENTAL" disabled={!canIncrement} aria-label="Incremental" />
          <span>
            <span className="font-medium">Incremental — só o que mudou</span>
            <span className="block text-xs text-muted-foreground">Cada carga lê apenas as linhas criadas ou alteradas depois da anterior. Recomendado quando existe um campo de data/hora de atualização.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
          <RadioGroupItem value="FULL" aria-label="Leitura completa" />
          <span>
            <span className="font-medium">Leitura completa</span>
            <span className="block text-xs text-muted-foreground">Cada carga relê a tabela/visão inteira; a INIA só aplica o que mudou e nada é duplicado. Use quando não houver campo de atualização confiável.</span>
          </span>
        </label>
      </RadioGroup>

      {!canIncrement ? (
        <p className="flex gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Esta {description.kind === "VIEW" ? "visão" : "tabela"} não tem coluna de data/hora ou número que permita uma leitura incremental confiável — use a leitura completa.
        </p>
      ) : null}

      {value.mode === "INCREMENTAL" ? (
        <div className="space-y-1.5">
          <Label htmlFor="sync-cursor">Campo de atualização</Label>
          <Select value={value.cursorColumn} onValueChange={(next) => set("cursorColumn", next)}>
            <SelectTrigger id="sync-cursor" className="w-full">
              <SelectValue placeholder="Escolha a coluna" />
            </SelectTrigger>
            <SelectContent>
              {cursorOptions.map((column) => (
                <SelectItem key={column.name} value={column.name}>
                  {columnLabel(column)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {cursor && !DATE_CATEGORIES.has(cursor.category)
              ? "Número crescente: só linhas NOVAS são lidas — alterações em linhas que já existiam não chegam. Prefira uma data/hora de atualização se houver."
              : "Precisa mudar sempre que a linha é criada ou alterada. Linhas com este campo vazio não são lidas."}
          </p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label>{value.mode === "INCREMENTAL" ? "Chave de desempate (opcional)" : "Chave para ler em páginas (opcional)"}</Label>
        <div className="space-y-2">
          {keys.map((key, index) => (
            <div key={index} className="flex gap-2">
              <Select value={key} onValueChange={(next) => set("keyColumns", keys.map((current, position) => (position === index ? next : current)))}>
                <SelectTrigger className="w-full" aria-label={`Chave ${index + 1}`}>
                  <SelectValue placeholder="Escolha a coluna" />
                </SelectTrigger>
                <SelectContent>
                  {keyOptions.filter((column) => column.name === key || !keys.includes(column.name)).map((column) => (
                    <SelectItem key={column.name} value={column.name}>
                      {columnLabel(column)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" aria-label="Remover chave" onClick={() => set("keyColumns", keys.filter((_, position) => position !== index))}>
                <X />
              </Button>
            </div>
          ))}
          {keys.length < 3 && keyOptions.length > keys.length ? (
            <Button variant="outline" size="sm" onClick={() => set("keyColumns", [...keys, ""])}>
              <Plus /> Adicionar coluna
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {value.mode === "INCREMENTAL"
            ? "Desempata linhas com o mesmo valor no campo de atualização (ex.: o identificador da linha). Já vem preenchida com a chave primária quando existe."
            : keys.length
              ? "Com chave, a leitura é feita em páginas e, se cair no meio, retoma de onde parou."
              : `Sem chave, a leitura acontece numa consulta só, limitada a ${new Intl.NumberFormat("pt-BR").format(value.maxRowsPerRun)} linhas por carga.`}
        </p>
      </div>

      <Collapsible className="rounded-lg border border-border">
        <CollapsibleTrigger className="group flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium">
          <span>Opções avançadas de leitura</span>
          <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-4 border-t border-border px-3 py-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="sync-batch">Linhas por página</Label>
            <Input id="sync-batch" inputMode="numeric" value={value.batchSize} onChange={(event) => set("batchSize", Math.min(10_000, Math.max(100, Number(event.target.value.replace(/\D/g, "")) || DATABASE_BATCH_SIZE_DEFAULT)))} />
            <p className="text-xs text-muted-foreground">Cada página é aplicada e confirmada antes da próxima (100–10.000).</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sync-max">Linhas por carga</Label>
            <Input id="sync-max" inputMode="numeric" value={value.maxRowsPerRun} onChange={(event) => set("maxRowsPerRun", Math.min(1_000_000, Math.max(1_000, Number(event.target.value.replace(/\D/g, "")) || DATABASE_MAX_ROWS_PER_RUN_DEFAULT)))} />
            <p className="text-xs text-muted-foreground">Acima disso, a próxima carga continua sozinha de onde parou.</p>
          </div>
          {value.mode === "INCREMENTAL" && cursor && DATE_CATEGORIES.has(cursor.category) ? (
            <div className="space-y-1.5">
              <Label htmlFor="sync-lookback">Releitura de segurança (min)</Label>
              <Input id="sync-lookback" inputMode="numeric" value={value.lookbackMinutes} onChange={(event) => set("lookbackMinutes", Math.min(10_080, Number(event.target.value.replace(/\D/g, "")) || 0))} />
              <p className="text-xs text-muted-foreground">Relê os últimos N minutos a cada ciclo, para linhas gravadas com atraso. 0 = desligado.</p>
            </div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
