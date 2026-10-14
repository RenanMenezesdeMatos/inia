"use client"

import { ShieldAlert } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { CapabilityCatalog, InterventionCapability, InterventionTypeDefinition } from "@/schemas/admin/intervention-policy.schema"

import { Note } from "../shared/fields"
import { effectiveCapabilities } from "../shared/helpers"
import { CONTINUITY } from "./type-rules"

/**
 * Capacidades técnicas (lista fixa do produto, com rótulo e descrição vindos do backend). O TIPO é dado administrável; o que
 * cada capacidade exige é código. "Solicitar avaliação de continuidade" tem regras fixas e um aviso que não some.
 */
export function CapabilitiesSection({ definition, catalog, disabled, onChange }: { definition: InterventionTypeDefinition; catalog: CapabilityCatalog | undefined; disabled: boolean; onChange: (capabilities: InterventionCapability[]) => void }) {
  if (!catalog) return <Skeleton className="h-40 w-full" />
  const continuity = definition.capabilities.includes(CONTINUITY)
  const effective = effectiveCapabilities(definition.capabilities, catalog)
  const implied = effective.filter((key) => !definition.capabilities.includes(key))
  const labelOf = (key: string) => catalog.capabilities.find((item) => item.key === key)?.label ?? key

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">Capacidades</h3>
        <p className="text-xs text-muted-foreground">O que esta intervenção faz. Cada capacidade traz as próprias exigências (formulário, conclusão, validação).</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {catalog.capabilities.map((capability) => {
          const checked = definition.capabilities.includes(capability.key)
          const blocked = disabled || (continuity && capability.key !== CONTINUITY)
          return (
            <label key={capability.key} className={cn("flex items-start gap-2 rounded-md border p-2 text-sm", checked && "border-primary/50 bg-primary/5", blocked && !checked && "opacity-60")}>
              <input
                type="checkbox"
                className="mt-1 size-4 accent-primary"
                checked={checked}
                disabled={blocked}
                onChange={(event) => {
                  if (capability.key === CONTINUITY) onChange(event.target.checked ? [CONTINUITY] : ["TASKS"])
                  else onChange(event.target.checked ? [...definition.capabilities, capability.key] : definition.capabilities.filter((key) => key !== capability.key))
                }}
              />
              <span>
                <span className="font-medium">{capability.label}</span>
                <span className="block text-xs text-muted-foreground">{capability.description}</span>
                {capability.implies.length > 0 ? <span className="block text-xs text-muted-foreground">Inclui também: {capability.implies.map(labelOf).join(", ")}.</span> : null}
              </span>
            </label>
          )
        })}
      </div>
      {definition.capabilities.length === 0 ? <p className="text-xs text-destructive">Escolha pelo menos uma capacidade.</p> : null}
      {implied.length > 0 ? <p className="text-xs text-muted-foreground">Também valem, por implicação: {implied.map(labelOf).join(", ")}.</p> : null}
      {definition.capabilities.includes("TRAINING") && definition.capabilities.includes("RECOGNITION") ? <p className="text-xs text-destructive">Treinamento (lacuna de habilidade) e Reconhecimento não convivem no mesmo tipo.</p> : null}
      {continuity ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm" role="note" data-testid="continuity-review-note">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">Solicitar avaliação de continuidade — regras fixas</p>
            <p className="text-xs">
              É um processo humano restrito: a decisão é sempre de uma pessoa autorizada (aprovação obrigatória), exige pelo menos uma evidência verificável, não usa IA e não se combina com outras capacidades. Essas regras não podem ser desligadas.
            </p>
            <p className="text-xs font-medium">A INIA nunca decide nem executa desligamento e nunca altera a situação funcional do colaborador.</p>
          </div>
        </div>
      ) : null}
      {effective.some((key) => catalog.capabilities.find((item) => item.key === key)?.assertsSkillGap) ? <Note>Este tipo afirma uma lacuna de habilidade: nas políticas, a regra que o abre precisa exigir um diagnóstico sustentado.</Note> : null}
    </section>
  )
}
