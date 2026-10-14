"use client"

import { HistoricalPeriodPicker } from "@/components/admin/workflows/node-config/indicator-query-fields"
import type { PolicyCondition } from "@/schemas/admin/intervention-policy.schema"

import { CheckboxList, ComparatorSelect, DecimalField, Note, NumberField, OptionSelect, ToggleField } from "../shared/fields"
import { IndicatorCodeField } from "../shared/indicator-code-field"
import {
  DIAGNOSIS_EXPECTATION_LABELS,
  FEEDBACK_KIND_LABELS,
  FLAG_MEASURE_LABELS,
  INTERVENTION_EVENT_LABELS,
  OPERATIONAL_RESULT_LABELS,
  PRIOR_STATUS_LABELS,
  WHEN_NONE_LABELS,
} from "../shared/labels"
import { usePolicyEditor } from "./editor-context"

type Of<K extends PolicyCondition["kind"]> = Extract<PolicyCondition, { kind: K }>
type EditorProps<C> = { condition: C; onChange: (next: PolicyCondition) => void }

const ANY = "__ANY__"
const options = <V extends string>(labels: Record<V, string>) => (Object.keys(labels) as V[]).map((value) => ({ value, label: labels[value] }))

/** Tipos de intervenção referenciados por chave (inclusive sem versão publicada) — uma referência antiga nunca some. */
function TypeKeysField({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const { types, typeLabel } = usePolicyEditor()
  const known = types.map((type) => ({ value: type.key, label: typeLabel(type.key), description: type.active ? undefined : "Tipo inativo" }))
  const legacy = values.filter((key) => !types.some((type) => type.key === key)).map((key) => ({ value: key, label: key, description: "Não existe mais no catálogo" }))
  return (
    <div className="space-y-1">
      <CheckboxList legend="Tipos de intervenção" options={[...known, ...legacy]} values={values} emptyText="Nenhum tipo de intervenção cadastrado." onChange={onChange} />
      <p className="text-xs text-muted-foreground">Nenhum marcado = qualquer tipo.</p>
    </div>
  )
}

export function EmploymentConditionEditor({ condition, onChange }: EditorProps<Of<"EMPLOYMENT">>) {
  return (
    <div className="space-y-3">
      <OptionSelect
        label="Verificar"
        value={condition.check}
        options={[
          { value: "CURRENTLY_ELIGIBLE", label: "Se está elegível hoje" },
          { value: "ELIGIBLE_DAYS", label: "Quantos dias esteve elegível no período" },
        ]}
        onChange={(check) => onChange(check === "CURRENTLY_ELIGIBLE" ? { kind: "EMPLOYMENT", check, expected: true } : { kind: "EMPLOYMENT", check, period: { kind: "ROLLING_DAYS", days: 30 }, comparator: "GTE", threshold: 15 })}
      />
      {condition.check === "CURRENTLY_ELIGIBLE" ? (
        <OptionSelect label="Situação esperada" value={condition.expected ? "YES" : "NO"} options={[{ value: "YES", label: "Está elegível (ativo e disponível)" }, { value: "NO", label: "Não está elegível" }]} onChange={(value) => onChange({ ...condition, expected: value === "YES" })} />
      ) : (
        <>
          <HistoricalPeriodPicker period={condition.period} allowClosures={false} closuresSource="MEASUREMENT" onChange={(period) => onChange({ ...condition, period })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <ComparatorSelect label="Dias elegíveis" value={condition.comparator} onChange={(comparator) => onChange({ ...condition, comparator })} />
            <NumberField label="Número de dias" value={condition.threshold} min={0} max={366} onChange={(threshold) => onChange({ ...condition, threshold: threshold ?? 0 })} />
          </div>
        </>
      )}
      <Note>Lê a situação funcional e a escala da Central de Dados. Fonte atrasada ou ausente deixa a condição inconclusiva. A INIA nunca altera a situação funcional.</Note>
    </div>
  )
}

export function PriorInterventionsConditionEditor({ condition, onChange }: EditorProps<Of<"PRIOR_INTERVENTIONS">>) {
  const completed = condition.statuses.includes("COMPLETED")
  return (
    <div className="space-y-3">
      <TypeKeysField values={condition.typeKeys} onChange={(typeKeys) => onChange({ ...condition, typeKeys })} />
      <CheckboxList
        legend="Situação das intervenções"
        options={options(PRIOR_STATUS_LABELS).map((option) => ({ ...option, disabled: condition.statuses.length === 1 && condition.statuses.includes(option.value) }))}
        values={condition.statuses}
        onChange={(statuses) => onChange({ ...condition, statuses, operationalResults: statuses.includes("COMPLETED") ? condition.operationalResults : [] })}
      />
      {completed ? (
        <div className="space-y-1">
          <CheckboxList legend="Resultado operacional registrado na conclusão" options={options(OPERATIONAL_RESULT_LABELS)} values={condition.operationalResults} onChange={(operationalResults) => onChange({ ...condition, operationalResults })} />
          <p className="text-xs text-muted-foreground">Nenhum marcado = qualquer resultado. Só vale para intervenções concluídas.</p>
        </div>
      ) : null}
      <ToggleField label="Somente sobre o mesmo assunto" description="Considera só intervenções sobre o indicador desta política." checked={condition.sameSubject} onChange={(sameSubject) => onChange({ ...condition, sameSubject })} />
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField label="Nos últimos (dias)" value={condition.withinDays} min={1} max={730} onChange={(withinDays) => onChange({ ...condition, withinDays: withinDays ?? 1 })} />
        <ComparatorSelect label="Quantidade" value={condition.comparator} onChange={(comparator) => onChange({ ...condition, comparator })} />
        <NumberField label="Número de intervenções" value={condition.threshold} min={0} max={100} onChange={(threshold) => onChange({ ...condition, threshold: threshold ?? 0 })} />
      </div>
      <Note>São registros da própria INIA: não ter nenhuma intervenção é um fato, nunca &quot;sem dados&quot;.</Note>
    </div>
  )
}

export function TimeSinceInterventionConditionEditor({ condition, onChange }: EditorProps<Of<"TIME_SINCE_INTERVENTION">>) {
  return (
    <div className="space-y-3">
      <TypeKeysField values={condition.typeKeys} onChange={(typeKeys) => onChange({ ...condition, typeKeys })} />
      <div className="grid gap-3 sm:grid-cols-3">
        <OptionSelect label="Contar o tempo" value={condition.event} options={options(INTERVENTION_EVENT_LABELS)} onChange={(event) => onChange({ ...condition, event })} />
        <ComparatorSelect label="Tempo decorrido" value={condition.comparator} onChange={(comparator) => onChange({ ...condition, comparator })} />
        <NumberField label="Dias" value={condition.days} min={0} max={730} onChange={(days) => onChange({ ...condition, days: days ?? 0 })} />
      </div>
      <ToggleField label="Somente sobre o mesmo assunto" description="Considera só intervenções sobre o indicador desta política." checked={condition.sameSubject} onChange={(sameSubject) => onChange({ ...condition, sameSubject })} />
      <OptionSelect label="Se não houver nenhuma intervenção" value={condition.whenNone} options={options(WHEN_NONE_LABELS)} onChange={(whenNone) => onChange({ ...condition, whenNone })} />
    </div>
  )
}

export function SupportedDiagnosisConditionEditor({ condition, onChange }: EditorProps<Of<"SUPPORTED_DIAGNOSIS">>) {
  const { readOnly, competencies } = usePolicyEditor()
  const known = competencies.map((competency) => ({ value: competency.key, label: competency.name, description: competency.active ? undefined : "Competência inativa", disabled: !competency.active && !condition.competencyKeys.includes(competency.key) }))
  const legacy = condition.competencyKeys.filter((key) => !competencies.some((competency) => competency.key === key)).map((key) => ({ value: key, label: key, description: "Não existe mais no catálogo" }))
  return (
    <div className="space-y-3">
      <IndicatorCodeField label="Indicador do diagnóstico" value={condition.indicatorCode} clearLabel="o indicador da política" readOnly={readOnly} onChange={(indicatorCode) => onChange({ ...condition, indicatorCode })} />
      <div className="space-y-1">
        <CheckboxList legend="Competências" options={[...known, ...legacy]} values={condition.competencyKeys} emptyText="Nenhuma competência cadastrada (aba Competências)." onChange={(competencyKeys) => onChange({ ...condition, competencyKeys })} />
        <p className="text-xs text-muted-foreground">Nenhuma marcada = qualquer padrão sustentado do diagnóstico.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionSelect label="Esperado" value={condition.expectation} options={options(DIAGNOSIS_EXPECTATION_LABELS)} onChange={(expectation) => onChange({ ...condition, expectation })} />
        <NumberField label="Nos últimos (dias)" value={condition.withinDays} min={1} max={365} onChange={(withinDays) => onChange({ ...condition, withinDays: withinDays ?? 1 })} />
      </div>
      <Note>Diagnóstico sustentado = padrão verificado com evidência. É a condição que um treinamento exige: indicador abaixo da meta, sozinho, não basta.</Note>
    </div>
  )
}

export function PublishedFeedbackConditionEditor({ condition, onChange }: EditorProps<Of<"PUBLISHED_FEEDBACK">>) {
  const { readOnly } = usePolicyEditor()
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionSelect label="Tipo de feedback" value={condition.feedbackKind ?? ANY} options={[{ value: ANY, label: "Qualquer tipo" }, ...options(FEEDBACK_KIND_LABELS)]} onChange={(value) => onChange({ ...condition, feedbackKind: value === ANY ? null : (value as "INDICATOR" | "MONITORING") })} />
        <IndicatorCodeField label="Indicador" value={condition.indicatorCode} clearLabel="qualquer indicador" readOnly={readOnly} onChange={(indicatorCode) => onChange({ ...condition, indicatorCode })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField label="Nos últimos (dias)" value={condition.withinDays} min={1} max={365} onChange={(withinDays) => onChange({ ...condition, withinDays: withinDays ?? 1 })} />
        <ComparatorSelect label="Quantidade" value={condition.comparator} onChange={(comparator) => onChange({ ...condition, comparator })} />
        <NumberField label="Número de feedbacks" value={condition.threshold} min={0} max={100} onChange={(threshold) => onChange({ ...condition, threshold: threshold ?? 0 })} />
      </div>
      <Note>Só contam feedbacks publicados — que só publicam com evidência verificável.</Note>
    </div>
  )
}

/**
 * Flag de atendimento: escolhe a flag do catálogo, o valor procurado (sim/não ou número), a janela e a recorrência — em
 * quantidade ou percentual dos atendimentos do colaborador. As flags chegam calculadas com cada atendimento.
 */
export function InteractionFlagConditionEditor({ condition, onChange }: EditorProps<Of<"INTERACTION_FLAG">>) {
  const { flags } = usePolicyEditor()
  const key = (channel: string, flagName: string) => `${channel}:${flagName}`
  const current = flags.find((flag) => flag.channel === condition.channel && flag.flagName === condition.flagName)
  const flagOptions = [
    ...flags.filter((flag) => flag.active || flag === current).map((flag) => ({ value: key(flag.channel, flag.flagName), label: `${flag.flagName}${flag.description ? ` — ${flag.description}` : ""}${flag.active ? "" : " (desativada)"}` })),
    ...(current || !condition.flagName ? [] : [{ value: key(condition.channel, condition.flagName), label: `${condition.flagName} (não existe mais no catálogo)` }]),
  ]
  const percent = condition.measure === "PERCENT"
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionSelect
          label="Flag"
          value={condition.flagName ? key(condition.channel, condition.flagName) : undefined}
          placeholder="Escolha a flag"
          options={flagOptions}
          onChange={(value) => {
            const picked = flags.find((flag) => key(flag.channel, flag.flagName) === value)
            if (!picked) return
            onChange({ ...condition, channel: picked.channel, flagName: picked.flagName, match: picked.valueType === condition.match.type ? condition.match : picked.valueType === "BOOLEAN" ? { type: "BOOLEAN", value: true } : { type: "NUMERIC", comparator: "LTE", threshold: 2 } })
          }}
        />
        {condition.match.type === "BOOLEAN" ? (
          <OptionSelect label="Valor procurado" value={condition.match.value ? "YES" : "NO"} options={[{ value: "YES", label: "Sim (a flag disparou)" }, { value: "NO", label: "Não" }]} onChange={(value) => onChange({ ...condition, match: { type: "BOOLEAN", value: value === "YES" } })} />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <ComparatorSelect label="Valor da flag" value={condition.match.comparator} onChange={(comparator) => onChange({ ...condition, match: { type: "NUMERIC", comparator, threshold: condition.match.type === "NUMERIC" ? condition.match.threshold : 0 } })} />
            <DecimalField label="Valor de referência" value={condition.match.threshold} onChange={(threshold) => onChange({ ...condition, match: { type: "NUMERIC", comparator: condition.match.type === "NUMERIC" ? condition.match.comparator : "LTE", threshold } })} />
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Nos últimos (dias)" value={condition.withinDays} min={1} max={186} onChange={(withinDays) => onChange({ ...condition, withinDays: withinDays ?? 1 })} />
        <OptionSelect label="Medir" value={condition.measure} options={options(FLAG_MEASURE_LABELS)} onChange={(measure) => onChange({ ...condition, measure, threshold: measure === "PERCENT" ? Math.min(condition.threshold, 100) : condition.threshold })} />
        <ComparatorSelect label={percent ? "Percentual" : "Quantidade"} value={condition.comparator} onChange={(comparator) => onChange({ ...condition, comparator })} />
        <NumberField label={percent ? "Percentual (%)" : "Número de atendimentos"} value={condition.threshold} min={0} max={percent ? 100 : 100000} onChange={(threshold) => onChange({ ...condition, threshold: threshold ?? 0 })} />
      </div>
      <NumberField className="max-w-64" label="Mínimo de atendimentos na janela" value={condition.minimumInteractions} min={1} max={1000} hint="Com menos atendimentos que isso a condição fica inconclusiva — sem atendimento não há sinal." onChange={(minimumInteractions) => onChange({ ...condition, minimumInteractions: minimumInteractions ?? 1 })} />
      <Note>As flags chegam calculadas com cada atendimento; atendimento sem a flag conta como &quot;não disparou&quot;. Os atendimentos encontrados entram como fontes no relatório.</Note>
    </div>
  )
}
