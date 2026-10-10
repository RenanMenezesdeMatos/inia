create extension if not exists pgcrypto;

create type case_status as enum ('DETECTED', 'DIAGNOSING', 'DIAGNOSED', 'ACTION_PENDING', 'FOLLOWING_UP', 'ESCALATED', 'RESOLVED', 'CLOSED');
create type case_priority as enum ('P1', 'P2', 'P3');
create type feedback_status as enum ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ACKNOWLEDGED', 'CANCELLED');
create type alert_status as enum ('OPEN', 'SEEN', 'ACKNOWLEDGED', 'RESOLVED', 'EXPIRED');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  timezone text not null default 'America/Fortaleza',
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  operation_id uuid not null references operations(id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (operation_id, name)
);

create table people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  team_id uuid references teams(id),
  name text not null,
  role text not null check (role in ('OPERATOR', 'SUPERVISOR', 'MANAGER', 'ADMIN', 'QUALITY')),
  avatar_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table indicator_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  code text not null,
  name text not null,
  unit text not null,
  desired_direction text not null check (desired_direction in ('HIGHER', 'LOWER', 'TARGET')),
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  indicator_definition_id uuid not null references indicator_definitions(id),
  subject_type text not null check (subject_type in ('ORGANIZATION', 'OPERATION', 'TEAM', 'PERSON')),
  subject_id uuid not null,
  target_value numeric not null,
  valid_from date not null,
  valid_until date,
  created_at timestamptz not null default now()
);

create table indicator_measurements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  indicator_definition_id uuid not null references indicator_definitions(id),
  subject_type text not null check (subject_type in ('ORGANIZATION', 'OPERATION', 'TEAM', 'PERSON')),
  subject_id uuid not null,
  value numeric not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, indicator_definition_id, subject_type, subject_id, period_start, period_end, source)
);

create table knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  title text not null,
  document_type text not null check (document_type in ('PROCEDURE', 'MANUAL', 'FAQ', 'RULE', 'FLOW')),
  created_at timestamptz not null default now()
);

create table knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  document_id uuid not null references knowledge_documents(id),
  version integer not null,
  content text not null,
  status text not null check (status in ('DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED')),
  effective_from timestamptz,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

create table supervision_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  operator_id uuid not null references people(id),
  team_id uuid not null references teams(id),
  title text not null,
  summary text not null,
  status case_status not null default 'DETECTED',
  priority case_priority not null,
  indicator_code text not null,
  indicator_value text not null,
  indicator_target text not null,
  root_cause text,
  confidence numeric check (confidence between 0 and 1),
  assignee_id uuid references people(id),
  sla_due_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table evidences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  case_id uuid not null references supervision_cases(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('INDICATOR', 'TRANSCRIPT', 'MONITORING', 'PROCEDURE', 'FEEDBACK', 'PROCESS')),
  title text not null,
  description text not null,
  source_type text not null,
  source_id text not null,
  occurred_at timestamptz not null,
  checksum text not null,
  created_at timestamptz not null default now()
);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  case_id uuid not null references supervision_cases(id) on delete cascade,
  action_type text not null,
  description text not null,
  expected_impact text not null,
  due_at timestamptz,
  created_at timestamptz not null default now()
);

create table feedbacks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  case_id uuid not null references supervision_cases(id),
  operator_id uuid not null references people(id),
  author_id uuid references people(id),
  status feedback_status not null default 'DRAFT',
  impacted_indicator text not null,
  evidence_found text not null,
  observed_behavior text not null,
  related_procedure text not null,
  recommendation text not null,
  suggested_approach text,
  published_at timestamptz,
  acknowledged_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  case_id uuid references supervision_cases(id),
  recipient_id uuid not null references people(id),
  title text not null,
  description text not null,
  severity text not null check (severity in ('INFO', 'MEDIUM', 'HIGH', 'CRITICAL')),
  alert_type text not null,
  status alert_status not null default 'OPEN',
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  resolved_at timestamptz
);

create table case_timeline_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  case_id uuid not null references supervision_cases(id) on delete cascade,
  event_type text not null,
  actor_id uuid references people(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  actor_id uuid references people(id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table outbox_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0
);

create index idx_measurements_subject_period on indicator_measurements (organization_id, subject_type, subject_id, indicator_definition_id, period_start desc);
create index idx_cases_queue on supervision_cases (organization_id, status, priority, sla_due_at);
create index idx_evidences_case on evidences (case_id, occurred_at desc);
create index idx_feedbacks_operator on feedbacks (operator_id, created_at desc);
create index idx_alerts_recipient on alerts (recipient_id, status, created_at desc);
create unique index idx_alerts_open_dedupe on alerts (organization_id, dedupe_key) where status in ('OPEN', 'SEEN', 'ACKNOWLEDGED');
create index idx_timeline_case on case_timeline_events (case_id, created_at desc);
create index idx_outbox_pending on outbox_events (created_at) where processed_at is null;
