-- AUDITORIA DE ARQUITETURA DE DADOS (run-9, 22/11/2026) — relatório e medições em docs/dev/memoria/banco-e-consultas.md.
-- Só índices e parâmetros de estatística: nenhuma tabela é reescrita, nenhum dado muda.

-- DADOS-03 (e a entrega única da monitoria, DADOS-01): a ficha do caso e a conferência "esta chamada já tem feedback" liam
-- `feedbacks` inteira por `case_id`.
create index if not exists idx_feedbacks_case on feedbacks (case_id);

-- DADOS-01: "esta chamada já tem monitoria entregue?" (delivery-guards-sql.ts) agora parte da chamada e chega à mensagem do
-- motor por `analysis_run_ids && array[run]`, e ao feedback publicado pelo id da mensagem. O filtro do GIN repete EXATAMENTE o da
-- consulta (domain/status/delivered_at): mudou lá, muda aqui, senão o banco deixa de usar o índice.
create index if not exists idx_feedback_engine_messages_delivered_monitoring_runs
  on feedback_engine_messages using gin (analysis_run_ids)
  where domain = 'MONITORING' and status = 'PUBLISHABLE' and delivered_at is not null;
create index if not exists idx_feedbacks_engine_message_id
  on feedbacks ((context_snapshot -> 'feedbackEngine' ->> 'messageId'))
  where (context_snapshot -> 'feedbackEngine' ->> 'messageId') is not null;

-- DADOS-05: o login pela rede procura a pessoa por `upper(btrim(matricula))` (postgres-credential-store.ts). NÃO é único de
-- propósito: a mesma matrícula normalizada em dois cadastros precisa ser ACHADA (limit 2) para ninguém entrar pela conta errada.
create index if not exists idx_people_network_login on people (upper(btrim(matricula))) where matricula is not null;

-- B-03: a lista de Workflows conta as execuções vivas e bloqueadas de cada Workflow; sem este índice parcial lia o histórico todo.
create index if not exists idx_workflow_enrollments_workflow_live
  on workflow_enrollments (workflow_id, status) where status in ('active', 'waiting', 'blocked');

-- DADOS-04: índices que repetem o começo de um índice único da mesma tabela (o único atende as mesmas consultas e a FK).
-- interaction_flags é a tabela que mais cresce depois de interações: o redundante custava escrita e cache sem servir nada.
drop index if exists idx_interaction_flags_interaction;          -- = início de unique (interaction_id, channel_flag_id)
drop index if exists idx_diagnostic_insights_filter;             -- idêntico a unique (organization_id, reason, indicator_code)
drop index if exists idx_knowledge_org_scopes_doc;               -- = início de knowledge_document_org_scopes_unique
drop index if exists idx_employee_schedule_exceptions_person_date; -- = início de unique (person_id, exception_date, code)
drop index if exists knowledge_version_usages_source_idx;        -- = início de unique (source_kind, source_id, version_id, agent_id)

-- DADOS-06: nas tabelas de série grandes, o autoanalyze padrão (10% de mudança) só rodava a cada ~37 dias em produção e o
-- histograma de datas ficava para trás — filtros "últimos 7/30 dias" eram estimados perto de zero linha. Sem reescrever tabela
-- (trava SHARE UPDATE EXCLUSIVE: leitura e escrita continuam). indicator_measurements é visão: o parâmetro vai em _all.
alter table indicator_measurements_all set (autovacuum_analyze_scale_factor = 0.005, autovacuum_analyze_threshold = 5000,
                                            autovacuum_vacuum_insert_scale_factor = 0.02);
alter table interactions set (autovacuum_analyze_scale_factor = 0.005, autovacuum_vacuum_insert_scale_factor = 0.02);
alter table transcripts set (autovacuum_analyze_scale_factor = 0.01, autovacuum_vacuum_insert_scale_factor = 0.02);
alter table interaction_flags set (autovacuum_analyze_scale_factor = 0.01, autovacuum_vacuum_insert_scale_factor = 0.02);
alter table ai_usage_events set (autovacuum_analyze_scale_factor = 0.01);
