"use client"

import { useId } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ESCALATION_ROLE_LABELS, ESCALATION_ROLES, EVIDENCE_KINDS, RESPONSIBLE_ROLES, type CapabilityCatalog, type InterventionTypeDefinition, type InterventionTypeView } from "@/schemas/admin/intervention-policy.schema"

import { CheckboxList, NumberField, OptionSelect, ToggleField } from "../shared/fields"
import { effectiveCapabilities, interventionTypeName } from "../shared/helpers"
import { COMPLETION_LABELS } from "../shared/labels"
import { CONTINUITY } from "./type-rules"

type SectionProps = { definition: InterventionTypeDefinition; disabled: boolean; onChange: (next: InterventionTypeDefinition) => void }
const roleOptions = ESCALATION_ROLES.map((role) => ({ value: role, label: ESCALATION_ROLE_LABELS[role] }))
const responsibleOptions = RESPONSIBLE_ROLES.map((role) => ({ value: role, label: role === "DIRECT_LEADER" ? "Líder direto do colaborador" : `${ESCALATION_ROLE_LABELS[role]} da cadeia` }))

export function IdentitySection({ definition, disabled, onChange }: SectionProps) {
  const nameId = useId()
  const descriptionId = useId()
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">Identificação</h3>
      <div className="space-y-1">
        <Label htmlFor={nameId} className="text-xs">
          Nome *
        </Label>
        <Input id={nameId} value={definition.name} maxLength={120} disabled={disabled} onChange={(event) => onChange({ ...definition, name: event.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={descriptionId} className="text-xs">
          Descrição
        </Label>
        <Textarea id={descriptionId} rows={2} maxLength={2000} disabled={disabled} value={definition.description} onChange={(event) => onChange({ ...definition, description: event.target.value })} />
      </div>
    </section>
  )
}

export function ResponsibilitySection({ definition, disabled, onChange }: SectionProps) {
  const continuity = definition.capabilities.includes(CONTINUITY)
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">Responsável, prazo e aprovação</h3>
        <p className="text-xs text-muted-foreground">Resolvidos pela cadeia do colaborador: o líder direto (quem ele reporta, qualquer nível) ou o primeiro acima dele com o nível escolhido.</p>
      </div>
      <div className="flex flex-wrap gap-4">
        <OptionSelect className="min-w-48" label="Responsável" value={definition.responsibleRole} disabled={disabled} options={responsibleOptions} onChange={(responsibleRole) => onChange({ ...definition, responsibleRole })} />
        <NumberField label="Prazo padrão (dias)" value={definition.defaultDueDays} min={1} max={365} disabled={disabled} onChange={(defaultDueDays) => onChange({ ...definition, defaultDueDays: defaultDueDays ?? 1 })} />
      </div>
      <ToggleField
        label="Exige aprovação antes de começar"
        description={continuity ? "Obrigatória na avaliação de continuidade (regra fixa)." : "Quem aprova também é resolvido pela cadeia do colaborador."}
        checked={definition.approval.required}
        disabled={disabled || continuity}
        onChange={(required) => onChange({ ...definition, approval: required ? { required: true, approverRole: "MANAGER" } : { required: false } })}
      />
      {definition.approval.required ? <OptionSelect className="max-w-xs" label="Quem aprova" value={definition.approval.approverRole} disabled={disabled} options={roleOptions} onChange={(approverRole) => onChange({ ...definition, approval: { required: true, approverRole } })} /> : null}
    </section>
  )
}

export function EvidenceSection({ definition, catalog, disabled, onChange }: SectionProps & { catalog: CapabilityCatalog | undefined }) {
  const continuity = definition.capabilities.includes(CONTINUITY)
  const labelOf = (key: string) => catalog?.evidenceKinds.find((kind) => kind.key === key)?.label ?? "Evidência"
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">Evidências</h3>
        <p className="text-xs text-muted-foreground">Toda evidência aponta para uma fonte verificável — texto gerado por IA nunca é evidência.</p>
      </div>
      <NumberField label="Mínimo de evidências" value={definition.evidence.minimumItems} min={continuity ? 1 : 0} max={10} disabled={disabled} hint={continuity ? "Pelo menos 1 na avaliação de continuidade (regra fixa)." : undefined} onChange={(minimumItems) => onChange({ ...definition, evidence: { ...definition.evidence, minimumItems: minimumItems ?? 0 } })} />
      <CheckboxList
        legend="Evidências aceitas"
        options={EVIDENCE_KINDS.map((kind) => ({ value: kind, label: labelOf(kind), disabled: definition.evidence.acceptedKinds.length === 1 && definition.evidence.acceptedKinds.includes(kind) }))}
        values={definition.evidence.acceptedKinds}
        disabled={disabled}
        onChange={(acceptedKinds) => onChange({ ...definition, evidence: { ...definition.evidence, acceptedKinds } })}
      />
    </section>
  )
}

export function CompletionSection({ definition, catalog, disabled, onChange }: SectionProps & { catalog: CapabilityCatalog | undefined }) {
  const effective = effectiveCapabilities(definition.capabilities, catalog)
  const needs: Partial<Record<keyof InterventionTypeDefinition["completion"], boolean>> = { requireAllTasksDone: effective.includes("TASKS"), requireLearningAssessment: effective.includes("TRAINING") }
  const aiDraftAvailable = (effective.includes("TRAINING") || effective.includes("ACTION_PLAN")) && !definition.capabilities.includes(CONTINUITY)
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">Critérios de conclusão</h3>
      {(Object.keys(COMPLETION_LABELS) as (keyof InterventionTypeDefinition["completion"])[]).map((key) => (
        <ToggleField key={key} label={COMPLETION_LABELS[key].title} description={COMPLETION_LABELS[key].description} checked={definition.completion[key]} disabled={disabled || needs[key] === false} onChange={(value) => onChange({ ...definition, completion: { ...definition.completion, [key]: value } })} />
      ))}
      <div className="border-t pt-3">
        <ToggleField
          label="Rascunho pela IA"
          description={aiDraftAvailable ? "Permite pedir à INIA um rascunho de treinamento ou plano, com fontes; o rascunho passa pelas aprovações do tipo." : "Só existe para tipos com Treinamento ou Plano de ação (e nunca na avaliação de continuidade)."}
          checked={definition.aiDraft}
          disabled={disabled || !aiDraftAvailable}
          onChange={(aiDraft) => onChange({ ...definition, aiDraft })}
        />
      </div>
    </section>
  )
}

export function IncompatibilitySection({ definition, ownKey, types, disabled, onChange }: SectionProps & { ownKey: string; types: InterventionTypeView[] }) {
  const others = types.filter((type) => type.key !== ownKey)
  const legacy = definition.incompatibleWith.filter((key) => !others.some((type) => type.key === key))
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">Incompatível com</h3>
        <p className="text-xs text-muted-foreground">Tipos que não podem estar ativos ao mesmo tempo para a mesma pessoa (vale nos dois sentidos).</p>
      </div>
      <CheckboxList
        legend="Tipos de intervenção"
        options={[...others.map((type) => ({ value: type.key, label: interventionTypeName(type), description: type.key })), ...legacy.map((key) => ({ value: key, label: key, description: "Não existe mais no catálogo" }))]}
        values={definition.incompatibleWith}
        disabled={disabled}
        emptyText="Nenhum outro tipo cadastrado."
        onChange={(incompatibleWith) => onChange({ ...definition, incompatibleWith })}
      />
    </section>
  )
}
