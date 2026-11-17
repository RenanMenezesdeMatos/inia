-- Apoio com Anjo — tempos de resposta configuráveis e volta à fila (2026-11-16, pedido do responsável).
--
-- Antes: 15 min sem mensagem de ninguém encerravam o atendimento (`INACTIVITY`), sem dizer de quem era a vez. Agora quem ficou sem
-- responder decide o que acontece, com tempos que o Administrador geral ou o Coordenador de Anjos ajusta (padrões 15/20/15):
--  * o OPERADOR ficou sem responder (a última mensagem foi do Anjo) por `operator_requeue_minutes` → o atendimento termina
--    (`OPERATOR_SILENT`), o Anjo fica livre e o pedido passa a "Aguardando o operador" (`AWAITING_OPERATOR`, desde
--    `awaiting_operator_since` = a última mensagem do Anjo). Se o operador escrever, o pedido volta ao FIM da fila; sem resposta até
--    `operator_close_minutes` (contados do mesmo instante), o pedido é encerrado como abandono do operador (`OPERATOR_NO_RETURN`);
--  * o ANJO ficou sem responder (não respondeu ainda ou a última mensagem foi do operador) por `anjo_requeue_minutes` → o atendimento
--    termina (`ANJO_SILENT`, abandono do Anjo, sem classificação nem avaliação) e o pedido volta à FRENTE da fila, para qualquer Anjo.
-- `INACTIVITY` continua no `check` para o histórico. Só acrescenta; o pedido aguardando o operador conta como aberto (um por operador).
alter table human_support_requests drop constraint if exists human_support_requests_status_check;
alter table human_support_requests add constraint human_support_requests_status_check
  check (status in ('WAITING','IN_PROGRESS','AWAITING_OPERATOR','CLOSED','CANCELLED','EXPIRED','ABANDONED'));

alter table human_support_requests drop constraint if exists human_support_requests_end_cause_check;
alter table human_support_requests add constraint human_support_requests_end_cause_check
  check (end_cause in ('OPERATOR_CANCELLED','SCOPE_DISABLED','QUEUE_EXPIRED','OPERATOR_ABANDONED','OPERATOR_CLOSED','ANJO_CLOSED','OPERATOR_ABSENT','INACTIVITY','OPERATOR_NO_RETURN'));

alter table human_support_requests add column if not exists awaiting_operator_since timestamptz;
alter table human_support_requests drop constraint if exists human_support_requests_awaiting_operator_check;
alter table human_support_requests add constraint human_support_requests_awaiting_operator_check
  check (status <> 'AWAITING_OPERATOR' or awaiting_operator_since is not null);

drop index if exists human_support_requests_open_per_operator;
create unique index if not exists human_support_requests_open_per_operator on human_support_requests (organization_id, operator_person_id)
  where status in ('WAITING','IN_PROGRESS','AWAITING_OPERATOR');

alter table human_support_attendances drop constraint if exists human_support_attendances_end_cause_check;
alter table human_support_attendances add constraint human_support_attendances_end_cause_check
  check (end_cause in ('OPERATOR_CLOSED','ANJO_CLOSED','OPERATOR_ABSENT','INACTIVITY','ANJO_LOST','TRANSFERRED','OPERATOR_SILENT','ANJO_SILENT'));

alter table human_support_messages drop constraint if exists human_support_messages_system_code_check;
alter table human_support_messages add constraint human_support_messages_system_code_check
  check (system_code is null or system_code in ('QUEUED','ANJO_ASSIGNED','ANJO_CONNECTION_LOST','ANJO_CONNECTION_RESTORED','ANJO_LEFT','ENDED_BY_OPERATOR','ENDED_BY_ANJO','ENDED_OPERATOR_ABSENT','ENDED_INACTIVITY','CANCELLED_BY_OPERATOR','CANCELLED_SCOPE_DISABLED','EXPIRED','ABANDONED','ANJO_TRANSFERRED','TRANSFER_REQUEUED','AWAITING_OPERATOR','OPERATOR_RETURNED','ANJO_SILENT_REQUEUED','ENDED_OPERATOR_NO_RETURN'));

alter table human_support_settings add column if not exists operator_requeue_minutes smallint not null default 15;
alter table human_support_settings add column if not exists operator_close_minutes smallint not null default 20;
alter table human_support_settings add column if not exists anjo_requeue_minutes smallint not null default 15;
alter table human_support_settings drop constraint if exists human_support_settings_response_minutes_check;
alter table human_support_settings add constraint human_support_settings_response_minutes_check
  check (operator_requeue_minutes between 1 and 120 and anjo_requeue_minutes between 1 and 120 and operator_close_minutes between 2 and 240 and operator_close_minutes > operator_requeue_minutes);

alter table human_support_setting_events drop constraint if exists human_support_setting_events_field_check;
alter table human_support_setting_events add constraint human_support_setting_events_field_check
  check (field in ('ENABLED','STATE','DEFAULT_CAPACITY','ANJO_CAPACITY','OPERATOR_REQUEUE_MINUTES','OPERATOR_CLOSE_MINUTES','ANJO_REQUEUE_MINUTES'));

create index if not exists human_support_requests_awaiting_operator on human_support_requests (organization_id, awaiting_operator_since) where status = 'AWAITING_OPERATOR';
