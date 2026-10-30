"use client"

import { useId, useMemo, useState } from "react"
import { Check, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { cn } from "@/lib/utils"
import { useQaConditionPreviewQuery, useQaMeasurementsQuery, useQaPeopleQuery } from "@/queries/admin/use-qa-lab-queries"
import type { ConditionPreviewRow, QaMeasurement, QaPersonOption, StructureAnchor } from "@/schemas/admin/qa-lab.schema"
import { COMPARATOR_LABELS, type Comparator } from "@/schemas/admin/workflow-graph.schema"

import { formatDateTime, formatNumber, roleLabel } from "./qa-lab-format"

const NUMERIC_COMPARATORS: Comparator[] = ["LT", "LTE", "EQUALS", "NOT_EQUALS", "GTE", "GT"]
const PERIOD_OPTIONS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "", label: "Qualquer período" },
]

function sinceIso(days: string): string | undefined {
  if (!days) return undefined
  return new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString()
}

function OptionRow({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted", selected && "bg-primary/5")}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
    </button>
  )
}

export function PersonPicker({
  value,
  onChange,
  role = "OPERATOR",
  scope,
  workflowId,
  label = "Colaborador",
  emptyHint,
}: {
  value: string | null
  onChange: (person: QaPersonOption | null) => void
  role?: string
  scope?: { scopeType?: string; teamId?: string | null; subteamId?: string | null }
  /** Presente = só colaboradores elegíveis pra este Workflow (Abrangência + Filtro Populacional). */
  workflowId?: string
  label?: string
  emptyHint?: string
}) {
  const [search, setSearch] = useState("")
  const debounced = useDebouncedValue(search, 250)
  const query = useQaPeopleQuery({ role, workflowId, search: debounced || undefined, scopeType: scope?.scopeType, teamId: scope?.teamId ?? undefined, subteamId: scope?.subteamId ?? undefined, limit: 100 })
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`qa-person-${role}`}>{label}</Label>
      <div className="relative">
        <Search className="absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input id={`qa-person-${role}`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome" className="pl-8" />
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">{query.isLoading ? "Buscando colaboradores…" : ""}</p>
      <ScrollArea className="h-44 rounded-md border border-border p-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
        {query.isLoading ? (
          <div className="space-y-1 p-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : query.data && query.data.length > 0 ? (
          query.data.map((person) => (
            <OptionRow key={person.id} selected={value === person.id} onSelect={() => onChange(value === person.id ? null : person)}>
              <span className="block truncate">{person.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {roleLabel(person.role)}
                {person.teamName ? ` · ${person.teamName}` : ""}
                {person.subteamName ? ` · ${person.subteamName}` : ""}
                {role === "OPERATOR" ? (person.hasShift ? " · jornada cadastrada" : " · sem jornada") : ""}
              </span>
            </OptionRow>
          ))
        ) : (
          <p className="p-2 text-xs text-muted-foreground">{emptyHint ?? "Nenhuma pessoa encontrada."}</p>
        )}
      </ScrollArea>
    </div>
  )
}

export type ThresholdHint = { comparator: Comparator; thresholdNumeric?: number | null; thresholdBoolean?: boolean | null }

/** Localizar medições (Parte 17): valor atual x meta, com atalho Atende/Não atende. */
export function MeasurementPicker({
  indicatorCode,
  indicatorName,
  hint,
  value,
  onChange,
}: {
  indicatorCode: string
  indicatorName: string
  hint: ThresholdHint | null
  value: string | null
  onChange: (measurement: QaMeasurement | null) => void
}) {
  const [scenario, setScenario] = useState<"ALL" | "MATCH" | "NO_MATCH">(hint ? "MATCH" : "ALL")
  const [comparator, setComparator] = useState<Comparator>(hint?.comparator ?? "LT")
  const [threshold, setThreshold] = useState<string>(hint?.thresholdNumeric !== undefined && hint?.thresholdNumeric !== null ? String(hint.thresholdNumeric) : "")
  const [days, setDays] = useState("90")
  const fieldId = useId()
  const params = useMemo(
    () => ({
      indicatorCode,
      ...(scenario !== "ALL" && threshold !== "" ? { comparator, thresholdNumeric: Number(threshold), negate: scenario === "NO_MATCH" } : {}),
      from: sinceIso(days),
      limit: 50,
    }),
    [indicatorCode, scenario, comparator, threshold, days],
  )
  const query = useQaMeasurementsQuery(params)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label id={`${fieldId}-scenario`}>Cenário</Label>
          <div role="group" aria-labelledby={`${fieldId}-scenario`} className="flex gap-1">
            {(["MATCH", "NO_MATCH", "ALL"] as const).map((option) => (
              <Button key={option} type="button" size="sm" variant={scenario === option ? "default" : "outline"} aria-pressed={scenario === option} onClick={() => setScenario(option)}>
                {option === "MATCH" ? "Atende" : option === "NO_MATCH" ? "Não atende" : "Todas"}
              </Button>
            ))}
          </div>
        </div>
        {scenario !== "ALL" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-comparator`}>{indicatorName}</Label>
              <Select value={comparator} onValueChange={(next) => setComparator(next as Comparator)}>
                <SelectTrigger id={`${fieldId}-comparator`} className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NUMERIC_COMPARATORS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {COMPARATOR_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-threshold`}>Valor</Label>
              <Input id={`${fieldId}-threshold`} type="number" className="w-28" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
            </div>
          </>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-period`}>Período</Label>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger id={`${fieldId}-period`} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((option) => (
                <SelectItem key={option.value || "all"} value={option.value || "all"}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{query.isLoading ? "Localizando medições…" : query.data ? `${query.data.length} medição(ões) encontrada(s) — dados reais, nunca alterados.` : ""}</p>
      <ScrollArea className="h-56 rounded-md border border-border p-1">
        {query.data?.map((measurement) => (
          <OptionRow key={measurement.id} selected={value === measurement.id} onSelect={() => onChange(value === measurement.id ? null : measurement)}>
            <span className="flex items-center gap-2">
              <span className="truncate">{measurement.operatorName}</span>
              {measurement.teamName ? <Badge variant="outline">{measurement.teamName}</Badge> : null}
            </span>
            <span className="block text-xs text-muted-foreground">
              Valor atual: {formatNumber(measurement.value, 2)} {measurement.unit} · Meta: {measurement.targetValue !== null ? `${formatNumber(measurement.targetValue, 2)} ${measurement.unit}` : "não cadastrada"} · período até{" "}
              {formatDateTime(measurement.periodEnd)}
            </span>
          </OptionRow>
        ))}
        {query.data && query.data.length === 0 ? <p className="p-2 text-xs text-muted-foreground">Nenhuma medição com esses filtros.</p> : null}
      </ScrollArea>
    </div>
  )
}

const BRANCH_LABEL: Record<ConditionPreviewRow["branch"], string> = { true: "Atende (TRUE)", false: "Não atende (FALSE)", no_data: "Sem dados" }
const BRANCH_TONE: Record<ConditionPreviewRow["branch"], string> = {
  true: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  false: "bg-red-500/10 text-red-700 dark:text-red-300",
  no_data: "bg-muted text-muted-foreground",
}

/**
 * "7 colaboradores possuem PRV abaixo de 80%" (Parte 18/44) — prévia da massa de teste. Cada
 * linha vem classificada pelo MESMO evaluator determinístico da execução (backend:
 * condition-evaluator.ts), com um resumo do cálculo ("82 < meta 85 → verdadeiro") e, em Sem
 * Dados, o motivo. Em modo Consolidado avalia a estrutura como UMA linha. Zero IA.
 */
export function ConditionPreviewPicker({
  workflowId,
  graphSource,
  conditionNodes,
  simulatedNow,
  consolidatedStructure,
  selectedSubjectId,
  onSelect,
}: {
  workflowId: string
  graphSource: "PUBLISHED" | "DRAFT"
  conditionNodes: { id: string; label: string }[]
  simulatedNow: string | undefined
  consolidatedStructure?: StructureAnchor | undefined
  selectedSubjectId: string | null
  onSelect: (row: ConditionPreviewRow) => void
}) {
  const [nodeId, setNodeId] = useState<string>(conditionNodes[0]?.id ?? "")
  const [branch, setBranch] = useState<ConditionPreviewRow["branch"] | "ALL">("ALL")
  const nodeSelectId = useId()
  const query = useQaConditionPreviewQuery(nodeId ? { workflowId, nodeId, graphSource, simulatedNow, consolidatedStructure } : null)
  const counts = useMemo(() => {
    const totals = { true: 0, false: 0, no_data: 0 }
    for (const row of query.data?.rows ?? []) totals[row.branch] += 1
    return totals
  }, [query.data])
  const rows = (query.data?.rows ?? []).filter((row) => branch === "ALL" || row.branch === branch)
  if (conditionNodes.length === 0) return null
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={nodeSelectId}>Prévia por Condition</Label>
          <Select value={nodeId} onValueChange={setNodeId}>
            <SelectTrigger id={nodeSelectId} className="w-64">
              <SelectValue placeholder="Escolha a condição" />
            </SelectTrigger>
            <SelectContent>
              {conditionNodes.map((node) => (
                <SelectItem key={node.id} value={node.id}>
                  {node.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-1">
          {(["true", "false", "no_data", "ALL"] as const).map((option) => (
            <Button key={option} type="button" size="sm" variant={branch === option ? "default" : "outline"} onClick={() => setBranch(option)}>
              {option === "ALL" ? "Todos" : `${BRANCH_LABEL[option]} (${counts[option]})`}
            </Button>
          ))}
        </div>
      </div>
      {query.isError ? <p className="text-xs text-muted-foreground">{(query.error as Error).message}</p> : null}
      {query.isLoading ? <p className="text-xs text-muted-foreground">Calculando com a mesma regra da execução…</p> : null}
      {query.data ? (
        <p className="text-xs text-muted-foreground">
          {counts.true} atende(m), {counts.false} não atende(m) e {counts.no_data} sem dados para “{query.data.label}” — mesma lógica determinística da execução, sem IA.
        </p>
      ) : null}
      <ScrollArea className="h-44 rounded-md border border-border p-1">
        {rows.map((row) => (
          <OptionRow key={row.subjectId} selected={selectedSubjectId === row.subjectId} onSelect={() => onSelect(row)}>
            <span className="flex items-center gap-2">
              <span className="truncate">{row.label}</span>
              {row.subjectKind === "STRUCTURE" ? <Badge variant="outline">{row.memberCount} colaborador(es)</Badge> : null}
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", BRANCH_TONE[row.branch])}>{BRANCH_LABEL[row.branch]}</span>
            </span>
            <span className="block text-xs text-muted-foreground" title={row.reasonText ?? row.summary}>
              {row.teamName ? `${row.teamName} · ` : ""}
              {row.summary}
            </span>
          </OptionRow>
        ))}
        {query.data && rows.length === 0 ? <p className="p-2 text-xs text-muted-foreground">Ninguém neste ramo.</p> : null}
      </ScrollArea>
    </div>
  )
}
