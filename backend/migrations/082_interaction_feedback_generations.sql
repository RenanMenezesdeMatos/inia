-- V1.5.10 — WORKFLOW → INTERACTION FEEDBACK PIPELINE (idempotência da geração)
--
-- Aditiva: uma tabela nova + duas colunas NULÁVEIS em `interaction_feedback_runs`; nenhuma linha existente muda.
--
-- `interaction_feedback_generations` = a INTENÇÃO LÓGICA de gerar o feedback de UMA interação, com chave estruturada:
--   organização + (workflow, nó da ação) + interação + contrato do feedback.
-- Decisão de produto (documentada em CLAUDE.md): o MESMO nó "Gerar feedback de atendimento" do MESMO Workflow gera no
-- máximo UM feedback por interação e por contrato — retry da mesma execução, duas matrículas concorrentes do mesmo
-- disparo (a flag de uma interação reenviada) e execuções futuras da agenda reaproveitam o resultado; a agenda passa a
-- escolher OUTRAS interações. Outro Workflow/outro nó (configuração explícita) ou um contrato novo geram um novo feedback.
--
-- É também o registro de posse (claim + lease) — ninguém chama o modelo sem possuir a geração — e a SELEÇÃO PERSISTIDA de
-- uma execução: a amostra da agenda é reservada aqui (`selection_*`) antes de qualquer geração, e o retry da mesma
-- matrícula relê exatamente as mesmas interações.

create table interaction_feedback_generations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  generation_key text not null,
  intent text not null check (intent in ('WORKFLOW_ACTION')),
  contract_version text not null,
  interaction_id uuid not null references interactions(id),
  collaborator_id uuid not null references people(id),
  workflow_id uuid references workflows(id),
  workflow_version_id uuid references workflow_versions(id),
  node_id text,
  -- Matrícula que RESERVOU/gerou (a primeira); retry da mesma matrícula relê a seleção por ela.
  enrollment_id uuid references workflow_enrollments(id) on delete set null,
  -- Como a interação entrou na execução (interação do gatilho ou amostra do colaborador) e a posição na amostra.
  selection_source text not null check (selection_source in ('TRIGGER_INTERACTION', 'COLLABORATOR_SAMPLE')),
  selection_strategy text check (selection_strategy in ('MOST_RECENT', 'DETERMINISTIC_SAMPLE')),
  selection_rank integer,
  -- RESERVED = selecionada, geração ainda não começou; PENDING = alguém possui (lease); COMPLETED = resultado funcional
  -- gravado (inclusive NOT_ANALYZABLE); FAILED = falha técnica (pode ser retomada).
  status text not null check (status in ('RESERVED', 'PENDING', 'COMPLETED', 'FAILED')),
  claimed_until timestamptz,
  attempts integer not null default 0,
  last_error text,
  run_id uuid,
  -- Resumo funcional SEGURO (status, disposições, motivos estruturados) — nunca texto, prompt ou trecho.
  outcome jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  unique (organization_id, generation_key),
  check ((status = 'COMPLETED') = (completed_at is not null)),
  check (status <> 'COMPLETED' or outcome is not null)
);
create index interaction_feedback_generations_selection_idx on interaction_feedback_generations (organization_id, workflow_id, node_id, enrollment_id, selection_rank);
create index interaction_feedback_generations_interaction_idx on interaction_feedback_generations (organization_id, workflow_id, node_id, interaction_id);

alter table interaction_feedback_runs add column generation_id uuid references interaction_feedback_generations(id);
-- Marca de pipeline COMPLETO (todas as decisões gravadas). Um run sem ela foi interrompido por falha técnica e nunca é
-- adotado; a fila de QA e o varredor já só enxergam itens com decisão gravada.
alter table interaction_feedback_runs add column completed_at timestamptz;
create index interaction_feedback_runs_generation_idx on interaction_feedback_runs (generation_id) where generation_id is not null;
alter table interaction_feedback_generations add constraint interaction_feedback_generations_run_fk foreign key (run_id) references interaction_feedback_runs(id);
