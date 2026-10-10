create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  agent_id uuid not null references agents(id) on delete cascade,
  source text not null check (source in ('MANUAL_TEST', 'TRIGGER')),
  trigger_firing_id uuid references trigger_firings(id),
  input_context text not null,
  output_text text,
  model text,
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'FAILED')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_agent_runs_agent on agent_runs (agent_id, created_at desc);
