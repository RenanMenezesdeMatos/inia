-- Um Orquestrador por domínio/Base de Conhecimento (Faturamento, Retenção, Suporte Técnico...)
-- coexistindo no mesmo escopo administrativo — cada um coordena só os especialistas do seu
-- domínio e é referenciado EXPLICITAMENTE por id no node "Orquestrador" de um Workflow.
--
-- A unicidade "um orquestrador ATIVO por escopo" (migration 029) existe por causa do caminho
-- INTERATIVO (chat/voz): ali não há como o operador escolher, é sempre "o" orquestrador do
-- escopo dele, e dois ativos disputariam quem responde. Um orquestrador restrito a WORKFLOW
-- nunca entra nessa disputa (resolve-orchestrator.ts filtra por invocation_mode), então a regra
-- passa a valer só para quem atende o chat/voz (INTERACTIVE ou BOTH).
drop index if exists uq_assistant_orchestrator_active_scope;

create unique index uq_assistant_orchestrator_active_scope
  on assistant_orchestrators (organization_id, scope_type, coalesce(team_id::text, ''), coalesce(subteam_id::text, ''))
  where active and invocation_mode in ('INTERACTIVE', 'BOTH');
