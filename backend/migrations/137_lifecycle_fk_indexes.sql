-- ÍNDICES DAS FKs QUE APONTAM PARA interactions E indicator_measurements — docs/dev/escala-read-model-e-ciclo-de-vida.md (parte B).
--
-- Aditiva. Pré-requisito de qualquer expurgo: apagar uma interação ou medição faz o PostgreSQL conferir cada tabela que
-- aponta para ela (CASCADE, SET NULL ou NO ACTION). Sem índice que comece pela coluna da FK, cada linha apagada vira uma
-- varredura completa da tabela que aponta — com 230 mil interações por dia, inviável. Os índices parciais existentes
-- (`call_assessments`/`call_criterion_assessments` com `where is_current`) não servem à conferência da FK. As FKs com
-- índice parcial `is not null` (feedback_analysis_runs, workflow_enrollments.indicator_measurement_id) já são atendidas.
-- Tabelas pequenas hoje: índice comum dentro da transação da migration.
create index if not exists idx_workflow_enrollments_interaction on workflow_enrollments (interaction_id) where interaction_id is not null;
create index if not exists idx_monitoring_triggers_interaction on monitoring_triggers (interaction_id);
create index if not exists idx_monitoring_evaluations_interaction on monitoring_evaluations (interaction_id);
create index if not exists idx_operator_diagnostics_interaction on operator_diagnostics (interaction_id) where interaction_id is not null;
create index if not exists idx_interaction_feedback_generations_interaction on interaction_feedback_generations (interaction_id);
create index if not exists idx_reliable_feedback_artifacts_interaction on reliable_feedback_artifacts (interaction_id) where interaction_id is not null;
create index if not exists idx_reliable_feedback_artifacts_measurement on reliable_feedback_artifacts (indicator_measurement_id) where indicator_measurement_id is not null;
create index if not exists idx_workflow_manual_runs_interaction on workflow_manual_runs (interaction_id) where interaction_id is not null;
create index if not exists idx_workflow_manual_runs_measurement on workflow_manual_runs (indicator_measurement_id) where indicator_measurement_id is not null;
create index if not exists idx_call_assessments_interaction on call_assessments (interaction_id);
create index if not exists idx_call_criterion_assessments_interaction on call_criterion_assessments (interaction_id);
