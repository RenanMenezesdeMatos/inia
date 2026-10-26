"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useIndicatorsWithRulesQuery } from "@/queries/admin/use-indicator-rule-queries"
import { SIGNAL_OPERATOR_LABELS, SIGNAL_OPERATORS, type CallOutcome, type FlagValueType, type SignalOperator } from "@/schemas/admin/channel-flag.schema"

/** Rascunho dos campos (texto nos números para o usuário digitar à vontade); vira `CallOutcome` só ao salvar. */
export type CallOutcomeDraft = { enabled: boolean; goodOperator: SignalOperator; goodValue: string; badOperator: SignalOperator; badValue: string; badBoolean: boolean }

export function callOutcomeDraftOf(outcome: CallOutcome | null | undefined): CallOutcomeDraft {
  if (outcome?.kind === "NUMERIC") return { enabled: true, goodOperator: outcome.good.operator, goodValue: String(outcome.good.value), badOperator: outcome.bad.operator, badValue: String(outcome.bad.value), badBoolean: true }
  if (outcome?.kind === "BOOLEAN") return { enabled: true, goodOperator: "GTE", goodValue: "", badOperator: "LTE", badValue: "", badBoolean: outcome.badValue }
  return { enabled: false, goodOperator: "GTE", goodValue: "", badOperator: "LTE", badValue: "", badBoolean: true }
}

const numberOf = (text: string) => (text.trim() === "" ? null : Number(text.replace(",", ".")))

/** null = o sinal não compara chamadas; undefined = rascunho incompleto (não dá para salvar). */
export function callOutcomeOfDraft(draft: CallOutcomeDraft, valueType: FlagValueType): CallOutcome | null | undefined {
  if (!draft.enabled) return null
  if (valueType === "BOOLEAN") return { kind: "BOOLEAN", badValue: draft.badBoolean }
  const good = numberOf(draft.goodValue)
  const bad = numberOf(draft.badValue)
  if (good === null || bad === null || Number.isNaN(good) || Number.isNaN(bad)) return undefined
  return { kind: "NUMERIC", good: { operator: draft.goodOperator, value: good }, bad: { operator: draft.badOperator, value: bad } }
}

const NO_INDICATOR = "__NENHUM__"

/**
 * "Para as boas práticas": o que é chamada boa e ruim neste sinal (a análise compara chamadas boas × ruins no mesmo assunto) e o
 * indicador relacionado (no feedback disparado pelo sinal, sem prática do próprio sinal, vêm as dos melhores no indicador). Nada é
 * suposto pela INIA: sem isso, o sinal não é usado para comparar chamadas.
 */
export function CallOutcomeFields({ valueType, draft, onDraftChange, relatedIndicatorId, onRelatedIndicatorChange }: { valueType: FlagValueType; draft: CallOutcomeDraft; onDraftChange: (draft: CallOutcomeDraft) => void; relatedIndicatorId: string | null; onRelatedIndicatorChange: (id: string | null) => void }) {
  const indicators = useIndicatorsWithRulesQuery()
  const set = (patch: Partial<CallOutcomeDraft>) => onDraftChange({ ...draft, ...patch })
  const operatorSelect = (value: SignalOperator, onChange: (value: SignalOperator) => void, label: string) => (
    <Select value={value} onValueChange={(next) => onChange(next as SignalOperator)}>
      <SelectTrigger aria-label={label} className="w-full sm:w-48"><SelectValue /></SelectTrigger>
      <SelectContent>{SIGNAL_OPERATORS.map((operator) => <SelectItem key={operator} value={operator}>{SIGNAL_OPERATOR_LABELS[operator]}</SelectItem>)}</SelectContent>
    </Select>
  )
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Para as boas práticas</legend>
      <label className="flex items-start gap-3 text-sm">
        <Switch checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} aria-label="Comparar chamadas por este sinal" />
        <span>Comparar chamadas por este sinal<span className="block text-xs text-muted-foreground">Diga o que é uma chamada boa e uma ruim. Chamada sem o sinal nunca conta como boa nem como ruim.</span></span>
      </label>
      {draft.enabled && valueType === "NUMERIC" ? (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-sm sm:w-28">Chamada boa</span>
            {operatorSelect(draft.goodOperator, (goodOperator) => set({ goodOperator }), "Condição da chamada boa")}
            <Input inputMode="decimal" aria-label="Valor da chamada boa" value={draft.goodValue} onChange={(event) => set({ goodValue: event.target.value })} className="sm:w-28" placeholder="Ex.: 4" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-sm sm:w-28">Chamada ruim</span>
            {operatorSelect(draft.badOperator, (badOperator) => set({ badOperator }), "Condição da chamada ruim")}
            <Input inputMode="decimal" aria-label="Valor da chamada ruim" value={draft.badValue} onChange={(event) => set({ badValue: event.target.value })} className="sm:w-28" placeholder="Ex.: 2" />
          </div>
          <p className="text-xs text-muted-foreground">O que fica entre as duas faixas não entra na comparação.</p>
        </div>
      ) : null}
      {draft.enabled && valueType === "BOOLEAN" ? (
        <div className="space-y-1.5">
          <Label>Valor ruim</Label>
          <Select value={draft.badBoolean ? "true" : "false"} onValueChange={(value) => set({ badBoolean: value === "true" })}>
            <SelectTrigger aria-label="Valor ruim" className="w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="true">Verdadeiro (sim)</SelectItem><SelectItem value="false">Falso (não)</SelectItem></SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">O valor oposto, quando a fonte o envia, é a chamada boa.</p>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label>Indicador relacionado (opcional)</Label>
        <Select value={relatedIndicatorId ?? NO_INDICATOR} onValueChange={(value) => onRelatedIndicatorChange(value === NO_INDICATOR ? null : value)}>
          <SelectTrigger aria-label="Indicador relacionado" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_INDICATOR}>Nenhum</SelectItem>
            {(indicators.data ?? []).filter((indicator) => indicator.active || indicator.id === relatedIndicatorId).map((indicator) => <SelectItem key={indicator.id} value={indicator.id}>{indicator.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">No feedback disparado por este sinal, sem prática das chamadas dele, vêm as dos operadores com melhor resultado neste indicador.</p>
      </div>
    </fieldset>
  )
}
