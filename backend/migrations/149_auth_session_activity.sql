-- Atividade de cada sessão — encerramento por inatividade (liberação na Vivo, 2026-10-20).
--
-- O JWT vence num prazo absoluto (JWT_EXPIRES_IN, 12 h). Checklists de segurança pedem também o encerramento da sessão PARADA
-- (SESSION_IDLE_TIMEOUT_MINUTES, padrão 30). Atividade = interação na tela (o navegador avisa no máximo uma vez por minuto) ou
-- uma ação que altera algo (POST/PUT/PATCH/DELETE); as leituras automáticas da tela (sino, avisos) não renovam a sessão.
--
-- Uma linha por sessão (`jti` do JWT, o mesmo da revogação no logout — migration 123). Sessão sem linha (emitida antes desta
-- migration) não é derrubada: a primeira atividade cria a linha. A linha só importa até o token vencer (`expires_at`); a tarefa
-- periódica de limpeza das tentativas de login apaga as vencidas.

create table auth_session_activity (
  jti text primary key check (length(jti) between 1 and 100),
  account_id uuid not null references user_accounts(id) on delete cascade,
  last_activity_at timestamptz not null,
  expires_at timestamptz not null
);

create index idx_auth_session_activity_expires on auth_session_activity (expires_at);
