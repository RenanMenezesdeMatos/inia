-- AI PROVIDERS, MODELS, ROUTING & COST MANAGEMENT V1
--
-- Provider (tipo de integração) vive em código (catálogo + adapter). Esta migration cria só os DADOS
-- da organização: conexões, segredos (criptografados), modelos, preços versionados, políticas de
-- roteamento por Use Case, eventos de uso e orçamentos.
--
-- ZERO mudança de comportamento: nenhuma linha é inserida. Sem policy ACTIVE, o gateway segue pela
-- configuração legada do ambiente (perfis por tier + GEMINI_API_KEY) exatamente como antes. Nenhum
-- segredo de ambiente é copiado para o banco.

create table ai_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  provider_key text not null check (provider_key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null check (length(trim(name)) between 1 and 120),
  base_url text check (base_url is null or base_url ~ '^https?://'),
  api_version text,
  account_metadata jsonb not null default '{}'::jsonb,
  is_local boolean not null default false,
  timeout_ms integer not null default 60000 check (timeout_ms between 1000 and 300000),
  enabled boolean not null default true,
  last_health_check_at timestamptz,
  last_health_status text check (last_health_status in ('CONNECTED', 'AUTH_ERROR', 'NETWORK_ERROR', 'RATE_LIMITED', 'INVALID_ENDPOINT', 'UNSUPPORTED', 'UNKNOWN_ERROR')),
  last_health_latency_ms integer,
  last_health_message text,
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ai_connections_org_name_uidx on ai_connections (organization_id, lower(name));
create index ai_connections_org_idx on ai_connections (organization_id, provider_key);

-- Segredos da conexão (credentialSecretRef): mesmo AES-256-GCM da Central de Dados (chave fora do
-- banco). Um segredo ativo por conexão × finalidade; substituir revoga o anterior (histórico sem valor).
create table ai_connection_secrets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  connection_id uuid not null references ai_connections(id) on delete cascade,
  purpose text not null check (purpose in ('API_KEY', 'CUSTOM_HEADERS')),
  key_version integer not null default 1,
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  -- Só para exibição mascarada ("••••abcd"); nunca o valor. Para cabeçalhos: nomes, sem valores.
  hint text,
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index ai_connection_secrets_active_uidx on ai_connection_secrets (connection_id, purpose) where revoked_at is null;

create table ai_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  connection_id uuid not null references ai_connections(id) on delete restrict,
  provider_model_id text not null check (length(trim(provider_model_id)) between 1 and 200),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  enabled boolean not null default true,
  kind text not null default 'GENERATIVE' check (kind in ('GENERATIVE', 'EMBEDDING', 'CLASSIFICATION', 'DECISION')),
  context_window integer check (context_window is null or context_window > 0),
  max_output_tokens integer check (max_output_tokens is null or max_output_tokens > 0),
  -- { "TOOLS": { "supported": true, "source": "MANUAL" }, ... } — ausente = desconhecido.
  capabilities jsonb not null default '{}'::jsonb,
  quality_tier text check (quality_tier in ('BASIC', 'STANDARD', 'DEEP')),
  timeout_ms integer check (timeout_ms is null or timeout_ms between 1000 and 300000),
  origin text not null default 'MANUAL' check (origin in ('DISCOVERED', 'MANUAL')),
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ai_models_connection_model_uidx on ai_models (connection_id, provider_model_id);
create index ai_models_org_idx on ai_models (organization_id, enabled);

-- Preço VERSIONADO por vigência: preço novo fecha o anterior (effective_to), nunca o sobrescreve.
create table ai_model_pricing (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  model_id uuid not null references ai_models(id) on delete restrict,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  input_per_million numeric(20, 10) not null check (input_per_million >= 0),
  output_per_million numeric(20, 10) not null check (output_per_million >= 0),
  cached_input_per_million numeric(20, 10) check (cached_input_per_million is null or cached_input_per_million >= 0),
  reasoning_per_million numeric(20, 10) check (reasoning_per_million is null or reasoning_per_million >= 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  note text,
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index ai_model_pricing_model_idx on ai_model_pricing (model_id, effective_from desc);
create unique index ai_model_pricing_open_uidx on ai_model_pricing (model_id) where effective_to is null;

create table ai_routing_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  use_case text not null check (use_case ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  status text not null check (status in ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  mode text not null check (mode in ('PINNED', 'FALLBACK_CHAIN', 'AUTO')),
  strategy text check (strategy in ('COST_FIRST', 'LATENCY_FIRST', 'BALANCED', 'QUALITY_FIRST')),
  max_estimated_cost_per_request numeric(20, 10) check (max_estimated_cost_per_request is null or max_estimated_cost_per_request >= 0),
  cost_currency char(3) check (cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  fallback_on text[] not null default '{RATE_LIMIT,TIMEOUT,NETWORK,PROVIDER_ERROR,MODEL_UNAVAILABLE}',
  version integer not null default 1,
  created_by uuid references people(id),
  updated_by uuid references people(id),
  activated_by uuid references people(id),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ai_routing_policies_active_uidx on ai_routing_policies (organization_id, use_case) where status = 'ACTIVE';
create unique index ai_routing_policies_draft_uidx on ai_routing_policies (organization_id, use_case) where status = 'DRAFT';

create table ai_routing_policy_models (
  policy_id uuid not null references ai_routing_policies(id) on delete cascade,
  position smallint not null check (position between 0 and 19),
  model_id uuid not null references ai_models(id) on delete restrict,
  primary key (policy_id, position),
  unique (policy_id, model_id)
);
create index ai_routing_policy_models_model_idx on ai_routing_policy_models (model_id);

-- Um evento por TENTATIVA de chamada (fallback = várias linhas com o mesmo correlation_id). Sem
-- prompt, sem resposta, sem segredo — só o necessário para custo/uso/latência/erro.
create table ai_usage_events (
  id bigint generated always as identity primary key,
  organization_id uuid references organizations(id),
  occurred_at timestamptz not null,
  use_case text not null,
  purpose text,
  phase text,
  source text,
  origin text not null check (origin in ('RUNTIME', 'QA_LAB', 'ADMIN_TEST')),
  provider_key text not null,
  connection_id uuid references ai_connections(id) on delete set null,
  model_id uuid references ai_models(id) on delete set null,
  model_name text not null,
  is_local boolean not null default false,
  correlation_id uuid not null,
  attempt smallint not null default 1,
  fallback_index smallint not null default 0,
  input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  cached_tokens integer,
  total_tokens integer,
  cost numeric(24, 12),
  currency char(3),
  cost_status text not null check (cost_status in ('EXACT', 'ESTIMATED', 'UNKNOWN')),
  cost_unknown_reason text check (cost_unknown_reason in ('NO_PRICING', 'NO_USAGE')),
  pricing_id uuid references ai_model_pricing(id) on delete set null,
  pricing_source text not null check (pricing_source in ('TABLE', 'LEGACY_ENV', 'NONE')),
  duration_ms integer,
  status text not null check (status in ('SUCCESS', 'ERROR', 'BLOCKED')),
  error_category text,
  routing_mode text not null check (routing_mode in ('LEGACY', 'PINNED', 'FALLBACK_CHAIN', 'AUTO')),
  policy_id uuid references ai_routing_policies(id) on delete set null,
  route_reason text not null,
  fallback_reason text
);
create index ai_usage_events_org_time_idx on ai_usage_events (organization_id, occurred_at desc);
create index ai_usage_events_org_use_case_idx on ai_usage_events (organization_id, use_case, occurred_at);
create index ai_usage_events_org_provider_idx on ai_usage_events (organization_id, provider_key, occurred_at);
create index ai_usage_events_org_model_idx on ai_usage_events (organization_id, model_id, occurred_at);
create index ai_usage_events_org_connection_idx on ai_usage_events (organization_id, connection_id, occurred_at);
create index ai_usage_events_org_status_idx on ai_usage_events (organization_id, status, occurred_at) where status <> 'SUCCESS';
-- Latência recente (AUTO LATENCY_FIRST) e rate limit recente (fallback) por modelo — janelas curtas.
create index ai_usage_events_model_latency_idx on ai_usage_events (model_id, occurred_at desc) where status = 'SUCCESS';
create index ai_usage_events_model_rate_limit_idx on ai_usage_events (model_id, occurred_at desc) where error_category = 'RATE_LIMIT';

create table ai_budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  scope text not null check (scope in ('GLOBAL', 'USE_CASE', 'PROVIDER')),
  scope_key text,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  monthly_amount numeric(20, 6) not null check (monthly_amount > 0),
  warning_thresholds integer[] not null default '{70,90,100}',
  hard_limit boolean not null default false,
  enabled boolean not null default true,
  created_by uuid references people(id),
  updated_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'GLOBAL' and scope_key is null) or (scope <> 'GLOBAL' and scope_key is not null))
);
create unique index ai_budgets_scope_uidx on ai_budgets (organization_id, scope, coalesce(scope_key, ''), currency);
