alter table knowledge_documents
  add column source_type text not null default 'TEXT' check (source_type in ('TEXT', 'PDF', 'DOCX', 'TXT', 'JSON')),
  add column original_filename text,
  add column mime_type text,
  add column file_size_bytes integer,
  add column created_by uuid references user_accounts(id);

create table knowledge_files (
  id uuid primary key default gen_random_uuid(),
  knowledge_document_id uuid not null references knowledge_documents(id) on delete cascade,
  file_data bytea not null,
  checksum text not null,
  created_at timestamptz not null default now()
);

create table knowledge_document_org_scopes (
  id uuid primary key default gen_random_uuid(),
  knowledge_document_id uuid not null references knowledge_documents(id) on delete cascade,
  scope_type text not null check (scope_type in ('ALL_TEAMS', 'TEAM', 'SUBTEAM')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  created_at timestamptz not null default now(),
  check (
    (scope_type = 'ALL_TEAMS' and team_id is null and subteam_id is null) or
    (scope_type = 'TEAM' and team_id is not null and subteam_id is null) or
    (scope_type = 'SUBTEAM' and subteam_id is not null)
  )
);

create table knowledge_document_subject_scopes (
  id uuid primary key default gen_random_uuid(),
  knowledge_document_id uuid not null references knowledge_documents(id) on delete cascade,
  scope_type text not null check (scope_type in ('ALL_SUBJECTS', 'SUBJECT')),
  subject_id uuid references subjects(id),
  created_at timestamptz not null default now(),
  check (
    (scope_type = 'ALL_SUBJECTS' and subject_id is null) or
    (scope_type = 'SUBJECT' and subject_id is not null)
  )
);

create table agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  agent_type text not null check (agent_type in ('CALL_FEEDBACK', 'INDICATOR_FEEDBACK', 'DIAGNOSTICS', 'CUSTOM')),
  objective text not null,
  description text not null,
  context_prompt text not null,
  active boolean not null default true,
  created_by uuid references user_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table agent_knowledge_documents (
  agent_id uuid not null references agents(id) on delete cascade,
  knowledge_document_id uuid not null references knowledge_documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agent_id, knowledge_document_id)
);

create table indicator_calculation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  indicator_definition_id uuid not null references indicator_definitions(id),
  scope_type text not null check (scope_type in ('ALL_TEAMS', 'TEAM', 'SUBTEAM')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  calculation_period text not null check (calculation_period in ('DAILY', 'WEEKLY', 'MONTHLY')),
  calculation_method text not null,
  attainment_rule text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'ALL_TEAMS' and team_id is null and subteam_id is null) or
    (scope_type = 'TEAM' and team_id is not null and subteam_id is null) or
    (scope_type = 'SUBTEAM' and subteam_id is not null)
  )
);

create unique index idx_indicator_rule_scope on indicator_calculation_rules (
  organization_id,
  indicator_definition_id,
  scope_type,
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'),
  coalesce(subteam_id, '00000000-0000-0000-0000-000000000000')
);

create table call_expectations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  scope_type text not null check (scope_type in ('ALL_TEAMS', 'TEAM', 'SUBTEAM')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  subject_scope_type text not null check (subject_scope_type in ('ALL_SUBJECTS', 'SUBJECT')),
  subject_id uuid references subjects(id),
  expectation text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'ALL_TEAMS' and team_id is null and subteam_id is null) or
    (scope_type = 'TEAM' and team_id is not null and subteam_id is null) or
    (scope_type = 'SUBTEAM' and subteam_id is not null)
  ),
  check (
    (subject_scope_type = 'ALL_SUBJECTS' and subject_id is null) or
    (subject_scope_type = 'SUBJECT' and subject_id is not null)
  )
);

create index idx_knowledge_org_scopes_doc on knowledge_document_org_scopes (knowledge_document_id);
create index idx_knowledge_subject_scopes_doc on knowledge_document_subject_scopes (knowledge_document_id);
create index idx_agents_active on agents (organization_id, active);
create index idx_indicator_rules_indicator on indicator_calculation_rules (organization_id, indicator_definition_id, active);
create index idx_call_expectations_scope on call_expectations (organization_id, active);
