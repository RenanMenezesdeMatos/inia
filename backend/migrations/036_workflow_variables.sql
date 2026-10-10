-- Workflow Variables: estado de execução explícito e nomeado pelo admin (ex.: "URA baixa"),
-- distinto de Node Output (produzido automaticamente por Agent/Orchestrator) e de System
-- Configuration (org_config_values, persistente e escopado por org/time). A definição
-- (nome/tipo) vive aqui, ligada ao workflow — não é versionada junto com o grafo, igual
-- trigger_config, porque renomear uma variável não deve exigir republicar o workflow.
create table workflow_variables (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  name text not null,
  type text not null check (type in ('BOOLEAN', 'NUMERIC', 'TEXT')),
  created_at timestamptz not null default now()
);

create index idx_workflow_variables_workflow_id on workflow_variables(workflow_id);

-- Valor de cada variável em runtime, por execução — irmã de node_outputs, mesmo padrão de
-- jsonb_set em engine.ts. Chave é o variableId (imutável), nunca o nome (que pode ser
-- renomeado sem quebrar nenhuma referência).
alter table workflow_enrollments
  add column variables jsonb not null default '{}'::jsonb;
