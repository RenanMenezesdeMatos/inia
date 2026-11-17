import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { renderCommunicationsForConversation, type ConversationCommunication } from "../domain/communication-conversation.js"
import { conversationPublicationsFor, type ConversationPublicationsInput } from "./conversation-publications.js"

/**
 * Comunicados para a conversa de `personId` sobre `question` (`COMMUNICATION_CONVERSATION_V4`): os escolhidos pela IA entre os no ar
 * que a pessoa enxerga (`PUBLICATION_RELEVANCE_V1`, ver `conversation-publications.ts`). Sem comunicado no ar ou sem relação com a
 * pergunta = nada entra no prompt (nunca se "preenche" com o mais recente). A decisão é a mesma que o chat/voz tomou antes do
 * esclarecimento pelas bases (memória curta por pergunta).
 */
export async function loadCommunicationsForConversation(
  db: Pick<Database, "query">,
  input: ConversationPublicationsInput,
): Promise<{ items: ConversationCommunication[]; promptBlock: string }> {
  if (input.question.trim() === "") return { items: [], promptBlock: "" }
  const { communications: items } = await conversationPublicationsFor(db, input)
  if (items.length === 0) return { items, promptBlock: "" }
  return { items, promptBlock: renderCommunicationsForConversation(items, await resolveOrganizationTimezone(db, input.organizationId), input.structure ?? null) }
}
