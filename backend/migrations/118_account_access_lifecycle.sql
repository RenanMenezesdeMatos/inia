-- Liberação de acesso e primeiro login.
--
-- O administrador HABILITA o acesso de uma pessoa já identificada (people) — criando a conta de login (user_accounts) quando
-- ela ainda não existe, nunca um cadastro novo — e recebe uma SENHA TEMPORÁRIA aleatória, exibida uma única vez. Com ela a
-- pessoa entra e é obrigada a criar a própria senha antes de usar qualquer outra coisa.
--
-- session_version: cada sessão (JWT) carrega a versão da conta no momento do login; o backend confere a cada request. Desabilitar
-- o acesso, gerar outra senha temporária ou concluir a troca de senha incrementam a versão = todas as sessões anteriores caem.
--
-- Contas existentes continuam exatamente como estão (password_change_required = false, versão 0): nenhum acesso atual muda.

alter table user_accounts
  add column session_version integer not null default 0,
  add column password_change_required boolean not null default false,
  add column temporary_password_issued_at timestamptz,
  add column temporary_password_expires_at timestamptz,
  add column password_changed_at timestamptz,
  add column access_disabled_at timestamptz;

-- Senha temporária só existe enquanto a troca é obrigatória — e a troca obrigatória sempre tem validade.
alter table user_accounts add constraint user_accounts_temporary_password_check check (
  (password_change_required and temporary_password_issued_at is not null and temporary_password_expires_at is not null
    and temporary_password_expires_at > temporary_password_issued_at)
  or (not password_change_required and temporary_password_issued_at is null and temporary_password_expires_at is null)
);

-- Tentativas de login para a trava contra tentativa e erro. Nunca guarda o texto digitado (o campo de e-mail às vezes recebe
-- uma senha): só um HMAC do identificador normalizado, com chave fora do banco.
create table auth_login_attempts (
  id bigint generated always as identity primary key,
  identifier_hash text not null,
  account_id uuid references user_accounts(id) on delete cascade,
  outcome text not null check (outcome in ('SUCCEEDED', 'INVALID_CREDENTIALS', 'ACCESS_DISABLED', 'TEMPORARY_PASSWORD_EXPIRED', 'LOCKED')),
  attempted_at timestamptz not null default now()
);

create index idx_auth_login_attempts_identifier on auth_login_attempts (identifier_hash, attempted_at desc);
