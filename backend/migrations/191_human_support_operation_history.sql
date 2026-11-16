-- Apoio com Anjo — histórico de indicadores e painel em tempo real da operação do Anjo (2026-11-11).
--
-- Decisões do responsável (11/11/2026): a atribuição continua DIRETA (D2: o acolhimento é a atribuição — não há oferta nem aceite);
-- "online" = a área do Anjo aberta com a sessão válida; a pertinência do acionamento é um campo novo da classificação.
--
-- Só acrescenta (o código anterior funciona com ela aplicada):
--  * presença: a sessão que manteve a conexão por último (`session_jti`, `session_account_id`, `session_expires_at`), para a
--    distribuição dizer se a conexão caiu por REDE ou porque a SESSÃO terminou (logout, prazo do login ou inatividade);
--  * eventos de presença: a causa `SESSION_ENDED` (a conexão caiu porque a sessão terminou);
--  * atendimento: `lost_cause` — por que um atendimento foi interrompido pelo sistema (`ANJO_LOST`): conexão, sessão ou papel retirado;
--  * pedido: `anjos_in_service_at_end` — quantos Anjos estavam em serviço no escopo quando o pedido saiu da fila sem atendimento
--    (expirado, abandonado, cancelado); null = anterior a esta migration;
--  * classificação: `pertinence` (Pertinente, Não pertinente, Não avaliado); null = anterior a esta migration (lido como Não avaliado).
--
-- A partir desta migration a conexão também é registrada com o Anjo Indisponível (antes só com Disponível/Em pausa ou com atendimento):
-- é o que separa "indisponível com a área aberta" (tempo online) de "offline". A data em que ela foi aplicada (`schema_migrations`) é
-- a cobertura desses indicadores.
alter table human_support_presence_events drop constraint if exists human_support_presence_events_cause_check;
alter table human_support_presence_events add constraint human_support_presence_events_cause_check
  check (cause in ('ANJO','ANJO_SCHEDULED','LEASE_EXPIRED','ROLE_REVOKED','CONNECTION_LOST','CONNECTION_RESTORED','SESSION_ENDED'));

alter table human_support_agent_presence add column if not exists session_jti text check (session_jti is null or length(session_jti) between 1 and 100);
alter table human_support_agent_presence add column if not exists session_account_id uuid references user_accounts(id) on delete set null;
alter table human_support_agent_presence add column if not exists session_expires_at timestamptz;

alter table human_support_attendances add column if not exists lost_cause text check (lost_cause is null or lost_cause in ('CONNECTION','SESSION','ROLE_REVOKED'));
alter table human_support_requests add column if not exists anjos_in_service_at_end smallint check (anjos_in_service_at_end is null or anjos_in_service_at_end >= 0);
alter table human_support_classifications add column if not exists pertinence text check (pertinence is null or pertinence in ('PERTINENT','NOT_PERTINENT','NOT_EVALUATED'));

-- Leituras do histórico por período (jornada e indicadores por Anjo).
create index if not exists human_support_attendances_anjo_started on human_support_attendances (organization_id, anjo_person_id, started_at);
create index if not exists human_support_requests_org_created on human_support_requests (organization_id, created_at);
