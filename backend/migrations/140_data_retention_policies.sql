-- POLÍTICAS DE RETENÇÃO — docs/dev/escala-read-model-e-ciclo-de-vida.md (parte B).
--
-- Aditiva. O mecanismo (backend/src/modules/data-lifecycle) apaga em lotes de 5.000, só o que é mais antigo que o prazo,
-- só o que a regra da tabela permite (ex.: alerta resolvido) e NUNCA o que outra tabela ainda referencia (ex.: interação que
-- é evidência de feedback). PRAZO É DECISÃO DE PRODUTO/LGPD: todas as políticas nascem DESLIGADAS e sem prazo — nada é
-- apagado até alguém decidir e registrar aqui quem decidiu e por quê. Tabelas com bloqueio estrutural (ex.: medições, cuja
-- FK em workflow_enrollments é ON DELETE CASCADE) são recusadas pelo mecanismo mesmo ligadas.
create table data_retention_policies (
  table_name text primary key,
  retention_days integer check (retention_days is null or retention_days > 0),
  enabled boolean not null default false,
  decided_at timestamptz,
  decided_by text,
  note text,
  updated_at timestamptz not null default now(),
  check (not enabled or (retention_days is not null and decided_at is not null and decided_by is not null))
);

create table data_retention_runs (
  id bigserial primary key,
  table_name text not null,
  cutoff timestamptz not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  deleted_rows integer not null default 0,
  outcome text not null check (outcome in ('COMPLETED', 'PARTIAL', 'REFUSED', 'FAILED')),
  detail text
);
create index idx_data_retention_runs_table on data_retention_runs (table_name, started_at desc);

insert into data_retention_policies (table_name, note) values
  ('transcripts', 'Texto das chamadas (dado do cliente final). Prazo = decisão LGPD.'),
  ('interactions', 'Metadados das chamadas. Evidência de feedback e matrícula de Workflow nunca saem.'),
  ('indicator_measurements', 'Medições diárias brutas. BLOQUEADA até workflow_enrollments.indicator_measurement_id deixar de ser CASCADE.'),
  ('data_lineage', 'Origem dos registros carregados pela Central de Dados.'),
  ('workflow_enrollments', 'Execuções de Workflow. BLOQUEADA até decidir o que acontece com saídas publicadas.'),
  ('ai_usage_events', 'Eventos brutos de uso de IA (o resumo diário ai_usage_daily fica).'),
  ('agent_runs', 'Entrada e saída completas dos Agents. Execução referenciada por evento de Workflow nunca sai.'),
  ('alerts', 'Só alertas RESOLVIDOS; abertos nunca. Alerta referenciado por reconciliação nunca sai.'),
  ('audit_logs', 'Trilha de auditoria.'),
  ('assistant_interactions', 'Mensagens das conversas com a INIA (hoje a regra é persistir tudo para aprendizado).'),
  ('workflow_output_speech_audio', 'Áudio PCM do recado (o texto fica; regerar custa TTS).'),
  ('feedback_application_speech_audio', 'Áudio PCM da aplicação de feedback (o texto fica; regerar custa TTS).');
