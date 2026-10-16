-- REPORTS RECORRENTES (2026-10-16) — consultas da INIA para lideranças transformadas em entregas periódicas no Acompanhamento.
--
-- O report guarda uma DEFINIÇÃO reproduzível (ferramenta da liderança + parâmetros válidos + estrutura fixa ou "de quem recebe" +
-- período relativo ou fixo), nunca texto de chat. Cada execução consulta os dados atuais no escopo de CADA destinatário, decide
-- pela atualização das bases (marca d'água real) e grava uma entrega por chave de escopo — ou um aviso de "não encaminhado".
-- Ver docs/dev/reports-recorrentes.md.

create table reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  owner_account_id uuid not null references user_accounts(id),
  owner_person_id uuid not null references people(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text,
  status text not null check (status in ('ACTIVE', 'INACTIVE')),
  origin text not null check (origin in ('CHAT', 'SCREEN')),
  audience_mode text not null check (audience_mode in ('SELF', 'DISTRIBUTION')),
  -- Versão da configuração: sobe a cada mudança da consulta, período, visualização, agenda, público ou análise. Cada entrega
  -- registra a versão usada (comparação entre versões diferentes é sinalizada).
  config_version integer not null default 1,
  definition jsonb not null,
  visualization jsonb not null,
  schedule jsonb not null,
  audience jsonb not null,
  analysis jsonb not null,
  time_zone text not null,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_status text,
  last_valid_delivery_at timestamptz,
  source_proposal_id uuid,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exclusão LÓGICA: a agenda é cancelada; histórico e entregas ficam para auditoria.
  deleted_at timestamptz,
  deleted_by_account_id uuid references user_accounts(id),
  check (deleted_at is null or next_run_at is null),
  check (status = 'ACTIVE' or next_run_at is null)
);

create index idx_reports_owner on reports (organization_id, owner_account_id, updated_at desc) where deleted_at is null;
create index idx_reports_due on reports (next_run_at) where status = 'ACTIVE' and deleted_at is null and next_run_at is not null;

create table report_versions (
  report_id uuid not null references reports(id) on delete cascade,
  version integer not null,
  organization_id uuid not null references organizations(id),
  name text not null,
  definition jsonb not null,
  visualization jsonb not null,
  schedule jsonb not null,
  audience jsonb not null,
  analysis jsonb not null,
  created_by_account_id uuid references user_accounts(id),
  created_at timestamptz not null default now(),
  primary key (report_id, version)
);

create table report_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  report_id uuid not null references reports(id) on delete cascade,
  scheduled_for timestamptz not null,
  trigger_kind text not null check (trigger_kind in ('SCHEDULE', 'MANUAL')),
  config_version integer not null,
  -- COMPLETED = ao menos uma entrega válida; NOT_FORWARDED = nada novo a entregar (bases/cobertura/sem mudança);
  -- PARTIAL = parte entregue, parte não; BLOCKED = responsável sem permissão; SKIPPED = report inativo/excluído na hora;
  -- FAILED = falha técnica (depois das tentativas).
  status text not null check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'NOT_FORWARDED', 'PARTIAL', 'BLOCKED', 'SKIPPED', 'FAILED')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  outcome jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (report_id, scheduled_for)
);

create index idx_report_runs_pending on report_runs (next_attempt_at) where status in ('QUEUED', 'RUNNING');
create index idx_report_runs_report on report_runs (report_id, scheduled_for desc);

create table report_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  report_id uuid not null references reports(id) on delete cascade,
  run_id uuid not null references report_runs(id) on delete cascade,
  config_version integer not null,
  -- Versão por escopo: sujeito da estrutura + conjunto de membros. Destinatários com a mesma chave recebem a mesma entrega.
  scope_key text not null,
  kind text not null check (kind in ('DELIVERY', 'NOT_FORWARDED')),
  reason text check (reason in ('STALE_SOURCES', 'NO_CHANGE', 'INSUFFICIENT_COVERAGE')),
  structure_label text,
  period_key text,
  period_label text,
  sources jsonb not null default '[]'::jsonb,
  dataset jsonb,
  visualization jsonb,
  comparison jsonb,
  fingerprint text,
  empty boolean not null default false,
  analysis_status text not null check (analysis_status in ('PENDING', 'READY', 'FAILED', 'DISABLED', 'NOT_APPLICABLE')),
  analysis_text text,
  analysis_attempts integer not null default 0,
  analysis_error text,
  analysis_updated_at timestamptz,
  -- Aviso repetido (mesmo motivo e período) não vira outro item: conta as ocorrências e a última verificação.
  occurrences integer not null default 1,
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (run_id, scope_key),
  check ((kind = 'DELIVERY') = (dataset is not null)),
  check ((kind = 'NOT_FORWARDED') = (reason is not null))
);

create index idx_report_deliveries_report on report_deliveries (report_id, scope_key, created_at desc);
create index idx_report_deliveries_analysis on report_deliveries (analysis_updated_at) where analysis_status in ('PENDING', 'FAILED');

create table report_delivery_recipients (
  delivery_id uuid not null references report_deliveries(id) on delete cascade,
  run_id uuid not null references report_runs(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  report_id uuid not null references reports(id) on delete cascade,
  recipient_person_id uuid not null references people(id),
  recipient_account_id uuid references user_accounts(id),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (delivery_id, recipient_person_id),
  -- Uma pessoa recebe no máximo um item por execução (seleções de público combinadas nunca duplicam).
  unique (run_id, recipient_person_id)
);

create index idx_report_recipients_feed on report_delivery_recipients (organization_id, recipient_person_id, created_at desc, delivery_id desc);

create table report_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  owner_account_id uuid not null references user_accounts(id),
  owner_person_id uuid not null references people(id),
  conversation_id uuid,
  interaction_id uuid,
  tool_name text not null,
  tool_args jsonb not null,
  draft jsonb not null,
  signature text not null,
  status text not null check (status in ('OFFERED', 'ACCEPTED', 'DISMISSED', 'EXPIRED')),
  report_id uuid references reports(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index idx_report_proposals_conversation on report_proposals (conversation_id, created_at desc);
create index idx_report_proposals_interaction on report_proposals (interaction_id);
