-- Apoio com Anjo — tempos de resposta por Grupo e "ninguém em serviço" na volta à fila (2026-11-16, pedido do responsável).
--
-- 1. TEMPOS POR GRUPO. Os três tempos da migration 193 continuam em `human_support_settings` como o PADRÃO DA ORGANIZAÇÃO (só quem
--    acompanha a organização inteira — Administrador geral ou Coordenador de Anjos com escopo de organização — muda). Cada Grupo pode
--    ter os seus (`human_support_group_response_times`), e o Coordenador de Anjos do Grupo só muda os do PRÓPRIO Grupo. Sem linha = o
--    Grupo usa o padrão da organização; Subgrupo segue o Grupo. O pedido usa o Grupo congelado nele (`human_support_requests.team_id`).
--    "Voltar ao padrão" apaga a linha (configuração, não objeto de negócio); o histórico fica em `human_support_setting_events`.
-- 2. NINGUÉM EM SERVIÇO. Quando o pedido voltaria à fila (Anjo sem responder ou operador que voltou depois de "Aguardando o
--    operador"; o Anjo que caiu continua esperando na fila, porque pode voltar) e não há Anjo em serviço no escopo, vale a mesma regra de quem pede sem ninguém em serviço: o pedido não fica na fila —
--    é encerrado (`NO_ANJO_IN_SERVICE`, estado Expirado, `anjos_in_service_at_end = 0`) e a tentativa sem Anjo é registrada.
create table if not exists human_support_group_response_times (
  organization_id uuid not null references organizations(id),
  team_id uuid not null references teams(id),
  operator_requeue_minutes smallint not null,
  operator_close_minutes smallint not null,
  anjo_requeue_minutes smallint not null,
  version integer not null default 1,
  updated_by_person_id uuid not null references people(id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, team_id),
  constraint human_support_group_response_times_minutes_check
    check (operator_requeue_minutes between 1 and 120 and anjo_requeue_minutes between 1 and 120 and operator_close_minutes between 2 and 240 and operator_close_minutes > operator_requeue_minutes)
);

alter table human_support_requests drop constraint if exists human_support_requests_end_cause_check;
alter table human_support_requests add constraint human_support_requests_end_cause_check
  check (end_cause in ('OPERATOR_CANCELLED','SCOPE_DISABLED','QUEUE_EXPIRED','OPERATOR_ABANDONED','OPERATOR_CLOSED','ANJO_CLOSED','OPERATOR_ABSENT','INACTIVITY','OPERATOR_NO_RETURN','NO_ANJO_IN_SERVICE'));

alter table human_support_messages drop constraint if exists human_support_messages_system_code_check;
alter table human_support_messages add constraint human_support_messages_system_code_check
  check (system_code is null or system_code in ('QUEUED','ANJO_ASSIGNED','ANJO_CONNECTION_LOST','ANJO_CONNECTION_RESTORED','ANJO_LEFT','ENDED_BY_OPERATOR','ENDED_BY_ANJO','ENDED_OPERATOR_ABSENT','ENDED_INACTIVITY','CANCELLED_BY_OPERATOR','CANCELLED_SCOPE_DISABLED','EXPIRED','ABANDONED','ANJO_TRANSFERRED','TRANSFER_REQUEUED','AWAITING_OPERATOR','OPERATOR_RETURNED','ANJO_SILENT_REQUEUED','ENDED_OPERATOR_NO_RETURN','ENDED_NO_ANJO_IN_SERVICE'));
