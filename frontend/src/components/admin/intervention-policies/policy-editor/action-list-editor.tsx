"use client"

import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ESCALATION_ROLE_LABELS, RESPONSIBLE_ROLE_LABELS, type PolicyAction, type PolicyConditionGroup } from "@/schemas/admin/intervention-policy.schema"

import { Note, NumberField, OptionSelect } from "../shared/fields"
import { ACTION_EFFECT_HINTS, ACTION_EFFECT_LABELS, ON_ACTIVE_LABELS } from "../shared/labels"
import { defaultAction, requiresSupportedDiagnosis } from "./defaults"
import { usePolicyEditor, type PublishedTypeOption } from "./editor-context"

/**
 * Ações de uma regra (atendida ou inconclusiva). Só tipos com versão PUBLICADA entram; uma referência antiga a tipo sem
 * publicação/inativo continua visível e marcada. As dicas antecipam regras que o backend aplica na publicação.
 */
export function ActionListEditor({ title, description, actions, max, inconclusive, when, onChange }: { title: string; description: string; actions: PolicyAction[]; max: number; inconclusive: boolean; when: PolicyConditionGroup; onChange: (next: PolicyAction[]) => void }) {
  const { readOnly, publishedTypes } = usePolicyEditor()
  const usable = publishedTypes.filter((type) => type.active)
  // Para inconclusiva, começa por um tipo que não classifica o colaborador (quando o catálogo permite saber).
  const preferred = inconclusive ? (usable.find((type) => type.traits?.allowedOnInconclusive) ?? usable[0]) : (usable.find((type) => type.traits && !type.traits.assertsSkillGap && !type.traits.sensitive) ?? usable[0])
  const setAction = (index: number, next: PolicyAction) => onChange(actions.map((action, position) => (position === index ? next : action)))

  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {actions.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma ação.</p> : null}
      <ul className="space-y-2">
        {actions.map((action, index) => (
          <li key={index}>
            <ActionRow action={action} inconclusive={inconclusive} when={when} siblings={actions} onChange={(next) => setAction(index, next)} onRemove={() => onChange(actions.filter((_, position) => position !== index))} />
          </li>
        ))}
      </ul>
      {readOnly ? null : usable.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum tipo de intervenção publicado e ativo. Publique um tipo na aba &quot;Tipos de intervenção&quot; para usá-lo aqui.</p>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled={actions.length >= max} onClick={() => onChange([...actions, defaultAction(preferred!.key)])}>
          <Plus /> Adicionar ação
        </Button>
      )}
    </section>
  )
}

function ActionRow({ action, inconclusive, when, siblings, onChange, onRemove }: { action: PolicyAction; inconclusive: boolean; when: PolicyConditionGroup; siblings: PolicyAction[]; onChange: (next: PolicyAction) => void; onRemove: () => void }) {
  const { readOnly, publishedTypes, typeLabel } = usePolicyEditor()
  const type: PublishedTypeOption | undefined = publishedTypes.find((item) => item.key === action.typeKey)
  const options = publishedTypes.filter((item) => item.active || item.key === action.typeKey).map((item) => ({ value: item.key, label: item.active ? item.name : `${item.name} (inativo)` }))
  if (!type) options.unshift({ value: action.typeKey, label: `${typeLabel(action.typeKey)} (sem versão publicada)` })
  const duplicated = siblings.filter((item) => item.typeKey === action.typeKey).length > 1

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <OptionSelect label="Tipo de intervenção" value={action.typeKey} options={options} onChange={(typeKey) => onChange({ ...action, typeKey })} />
          {type ? (
            <p className="text-xs text-muted-foreground" data-testid="action-assignment">
              Responsável: {RESPONSIBLE_ROLE_LABELS[type.definition.responsibleRole]}
              {type.definition.responsibleRole === "DIRECT_LEADER" ? " do colaborador" : " da cadeia"} ·{" "}
              {type.definition.approval.required ? `aprovação: ${ESCALATION_ROLE_LABELS[type.definition.approval.approverRole]}` : "sem aprovação"} (definidos no tipo)
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <OptionSelect label="Efeito" value={action.effect} options={(["RECOMMEND", "OPEN"] as const).map((value) => ({ value, label: ACTION_EFFECT_LABELS[value] }))} onChange={(effect) => onChange({ ...action, effect })} />
          <p className="text-xs text-muted-foreground">{ACTION_EFFECT_HINTS[action.effect]}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <NumberField label="Prazo (dias)" allowEmpty emptyPlaceholder={type ? String(type.definition.defaultDueDays) : "padrão"} value={action.dueInDays} min={1} max={365} hint={action.dueInDays === null ? `Vazio = prazo padrão do tipo${type ? ` (${type.definition.defaultDueDays} dias)` : ""}.` : undefined} onChange={(dueInDays) => onChange({ ...action, dueInDays })} />
        <OptionSelect className="min-w-56" label="Se já houver uma ativa igual" value={action.onActive} options={(["KEEP", "UPDATE"] as const).map((value) => ({ value, label: ON_ACTIVE_LABELS[value] }))} onChange={(onActive) => onChange({ ...action, onActive })} />
        <NumberField label="Carência após encerrar (dias)" value={action.cooldownDays} min={0} max={365} hint="Encerrada há menos que isso não reabre. 0 = sem carência." onChange={(cooldownDays) => onChange({ ...action, cooldownDays: cooldownDays ?? 0 })} />
        {readOnly ? null : (
          <Button type="button" size="sm" variant="ghost" className="ml-auto self-end" aria-label={`Remover ação ${type?.name ?? action.typeKey}`} onClick={onRemove}>
            <Trash2 /> Remover
          </Button>
        )}
      </div>
      {duplicated ? <p className="text-xs text-destructive">Este tipo aparece mais de uma vez nesta lista.</p> : null}
      {type && !type.active ? <p className="text-xs text-destructive">Este tipo está inativo: a publicação vai rejeitar.</p> : null}
      {type?.traits && inconclusive && !type.traits.allowedOnInconclusive ? (
        <Note tone="warning">{type.name} classifica o colaborador: com dados insuficientes só cabem tipos de observação, revisão de dados ou revisão pela liderança. A publicação vai rejeitar.</Note>
      ) : null}
      {type?.traits && !inconclusive && type.traits.assertsSkillGap && !requiresSupportedDiagnosis(when) ? (
        <Note tone="warning">{type.name} afirma uma lacuna de habilidade (treinamento): a regra precisa exigir a condição &quot;Diagnóstico sustentado — existe&quot;. Indicador abaixo da meta, sozinho, não basta.</Note>
      ) : null}
      {type?.traits?.sensitive ? (
        <Note tone="warning">Avaliação de continuidade: sempre decisão humana restrita. Nunca com dados insuficientes; a regra precisa de uma condição com evidência verificável e de uma justificativa com pelo menos 30 caracteres. A INIA nunca decide nem executa desligamento.</Note>
      ) : null}
    </div>
  )
}
