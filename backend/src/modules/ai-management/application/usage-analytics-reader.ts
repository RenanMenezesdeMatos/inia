/**
 * LEITOR ANALÍTICO do uso de IA (Monitoria de usabilidade). Custo é o REGISTRADO por evento (ESTIMATED pela tabela de preço da
 * organização, ou UNKNOWN) — nunca estimado por mensagem × preço fixo. Atribuição a workflow só existe com correlação gravada
 * (migration 084: root_enrollment_id); conversa/canal/origem NÃO têm correlação gravada — o uso fora de workflow é mostrado como
 * categoria própria "sem atribuição".
 *
 * Colunas de `aiUsageSql`: occurred_at, use_case, workflow_id, root_enrollment_id, total_tokens, cost, currency, cost_status, status.
 */
export function aiUsageSql(organizationParam: string): string {
  return `select u.occurred_at, u.use_case, u.workflow_id, u.root_enrollment_id, u.total_tokens, u.cost, u.currency, u.cost_status, u.status
    from ai_usage_events u where u.organization_id = ${organizationParam}`
}

/** Use Cases que atendem conversa/voz com a INIA (fora de workflow). */
export const CONVERSATIONAL_USE_CASES = ["CHAT", "VOICE_REALTIME", "SPEECH_SYNTHESIS", "SPECIALIST_RESPONSE", "ORCHESTRATOR_ROUTING", "ORCHESTRATOR_SYNTHESIS"] as const
