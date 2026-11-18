"use client"

import { useId } from "react"
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { ConfigIssue, PolicyRule } from "@/schemas/admin/intervention-policy.schema"

import { InlineIssues, Note, NumberField } from "../shared/fields"
import { normalizeStableKey, STABLE_KEY_PATTERN } from "../shared/helpers"
import { usePolicyDescriber } from "../shared/use-policy-describer"
import { ActionListEditor } from "./action-list-editor"
import { ConditionGroupEditor } from "./condition-group-editor"
import { countConditions, DEFAULT_JUSTIFICATION, MAX_ACTIONS, MAX_CONDITIONS_PER_RULE, MAX_INCONCLUSIVE_ACTIONS } from "./defaults"
import { usePolicyEditor } from "./editor-context"

/**
 * Uma regra da trilha, lida de cima para baixo: a frase do que ela faz ("Quando …, a INIA …"), o nome, o porquê, as condições e
 * as ações. A ordem na lista É a prioridade (mover renumera); o número e a chave ficam em "Avançado", para quem precisa deles.
 */
export function RuleCard({ rule, index, total, priorityDuplicated, issues, onChange, onMove, onRemove }: { rule: PolicyRule; index: number; total: number; priorityDuplicated: boolean; issues: ConfigIssue[]; onChange: (next: PolicyRule) => void; onMove: (delta: -1 | 1) => void; onRemove: () => void }) {
  const { readOnly, conditionContext } = usePolicyEditor()
  const describer = usePolicyDescriber(conditionContext.policyIndicatorCode)
  const nameId = useId()
  const keyId = useId()
  const justificationId = useId()
  const keyValid = STABLE_KEY_PATTERN.test(rule.key)
  const conditions = countConditions(rule.when)

  return (
    <article className={cn("space-y-4 rounded-xl border p-4", issues.length > 0 && "border-destructive/60")} data-testid={`policy-rule-${index}`} aria-label={`Regra ${rule.name}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Badge variant="secondary">{index + 1}ª regra</Badge>
          {/* A regra dita em frase — o mesmo texto do resumo da política; muda conforme as condições e as ações abaixo. */}
          <p className="text-sm" data-testid={`policy-rule-sentence-${index}`}>
            {describer.rule(rule)}
          </p>
        </div>
        {readOnly ? null : (
          <div className="flex gap-1">
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Mover ${rule.name} para cima`} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Mover ${rule.name} para baixo`} disabled={index === total - 1} onClick={() => onMove(1)}>
              <ArrowDown />
            </Button>
            <Button type="button" size="sm" variant="ghost" aria-label={`Remover ${rule.name}`} onClick={onRemove}>
              <Trash2 /> Remover regra
            </Button>
          </div>
        )}
      </header>
      {priorityDuplicated ? <p className="text-xs text-destructive">Outra regra já usa a prioridade {rule.priority}: mova esta regra na lista (ou ajuste o número em Avançado).</p> : null}

      <InlineIssues issues={issues} />

      <div className="space-y-1">
        <Label htmlFor={nameId} className="text-xs">
          Nome da regra *
        </Label>
        <Input id={nameId} value={rule.name} maxLength={120} onChange={(event) => onChange({ ...rule, name: event.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={justificationId} className="text-xs">
          Por que esta regra existe *
        </Label>
        <Textarea id={justificationId} rows={2} maxLength={1000} value={rule.justification} onChange={(event) => onChange({ ...rule, justification: event.target.value })} />
        <p className="text-xs text-muted-foreground">Aparece para quem lidera no motivo de cada ação e fica na justificativa de cada avaliação.</p>
        {rule.justification.trim() === DEFAULT_JUSTIFICATION || rule.justification.trim() === "" ? <p className="text-xs text-amber-700 dark:text-amber-400">Escreva o porquê antes de publicar.</p> : null}
      </div>
      <Collapsible defaultOpen={!keyValid}>
        <CollapsibleTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground">Avançado: prioridade e chave</CollapsibleTrigger>
        <CollapsibleContent className="mt-2 grid gap-3 sm:grid-cols-2">
          <NumberField label="Prioridade" value={rule.priority} min={1} max={999} hint="1 = maior prioridade. Mover a regra na lista renumera todas." onChange={(priority) => onChange({ ...rule, priority: priority ?? 1 })} />
          <div className="space-y-1">
            <Label htmlFor={keyId} className="text-xs">
              Chave da regra *
            </Label>
            <Input id={keyId} className="font-mono" value={rule.key} maxLength={40} aria-invalid={!keyValid || undefined} onChange={(event) => onChange({ ...rule, key: normalizeStableKey(event.target.value) })} />
            <p className={cn("text-xs", keyValid ? "text-muted-foreground" : "text-destructive")}>Identifica a regra nas avaliações e no relatório. Letras maiúsculas, números e _.</p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <ConditionGroupEditor group={rule.when} depth={1} canAddCondition={conditions < MAX_CONDITIONS_PER_RULE} onChange={(when) => onChange({ ...rule, when })} />

      <ActionListEditor title="O que a INIA faz quando a regra é atendida" description={`Até ${MAX_ACTIONS} tipos de intervenção. Em cada um: abrir a ação, sugerir ou só avisar quem lidera.`} actions={rule.actions} max={MAX_ACTIONS} inconclusive={false} when={rule.when} onChange={(actions) => onChange({ ...rule, actions })} />
      <ActionListEditor
        title="O que a INIA faz quando faltam dados para concluir"
        description={`Opcional, até ${MAX_INCONCLUSIVE_ACTIONS}. Dados ausentes ou insuficientes nunca viram classificação do colaborador.`}
        actions={rule.inconclusiveActions}
        max={MAX_INCONCLUSIVE_ACTIONS}
        inconclusive
        when={rule.when}
        onChange={(inconclusiveActions) => onChange({ ...rule, inconclusiveActions })}
      />
      <Note>Com regra inconclusiva só cabem tipos cujas capacidades não classificam o colaborador (observação, revisão de dados, revisão pela liderança, checkpoints). Tipos com Treinamento exigem, na própria regra, a condição &quot;Diagnóstico sustentado — existe&quot;.</Note>
    </article>
  )
}
