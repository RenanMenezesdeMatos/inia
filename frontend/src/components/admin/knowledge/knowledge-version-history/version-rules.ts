import type { KnowledgeVersionFullRow } from "@/schemas/admin/knowledge.schema"

/**
 * Reverter vale para o que já ficou pronto e não é a vigente. Versão substituída ficou pronta; arquivada, só se chegou a ser publicada; a que
 * "não entrou em uso" ficou pronta quando uma mais nova passou à frente, mas não quando a base foi arquivada no meio do processamento.
 */
export function canRevertVersion(version: KnowledgeVersionFullRow): boolean {
  switch (version.situation) {
    case "REPLACED":
      return true
    case "ARCHIVED":
      return version.publishedAt !== null
    case "SUPERSEDED":
      return version.supersededReason === "NEWER_VERSION"
    default:
      return false
  }
}

/** "versão 3" ou "versões 3 e 5", para as mensagens de comparação. */
export function versionsPhrase(numbers: readonly number[]): { article: string; noun: string; list: string } {
  const plural = numbers.length > 1
  return { article: plural ? "das" : "da", noun: plural ? "versões" : "versão", list: numbers.join(" e ") }
}
