import type { ItemWording, WriterItem } from "../../investigation/domain/interaction-feedback-writer.js"

/**
 * V1.5.6 — O QUE O COLABORADOR VÊ no Acompanhamento. Para ele, é simplesmente o feedback da INIA sobre um atendimento:
 * tipo do ponto, data, os três textos e, quando há, até 2 trechos CURTOS da conversa já mascarados pela projeção de display
 * (a mesma que decidiu a readiness; nada retido é exibido). Nunca: QA, modelo/IA, validadores, fallback, prompt, hashes,
 * provenance, refs internas, dono/escopo técnico, incerteza/contexto neutro, material procedimental bloqueado.
 */
export const COLLABORATOR_EVIDENCE_MAX = 2

const SECTION_VIEW = {
  STRENGTH: { label: "Ponto positivo", fields: { observed: "O que foi observado", whyItMatters: "Por que isso importa", whatYouCanDo: "O que você pode continuar fazendo" } },
  OPPORTUNITY: { label: "Ponto de atenção", fields: { observed: "O que foi observado", whyItMatters: "Por que isso importa", whatYouCanDo: "O que você pode fazer" } },
} as const
const SPEAKER = (speaker: string | null) => {
  const value = (speaker ?? "").toUpperCase()
  return value === "OPERADOR" ? "Você" : value === "CLIENTE" ? "Cliente" : value === "EVENTO" ? "Na chamada" : "Participante"
}

export function toCollaboratorFeedbackView(input: { deliveryId: string; section: "STRENGTH" | "OPPORTUNITY"; wording: ItemWording; writerItem: WriterItem; interactionLabel: string; occurredAt: Date | null; deliveredAt: Date; acknowledgedAt: Date | null }) {
  const section = SECTION_VIEW[input.section]
  return {
    id: input.deliveryId,
    kind: "INTERACTION_FEEDBACK" as const,
    title: "Feedback de atendimento",
    section: input.section,
    sectionLabel: section.label,
    interactionLabel: input.interactionLabel,
    interactionAt: input.occurredAt?.toISOString() ?? null,
    deliveredAt: input.deliveredAt.toISOString(),
    acknowledgedAt: input.acknowledgedAt?.toISOString() ?? null,
    blocks: (["observed", "whyItMatters", "whatYouCanDo"] as const).map((key) => ({ key, label: section.fields[key], text: input.wording[key] })).filter((block) => block.text.trim().length > 0),
    evidence: input.writerItem.evidence.slice(0, COLLABORATOR_EVIDENCE_MAX).map((entry) => ({ speakerLabel: SPEAKER(entry.speaker), text: entry.text, truncated: entry.truncated })),
  }
}
