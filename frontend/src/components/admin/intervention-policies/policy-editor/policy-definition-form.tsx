"use client"

import { useId } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import type { ConfigIssue, PolicyDefinition, PolicyRule } from "@/schemas/admin/intervention-policy.schema"

import { InlineIssues, ToggleField } from "../shared/fields"
import { IndicatorCodeField } from "../shared/indicator-code-field"
import { MATCH_STRATEGY_LABELS } from "../shared/labels"
import { duplicatedPriorities, MAX_RULES, moveRule, newRule } from "./defaults"
import { PolicyEditorProvider, usePolicyEditor } from "./editor-context"
import { RuleCard } from "./rule-card"

/**
 * Formulário da DEFINIÇÃO de uma versão (`INTERVENTION_POLICY_V1`): configurações gerais + regras. O mesmo componente mostra
 * o rascunho editável e as versões publicadas (só leitura, dentro de um fieldset desabilitado — nada é editável por engano).
 * As pendências do backend aparecem junto da regra a que pertencem (`rules.N…`) ou no topo.
 */
export function PolicyDefinitionForm({ definition, readOnly, issues = [], onChange }: { definition: PolicyDefinition; readOnly: boolean; issues?: ConfigIssue[]; onChange?: (next: PolicyDefinition) => void }) {
  return (
    <PolicyEditorProvider readOnly={readOnly} policyIndicatorCode={definition.indicatorCode}>
      <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-6 border-0 p-0">
        <DefinitionFields definition={definition} issues={issues} onChange={(next) => onChange?.(next)} />
      </fieldset>
    </PolicyEditorProvider>
  )
}

const ruleIndexOf = (path: string) => {
  const match = /^rules\.(\d+)/.exec(path)
  return match ? Number(match[1]) : null
}

function DefinitionFields({ definition, issues, onChange }: { definition: PolicyDefinition; issues: ConfigIssue[]; onChange: (next: PolicyDefinition) => void }) {
  const { readOnly, catalogsReady, publishedTypes, policyIndicatorCode, indicatorByCode } = usePolicyEditor()
  const descriptionId = useId()
  const duplicated = duplicatedPriorities(definition.rules)
  const settingsIssues = issues.filter((issue) => issue.path !== "" && !issue.path.startsWith("rules"))
  const rulesIssues = issues.filter((issue) => issue.path === "rules")
  const setRules = (rules: PolicyRule[]) => onChange({ ...definition, rules })
  const defaultType = publishedTypes.find((type) => type.active && type.traits && !type.traits.assertsSkillGap && !type.traits.sensitive) ?? publishedTypes.find((type) => type.active)

  return (
    <>
      <section className="space-y-4 rounded-xl border p-4">
        <h3 className="text-sm font-semibold">Configuração geral</h3>
        <InlineIssues issues={settingsIssues} />
        <div className="space-y-1">
          <Label htmlFor={descriptionId} className="text-xs">
            Descrição
          </Label>
          <Textarea id={descriptionId} rows={2} maxLength={2000} value={definition.description} placeholder="Para que serve esta política e quem ela acompanha." onChange={(event) => onChange({ ...definition, description: event.target.value })} />
        </div>
        <IndicatorCodeField label="Indicador principal" value={definition.indicatorCode} clearLabel="nenhum (política geral)" readOnly={readOnly} onChange={(indicatorCode) => onChange({ ...definition, indicatorCode })} />
        <p className="-mt-2 text-xs text-muted-foreground">É o assunto das intervenções e do caso. Condições de indicador sem indicador próprio usam este.</p>
        <div className="space-y-1.5">
          <Label className="text-xs">Quando mais de uma regra é atendida</Label>
          <RadioGroup value={definition.matchStrategy} onValueChange={(value) => onChange({ ...definition, matchStrategy: value as PolicyDefinition["matchStrategy"] })} className="space-y-1" aria-label="Quando mais de uma regra é atendida">
            {(["FIRST_MATCH", "ALL_MATCHES"] as const).map((value) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <RadioGroupItem value={value} className="mt-0.5" />
                <span>
                  {MATCH_STRATEGY_LABELS[value].title}
                  <span className="block text-xs text-muted-foreground">{MATCH_STRATEGY_LABELS[value].description}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>
        <ToggleField
          label="Narrativa redigida pela INIA no relatório"
          description="Custa uma chamada de IA a cada avaliação que abre ou recomenda ações. Desligada, o relatório estruturado (fatos, fontes, regras, ações) continua existindo — a narrativa só o explica em texto."
          checked={definition.report.aiNarrative}
          onChange={(aiNarrative) => onChange({ ...definition, report: { aiNarrative } })}
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Regras ({definition.rules.length})</h3>
            <p className="text-xs text-muted-foreground">Cada regra declara as próprias condições e ações. A prioridade é explícita e única (1 = maior).</p>
          </div>
          {readOnly ? null : (
            <Button type="button" size="sm" disabled={!catalogsReady || definition.rules.length >= MAX_RULES} onClick={() => setRules([...definition.rules, newRule(definition.rules, { policyIndicatorCode, indicator: policyIndicatorCode ? indicatorByCode.get(policyIndicatorCode) : undefined }, defaultType?.key ?? null)])}>
              <Plus /> Adicionar regra
            </Button>
          )}
        </div>
        <InlineIssues issues={rulesIssues} />
        {definition.rules.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhuma regra. Uma política precisa de pelo menos uma regra para ser publicada.</p> : null}
        {definition.rules.map((rule, index) => (
          <RuleCard
            key={index}
            rule={rule}
            index={index}
            total={definition.rules.length}
            priorityDuplicated={duplicated.has(rule.priority)}
            issues={issues.filter((issue) => ruleIndexOf(issue.path) === index)}
            onChange={(next) => setRules(definition.rules.map((current, position) => (position === index ? next : current)))}
            onMove={(delta) => setRules(moveRule(definition.rules, index, delta))}
            onRemove={() => setRules(definition.rules.filter((_, position) => position !== index))}
          />
        ))}
      </section>
    </>
  )
}
