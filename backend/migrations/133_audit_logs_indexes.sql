-- `audit_logs` só tinha a chave primária (auditoria de escalabilidade, 2026-10-13). A tabela cresce com cada ação auditada, sem
-- retenção, e três leituras a varriam inteira:
--  - trilha de uma entidade: exceção de escala (schedule-exception-service.ts), Checkpoint Registry
--    (checkpoint-registry-queries.ts) e estratégia de diagnóstico → (organização, tipo, entidade, instante);
--  - ações de um revisor em volta de cada decisão de QA (qa-decision-audit.ts), uma busca por decisão → (ator, instante).
--
-- O índice do ator começa por `actor_id`, e não pela organização: é também a busca da FK `audit_logs_actor_id_fkey`, que roda
-- a cada pessoa apagada (reset da massa demo, limpeza de provas). Com 500 mil linhas, a checagem da FK de uma pessoa passou de
-- 50 ms (varredura) para 0,08 ms; com a organização na frente, ela continuava varrendo. A pessoa pertence a uma organização só,
-- então a organização segue como filtro. Parcial: ação de sistema (sem ator) nunca é buscada por ator.
-- Medição em docs/dev/escalabilidade-consultas.md.

create index idx_audit_logs_entity on audit_logs (organization_id, entity_type, entity_id, created_at);
create index idx_audit_logs_actor on audit_logs (actor_id, created_at) where actor_id is not null;
