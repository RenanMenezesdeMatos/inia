-- Apoio com Anjo, Parte B (migration 182): pedido de apoio humano a partir do chat da INIA, atendido por um Anjo do escopo.
-- Especificação aprovada: docs/designs/apoio-com-anjo/design_draft.md (seções 5–13 e Apêndice B). Tudo nasce DESLIGADO: sem linha em
-- human_support_settings a organização está desligada. Só aditiva e idempotente. As mensagens humanas ficam em tabelas próprias,
-- nunca em assistant_interactions: o contexto da INIA nunca as lê.

create table if not exists human_support_settings (
  organization_id uuid primary key references organizations(id),
  enabled boolean not null default false,
  default_capacity smallint not null default 2 check (default_capacity between 1 and 5),
  version integer not null default 0,
  updated_by_person_id uuid references people(id),
  updated_at timestamptz not null default now()
);

create table if not exists human_support_scope_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  scope_type text not null check (scope_type in ('GROUP','SUBGROUP')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  state text not null default 'INHERIT' check (state in ('INHERIT','ON','OFF')),
  updated_by_person_id uuid references people(id),
  updated_at timestamptz not null default now(),
  check ((scope_type = 'GROUP' and team_id is not null and subteam_id is null) or (scope_type = 'SUBGROUP' and subteam_id is not null))
);
create unique index if not exists human_support_scope_settings_group on human_support_scope_settings (organization_id, team_id) where scope_type = 'GROUP';
create unique index if not exists human_support_scope_settings_subgroup on human_support_scope_settings (organization_id, subteam_id) where scope_type = 'SUBGROUP';

create table if not exists human_support_setting_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  target_type text not null check (target_type in ('ORGANIZATION','GROUP','SUBGROUP','ANJO')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  subject_person_id uuid references people(id),
  field text not null check (field in ('ENABLED','STATE','DEFAULT_CAPACITY','ANJO_CAPACITY')),
  from_value text,
  to_value text,
  actor_person_id uuid not null references people(id),
  occurred_at timestamptz not null default now()
);
create index if not exists human_support_setting_events_org on human_support_setting_events (organization_id, occurred_at);

create table if not exists human_support_agent_presence (
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  status text not null default 'OFFLINE' check (status in ('AVAILABLE','PAUSED','OFFLINE')),
  pause_reason text check (pause_reason in ('LUNCH','PERSONAL','PROCESS_ACTIVITY','MEETING')),
  max_concurrent smallint check (max_concurrent between 1 and 5),
  lease_until timestamptz,
  connection_lost_at timestamptz,
  connection_restored_at timestamptz,
  last_assigned_at timestamptz,
  status_since timestamptz not null default now(),
  version integer not null default 0,
  primary key (organization_id, person_id),
  check ((status = 'PAUSED') = (pause_reason is not null))
);
create index if not exists human_support_agent_presence_status on human_support_agent_presence (organization_id, status, lease_until);

create table if not exists human_support_presence_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  from_status text,
  to_status text not null,
  pause_reason text,
  cause text not null check (cause in ('ANJO','LEASE_EXPIRED','ROLE_REVOKED','CONNECTION_LOST','CONNECTION_RESTORED')),
  occurred_at timestamptz not null default now()
);
create index if not exists human_support_presence_events_person on human_support_presence_events (organization_id, person_id, occurred_at);

create table if not exists human_support_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  protocol text not null check (protocol ~ '^AP-[2-9A-HJ-NP-Z]{6}$'),
  operator_person_id uuid not null references people(id),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  origin text not null check (origin in ('BUTTON','DISLIKE','SIGNAL')),
  source_conversation_id uuid,
  source_interaction_id uuid,
  source_rating_id uuid,
  shared_context jsonb not null,
  context_version text not null,
  note text check (note is null or char_length(note) <= 2000),
  client_request_id uuid not null,
  status text not null default 'WAITING' check (status in ('WAITING','IN_PROGRESS','CLOSED','CANCELLED','EXPIRED','ABANDONED')),
  end_cause text check (end_cause in ('OPERATOR_CANCELLED','SCOPE_DISABLED','QUEUE_EXPIRED','OPERATOR_ABANDONED','OPERATOR_CLOSED','ANJO_CLOSED','OPERATOR_ABSENT','INACTIVITY')),
  queued_at timestamptz not null default now(),
  queue_expires_at timestamptz not null,
  queue_deadline_basis text not null check (queue_deadline_basis in ('SUBGROUP','GROUP','ORGANIZATION','DEFAULT')),
  operator_seen_at timestamptz not null default now(),
  next_seq integer not null default 1,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check ((status in ('CLOSED','CANCELLED','EXPIRED','ABANDONED')) = (ended_at is not null and end_cause is not null))
);
create unique index if not exists human_support_requests_protocol on human_support_requests (organization_id, protocol);
create unique index if not exists human_support_requests_open_per_operator on human_support_requests (organization_id, operator_person_id) where status in ('WAITING','IN_PROGRESS');
create unique index if not exists human_support_requests_client on human_support_requests (organization_id, operator_person_id, client_request_id);
create index if not exists human_support_requests_queue on human_support_requests (organization_id, status, queued_at);
create index if not exists human_support_requests_created on human_support_requests (organization_id, created_at);
create index if not exists human_support_requests_operator on human_support_requests (operator_person_id, created_at desc);

create table if not exists human_support_request_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  request_id uuid not null references human_support_requests(id) on delete cascade,
  from_status text,
  to_status text not null,
  cause text not null,
  actor_person_id uuid references people(id),
  occurred_at timestamptz not null default now()
);
create index if not exists human_support_request_events_request on human_support_request_events (request_id, occurred_at);

create table if not exists human_support_attendances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  request_id uuid not null references human_support_requests(id) on delete cascade,
  anjo_person_id uuid not null references people(id),
  operator_person_id uuid not null references people(id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ENDED')),
  end_cause text check (end_cause in ('OPERATOR_CLOSED','ANJO_CLOSED','OPERATOR_ABSENT','INACTIVITY','ANJO_LOST')),
  started_at timestamptz not null default now(),
  first_anjo_message_at timestamptz,
  last_human_message_at timestamptz not null default now(),
  ended_at timestamptz,
  check ((status = 'ENDED') = (ended_at is not null and end_cause is not null))
);
create unique index if not exists human_support_attendances_active on human_support_attendances (request_id) where status = 'ACTIVE';
create index if not exists human_support_attendances_anjo on human_support_attendances (organization_id, anjo_person_id, status);
create index if not exists human_support_attendances_open on human_support_attendances (organization_id, status, last_human_message_at);

create table if not exists human_support_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  request_id uuid not null references human_support_requests(id) on delete cascade,
  attendance_id uuid references human_support_attendances(id) on delete cascade,
  operator_person_id uuid not null references people(id),
  author_kind text not null check (author_kind in ('OPERATOR','ANJO','SYSTEM')),
  author_person_id uuid references people(id),
  body text not null default '' check (char_length(body) <= 4000),
  system_code text check (system_code is null or system_code in ('QUEUED','ANJO_ASSIGNED','ANJO_CONNECTION_LOST','ANJO_CONNECTION_RESTORED','ANJO_LEFT','ENDED_BY_OPERATOR','ENDED_BY_ANJO','ENDED_OPERATOR_ABSENT','ENDED_INACTIVITY','CANCELLED_BY_OPERATOR','CANCELLED_SCOPE_DISABLED','EXPIRED','ABANDONED')),
  client_message_id uuid,
  seq integer not null,
  occurred_at timestamptz not null default statement_timestamp(),
  check ((author_kind = 'SYSTEM') = (author_person_id is null and system_code is not null)),
  check (author_kind = 'SYSTEM' or char_length(body) >= 1)
);
create unique index if not exists human_support_messages_seq on human_support_messages (request_id, seq);
create unique index if not exists human_support_messages_client on human_support_messages (request_id, client_message_id) where client_message_id is not null;

create table if not exists human_support_classifications (
  attendance_id uuid primary key references human_support_attendances(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  anjo_person_id uuid not null references people(id),
  operator_person_id uuid not null references people(id),
  reason text not null check (reason in ('NO_PROCESS','NO_GUIDANCE','QUESTION_UNCLEAR','FOUND_IN_PROCESS','AVAILABLE_ELSEWHERE','OTHER')),
  reference_title text check (reference_title is null or char_length(reference_title) between 3 and 200),
  reference_url text check (reference_url is null or (char_length(reference_url) <= 500 and reference_url ~* '^https?://')),
  other_description text check (other_description is null or char_length(other_description) between 3 and 1000),
  outcome text not null check (outcome in ('RESOLVED','GUIDED','FORWARDED','NOT_RESOLVED')),
  catalog_version text not null,
  created_at timestamptz not null default now(),
  check (reason not in ('FOUND_IN_PROCESS','AVAILABLE_ELSEWHERE') or reference_title is not null),
  check (reason <> 'OTHER' or other_description is not null)
);

create table if not exists human_support_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  attendance_id uuid not null references human_support_attendances(id) on delete cascade,
  operator_person_id uuid not null references people(id),
  resolved text check (resolved in ('YES','PARTIAL','NO')),
  stars smallint check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  check (resolved is not null or stars is not null)
);
create unique index if not exists human_support_evaluations_current on human_support_evaluations (attendance_id) where superseded_at is null;

create table if not exists human_support_entry_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  kind text not null check (kind in ('SUGGESTION_ELIGIBLE','NO_ANJO_IN_SERVICE')),
  origin text check (origin in ('BUTTON','DISLIKE','SIGNAL')),
  interaction_id uuid,
  occurred_at timestamptz not null default now()
);
create unique index if not exists human_support_entry_events_suggestion on human_support_entry_events (origin, interaction_id) where kind = 'SUGGESTION_ELIGIBLE';
create index if not exists human_support_entry_events_org on human_support_entry_events (organization_id, kind, occurred_at);
create index if not exists human_support_entry_events_person on human_support_entry_events (organization_id, person_id, kind, occurred_at);

create table if not exists human_support_inbox_versions (
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  version bigint not null default 0,
  primary key (organization_id, person_id)
);

-- Registro LGPD: o check de data_kind da 151 é inline (sem nome declarado); acha o nome pelo catálogo.
do $$
declare constraint_name text;
begin
  select conname into constraint_name from pg_constraint
   where conrelid = 'personal_data_access_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%data_kind%';
  if constraint_name is not null then
    execute format('alter table personal_data_access_log drop constraint %I', constraint_name);
  end if;
end $$;
alter table personal_data_access_log add constraint personal_data_access_log_data_kind_check
  check (data_kind in ('CALL_TRANSCRIPT','ASSISTANT_CONVERSATION','EMPLOYEE_PROFILE','HUMAN_SUPPORT_CONVERSATION','HUMAN_SUPPORT_PRESENCE'));

-- Retenção: políticas DESLIGADAS e sem prazo (prazo = decisão de produto/LGPD), como as demais. Os pedidos só saem em estado final.
insert into data_retention_policies (table_name, note) values
  ('human_support_requests', 'Pedidos de apoio com Anjo (com a conversa humana, os atendimentos, as classificações e as avaliações). Só pedidos terminados saem.'),
  ('human_support_entry_events', 'Sugestões elegíveis e tentativas sem Anjo em serviço.'),
  ('human_support_presence_events', 'Histórico de presença dos Anjos (inclui motivos de pausa).')
on conflict (table_name) do nothing;
