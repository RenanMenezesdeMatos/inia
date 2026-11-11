-- Apoio com Anjo — pausa e indisponibilidade programadas (2026-11-11).
--
-- Durante um atendimento o Anjo pode PROGRAMAR "Em pausa" (com motivo) ou "Indisponível": o estado atual não muda, ele para de
-- receber chamados na hora (a distribuição ignora quem tem programação) e a mudança entra quando termina o ÚLTIMO atendimento em
-- andamento — encerrado pelo Anjo, pelo operador, por inatividade ou interrompido —, na mesma transação que encerra o atendimento.
-- Sem atendimento em andamento, pausa e indisponibilidade continuam valendo na hora (nada é programado).
--
-- A programação fica na própria linha de presença (sobrevive a recarregar a página e a reconectar). Quando o SISTEMA deixa o Anjo
-- Indisponível (sem conexão além da carência, papel revogado) a programação é apagada junto: ela nunca devolve o Anjo à fila.
-- O evento de presença da mudança aplicada leva a causa nova `ANJO_SCHEDULED` e o instante da aplicação (a transição efetiva), que é
-- de onde contam o cronômetro (`status_since`) e as horas em pausa do painel. Programar e cancelar não geram evento de presença.
--
-- Só acrescenta: colunas anuláveis (linhas existentes ficam sem programação) e a causa nova no `check`. O código anterior continua
-- funcionando com esta migration aplicada; o código novo precisa dela (aplique a migration ANTES de publicar o código).
alter table human_support_agent_presence
  add column if not exists scheduled_status text,
  add column if not exists scheduled_pause_reason text,
  add column if not exists scheduled_at timestamptz;

alter table human_support_agent_presence drop constraint if exists human_support_agent_presence_scheduled_check;
alter table human_support_agent_presence add constraint human_support_agent_presence_scheduled_check check (
  (scheduled_status is null and scheduled_pause_reason is null and scheduled_at is null)
  or (scheduled_status = 'OFFLINE' and scheduled_pause_reason is null and scheduled_at is not null)
  or (scheduled_status = 'PAUSED' and scheduled_pause_reason in ('LUNCH','PERSONAL','PROCESS_ACTIVITY','MEETING') and scheduled_at is not null)
);

alter table human_support_presence_events drop constraint if exists human_support_presence_events_cause_check;
alter table human_support_presence_events add constraint human_support_presence_events_cause_check
  check (cause in ('ANJO','ANJO_SCHEDULED','LEASE_EXPIRED','ROLE_REVOKED','CONNECTION_LOST','CONNECTION_RESTORED'));
