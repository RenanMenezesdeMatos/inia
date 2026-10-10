import { permanentRedirect } from "next/navigation"

/**
 * Rota antiga da Wiki ("IA e Bases de Conhecimento"). O conteúdo foi repartido, sem duplicação, em
 * /wiki/agents, /wiki/orchestrators e /wiki/bases-conhecimento — links antigos caem na página de
 * Agents, que abre a camada de IA e aponta para as outras duas.
 */
export default function LegacyAiKnowledgeWikiPage() {
  permanentRedirect("/wiki/agents")
}
