-- Dois problemas reais encontrados testando ao vivo em 2026-09-11:
--
-- 1) Nada impedia criar um segundo orquestrador pro mesmo escopo (ex.: dois "ALL_TEAMS") — o
--    mais recente passava a valer pra todo mundo silenciosamente (resolve-orchestrator.ts ordena
--    por created_at desc), sem aviso nenhum pro admin. Fica um orquestrador ativo por escopo.
--
-- 2) O agente escolhido como "orquestrador" vinha do mesmo catálogo geral de agentes
--    especialistas (CALL_FEEDBACK/INDICATOR_FEEDBACK/DIAGNOSTICS/CUSTOM) — sem tipo próprio,
--    o admin podia (e chegou a) escolher qualquer agente de teste como orquestrador. Cria um
--    tipo dedicado ORCHESTRATOR (e, junto, HR — pedido separado nessa mesma rodada) e passa a
--    checar o tipo na criação/edição do orquestrador.

alter table agents drop constraint if exists agents_agent_type_check;
alter table agents add constraint agents_agent_type_check
  check (agent_type in ('CALL_FEEDBACK', 'INDICATOR_FEEDBACK', 'DIAGNOSTICS', 'ORCHESTRATOR', 'HR', 'CUSTOM'));

-- Só um orquestrador ATIVO por combinação de escopo — coalesce pra tratar ALL_TEAMS (team_id e
-- subteam_id ambos null) como um valor comparável em vez de "nulls nunca conflitam entre si".
create unique index uq_assistant_orchestrator_active_scope
  on assistant_orchestrators (organization_id, scope_type, coalesce(team_id::text, ''), coalesce(subteam_id::text, ''))
  where active;
