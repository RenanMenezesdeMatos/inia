-- Segundo tipo de Gatilho: por indicador (medição), não só por flag de canal.
-- Um workflow_enrollment passa a poder nascer de uma medição de indicador, sem interação.

alter table workflow_enrollments alter column interaction_id drop not null;
alter table workflow_enrollments add column indicator_measurement_id uuid references indicator_measurements(id) on delete cascade;
alter table workflow_enrollments add constraint workflow_enrollments_source_check check (
  (interaction_id is not null and indicator_measurement_id is null) or
  (interaction_id is null and indicator_measurement_id is not null)
);

-- Backfill: workflows existentes (todos por flag de canal) ganham o discriminante "kind"
-- que a partir de agora é obrigatório no trigger_config.
update workflows
set trigger_config = trigger_config || '{"kind":"channel_flag"}'::jsonb
where trigger_config ? 'channelFlagId' and not (trigger_config ? 'kind');
