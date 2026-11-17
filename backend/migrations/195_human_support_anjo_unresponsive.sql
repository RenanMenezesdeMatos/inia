-- Apoio com Anjo — Anjo que não responde ninguém e abandono do Anjo por saída (2026-11-16, pedido do responsável).
--
-- 1. PAUSA "DESCONEXÃO" PELO SISTEMA. O Anjo que fica `anjo_unresponsive_minutes` (padrão 20) sem responder ninguém — desde o
--    primeiro retorno que ficou devendo a um operador (atendimento em andamento ou perdido por falta de resposta), sem mandar mensagem
--    em nenhum atendimento nem mudar o próprio estado nesse tempo — é posto em pausa com o motivo `DISCONNECTION` ("Desconexão"):
--    deixa de receber pedidos. Fica nela até `disconnection_pause_minutes` (padrão 10); se não voltar (escolher Disponível ou outro
--    estado), vira Indisponível. As duas mudanças ficam no histórico de presença com a causa (`UNRESPONSIVE` e
--    `UNRESPONSIVE_TIMEOUT`), que aparece na Monitoria Online, na linha do tempo da presença e na área do Anjo. O motivo
--    `DISCONNECTION` só o sistema põe: nunca é programado nem escolhido pelo Anjo.
-- 2. Os dois tempos são da organização (o Anjo pode atender vários Grupos), em `human_support_settings`, mudados por quem acompanha a
--    organização inteira, com o mesmo histórico e auditoria dos tempos de resposta.
-- 3. Sem mudança de esquema: a queda de rede (`ANJO_LOST` com `lost_cause = 'CONNECTION'`) deixa de contar como abandono do Anjo; a
--    saída (`lost_cause = 'SESSION'`: deslogou, prazo do login, conta desligada) continua contando — ele derrubou o operador.
alter table human_support_agent_presence drop constraint if exists human_support_agent_presence_pause_reason_check;
alter table human_support_agent_presence add constraint human_support_agent_presence_pause_reason_check
  check (pause_reason in ('LUNCH','PERSONAL','PROCESS_ACTIVITY','MEETING','DISCONNECTION'));

alter table human_support_presence_events drop constraint if exists human_support_presence_events_cause_check;
alter table human_support_presence_events add constraint human_support_presence_events_cause_check
  check (cause in ('ANJO','ANJO_SCHEDULED','LEASE_EXPIRED','ROLE_REVOKED','CONNECTION_LOST','CONNECTION_RESTORED','SESSION_ENDED','UNRESPONSIVE','UNRESPONSIVE_TIMEOUT'));

alter table human_support_settings add column if not exists anjo_unresponsive_minutes smallint not null default 20;
alter table human_support_settings add column if not exists disconnection_pause_minutes smallint not null default 10;
alter table human_support_settings drop constraint if exists human_support_settings_unresponsive_minutes_check;
alter table human_support_settings add constraint human_support_settings_unresponsive_minutes_check
  check (anjo_unresponsive_minutes between 1 and 240 and disconnection_pause_minutes between 1 and 120);

alter table human_support_setting_events drop constraint if exists human_support_setting_events_field_check;
alter table human_support_setting_events add constraint human_support_setting_events_field_check
  check (field in ('ENABLED','STATE','DEFAULT_CAPACITY','ANJO_CAPACITY','OPERATOR_REQUEUE_MINUTES','OPERATOR_CLOSE_MINUTES','ANJO_REQUEUE_MINUTES','ANJO_UNRESPONSIVE_MINUTES','DISCONNECTION_PAUSE_MINUTES'));

-- A busca do "último sinal de vida" do Anjo (última mensagem dele) a cada distribuição.
create index if not exists human_support_messages_anjo_author on human_support_messages (organization_id, author_person_id, occurred_at desc) where author_kind = 'ANJO';
