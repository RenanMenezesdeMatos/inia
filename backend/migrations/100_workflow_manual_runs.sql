-- Gatilho MANUAL de Workflow — "Executar agora" para UM colaborador escolhido por quem tem permissão.
--
-- O disparo é um registro próprio (quem, quando, workflow + versão publicada, colaborador, interação/medição escolhidas,
-- chave de idempotência) e cria UMA matrícula NORMAL no motor (`workflow_enrollments`), que aponta de volta para ele:
-- a origem manual continua identificável mesmo quando a matrícula carrega uma interação ou medição real (a matrícula
-- continua com exatamente uma origem de dados — `workflow_enrollments_source_check` não muda).
--
-- Idempotência: a MESMA solicitação (mesma chave gerada pela tela a cada abertura do diálogo) nunca cria duas execuções —
-- duplo clique, retry de rede ou reenvio devolvem o disparo já registrado. Um novo disparo intencional usa outra chave.
create table workflow_manual_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  workflow_id uuid not null references workflows(id) on delete cascade,
  version_id uuid not null references workflow_versions(id),
  requested_by uuid not null references people(id),
  requested_at timestamptz not null default now(),
  idempotency_key text not null check (length(idempotency_key) between 8 and 120),
  context text not null check (context in ('COLLABORATOR', 'INTERACTION', 'INDICATOR_MEASUREMENT')),
  collaborator_id uuid not null references people(id),
  interaction_id uuid references interactions(id) on delete set null,
  indicator_measurement_id uuid references indicator_measurements(id) on delete set null,
  unique (workflow_id, requested_by, idempotency_key)
);

create index workflow_manual_runs_workflow_idx on workflow_manual_runs (workflow_id, requested_at desc);

alter table workflow_enrollments
  add column manual_run_id uuid references workflow_manual_runs(id) on delete cascade;

-- Um disparo manual = exatamente uma matrícula raiz.
create unique index workflow_enrollments_manual_run_uk
  on workflow_enrollments (manual_run_id)
  where manual_run_id is not null;
