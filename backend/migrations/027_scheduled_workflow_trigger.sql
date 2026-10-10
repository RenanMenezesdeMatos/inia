-- Terceira origem de workflow_enrollment: gatilho por agenda (X vezes ao dia), sem
-- interação nem medição de indicador por trás — nasce de um checador periódico que
-- matricula um operador do escopo do workflow a cada horário configurado.

alter table workflow_enrollments
  add column scheduled_subject_id uuid references people(id) on delete cascade,
  add column scheduled_for timestamptz;

alter table workflow_enrollments drop constraint workflow_enrollments_source_check;
alter table workflow_enrollments add constraint workflow_enrollments_source_check check (
  (case when interaction_id is not null then 1 else 0 end
   + case when indicator_measurement_id is not null then 1 else 0 end
   + case when scheduled_subject_id is not null then 1 else 0 end) = 1
);

-- Evita matricular o mesmo operador duas vezes no mesmo horário do mesmo dia, mesmo que o
-- checador de agenda rode mais de uma vez antes do horário seguinte.
create unique index workflow_enrollments_schedule_slot_uk
  on workflow_enrollments (workflow_id, scheduled_subject_id, scheduled_for)
  where scheduled_subject_id is not null;
