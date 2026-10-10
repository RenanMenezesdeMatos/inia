-- Central de Dados — porta única de entrada dos dados fornecidos pelo cliente.
--
-- Fonte (de onde vem) → Feed (qual conjunto de dados) → Conector (como buscar/receber) →
-- Raw/Staging → Mapping → Contrato canônico → Validação → Domain Writer → Domínio da INIA,
-- com Run (o que aconteceu), Quarentena (o que foi rejeitado) e Lineage (de onde veio).
--
-- Nenhuma tabela aqui é "por indicador" ou "por dataset": o contrato é dado (contract_key +
-- contract_version), o mapeamento é dado (jsonb) e o writer é escolhido pelo contrato.

-- ------------------------------------------------------------------------------------------
-- Identidade externa estável de Grupo/Subgrupo — o nome visual nunca é identidade.
-- Backfill determinístico a partir do nome (maiúsculo, sem acento, `_` no lugar de símbolos)
-- para que a estrutura já existente possa ser referenciada por código desde o primeiro feed.
-- ------------------------------------------------------------------------------------------
alter table teams add column if not exists external_code text;
alter table subteams add column if not exists external_code text;

create or replace function inia_external_code(input text) returns text language sql immutable as $$
  select trim(both '_' from regexp_replace(
    upper(translate(input,
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
    '[^A-Z0-9]+', '_', 'g'))
$$;

update teams set external_code = inia_external_code(name) where external_code is null;
update subteams s set external_code = t.external_code || '/' || inia_external_code(s.name)
  from teams t where t.id = s.team_id and s.external_code is null;

create unique index if not exists teams_external_code_uk on teams (organization_id, external_code) where external_code is not null;
create unique index if not exists subteams_external_code_uk on subteams (organization_id, external_code) where external_code is not null;

-- Chaves naturais que o domínio já usava implicitamente, agora garantidas pelo banco (upsert
-- idempotente da Central). Sem duplicidade prévia (verificado antes da migration).
create unique index if not exists goals_natural_key_uk on goals (organization_id, indicator_definition_id, subject_type, subject_id, valid_from);
create unique index if not exists employee_work_shifts_natural_key_uk on employee_work_shifts (person_id, effective_from);

-- ------------------------------------------------------------------------------------------
-- Fontes
-- ------------------------------------------------------------------------------------------
create table if not exists data_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  public_id text not null,                          -- id curto e estável usado na URL do push
  name text not null,
  description text,
  kind text not null check (kind in ('FILE_UPLOAD', 'API_PULL', 'API_PUSH', 'SFTP')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'PAUSED', 'ERROR')),
  config jsonb not null default '{}'::jsonb,        -- NUNCA contém segredo (ver data_secrets)
  connection_health text not null default 'UNKNOWN' check (connection_health in ('UNKNOWN', 'HEALTHY', 'ERROR')),
  connection_checked_at timestamptz,
  connection_error text,
  created_by uuid references people(id),
  updated_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, public_id)
);
create index if not exists idx_data_sources_org on data_sources (organization_id) where deleted_at is null;

-- Segredos cifrados em repouso (AES-256-GCM, chave FORA do banco — DATA_HUB_SECRET_KEY).
-- Nunca devolvidos por API; só o adaptador de conexão os lê.
create table if not exists data_secrets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  source_id uuid not null references data_sources(id) on delete cascade,
  purpose text not null,                            -- ex.: API_AUTH, SFTP_PASSWORD, SFTP_PRIVATE_KEY
  key_version integer not null default 1,
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz
);
create unique index if not exists data_secrets_active_uk on data_secrets (source_id, purpose) where revoked_at is null;

-- ------------------------------------------------------------------------------------------
-- Feeds — "qual conjunto de dados esta fonte entrega", apontando para UM contrato canônico.
-- ------------------------------------------------------------------------------------------
create table if not exists data_feeds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  source_id uuid not null references data_sources(id) on delete cascade,
  feed_key text not null,                           -- usado na URL do push e nos logs
  name text not null,
  contract_key text not null,
  contract_version integer not null default 1,
  connector_config jsonb not null default '{}'::jsonb,  -- endpoint, sheet, separador, pattern...
  mapping jsonb not null default '{"fields":[]}'::jsonb,
  load_mode text not null default 'DELTA' check (load_mode in ('DELTA', 'SNAPSHOT')),
  cadence jsonb not null default '{"kind":"MANUAL"}'::jsonb,
  expected_interval_minutes integer,                -- base do ATRASADO (freshness)
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'PAUSED', 'DEGRADED')),
  authoritative boolean not null default false,     -- fonte autoritativa do dataset (master data)
  fail_on_any_rejection boolean not null default false,
  source_namespace text,                            -- identidade de origem em dados de evento
  schema_fingerprint jsonb,
  schema_changed_at timestamptz,
  checkpoint jsonb,                                 -- cursor/watermark do API Pull
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_data_at timestamptz,                         -- freshness de negócio (maior periodEnd/eventTime)
  last_error_code text,
  last_error_message text,
  next_sync_at timestamptz,
  created_by uuid references people(id),
  updated_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (source_id, feed_key)
);
create index if not exists idx_data_feeds_org on data_feeds (organization_id) where deleted_at is null;
create index if not exists idx_data_feeds_due on data_feeds (next_sync_at) where status = 'ACTIVE' and deleted_at is null;
-- Um único feed autoritativo ATIVO por contrato de dado mestre por organização.
create unique index if not exists data_feeds_authoritative_uk on data_feeds (organization_id, contract_key) where authoritative and deleted_at is null;

-- Credenciais de API Push (só o hash é guardado; o segredo aparece uma vez, ao criar/rotacionar).
create table if not exists data_push_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  source_id uuid not null references data_sources(id) on delete cascade,
  feed_id uuid references data_feeds(id) on delete cascade,  -- null = vale para todos os feeds da fonte
  label text not null,
  token_prefix text not null,                        -- 8 chars visíveis para identificar o token
  token_hash text not null,
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists idx_data_push_tokens_hash on data_push_tokens (token_hash) where revoked_at is null;

-- ------------------------------------------------------------------------------------------
-- Raw/Staging — objetos brutos (arquivo, payload) atrás do port RawObjectStore. Retenção por
-- expires_at (padrão 30 dias); metadados do Run permanecem.
-- ------------------------------------------------------------------------------------------
create table if not exists data_raw_objects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  source_id uuid references data_sources(id) on delete set null,
  feed_id uuid references data_feeds(id) on delete set null,
  filename text,
  content_type text not null,
  byte_size integer not null,
  checksum_sha256 text not null,
  content bytea not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists idx_data_raw_objects_expiry on data_raw_objects (expires_at);

-- ------------------------------------------------------------------------------------------
-- Runs — toda carga cria um Run com métricas completas e linha do tempo por etapa.
-- ------------------------------------------------------------------------------------------
create table if not exists data_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  source_id uuid not null references data_sources(id) on delete cascade,
  feed_id uuid not null references data_feeds(id) on delete cascade,
  contract_key text not null,
  contract_version integer not null,
  trigger_kind text not null check (trigger_kind in ('MANUAL', 'SCHEDULE', 'PUSH', 'FILE_UPLOAD', 'REPROCESS')),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'CONNECTING', 'FETCHING', 'PARSING', 'MAPPING', 'VALIDATING', 'APPLYING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')),
  stages jsonb not null default '[]'::jsonb,        -- [{stage, startedAt, finishedAt, detail}]
  raw_object_id uuid references data_raw_objects(id) on delete set null,
  idempotency_key text,
  reprocess_of_run_id uuid references data_ingestion_runs(id) on delete set null,
  requested_by uuid references people(id),
  attempts integer not null default 0,
  claimed_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  bytes integer,
  records_received integer not null default 0,
  records_parsed integer not null default 0,
  records_valid integer not null default 0,
  records_rejected integer not null default 0,
  records_inserted integer not null default 0,
  records_updated integer not null default 0,
  records_unchanged integer not null default 0,
  records_deactivated integer not null default 0,
  error_count integer not null default 0,
  error_code text,
  error_message text,
  business_max_event_time timestamptz,
  checkpoint_before jsonb,
  checkpoint_after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_data_runs_feed on data_ingestion_runs (feed_id, created_at desc);
create index if not exists idx_data_runs_org on data_ingestion_runs (organization_id, created_at desc);
create index if not exists idx_data_runs_queued on data_ingestion_runs (next_attempt_at) where status = 'QUEUED';
-- Sem duas execuções concorrentes do mesmo feed: uma única linha "em andamento" por feed.
create unique index if not exists data_runs_one_active_per_feed on data_ingestion_runs (feed_id)
  where status in ('CONNECTING', 'FETCHING', 'PARSING', 'MAPPING', 'VALIDATING', 'APPLYING');
-- Idempotency-Key do push: mesmo lote enviado duas vezes → mesmo Run.
create unique index if not exists data_runs_idempotency_uk on data_ingestion_runs (feed_id, idempotency_key) where idempotency_key is not null;

-- Quarentena: registro rejeitado, rastreável, sem o payload sensível inteiro.
create table if not exists data_ingestion_rejections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  run_id uuid not null references data_ingestion_runs(id) on delete cascade,
  record_number integer not null,
  source_record_key text,
  error_code text not null,
  field text,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_data_rejections_run on data_ingestion_rejections (run_id, record_number);
create index if not exists idx_data_rejections_code on data_ingestion_rejections (organization_id, error_code, created_at desc);

-- Dedup de arquivos (SFTP e upload): o mesmo conteúdo nunca é reprocessado sem pedido explícito.
create table if not exists data_processed_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  feed_id uuid not null references data_feeds(id) on delete cascade,
  remote_path text not null,
  checksum_sha256 text not null,
  byte_size integer not null,
  remote_modified_at timestamptz,
  run_id uuid references data_ingestion_runs(id) on delete set null,
  processed_at timestamptz not null default now(),
  unique (feed_id, checksum_sha256)
);

-- Lineage genérico: "de onde veio este registro?" sem colunas de ingestão em cada tabela.
create table if not exists data_lineage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  run_id uuid not null references data_ingestion_runs(id) on delete cascade,
  feed_id uuid not null references data_feeds(id) on delete cascade,
  source_id uuid not null references data_sources(id) on delete cascade,
  contract_key text not null,
  entity_type text not null,                         -- ex.: people, indicator_measurements
  entity_id uuid not null,
  source_record_key text,
  record_number integer,
  action text not null check (action in ('INSERTED', 'UPDATED')),
  created_at timestamptz not null default now()
);
create index if not exists idx_data_lineage_entity on data_lineage (entity_type, entity_id, created_at desc);
create index if not exists idx_data_lineage_run on data_lineage (run_id);
