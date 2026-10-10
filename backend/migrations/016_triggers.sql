create table triggers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  channel_flag_id uuid not null references channel_flags(id),
  comparator text not null check (comparator in ('EQUALS', 'GT', 'LT', 'GTE', 'LTE')),
  threshold_boolean boolean,
  threshold_numeric numeric,
  scope_type text not null default 'ALL_TEAMS' check (scope_type in ('ALL_TEAMS', 'TEAM', 'SUBTEAM')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  agent_id uuid not null references agents(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'ALL_TEAMS' and team_id is null and subteam_id is null) or
    (scope_type = 'TEAM' and team_id is not null and subteam_id is null) or
    (scope_type = 'SUBTEAM' and subteam_id is not null)
  ),
  check (
    (threshold_boolean is not null and threshold_numeric is null) or
    (threshold_boolean is null and threshold_numeric is not null)
  )
);

create index idx_triggers_flag on triggers (channel_flag_id, active);

create table trigger_firings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  trigger_id uuid not null references triggers(id) on delete cascade,
  interaction_id uuid not null references interactions(id) on delete cascade,
  agent_id uuid not null references agents(id),
  matched_value_boolean boolean,
  matched_value_numeric numeric,
  created_at timestamptz not null default now()
);

create index idx_trigger_firings_trigger on trigger_firings (trigger_id, created_at desc);
create index idx_trigger_firings_interaction on trigger_firings (interaction_id);
