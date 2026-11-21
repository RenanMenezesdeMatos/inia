import type { KnowledgeLinkCandidate } from "@/schemas/admin/agent-knowledge-links.schema"

/** Situação da base num agente: o que a IA usa hoje × o que está no rascunho do agente. */
export function knowledgeLinkStatusOf(candidate: Pick<KnowledgeLinkCandidate, "linkedInUse" | "linkedInDraft">): { tone: "success" | "warning"; label: string } | null {
  if (candidate.linkedInUse && candidate.linkedInDraft) return { tone: "success", label: "Em uso" }
  if (candidate.linkedInDraft) return { tone: "warning", label: "No rascunho" }
  if (candidate.linkedInUse) return { tone: "warning", label: "Sai ao publicar" }
  return null
}

export const agentHref = (id: string) => `/admin/agents/${id}`
