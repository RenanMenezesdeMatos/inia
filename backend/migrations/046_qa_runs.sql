-- QA Lab (/admin/simulate): histórico de execuções de teste isoladas de Agent/Orchestrator/
-- Workflow. Tabela PRÓPRIA, deliberadamente separada de workflow_enrollments/agent_runs/alerts:
-- uma execução de QA nunca entra em métricas produtivas (usageCount de agente, execuções de
-- workflow, pendências, relatórios). `state` guarda o estado resumível de um Workflow em
-- simulação (Wait/Human Review/passo a passo); `trace` é o passo a passo + efeitos simulados +
-- chamadas de IA; `input` é o pedido original (reaproveitado por "Executar novamente").
create table qa_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  executed_by uuid not null references people(id),
  resource_type text not null check (resource_type in ('WORKFLOW', 'AGENT', 'ORCHESTRATOR')),
  resource_id uuid not null,
  resource_name text not null,
  status text not null check (status in ('RUNNING', 'COMPLETED', 'WAITING', 'PAUSED', 'FAILED')),
  input jsonb not null,
  context jsonb not null default '{}'::jsonb,
  state jsonb,
  trace jsonb not null default '{}'::jsonb,
  ai_calls int not null default 0,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  total_tokens int not null default 0,
  duration_ms int not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_qa_runs_recent on qa_runs (organization_id, created_at desc);
create index idx_qa_runs_resource on qa_runs (resource_type, resource_id, created_at desc);
