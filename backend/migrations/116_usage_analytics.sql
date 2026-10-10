-- Monitoria de usabilidade (2026-10-06) — instrumentação de uso, sessões, fatos por pessoa/dia, elegibilidade e qualidade.
--
-- Aditiva: nenhuma tabela existente muda. As tabelas de negócio (feedbacks, avaliações, ciência, aplicações, conversas,
-- workflows) continuam sendo a fonte OFICIAL e são lidas por leitores explícitos dos módulos — nada é copiado para cá.
-- Estas tabelas guardam só o que não existia: eventos de interface (navegador), fatos de servidor que as tabelas oficiais não
-- guardam como histórico, as projeções reprocessáveis (sessões, pessoa × dia, pessoa × dia × tela) e a cobertura da medição.
--
-- Livro-razão: ids de pessoa/conta NÃO têm FK (como ai_usage_events) — expirar/reprocessar nunca depende do cadastro e o
-- reset da massa demo não é bloqueado por telemetria. Telemetria NUNCA guarda texto de tela, conteúdo de conversa/feedback,
-- consulta digitada, login ou senha: `properties` só aceita as chaves do esquema fechado de cada evento (validado na aplicação).
-- Retenção (configurável em usage_settings): eventos brutos 90 dias; fatos/projeções 13 meses; marcos de acesso não expiram.

create table if not exists usage_settings (
  organization_id uuid primary key references organizations(id),
  collection_enabled boolean not null default true,
  raw_retention_days integer not null default 90 check (raw_retention_days between 7 and 400),
  fact_retention_months integer not null default 13 check (fact_retention_months between 1 and 60),
  -- Fuso para agregação/apresentação; null = o da operação (operations.timezone), com fallback America/Fortaleza.
  timezone_override text check (timezone_override is null or char_length(timezone_override) between 3 and 64),
  updated_by_account_id uuid,
  updated_at timestamptz not null default now()
);

-- Ligar/desligar a coleta fica registrado: o intervalo desligado vira lacuna de cobertura (nunca zero).
create table if not exists usage_collection_toggles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  enabled boolean not null,
  reason text check (reason is null or char_length(reason) <= 300),
  changed_by_account_id uuid,
  changed_at timestamptz not null default now()
);
create index if not exists usage_collection_toggles_org_idx on usage_collection_toggles (organization_id, changed_at);

create table if not exists usage_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  event_id uuid not null,
  event_name text not null,
  schema_version smallint not null,
  family text not null,
  source text not null check (source in ('CLIENT', 'SERVER', 'BACKFILL')),
  actor_type text not null check (actor_type in ('HUMAN', 'SYSTEM')),
  account_id uuid,
  actor_person_id uuid,
  subject_person_id uuid,
  -- Instante EFETIVO do fato (relógio do cliente, corrigido só quando o desvio passa da tolerância — ver timestamp_status).
  occurred_at timestamptz not null,
  client_occurred_at timestamptz,
  received_at timestamptz not null,
  clock_offset_ms integer,
  timestamp_status text not null default 'OK' check (timestamp_status in ('OK', 'CLIENT_CLOCK_CORRECTED', 'LATE')),
  usage_session_id uuid,
  tab_id uuid,
  screen_instance_id uuid,
  screen_key text,
  feature_key text,
  element_key text,
  route_template text,
  area text,
  entity_type text,
  entity_id uuid,
  correlation_id uuid,
  device text check (device is null or device in ('DESKTOP', 'MOBILE', 'TABLET')),
  app_version text,
  environment text not null,
  -- Classificação EXPLÍCITA do ator no momento do fato (usage_population_classifications), nunca flag do navegador.
  population_class text not null default 'REAL' check (population_class in ('REAL', 'TEST', 'DEMO', 'AUTOMATION')),
  -- Estrutura organizacional conhecida no momento do fato (snapshot na ingestão).
  team_id uuid,
  subteam_id uuid,
  reports_to_id uuid,
  properties jsonb not null default '{}'::jsonb,
  -- Chave semântica de fatos de servidor (o mesmo fato nunca entra duas vezes).
  idempotency_key text,
  batch_id uuid,
  constraint usage_events_unique_event unique (organization_id, event_id)
);
create unique index if not exists usage_events_idempotency_idx on usage_events (organization_id, idempotency_key) where idempotency_key is not null;
create index if not exists usage_events_org_time_idx on usage_events (organization_id, occurred_at);
create index if not exists usage_events_person_time_idx on usage_events (organization_id, actor_person_id, occurred_at);
create index if not exists usage_events_name_time_idx on usage_events (organization_id, event_name, occurred_at);
create index if not exists usage_events_entity_idx on usage_events (organization_id, entity_type, entity_id) where entity_id is not null;
create index if not exists usage_events_session_idx on usage_events (organization_id, usage_session_id) where usage_session_id is not null;
create index if not exists usage_events_correlation_idx on usage_events (organization_id, correlation_id) where correlation_id is not null;
create index if not exists usage_events_received_idx on usage_events (received_at);

-- Um lote recebido do navegador (qualidade da medição: recebidos, aceitos, duplicados, recusados por motivo, atraso).
create table if not exists usage_ingest_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  account_id uuid,
  received_at timestamptz not null,
  transport text not null check (transport in ('FETCH', 'BEACON')),
  events_received integer not null check (events_received >= 0),
  accepted integer not null check (accepted >= 0),
  duplicates integer not null check (duplicates >= 0),
  rejected integer not null check (rejected >= 0),
  rejection_reasons jsonb not null default '{}'::jsonb,
  clock_offset_ms integer,
  oldest_event_age_ms integer,
  app_version text,
  device text
);
create index if not exists usage_ingest_batches_org_idx on usage_ingest_batches (organization_id, received_at);

-- Primeira/última evidência por família de eventos — base da cobertura ("medição iniciada em…").
create table if not exists usage_coverage (
  organization_id uuid not null references organizations(id),
  family text not null,
  first_event_at timestamptz not null,
  last_event_at timestamptz not null,
  last_received_at timestamptz not null,
  primary key (organization_id, family)
);

-- Sessões de uso DERIVADAS dos eventos (reprocessáveis): conta × id do navegador × período contínuo de atividade.
create table if not exists usage_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  account_id uuid not null,
  person_id uuid not null,
  usage_session_id uuid not null,
  seq integer not null check (seq >= 0),
  started_at timestamptz not null,
  last_activity_at timestamptz not null,
  ended_at timestamptz not null,
  end_reason text not null check (end_reason in ('LOGOUT', 'INACTIVITY_INFERRED', 'OPEN')),
  activity_count integer not null,
  active_seconds integer not null default 0,
  has_product_activity boolean not null,
  has_admin_activity boolean not null,
  device text,
  app_version text,
  population_class text not null default 'REAL',
  team_id uuid,
  subteam_id uuid,
  reports_to_id uuid,
  started_local_date date not null,
  timezone text not null,
  projected_at timestamptz not null,
  constraint usage_sessions_unique unique (organization_id, usage_session_id, seq),
  constraint usage_sessions_order check (ended_at >= started_at and last_activity_at >= started_at)
);
create index if not exists usage_sessions_org_start_idx on usage_sessions (organization_id, started_at);
create index if not exists usage_sessions_person_idx on usage_sessions (organization_id, person_id, started_at);

-- Fatos por PESSOA × DIA LOCAL — permitem união exata de pessoas em qualquer intervalo (nunca somar ativos diários).
create table if not exists usage_person_days (
  organization_id uuid not null references organizations(id),
  person_id uuid not null,
  local_date date not null,
  timezone text not null,
  active_product boolean not null default false,
  active_admin boolean not null default false,
  sessions_started integer not null default 0,
  sessions_started_product integer not null default 0,
  sessions_active integer not null default 0,
  active_seconds integer not null default 0,
  active_seconds_product integer not null default 0,
  screen_views integer not null default 0,
  screen_views_product integer not null default 0,
  activations integer not null default 0,
  first_activity_at timestamptz,
  last_activity_at timestamptz,
  devices text[] not null default '{}',
  active_hours smallint[] not null default '{}',
  population_class text not null default 'REAL',
  team_id uuid,
  subteam_id uuid,
  reports_to_id uuid,
  projected_at timestamptz not null,
  primary key (organization_id, person_id, local_date)
);
create index if not exists usage_person_days_date_idx on usage_person_days (organization_id, local_date);

-- Fatos por PESSOA × DIA × TELA (ranking de telas por 13 meses, pessoas únicas por tela, tempo ativo por tela).
create table if not exists usage_screen_person_days (
  organization_id uuid not null references organizations(id),
  person_id uuid not null,
  local_date date not null,
  screen_key text not null,
  area text,
  views integer not null default 0,
  active_seconds integer not null default 0,
  population_class text not null default 'REAL',
  team_id uuid,
  subteam_id uuid,
  primary key (organization_id, person_id, local_date, screen_key)
);
create index if not exists usage_screen_person_days_date_idx on usage_screen_person_days (organization_id, local_date, screen_key);

-- Fila de reprojeção (pessoa × dia local afetado por evento novo ou tardio). Idempotente: reprocessar = projetar de novo.
create table if not exists usage_projection_dirty (
  organization_id uuid not null references organizations(id),
  person_id uuid not null,
  local_date date not null,
  marked_at timestamptz not null,
  attempts integer not null default 0,
  primary key (organization_id, person_id, local_date)
);
create index if not exists usage_projection_dirty_marked_idx on usage_projection_dirty (marked_at);

create table if not exists usage_projection_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ACTIVITY', 'ELIGIBILITY', 'RETENTION', 'BACKFILL')),
  started_at timestamptz not null,
  finished_at timestamptz,
  processed integer not null default 0,
  failed integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists usage_projection_runs_kind_idx on usage_projection_runs (kind, started_at desc);

-- Elegibilidade REGISTRADA daqui em diante (pessoa ativa + conta habilitada). Nunca reconstruída por suposição: o primeiro
-- intervalo de quem já existia começa no início do registro (COLLECTION_START).
create table if not exists usage_eligibility_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null,
  account_id uuid not null,
  eligible_from timestamptz not null,
  eligible_until timestamptz,
  opened_basis text not null check (opened_basis in ('COLLECTION_START', 'ACCOUNT_CREATED', 'STATE_CHANGE_OBSERVED')),
  closed_basis text check (closed_basis is null or closed_basis in ('ACCOUNT_DISABLED', 'PERSON_INACTIVE', 'ACCOUNT_REMOVED')),
  created_at timestamptz not null default now(),
  constraint usage_eligibility_order check (eligible_until is null or eligible_until >= eligible_from),
  constraint usage_eligibility_closed check ((eligible_until is null) = (closed_basis is null))
);
create unique index if not exists usage_eligibility_open_idx on usage_eligibility_periods (organization_id, person_id) where eligible_until is null;
create index if not exists usage_eligibility_range_idx on usage_eligibility_periods (organization_id, eligible_from);

-- Início do registro de elegibilidade por organização (cobertura da população do período).
create table if not exists usage_eligibility_tracking (
  organization_id uuid primary key references organizations(id),
  started_at timestamptz not null
);

-- Marcos de acesso por pessoa — NÃO expiram com a retenção (expirar eventos nunca transforma alguém em "nunca acessou").
create table if not exists usage_person_milestones (
  organization_id uuid not null references organizations(id),
  person_id uuid not null,
  first_observed_at timestamptz,
  first_observed_source text check (first_observed_source is null or first_observed_source in ('ACTIVITY', 'LOGIN', 'DOMAIN_ACTION')),
  last_observed_at timestamptz,
  last_observed_source text check (last_observed_source is null or last_observed_source in ('ACTIVITY', 'LOGIN', 'DOMAIN_ACTION')),
  -- Backfill comprovado: o último login conhecido (user_accounts.last_login_at) anterior à coleta — prova de que a pessoa já
  -- acessou alguma vez; nunca prova frequência nem tempo de uso.
  legacy_last_login_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, person_id)
);

-- Classificação EXPLÍCITA de pessoas de teste, demonstração ou automação (fora dos números por padrão).
create table if not exists usage_population_classifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null,
  classification text not null check (classification in ('TEST', 'DEMO', 'AUTOMATION')),
  reason text not null check (char_length(reason) between 3 and 300),
  classified_by_account_id uuid,
  classified_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by_account_id uuid
);
create unique index if not exists usage_population_classifications_current_idx on usage_population_classifications (organization_id, person_id) where removed_at is null;

-- Falhas de login: contagem por hora da INSTALAÇÃO, sem organização e sem pessoa (a entrada digitada nunca atribui ninguém).
create table if not exists usage_auth_failure_counts (
  bucket_start timestamptz primary key,
  failures integer not null check (failures >= 0)
);
