-- Consulta de dados da Central (`data_hub.explore`): caminhos de leitura dos conjuntos grandes.
--
-- A consulta sempre filtra pela organização, ordena pela coluna do conjunto e pagina por posição (coluna, id). Sem estes índices, a primeira página
-- de um conjunto grande leria a organização inteira para ordenar. Com eles, lê só os registros da página.
--
-- Fora daqui, porque já têm índice que serve: `ai_usage_events` (organização, quando), `data_ingestion_runs` (organização, criação), `employee_schedule_days`
-- (organização, dia) e `interactions` (organização, protocolo). Conjuntos pequenos (pessoas, Grupos, metas, jornadas, exceções, situações) ordenam em memória, e
-- o custo é irrisório. Tamanho e efeito medidos em docs/dev/central-de-dados-consulta.md.

create index if not exists idx_interactions_explorer on interactions (organization_id, started_at desc, id desc);
create index if not exists idx_transcripts_explorer on transcripts (organization_id, created_at desc, id desc);
create index if not exists idx_interaction_flags_explorer on interaction_flags (organization_id, received_at desc, id desc);
create index if not exists idx_measurements_explorer on indicator_measurements (organization_id, period_start desc, id desc);
create index if not exists idx_official_closures_explorer on employee_indicator_performance (organization_id, reference_period desc, id desc);
create index if not exists idx_prv_closures_explorer on employee_prv_performance (organization_id, reference_period desc, id desc);
create index if not exists idx_supervision_cases_explorer on supervision_cases (organization_id, created_at desc, id desc);
create index if not exists idx_feedbacks_explorer on feedbacks (organization_id, created_at desc, id desc);
create index if not exists idx_workflow_enrollments_explorer on workflow_enrollments (organization_id, created_at desc, id desc);
create index if not exists idx_agent_runs_explorer on agent_runs (organization_id, created_at desc, id desc);
create index if not exists idx_data_rejections_explorer on data_ingestion_rejections (organization_id, created_at desc, id desc);
