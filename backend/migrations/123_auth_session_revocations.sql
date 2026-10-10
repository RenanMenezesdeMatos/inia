-- Revogação de UMA sessão no logout (auditoria de segurança, 2026-10-08).
--
-- Antes, "Sair" só apagava o cookie no navegador: quem tivesse copiado o token continuava entrando até ele vencer (12 h).
-- Cada sessão agora nasce com um id (`jti` no JWT); o logout grava esse id aqui e o guard de sessão recusa o token na hora.
-- Só o aparelho que saiu cai — derrubar TODAS as sessões continua sendo `session_version` (migration 118).
--
-- A linha só é útil até o token vencer (`expires_at` = `exp` do JWT); o próprio logout apaga as vencidas.
-- Sessões emitidas antes desta migration não têm `jti`: seguem valendo até vencer, como sempre.

create table auth_revoked_sessions (
  jti text primary key check (length(jti) between 1 and 100),
  account_id uuid not null references user_accounts(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz not null default now()
);

create index idx_auth_revoked_sessions_expires on auth_revoked_sessions (expires_at);
