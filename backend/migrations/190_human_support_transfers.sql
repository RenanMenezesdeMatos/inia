-- Apoio com Anjo — transferência de atendimento pela coordenação (2026-11-11).
--
-- O Coordenador de Anjos (no alcance dele) ou o Administrador geral pode passar um atendimento em andamento para outro Anjo que
-- possa recebê-lo agora (Disponível, com a área aberta e com vaga, no Grupo/Subgrupo do pedido) ou, sem nenhum assim, devolvê-lo à
-- FRENTE da fila. Motivo curto obrigatório, que o operador nunca vê. O atendimento de quem saiu termina com a causa `TRANSFERRED`
-- (sem classificação nem avaliação: quem fecha o atendimento classifica); o pedido continua o mesmo — protocolo, mensagens e
-- recibos — e, na transferência direta, ganha um atendimento novo com o outro Anjo.
--
-- Só acrescenta: causa nova no `check` do fim do atendimento, dois códigos de mensagem de sistema, a tabela do registro (filha do
-- pedido: sai com ele na retenção) e, no pedido, o Anjo de quem ele foi devolvido à fila (a distribuição não o devolve a esse
-- mesmo Anjo). O código anterior funciona com ela aplicada.
alter table human_support_attendances drop constraint if exists human_support_attendances_end_cause_check;
alter table human_support_attendances add constraint human_support_attendances_end_cause_check
  check (end_cause in ('OPERATOR_CLOSED','ANJO_CLOSED','OPERATOR_ABSENT','INACTIVITY','ANJO_LOST','TRANSFERRED'));

alter table human_support_messages drop constraint if exists human_support_messages_system_code_check;
alter table human_support_messages add constraint human_support_messages_system_code_check
  check (system_code is null or system_code in ('QUEUED','ANJO_ASSIGNED','ANJO_CONNECTION_LOST','ANJO_CONNECTION_RESTORED','ANJO_LEFT','ENDED_BY_OPERATOR','ENDED_BY_ANJO','ENDED_OPERATOR_ABSENT','ENDED_INACTIVITY','CANCELLED_BY_OPERATOR','CANCELLED_SCOPE_DISABLED','EXPIRED','ABANDONED','ANJO_TRANSFERRED','TRANSFER_REQUEUED'));

alter table human_support_requests add column if not exists avoid_anjo_person_id uuid references people(id);

create table if not exists human_support_transfers (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  request_id uuid not null references human_support_requests(id) on delete cascade,
  from_attendance_id uuid not null references human_support_attendances(id) on delete cascade,
  to_attendance_id uuid references human_support_attendances(id) on delete cascade,
  from_anjo_person_id uuid not null references people(id),
  to_anjo_person_id uuid references people(id),
  actor_person_id uuid not null references people(id),
  reason text not null check (char_length(reason) between 3 and 500),
  occurred_at timestamptz not null default now(),
  check ((to_attendance_id is null) = (to_anjo_person_id is null))
);
create index if not exists human_support_transfers_request on human_support_transfers (request_id, occurred_at);
create index if not exists human_support_transfers_org on human_support_transfers (organization_id, occurred_at);
