-- "Aplicar individualmente" (EMPLOYEE_COLLECTION → EMPLOYEE, fan-out) — hoje workflow_enrollments
-- não tem NENHUM conceito de lineage pai/filho, e nenhum node cria enrollments (só o checador de
-- Agenda, fora do motor). Fan-out é trabalho novo de verdade: cada execução individual filha
-- aponta pra execução consolidada que a originou (`parent_enrollment_id`) e pro node específico
-- de "Aplicar individualmente" que a criou (`fan_out_node_id` — permite mais de um no mesmo
-- grafo sem colidir). `scheduled_subject_id` (já existente) é reaproveitado pro colaborador —
-- mesma coluna que o checador de Agenda já usa pra "carregador técnico" em modo Individual —
-- então resolveEnrollmentOperatorId resolve o filho corretamente sem nenhuma mudança.

alter table workflow_enrollments
  add column parent_enrollment_id uuid references workflow_enrollments(id) on delete cascade,
  add column fan_out_node_id text;

-- Idempotência do fan-out (retry/crash/reprocessamento nunca duplica um filho pro mesmo
-- colaborador do mesmo fan-out) — constraint de banco, não lógica de aplicação, mesmo padrão já
-- usado por workflow_enrollments_schedule_slot_uk (027_scheduled_workflow_trigger.sql).
create unique index workflow_enrollments_fan_out_uk
  on workflow_enrollments (parent_enrollment_id, fan_out_node_id, scheduled_subject_id)
  where parent_enrollment_id is not null and fan_out_node_id is not null;

-- Lineage (Parte 20/54 do pedido) — achar todos os filhos de uma execução consolidada.
create index workflow_enrollments_parent_enrollment_id_idx
  on workflow_enrollments (parent_enrollment_id)
  where parent_enrollment_id is not null;
