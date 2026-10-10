import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * LEITOR ANALÍTICO das conversas com a INIA (Monitoria de usabilidade). Fonte OFICIAL: conversas e mensagens persistidas.
 * Semântica fixada aqui (nunca reinterpretada pela monitoria):
 *   - mensagem HUMANA = role 'user'; canal de ENTRADA = `channel` ('chat' = digitada, 'voice' = turno de voz concluído — a
 *     pergunta digitada dentro da sessão de voz é gravada como 'chat');
 *   - mensagem da INIA = role 'assistant'; canal de SAÍDA = `channel` ('chat' = texto, 'voice' = resposta falada);
 *   - mensagem PROATIVA da INIA (recado de Workflow: client_message_id 'workflow-output:…'; apresentação da aplicação:
 *     'feedback-application:presentation') nunca é participação humana;
 *   - `LEGACY_HISTORY` não tem fronteira de conversa: suas mensagens contam onde a métrica é por mensagem, nunca como conversa;
 *   - chunks de streaming e transcrições parciais NÃO são gravados (só o texto final de cada turno) — não há o que deduplicar.
 *
 * Colunas de `conversationMessagesSql`: message_id, conversation_id, owner_person_id, role, channel, occurred_at, origin, kind,
 * proactive (bool), conversation_started_at, conversation_created_at.
 */
type Queryable = Pick<Database, "query">

export async function ownersOfConversations(db: Queryable, organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const result = await db.query<{ id: string; owner_person_id: string }>(`select id, owner_person_id from assistant_conversations where organization_id = $1 and id = any($2::uuid[])`, [organizationId, [...new Set(ids)]])
  return new Map(result.rows.map((row) => [row.id, row.owner_person_id]))
}

export const PROACTIVE_MESSAGE_SQL = (alias: string) => `(${alias}.role = 'assistant' and coalesce(${alias}.client_message_id like 'workflow-output:%' or ${alias}.client_message_id = 'feedback-application:presentation', false))`

export function conversationMessagesSql(organizationParam: string): string {
  return `select i.id message_id, i.conversation_id, c.owner_person_id, i.role, i.channel, i.occurred_at, c.origin, c.kind,
      ${PROACTIVE_MESSAGE_SQL("i")} proactive, c.started_at conversation_started_at, c.created_at conversation_created_at
    from assistant_interactions i
    join assistant_conversations c on c.id = i.conversation_id and c.organization_id = i.organization_id
    where i.organization_id = ${organizationParam}`
}

/** Colunas: conversation_id, owner_person_id, origin, kind, status, started_at, created_at, closed_at, close_reason, owner_seen_at (conversa de Workflow aberta pelo dono). */
export function conversationsSql(organizationParam: string): string {
  return `select c.id conversation_id, c.owner_person_id, c.origin, c.kind, c.status, c.started_at, c.created_at, c.closed_at, c.close_reason, c.owner_seen_at
    from assistant_conversations c where c.organization_id = ${organizationParam}`
}
