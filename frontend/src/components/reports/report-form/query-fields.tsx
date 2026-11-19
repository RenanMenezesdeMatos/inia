"use client"

import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { isRecordTool, type ReportDefinition, type ReportOptions } from "@/schemas/reports/reports.schema"
import { GROUP_BY_LABELS, PERIOD_DISPLAY_LABELS, QUERY_ARG_LABELS, SITUATION_LABELS, SORT_LABELS, TOOL_LABELS, VIEW_LABELS, WINDOW_LABELS, WORKFORCE_STATUS_LABELS } from "../report-labels"
import { ChipToggleGroup, Field, OptionSelect } from "./form-controls"
import { switchTool } from "./form-helpers"

const options = <K extends string>(labels: Record<K, string>, keys?: K[]) => (keys ?? (Object.keys(labels) as K[])).map((value): { value: K; label: string } => ({ value, label: labels[value] ?? value }))

/** "Que dados": o tipo de consulta e os parâmetros dela, a estrutura e o período analisado. */
export function QueryFields({ definition, onChange, catalog }: { definition: ReportDefinition; onChange: (definition: ReportDefinition) => void; catalog: ReportOptions }) {
  const set = (patch: Partial<ReportDefinition>) => onChange({ ...definition, ...patch } as ReportDefinition)
  const indicatorOptions = catalog.indicators.map((indicator) => ({ value: indicator.code, label: indicator.name }))
  const structureValue = definition.structure.mode === "RECIPIENT" ? "RECIPIENT" : `${definition.structure.subjectKind}:${definition.structure.subjectId}`
  const records = definition.tool === "SPAN" || isRecordTool(definition.tool)
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
      ) : records ? (
        <QueryArgsSummary queryArgs={definition.queryArgs ?? {}} />
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
      {definition.tool !== "INDICATOR_DIAGNOSIS" && !records ? (
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
      {definition.tool !== "INDICATOR_DIAGNOSIS" && !records ? (
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

/** Parâmetros da consulta de registros/span: os que a pergunta do chat usou (agrupamento, medidas, filtros), só leitura. */
function QueryArgsSummary({ queryArgs }: { queryArgs: NonNullable<ReportDefinition["queryArgs"]> }) {
  const entries = Object.entries(queryArgs)
  return (
    <Field label="Parâmetros da consulta" hint="Vêm da pergunta feita no chat. Para mudar, refaça a pergunta à INIA e crie o report a partir dela." className="sm:col-span-2">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Padrão da consulta (total da estrutura).</p>
      ) : (
        <ul className="text-sm">
          {entries.map(([key, value]) => (
            <li key={key}>
              <span className="text-muted-foreground">{QUERY_ARG_LABELS[key] ?? key.replace(/_/g, " ")}:</span> {Array.isArray(value) ? value.join(", ") : String(value)}
            </li>
          ))}
        </ul>
      )}
    </Field>
  )
}

const today = () => new Date().toISOString().slice(0, 10)

function PeriodFields({ definition, onChange }: { definition: ReportDefinition; onChange: (definition: ReportDefinition) => void }) {
  if (definition.tool === "WORKFORCE") return <Field label="Período analisado" className="sm:col-span-2"><p className="text-sm text-muted-foreground">Situação funcional na data de cada execução.</p></Field>
  if (definition.tool === "SPAN") return <Field label="Período analisado" className="sm:col-span-2"><p className="text-sm text-muted-foreground">Organograma na data de cada execução.</p></Field>
  if (isRecordTool(definition.tool)) return <RecordPeriodFields definition={definition} onChange={onChange} />
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

const CALENDAR_OPTIONS = [
  { value: "WEEK:-1", label: "Semana passada (segunda a domingo)" },
  { value: "WEEK:0", label: "Semana em curso (segunda a domingo)" },
  { value: "WEEK:0:toDate", label: "Semana em curso até a data da execução" },
  { value: "WEEK:1", label: "Próxima semana" },
  { value: "MONTH:-1", label: "Mês passado (calendário)" },
  { value: "MONTH:0", label: "Mês em curso (inteiro)" },
  { value: "MONTH:0:toDate", label: "Mês em curso até a data da execução" },
  { value: "MONTH:1", label: "Próximo mês" },
]

/** Período das consultas de registros: mês (último fechado ou fixo) ou datas (calendário, dias relativos ou fixas) — recalculado a cada execução. */
function RecordPeriodFields({ definition, onChange }: { definition: ReportDefinition; onChange: (definition: ReportDefinition) => void }) {
  const period = definition.period
  const setPeriod = (next: ReportDefinition["period"]) => onChange({ ...definition, period: next })
  const labels: Record<string, string> = { LAST_CLOSED: "Último mês fechado (recalculado a cada execução)", FIXED_MONTH: "Um mês fixo", CALENDAR: "Semana ou mês do calendário (relativo à execução)", RELATIVE_DAYS: "Dias relativos à execução (ex.: últimos 7 dias)", FIXED_DATES: "Datas fixas" }
  const calendarValue = period.mode === "CALENDAR" ? `${period.unit}:${period.offset}${period.toDate ? ":toDate" : ""}` : ""
  return (
    <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      <Field label="Período analisado" hint="O período dos dados — diferente da frequência de execução. Relativo = recalculado na data de cada execução." className="sm:col-span-2">
        <OptionSelect
          ariaLabel="Período analisado"
          value={period.mode}
          onChange={(mode) =>
            setPeriod(
              mode === "FIXED_MONTH" ? { mode, month: new Date().toISOString().slice(0, 7) } : mode === "CALENDAR" ? { mode, unit: "WEEK", offset: -1 } : mode === "RELATIVE_DAYS" ? { mode, fromOffset: -7, toOffset: -1 } : mode === "FIXED_DATES" ? { mode, from: today(), to: today() } : { mode: "LAST_CLOSED" },
            )
          }
          options={Object.keys(labels).map((value) => ({ value, label: labels[value]! }))}
        />
      </Field>
      {period.mode === "FIXED_MONTH" ? (
        <Field label="Mês">
          <Input type="month" value={period.month} onChange={(event) => setPeriod({ mode: "FIXED_MONTH", month: event.target.value })} aria-label="Mês" />
        </Field>
      ) : null}
      {period.mode === "CALENDAR" ? (
        <Field label="Qual semana ou mês">
          <OptionSelect
            ariaLabel="Qual semana ou mês"
            value={CALENDAR_OPTIONS.some((option) => option.value === calendarValue) ? calendarValue : "WEEK:-1"}
            onChange={(value) => {
              const [unit, offset, toDate] = value.split(":")
              setPeriod({ mode: "CALENDAR", unit: unit as "WEEK" | "MONTH", offset: Number(offset), ...(toDate ? { toDate: true } : {}) })
            }}
            options={CALENDAR_OPTIONS}
          />
        </Field>
      ) : null}
      {period.mode === "RELATIVE_DAYS" ? (
        <>
          <Field label="De (dias em relação à execução)" hint="0 = dia da execução; -1 = ontem; 1 = amanhã.">
            <Input type="number" min={-366} max={366} value={period.fromOffset} onChange={(event) => setPeriod({ ...period, fromOffset: Math.max(-366, Math.min(366, Math.round(Number(event.target.value) || 0))) })} aria-label="Dia inicial relativo" />
          </Field>
          <Field label="Até (dias em relação à execução)">
            <Input type="number" min={-366} max={366} value={period.toOffset} onChange={(event) => setPeriod({ ...period, toOffset: Math.max(-366, Math.min(366, Math.round(Number(event.target.value) || 0))) })} aria-label="Dia final relativo" />
          </Field>
        </>
      ) : null}
      {period.mode === "FIXED_DATES" ? (
        <>
          <Field label="De">
            <Input type="date" value={period.from} onChange={(event) => setPeriod({ ...period, from: event.target.value })} aria-label="Data inicial" />
          </Field>
          <Field label="Até">
            <Input type="date" value={period.to} onChange={(event) => setPeriod({ ...period, to: event.target.value })} aria-label="Data final" />
          </Field>
        </>
      ) : null}
    </div>
  )
}
