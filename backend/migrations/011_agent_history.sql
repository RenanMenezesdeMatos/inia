create table agent_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  agent_id uuid not null references agents(id) on delete cascade,
  action text not null check (action in ('CREATED', 'UPDATED', 'DUPLICATED')),
  changed_by_person_id uuid references people(id),
  changed_by_name text not null,
  changes jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index idx_agent_history_agent on agent_history (agent_id, created_at desc);
