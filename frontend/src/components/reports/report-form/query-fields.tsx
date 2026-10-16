"use client"

import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { ReportDefinition, ReportOptions } from "@/schemas/reports/reports.schema"
import { GROUP_BY_LABELS, PERIOD_DISPLAY_LABELS, SITUATION_LABELS, SORT_LABELS, TOOL_LABELS, VIEW_LABELS, WINDOW_LABELS, WORKFORCE_STATUS_LABELS } from "../report-labels"
import { ChipToggleGroup, Field, OptionSelect } from "./form-controls"
import { switchTool } from "./form-helpers"

const options = <K extends string>(labels: Record<K, string>, keys?: K[]) => (keys ?? (Object.keys(labels) as K[])).map((value) => ({ value, label: labels[value] }))

/** "Que dados": o tipo de consulta e os parâmetros dela, a estrutura e o período analisado. */
export function QueryFields({ definition, onChange, catalog }: { definition: ReportDefinition; onChange: (definition: ReportDefinition) => void; catalog: ReportOptions }) {
  const set = (patch: Partial<ReportDefinition>) => onChange({ ...definition, ...patch } as ReportDefinition)
  const indicatorOptions = catalog.indicators.map((indicator) => ({ value: indicator.code, label: indicator.name }))
  const structureValue = definition.structure.mode === "RECIPIENT" ? "RECIPIENT" : `${definition.structure.subjectKind}:${definition.structure.subjectId}`
  const groupKeys: string[] = definition.tool === "WORKFORCE" ? ["ESTRUTURA", "UNIDADE", "SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "TEAM", "SUBTEAM"] : ["ESTRUTURA", "UNIDADE", "SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "TEAM", "SUBTEAM", "PESSOA", "COMPETENCIA"]

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Tipo de consulta" className="sm:col-span-2">
        <OptionSelect ariaLabel="Tipo de consulta" value={definition.tool} onChange={(tool) => onChange(switchTool(definition, tool))} options={options(TOOL_LABELS)} />
      </Field>

      {definition.tool === "INDICATOR_DIAGNOSIS" ? (
        <Field label="Indicador" className="sm:col-span-2">
          <OptionSelect ariaLabel="Indicador do diagnóstico" value={definition.indicators[0]} onChange={(code) => set({ indicators: [code] })} options={indicatorOptions.filter((option) => option.value !== "PRV")} placeholder="Escolha o indicador" />
        </Field>
      ) : definition.tool === "INDICATOR_QUERY" ? (
        <Field label="Indicadores" hint="Nenhum marcado = todos os indicadores com dado. PRV = resultado geral (quartil geral)." className="sm:col-span-2">
          <ChipToggleGroup ariaLabel="Indicadores" options={indicatorOptions} selected={definition.indicators} onChange={(indicators) => set({ indicators })} />
        </Field>
      ) : (
        <Field label="Situações" hint="Nenhuma marcada = todas as situações." className="sm:col-span-2">
          <ChipToggleGroup ariaLabel="Situações funcionais" options={options(WORKFORCE_STATUS_LABELS)} selected={definition.statuses ?? []} onChange={(statuses) => set({ statuses })} />
        </Field>
      )}

      {definition.tool === "INDICATOR_QUERY" ? (
        <Field label="Visão">
          <OptionSelect ariaLabel="Visão" value={definition.view ?? "INDICADOR"} onChange={(view) => set({ view })} options={options(VIEW_LABELS) as { value: NonNullable<ReportDefinition["view"]>; label: string }[]} />
        </Field>
      ) : null}
      {definition.tool !== "INDICATOR_DIAGNOSIS" ? (
        <Field label="Linhas da tabela (agrupar por)">
          <OptionSelect ariaLabel="Agrupar por" value={definition.groupBy} onChange={(groupBy) => set({ groupBy })} options={options(GROUP_BY_LABELS, groupKeys) as { value: NonNullable<ReportDefinition["groupBy"]>; label: string }[]} />
        </Field>
      ) : null}

      {definition.tool === "INDICATOR_QUERY" && definition.groupBy === "PESSOA" ? (
        <>
          <Field label="Filtrar pessoas">
            <OptionSelect ariaLabel="Filtrar pessoas" value={definition.situation ?? "TODAS"} onChange={(value) => set({ situation: value === "TODAS" ? undefined : (value as ReportDefinition["situation"]) })} options={[{ value: "TODAS", label: "Todas" }, ...options(SITUATION_LABELS)]} />
          </Field>
          <Field label="Quartil oficial" hint="Só quem está nos quartis marcados (do indicador ou do PRV).">
            <ChipToggleGroup ariaLabel="Quartis" options={["Q1", "Q2", "Q3", "Q4"].map((value) => ({ value, label: value }))} selected={definition.quartiles ?? []} onChange={(quartiles) => set({ quartiles: quartiles as ReportDefinition["quartiles"] })} />
          </Field>
        </>
      ) : null}

      {definition.tool === "INDICATOR_QUERY" ? (
        <>
          <Field label="Ordenar por">
            <OptionSelect ariaLabel="Ordenar por" value={definition.sortBy ?? "PADRAO"} onChange={(value) => set({ sortBy: value === "PADRAO" ? undefined : (value as ReportDefinition["sortBy"]) })} options={[{ value: "PADRAO", label: "Padrão da consulta" }, ...options(SORT_LABELS)]} />
          </Field>
          <Field label="Ordem">
            <OptionSelect ariaLabel="Ordem" value={definition.order ?? "PADRAO"} onChange={(value) => set({ order: value === "PADRAO" ? undefined : (value as "ASC" | "DESC") })} options={[{ value: "PADRAO", label: "Padrão" }, { value: "ASC", label: "Crescente" }, { value: "DESC", label: "Decrescente" }]} />
          </Field>
        </>
      ) : null}
      {definition.tool === "INDICATOR_DIAGNOSIS" ? (
        <>
          <Field label="Comparar">
            <OptionSelect ariaLabel="Comparar" value={definition.compare ?? "FORA_X_DENTRO"} onChange={(compare) => set({ compare })} options={[{ value: "FORA_X_DENTRO", label: "Fora × dentro da meta" }, { value: "Q4_X_Q1", label: "Q4 × Q1 (quartis oficiais)" }]} />
          </Field>
          <Field label="Nível dos motivos">
            <OptionSelect ariaLabel="Nível dos motivos" value={definition.level ?? "SUBMOTIVO"} onChange={(level) => set({ level })} options={[{ value: "SUBMOTIVO", label: "Motivo › submotivo" }, { value: "MOTIVO", label: "Só o motivo" }]} />
          </Field>
        </>
      ) : null}
      {definition.tool === "WORKFORCE" ? (
        <div className="flex flex-col gap-2 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm"><Switch checked={definition.listPeople ?? false} onCheckedChange={(listPeople) => set({ listPeople })} />Listar as pessoas (nomes)</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={definition.includeLeaders ?? false} onCheckedChange={(includeLeaders) => set({ includeLeaders })} />Incluir líderes da estrutura</label>
        </div>
      ) : null}
      {definition.tool !== "INDICATOR_DIAGNOSIS" ? (
        <Field label="Limite de linhas">
          <Input type="number" min={1} max={50} value={definition.limit} onChange={(event) => set({ limit: Math.min(50, Math.max(1, Number(event.target.value) || 1)) })} aria-label="Limite de linhas" />
        </Field>
      ) : null}

      <Field label="Estrutura" hint={definition.structure.mode === "RECIPIENT" ? "Acompanha a estrutura ATUAL de quem recebe, a cada execução (muda se a equipe mudar)." : "Uma estrutura específica — quem não tiver acesso a ela não recebe."} className="sm:col-span-2">
        <OptionSelect
          ariaLabel="Estrutura"
          value={structureValue}
          onChange={(value) => {
            if (value === "RECIPIENT") return set({ structure: { mode: "RECIPIENT" } })
            const option = catalog.structures.find((item) => `${item.subjectKind}:${item.subjectId}` === value)
            if (option) set({ structure: { mode: "FIXED", subjectKind: option.subjectKind, subjectId: option.subjectId, label: option.label } })
          }}
          options={[{ value: "RECIPIENT", label: catalog.ownStructure ? `Minha estrutura (${catalog.ownStructure}) — a de quem recebe` : "A estrutura de quem recebe" }, ...catalog.structures.map((item) => ({ value: `${item.subjectKind}:${item.subjectId}`, label: `${item.label} — ${item.description}` }))]}
        />
      </Field>

      <PeriodFields definition={definition} onChange={onChange} />
    </div>
  )
}

function PeriodFields({ definition, onChange }: { definition: ReportDefinition; onChange: (definition: ReportDefinition) => void }) {
  if (definition.tool === "WORKFORCE") return <Field label="Período analisado" className="sm:col-span-2"><p className="text-sm text-muted-foreground">Situação funcional na data de cada execução.</p></Field>
  const period = definition.period
  const modes = definition.tool === "INDICATOR_DIAGNOSIS" ? ["LAST_CLOSED", "FIXED_MONTH"] : ["LAST_CLOSED", "LAST_N_CLOSED", "FIXED_MONTH", "CURRENT"]
  const labels: Record<string, string> = { LAST_CLOSED: "Última competência fechada (recalculada a cada execução)", LAST_N_CLOSED: "Últimas competências fechadas", FIXED_MONTH: "Uma competência fixa", CURRENT: "Período em curso (medição diária, parcial)" }
  const setPeriod = (next: ReportDefinition["period"]) => onChange({ ...definition, period: next, ...(next.mode !== "LAST_N_CLOSED" && definition.groupBy === "COMPETENCIA" ? { groupBy: "UNIDADE" as const } : {}) })
  return (
    <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      <Field label="Período analisado" hint="O período dos dados — diferente da frequência de execução (ex.: rodar todo dia o acumulado do mês)." className="sm:col-span-2">
        <OptionSelect
          ariaLabel="Período analisado"
          value={period.mode}
          onChange={(mode) => setPeriod(mode === "LAST_N_CLOSED" ? { mode, months: 3, display: "POR_MES" } : mode === "FIXED_MONTH" ? { mode, month: new Date().toISOString().slice(0, 7) } : mode === "CURRENT" ? { mode, window: "MES_CORRENTE" } : { mode: "LAST_CLOSED" })}
          options={modes.map((value) => ({ value, label: labels[value]! }))}
        />
      </Field>
      {period.mode === "LAST_N_CLOSED" ? (
        <>
          <Field label="Quantas competências">
            <OptionSelect ariaLabel="Quantas competências" value={String(period.months)} onChange={(value) => setPeriod({ ...period, months: Number(value) })} options={[2, 3, 4, 5, 6].map((value) => ({ value: String(value), label: `${value} meses` }))} />
          </Field>
          <Field label="Como ler o período">
            <OptionSelect ariaLabel="Como ler o período" value={period.display} onChange={(display) => setPeriod({ ...period, display })} options={options(PERIOD_DISPLAY_LABELS) as { value: "ULTIMA" | "MEDIA" | "POR_MES" | "RECORRENCIA"; label: string }[]} />
          </Field>
        </>
      ) : null}
      {period.mode === "FIXED_MONTH" ? (
        <Field label="Competência">
          <Input type="month" value={period.month} onChange={(event) => setPeriod({ mode: "FIXED_MONTH", month: event.target.value })} aria-label="Competência" />
        </Field>
      ) : null}
      {period.mode === "CURRENT" ? (
        <Field label="Janela">
          <OptionSelect ariaLabel="Janela" value={period.window} onChange={(window) => setPeriod({ mode: "CURRENT", window })} options={options(WINDOW_LABELS) as { value: "MES_CORRENTE" | "SEMANA_CORRENTE" | "ULTIMOS_7_DIAS"; label: string }[]} />
        </Field>
      ) : null}
    </div>
  )
}
