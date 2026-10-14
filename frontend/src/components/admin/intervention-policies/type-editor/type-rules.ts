import type { CapabilityCatalog, InterventionCapability, InterventionTypeDefinition } from "@/schemas/admin/intervention-policy.schema"
import type { FormField } from "@/schemas/interventions/intervention.schema"

import { effectiveCapabilities } from "../shared/helpers"

/**
 * Coerências que o editor de tipo aplica sozinho (sem esconder nada): as regras FIXAS da avaliação de continuidade e as
 * dependências entre capacidades e critérios de conclusão. O backend valida tudo de novo na publicação.
 */
export const CONTINUITY: InterventionCapability = "CONTINUITY_REVIEW"

export function enforceTypeRules(definition: InterventionTypeDefinition, catalog: CapabilityCatalog | undefined): InterventionTypeDefinition {
  let next = definition
  if (next.capabilities.includes(CONTINUITY)) {
    // Processo humano restrito: exclusivo, sempre com decisão humana, ao menos uma evidência, nunca IA.
    next = {
      ...next,
      capabilities: [CONTINUITY],
      approval: next.approval.required ? next.approval : { required: true, approverRole: "MANAGER" },
      evidence: { ...next.evidence, minimumItems: Math.max(1, next.evidence.minimumItems) },
      aiDraft: false,
    }
  }
  const effective = effectiveCapabilities(next.capabilities, catalog)
  return {
    ...next,
    completion: {
      ...next.completion,
      requireAllTasksDone: next.completion.requireAllTasksDone && effective.includes("TASKS"),
      requireLearningAssessment: next.completion.requireLearningAssessment && effective.includes("TRAINING"),
    },
    aiDraft: next.aiDraft && (effective.includes("TRAINING") || effective.includes("ACTION_PLAN")),
  }
}

export function normalizeFieldKey(raw: string): string {
  const cleaned = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_]+/g, "")
    .slice(0, 40)
  if (!cleaned) return ""
  const first = cleaned[0]!
  return /[a-zA-Z]/.test(first) ? first.toLowerCase() + cleaned.slice(1) : `campo${cleaned}`.slice(0, 40)
}

export const FIELD_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{0,39}$/

export function newFormField(fields: FormField[]): FormField {
  const taken = new Set(fields.map((field) => field.key))
  let index = fields.length + 1
  while (taken.has(`campo${index}`)) index += 1
  return { key: `campo${index}`, label: `Campo ${index}`, kind: "TEXT", required: false }
}
