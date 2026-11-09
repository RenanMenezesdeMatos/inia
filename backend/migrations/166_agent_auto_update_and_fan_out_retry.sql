-- Revisão aprovada da PEN-002 e da PEN-076 (03/11/2026): atualização automática dos agentes.
-- Publicar uma versão do agente a torna vigente para as próximas execuções de TODOS os consumidores (chat, voz, Workflows,
-- orquestradores), sem republicá-los. Workflows e orquestradores deixam de fixar versão de agente. A versão usada continua
-- registrada em cada execução, e o histórico já gravado não é reescrito:
-- - `agent_runs.agent_version_id` e `assistant_interaction_agents.agent_version_id` ficam como estão;
-- - versões publicadas de Workflow (`workflow_versions.graph`) e de Orquestrador (`assistant_orchestrator_versions.config`)
--   são imutáveis e continuam com o que registraram — o motor só deixa de ler a versão de agente delas.
-- Esta migration é adicional: a 164 e a 165 já foram aplicadas e não são reescritas.

-- 1. Rascunhos de Workflow: a referência explícita à versão do agente (posta pela 164) deixa de existir. É estado editável,
--    não histórico. A referência à versão do ORQUESTRADOR (`orchestratorVersionId`) continua: a configuração do Orquestrador
--    é versionada e o Workflow a referencia (PEN-076, item não revisto).
update workflows w set draft_graph = jsonb_set(w.draft_graph, '{nodes}', (
  select jsonb_agg(case when n->>'type' = 'action' and n->'config'->>'actionType' = 'CALL_AGENT' and n->'config' ? 'agentVersionId'
                        then jsonb_set(n, '{config}', (n->'config') - 'agentVersionId') else n end order by ord)
    from jsonb_array_elements(w.draft_graph->'nodes') with ordinality e(n, ord)
))
where jsonb_typeof(w.draft_graph->'nodes') = 'array'
  and exists (select 1 from jsonb_array_elements(w.draft_graph->'nodes') n where n->'config' ? 'agentVersionId');

-- 2. Orquestrador: as colunas que fixavam a versão do agente na configuração atual deixam de ser usadas. O que cada versão
--    gravada registrou continua no `config` dela (imutável).
update assistant_orchestrator_specialists set agent_version_id = null where agent_version_id is not null;
update assistant_orchestrators set orchestrator_agent_version_id = null where orchestrator_agent_version_id is not null;
comment on column assistant_orchestrator_specialists.agent_version_id is 'Sem uso desde a revisão da PEN-002/PEN-076 (03/11/2026, migration 166): o especialista roda na versão vigente. Mantida para não apagar estrutura.';
comment on column assistant_orchestrators.orchestrator_agent_version_id is 'Sem uso desde a revisão da PEN-002/PEN-076 (03/11/2026, migration 166): o agente orquestrador roda na versão vigente.';

-- 3. Participação de agente numa resposta: chamada impedida porque a versão vigente não está autorizada para o alcance do
--    Orquestrador (condição de segurança da revisão).
alter table assistant_interaction_agents drop constraint assistant_interaction_agents_outcome_check;
alter table assistant_interaction_agents add constraint assistant_interaction_agents_outcome_check
  check (outcome in ('EXECUTED', 'BLOCKED_INACTIVE', 'BLOCKED_UNAUTHORIZED', 'FAILED'));

-- 4. Execução bloqueada: o motivo passa a ser "agente inativo" (PEN-070) ou "acesso não autorizado" (revisão de 03/11/2026).
comment on column workflow_enrollments.blocked_reason is 'AGENT_INACTIVE (PEN-070) ou AGENT_ACCESS_NOT_AUTHORIZED (versão vigente do agente não autorizada para o alcance do Workflow).';

-- 5. Nova tentativa de execução filha de "Selecionar colaboradores" (PEN-073): continua filha da mesma execução principal, para o
--    mesmo colaborador. A unicidade do envio vale para os filhos que ele cria; só as tentativas confirmadas ficam fora dela.
drop index if exists workflow_enrollments_fan_out_uk;
create unique index workflow_enrollments_fan_out_uk on workflow_enrollments(parent_enrollment_id, fan_out_node_id, scheduled_subject_id)
  where parent_enrollment_id is not null and fan_out_node_id is not null and retry_of_enrollment_id is null;
