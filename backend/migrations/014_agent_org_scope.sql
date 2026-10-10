alter table agents
  add column scope_type text not null default 'ALL_TEAMS' check (scope_type in ('ALL_TEAMS', 'TEAM', 'SUBTEAM')),
  add column team_id uuid references teams(id),
  add column subteam_id uuid references subteams(id),
  add constraint agents_scope_check check (
    (scope_type = 'ALL_TEAMS' and team_id is null and subteam_id is null) or
    (scope_type = 'TEAM' and team_id is not null and subteam_id is null) or
    (scope_type = 'SUBTEAM' and subteam_id is not null)
  );

create index idx_agents_scope on agents (organization_id, scope_type, team_id, subteam_id);
