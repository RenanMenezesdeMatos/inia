-- Orquestrador de chat/voz da INIA: um agente orquestrador + agentes especialistas que ele
-- pode acionar como "tools" (function calling nativo do Gemini) — resposta síncrona de
-- conversa, sem grafo de execução nem tick, diferente do motor de workflow assíncrono.
-- Também resolve a pendência do CLAUDE.md: nenhuma interação de chat/voz era persistida.

create table assistant_orchestrators (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  scope_type text not null default 'ALL_TEAMS' check (scope_type in ('ALL_TEAMS', 'TEAM', 'SUBTEAM')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  orchestrator_agent_id uuid not null references agents(id),
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

create table assistant_orchestrator_specialists (
  id uuid primary key default gen_random_uuid(),
  orchestrator_id uuid not null references assistant_orchestrators(id) on delete cascade,
  agent_id uuid not null references agents(id),
  tool_name text not null,
  created_at timestamptz not null default now(),
  unique (orchestrator_id, agent_id)
);

create table assistant_interactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  operator_id uuid not null references people(id),
  channel text not null check (channel in ('chat', 'voice')),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  agent_id uuid references agents(id),
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

create index idx_assistant_interactions_operator on assistant_interactions (operator_id, created_at);
