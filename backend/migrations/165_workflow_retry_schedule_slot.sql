-- Nova tentativa de execução bloqueada (PEN-073 a PEN-075, decididas em 03/11/2026): a tentativa é uma execução NOVA vinculada
-- à original (`retry_of_enrollment_id`) para o MESMO colaborador e o mesmo horário de agenda. A unicidade do slot de agenda
-- continua valendo para os disparos — só as tentativas confirmadas por alguém ficam fora dela (a original nunca é alterada).
drop index if exists workflow_enrollments_schedule_slot_uk;
create unique index workflow_enrollments_schedule_slot_uk on workflow_enrollments(workflow_id, scheduled_subject_id, scheduled_for)
  where scheduled_subject_id is not null and retry_of_enrollment_id is null;
