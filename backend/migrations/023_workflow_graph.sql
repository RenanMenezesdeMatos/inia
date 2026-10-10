-- Substitui o motor de regra simples (condição -> ações) por um grafo de execução
-- (Gatilho -> Aguardar -> Condição -> Ação -> Fim), no estilo "follow-up flow" do Deskcomm.

alter table workflows
  add column trigger_config jsonb,
  add column draft_graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  add column active_version_id uuid;

create table workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  graph jsonb not null,
  created_by uuid references people(id),
  created_at timestamptz not null default now()
);

alter table workflows
  add constraint workflows_active_version_id_fkey foreign key (active_version_id) references workflow_versions(id);

-- Backfill: cada workflow existente (1 condição + 1 ação) vira um grafo de 4 nós fixos que
-- reproduz o comportamento de hoje (só dispara a ação quando a condição bate).
update workflows w
set
  trigger_config = jsonb_build_object('channelFlagId', wc.channel_flag_id),
  draft_graph = jsonb_build_object(
    'nodes', jsonb_build_array(
      jsonb_build_object('id', 'trigger', 'type', 'trigger', 'label', 'Gatilho', 'position', jsonb_build_object('x', 0, 'y', 0), 'config', '{}'::jsonb),
      jsonb_build_object(
        'id', 'condition', 'type', 'condition', 'label', 'Condição', 'position', jsonb_build_object('x', 0, 'y', 160),
        'config', jsonb_build_object('comparator', wc.comparator, 'thresholdBoolean', wc.threshold_boolean, 'thresholdNumeric', wc.threshold_numeric)
      ),
      jsonb_build_object(
        'id', 'action', 'type', 'action', 'label', 'Ação', 'position', jsonb_build_object('x', 0, 'y', 320),
        'config', wa.action_config || jsonb_build_object('actionType', wa.action_type)
      ),
      jsonb_build_object('id', 'end', 'type', 'end', 'label', 'Fim', 'position', jsonb_build_object('x', 0, 'y', 480), 'config', '{}'::jsonb)
    ),
    'edges', jsonb_build_array(
      jsonb_build_object('id', 'e-trigger-condition', 'source', 'trigger', 'sourceHandle', 'always', 'target', 'condition'),
      jsonb_build_object('id', 'e-condition-true', 'source', 'condition', 'sourceHandle', 'true', 'target', 'action'),
      jsonb_build_object('id', 'e-condition-false', 'source', 'condition', 'sourceHandle', 'false', 'target', 'end'),
      jsonb_build_object('id', 'e-action-end', 'source', 'action', 'sourceHandle', 'always', 'target', 'end')
    )
  )
from workflow_conditions wc, workflow_actions wa
where wc.workflow_id = w.id and wa.workflow_id = w.id;

insert into workflow_versions (workflow_id, graph, created_by, created_at)
select id, draft_graph, created_by, now() from workflows;

update workflows w set active_version_id = wv.id from workflow_versions wv where wv.workflow_id = w.id;

create table workflow_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  workflow_id uuid not null references workflows(id) on delete cascade,
  version_id uuid not null references workflow_versions(id),
  interaction_id uuid not null references interactions(id) on delete cascade,
  current_node_id text not null,
  matched_flag_name text,
  matched_value_boolean boolean,
  matched_value_numeric numeric,
  status text not null default 'active' check (status in ('active', 'waiting', 'completed', 'failed', 'dead')),
  next_eval_at timestamptz not null default now(),
  claimed_until timestamptz,
  attempts int not null default 0,
  revision int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_workflow_enrollments_due on workflow_enrollments (next_eval_at) where status in ('active', 'waiting');
create index idx_workflow_enrollments_workflow on workflow_enrollments (workflow_id, created_at desc);

create table workflow_enrollment_events (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references workflow_enrollments(id) on delete cascade,
  node_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  agent_run_id uuid,
  created_at timestamptz not null default now(),
  unique (enrollment_id, idempotency_key)
);

create index idx_workflow_enrollment_events_enrollment on workflow_enrollment_events (enrollment_id, created_at);

alter table agent_runs drop constraint agent_runs_workflow_firing_id_fkey;
alter table agent_runs drop column workflow_firing_id;

alter table workflow_enrollment_events add constraint workflow_enrollment_events_agent_run_id_fkey foreign key (agent_run_id) references agent_runs(id);

drop table workflow_action_runs;
drop table workflow_firings;
drop table workflow_actions;
drop table workflow_conditions;
