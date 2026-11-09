-- Central de Dados: configurar uma fonte com credencial guardada exige digitar a credencial de novo (05/11/2026).
-- A senha digitada libera a configuração por 30 minutos, para aquela pessoa, naquela fonte e naquela sessão de login. As cargas
-- agendadas continuam usando a senha guardada e não passam por aqui.
--
-- O estado fica no PostgreSQL porque há várias APIs. O histórico de quem liberou e de quem errou fica em `audit_logs`: uma linha
-- destas tabelas é só o estado atual, então uma liberação renovada sobrescreve a anterior e linhas vencidas podem sair.

create table data_source_config_unlocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_id uuid not null references data_sources(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  -- `jti` da sessão: um login novo nasce sem liberação.
  session_id text not null,
  method text not null check (method in ('PASSWORD_ENTERED', 'SOURCE_CREATED', 'CREDENTIAL_CHANGED')),
  granted_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint data_source_config_unlocks_period check (expires_at > granted_at),
  constraint data_source_config_unlocks_identity unique (source_id, person_id, session_id)
);

create index idx_data_source_config_unlocks_person on data_source_config_unlocks (person_id);

-- Tentativas de informar uma credencial (liberar, cadastrar, testar ou trocar), para o limite de 5 recusas em 15 minutos. A chave é
-- pessoa + servidor + usuário (`credentialTargetKey`, um hash): cadastrar outra fonte com o mesmo destino, ou mudar o banco ou a
-- criptografia, não zera a conta. A tentativa entra como FAILED antes de comparar ou conectar, como no login: N pedidos simultâneos se
-- enxergam e só 5 chegam a isso. Queda de rede vira REFUSED e não conta.
create table data_source_credential_attempts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  target_key text not null,
  outcome text not null check (outcome in ('FAILED', 'SUCCEEDED', 'REFUSED')),
  attempted_at timestamptz not null
);

create index idx_data_source_credential_attempts_window on data_source_credential_attempts (person_id, target_key, attempted_at desc);

-- Registro da Central: consulta por organização e instante, só das ações da Central.
create index idx_audit_logs_data_hub on audit_logs (organization_id, created_at desc) where action like 'DATA_HUB_%';
