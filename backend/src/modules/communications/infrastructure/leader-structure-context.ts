import type { Database } from "../../../infrastructure/database/pool.js"
import type { KnowledgeChunk } from "../../knowledge/domain/knowledge-chunking.js"
import { rankChunks } from "../../knowledge/domain/lexical-retrieval.js"
import { renderAlignmentsForConversation, type AlignmentCandidate, type AlignmentResolution } from "../../operational-alignments/domain/operational-alignment.js"
import { recordAlignmentUsage } from "../../operational-alignments/application/alignment-audit.js"
import { structureAlignmentHeader, type LeaderStructureScope } from "../domain/leader-structure.js"
import type { PublicationRelevanceModel } from "../application/publication-relevance-model.js"
import { loadCommunicationsForConversation } from "./communication-conversation-loader.js"
import { resolveAlignmentsForStructure } from "./structure-alignment-resolution.js"

// Moram em arquivo próprio (sem ciclo de import — ARQ-06); reexportados para quem já importava daqui.
export { loadStructureSubjects, resolveAlignmentsForStructure } from "./structure-alignment-resolution.js"

type Queryable = Pick<Database, "query">

/** Quantos alinhamentos da estrutura entram no chat só de liderança (sem Orquestrador: sem bases autorizadas para filtrar). */
export const MAX_STRUCTURE_ALIGNMENTS_WITHOUT_ORCHESTRATOR = 3

/** Mesmo bloco da regra única, com o cabeçalho de quem lidera: cada alinhamento vale para o público dele. */
export function renderAlignmentsForStructure(resolution: AlignmentResolution, scope: LeaderStructureScope): string {
  const rendered = renderAlignmentsForConversation(resolution)
  if (!rendered) return ""
  const [, ...rest] = rendered.split("\n")
  return [...structureAlignmentHeader(scope), ...rest].join("\n")
}

/** Os alinhamentos relacionados à pergunta (sem Orquestrador não há bases autorizadas para restringir): busca da base, até 3. */
export function alignmentsRelatedTo(question: string, candidates: readonly AlignmentCandidate[], max = MAX_STRUCTURE_ALIGNMENTS_WITHOUT_ORCHESTRATOR): AlignmentCandidate[] {
  if (question.trim() === "" || candidates.length === 0) return []
  const chunks: KnowledgeChunk[] = candidates.map((candidate, index) => ({
    documentId: candidate.versionId,
    documentTitle: candidate.title,
    heading: candidate.affectedDocuments.map((document) => document.title).join("; "),
    index,
    text: [candidate.affectedTopic ?? "", candidate.guidance, candidate.affectedDocuments.map((document) => document.title).join(" ")].join("\n"),
  }))
  const byVersion = new Map(candidates.map((candidate) => [candidate.versionId, candidate]))
  const picked: AlignmentCandidate[] = []
  for (const ranked of rankChunks(question, chunks)) {
    const candidate = byVersion.get(ranked.documentId)
    if (!candidate || picked.includes(candidate)) continue
    picked.push(candidate)
    if (picked.length >= max) break
  }
  return picked
}

/**
 * Chat só de liderança (sem Orquestrador do Grupo de quem lidera): alinhamentos vigentes da estrutura e comunicados que chegam a ela,
 * os dois só quando relacionados à pergunta. Texto pronto para somar às instruções da liderança ("" = nada relacionado).
 */
export async function loadLeaderStructureBlock(db: Queryable, input: { organizationId: string; scope: LeaderStructureScope; question: string; at?: Date; model?: PublicationRelevanceModel }): Promise<{ text: string; alignments: AlignmentCandidate[]; communicationIds: string[] }> {
  const question = input.question.trim()
  if (!question) return { text: "", alignments: [], communicationIds: [] }
  const at = input.at ?? new Date()
  const [resolution, communications] = await Promise.all([
    resolveAlignmentsForStructure(db, { organizationId: input.organizationId, scope: input.scope, at, documentIds: null }),
    loadCommunicationsForConversation(db, { organizationId: input.organizationId, personId: input.scope.leaderPersonId, question, structure: input.scope, ...(input.model ? { model: input.model } : {}) }),
  ])
  const related = resolution ? alignmentsRelatedTo(question, resolution.applied) : []
  // Rastro só do que entrou de fato (os relacionados à pergunta).
  if (resolution && related.length > 0) recordAlignmentUsage(db, input.organizationId, { ...resolution, applied: related }, { surface: "CONVERSATION", personId: input.scope.leaderPersonId })
  const alignmentsText = resolution && related.length > 0 ? renderAlignmentsForStructure({ ...resolution, applied: related }, input.scope) : ""
  const text = [alignmentsText, communications.promptBlock].filter(Boolean).join("\n\n")
  return { text, alignments: related, communicationIds: communications.items.map((item) => item.id) }
}
