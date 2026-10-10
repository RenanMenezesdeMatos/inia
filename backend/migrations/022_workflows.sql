-- Motor de workflow (QUANDO / SE / ENTÃO), substituindo triggers/trigger_firings.
-- Ver plano em docs internos: reorganização de agentes/gatilhos.

create table workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  description text,
  scope_type text not null default 'ALL_TEAMS' check (scope_type in ('ALL_TEAMS', 'TEAM', 'SUBTEAM')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  active boolean not null default true,
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'ALL_TEAMS' and team_id is null and subteam_id is null) or
    (scope_type = 'TEAM' and team_id is not null and subteam_id is null) or
    (scope_type = 'SUBTEAM' and subteam_id is not null)
  )
);

create table workflow_conditions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  channel_flag_id uuid not null references channel_flags(id),
  comparator text not null check (comparator in ('EQUALS', 'GT', 'LT', 'GTE', 'LTE')),
  threshold_boolean boolean,
  threshold_numeric numeric,
  created_at timestamptz not null default now(),
  check (
    (threshold_boolean is not null and threshold_numeric is null) or
    (threshold_boolean is null and threshold_numeric is not null)
  )
);

create index idx_workflow_conditions_flag on workflow_conditions (channel_flag_id);
create unique index idx_workflow_conditions_workflow on workflow_conditions (workflow_id);

create table workflow_actions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  position int not null default 0,
  action_type text not null check (action_type in ('CALL_AGENT', 'SET_CONFIG_VALUE')),
  action_config jsonb not null,
  created_at timestamptz not null default now(),
  check (
    (action_type = 'CALL_AGENT' and action_config ? 'agentId') or
    (action_type = 'SET_CONFIG_VALUE' and action_config ? 'configKey' and action_config ? 'valueType')
  )
);

create index idx_workflow_actions_workflow on workflow_actions (workflow_id, position);

create table workflow_firings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  workflow_id uuid not null references workflows(id) on delete cascade,
  interaction_id uuid not null references interactions(id) on delete cascade,
  matched_value_boolean boolean,
  matched_value_numeric numeric,
  created_at timestamptz not null default now()
);

create index idx_workflow_firings_workflow on workflow_firings (workflow_id, created_at desc);
create index idx_workflow_firings_interaction on workflow_firings (interaction_id);

create table workflow_action_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_firing_id uuid not null references workflow_firings(id) on delete cascade,
  workflow_action_id uuid not null references workflow_actions(id),
  action_type text not null,
  status text not null check (status in ('COMPLETED', 'FAILED')),
  error_message text,
  agent_run_id uuid references agent_runs(id),
  created_at timestamptz not null default now()
);

create index idx_workflow_action_runs_firing on workflow_action_runs (workflow_firing_id);

create table org_config_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  scope_type text not null default 'ALL_TEAMS' check (scope_type in ('ALL_TEAMS', 'TEAM', 'SUBTEAM')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  config_key text not null,
  value_type text not null check (value_type in ('BOOLEAN', 'NUMERIC', 'TEXT')),
  value_boolean boolean,
  value_numeric numeric,
  value_text text,
  updated_by uuid references people(id),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'ALL_TEAMS' and team_id is null and subteam_id is null) or
    (scope_type = 'TEAM' and team_id is not null and subteam_id is null) or
    (scope_type = 'SUBTEAM' and subteam_id is not null)
  ),
  check (
    (value_type = 'BOOLEAN' and value_boolean is not null and value_numeric is null and value_text is null) or
    (value_type = 'NUMERIC' and value_numeric is not null and value_boolean is null and value_text is null) or
    (value_type = 'TEXT' and value_text is not null and value_boolean is null and value_numeric is null)
  )
);

create unique index idx_org_config_values_key on org_config_values (
  organization_id, scope_type, coalesce(team_id, '00000000-0000-0000-0000-000000000000'),
  coalesce(subteam_id, '00000000-0000-0000-0000-000000000000'), config_key
);

create table user_role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  role text not null check (role in ('OPERATOR', 'ADMIN', 'SUPERVISOR', 'MANAGER', 'SENIOR_MANAGER', 'DIRECTOR')),
  scope_type text not null default 'ALL_TEAMS' check (scope_type in ('ALL_TEAMS', 'TEAM', 'SUBTEAM')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  created_at timestamptz not null default now(),
  check (
    (scope_type = 'ALL_TEAMS' and team_id is null and subteam_id is null) or
    (scope_type = 'TEAM' and team_id is not null and subteam_id is null) or
    (scope_type = 'SUBTEAM' and subteam_id is not null)
  )
);

create index idx_user_role_assignments_person on user_role_assignments (person_id);

-- Backfill: triggers -> workflows (1 condição + 1 ação CALL_AGENT cada), trigger_firings -> workflow_firings
insert into workflows (id, organization_id, name, scope_type, team_id, subteam_id, active, created_at, updated_at)
select id, organization_id, name, scope_type, team_id, subteam_id, active, created_at, updated_at
from triggers;

insert into workflow_conditions (workflow_id, channel_flag_id, comparator, threshold_boolean, threshold_numeric, created_at)
select id, channel_flag_id, comparator, threshold_boolean, threshold_numeric, created_at
from triggers;

insert into workflow_actions (workflow_id, position, action_type, action_config, created_at)
select id, 0, 'CALL_AGENT', jsonb_build_object('agentId', agent_id), created_at
from triggers;

insert into workflow_firings (id, organization_id, workflow_id, interaction_id, matched_value_boolean, matched_value_numeric, created_at)
select id, organization_id, trigger_id, interaction_id, matched_value_boolean, matched_value_numeric, created_at
from trigger_firings;

alter table agent_runs add column workflow_firing_id uuid references workflow_firings(id);
update agent_runs set workflow_firing_id = trigger_firing_id where trigger_firing_id is not null;

alter table agent_runs drop constraint agent_runs_source_check;
update agent_runs set source = 'WORKFLOW' where source = 'TRIGGER';
alter table agent_runs add constraint agent_runs_source_check check (source in ('MANUAL_TEST', 'WORKFLOW'));

alter table agent_runs drop column trigger_firing_id;

drop table trigger_firings;
drop table triggers;
