-- FEEDBACK ENGINE — memória operacional rastreável, diagnóstico e mensagens (aditiva).
--
-- O feedback deixa de ser o artefato central: a ANÁLISE é. Cinco responsabilidades que nunca se misturam:
--   feedback_analysis_runs          execução de uma análise (chamada ou indicador): proveniência, versões, custo, resultado
--                                   auditável. Uma análise compatível (mesma chave) é REUSADA — nunca refeita nem recontada.
--   call_assessments                a leitura de UMA chamada: cenário, procedimento aplicável, caminho correto × seguido,
--                                   cobertura, estrutura vigente na data analisada. Revisões preservadas (supersessão).
--   call_criterion_assessments      a MEMÓRIA consultável: um critério da base × uma chamada, com status (acerto, desvio,
--                                   parcial, não observável, não aplicável, não avaliado), evidência literal por turno/falante,
--                                   regra/versão, justificativa e orientação. Acertos e desvios alimentam a mesma memória.
--   indicator_investigations        o diagnóstico de um indicador oficial: fatos oficiais, localização (onde/quando mudou),
--                                   evidências das chamadas do recorte, grupo de referência comparável, conclusão e limites.
--   feedback_engine_messages        a mensagem derivada do diagnóstico (ou a abstenção com motivo). Identidade da ENTREGA
--                                   separada da identidade da análise: a mesma análise nunca é contada duas vezes.
-- + knowledge_criteria              identidade automática dos critérios derivados da base publicada (sem aprovação humana).
-- + feedback_material_recommendations  material recomendado para desenvolvimento ≠ base usada como fundamento ≠ entregue.
--
-- Nada existente muda de significado. `workflow_output_emissions` ganha a referência à mensagem nova; os artefatos do caminho
-- anterior (reliable_feedback_artifacts) ganham o registro de supersessão para encerrar retenções antigas com motivo.

create table feedback_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  kind text not null check (kind in ('CALL_ANALYSIS', 'INDICATOR_INVESTIGATION')),
  -- Chave de compatibilidade: mesma fonte (transcrição/medição), mesmas versões da base, mesma lógica e mesma configuração
  -- do especialista. Uma análise concluída com a mesma chave é reutilizada.
  analysis_key text not null,
  person_id uuid not null references people(id),
  interaction_id uuid references interactions(id) on delete set null,
  indicator_definition_id uuid references indicator_definitions(id) on delete set null,
  period_start date,
  period_end date,
  agent_id uuid references agents(id) on delete set null,
  trigger jsonb not null default '{}'::jsonb,
  status text not null check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
  outcome text check (outcome in ('USABLE', 'PARTIAL', 'INSUFFICIENT_EVIDENCE')),
  outcome_reasons text[] not null default '{}',
  logic_version text not null,
  provenance jsonb not null default '{}'::jsonb,
  result jsonb,
  metrics jsonb not null default '{}'::jsonb,
  error text,
  as_of timestamptz not null,
  claimed_until timestamptz,
  attempts integer not null default 0,
  started_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, analysis_key)
);
create index feedback_analysis_runs_person_idx on feedback_analysis_runs (organization_id, person_id, created_at desc);
create index feedback_analysis_runs_interaction_idx on feedback_analysis_runs (interaction_id) where interaction_id is not null;

create table call_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  analysis_run_id uuid not null references feedback_analysis_runs(id) on delete cascade,
  interaction_id uuid not null references interactions(id) on delete cascade,
  person_id uuid not null references people(id),
  occurred_at timestamptz not null,
  local_date date not null,
  time_zone text not null,
  subject_raw text,
  subject_canonical text,
  channel text,
  -- Estrutura organizacional usada para agregação: a vigente NO MOMENTO DA ANÁLISE (não há histórico organizacional confiável);
  -- `structure_basis` registra essa limitação para quem consulta.
  team_id uuid,
  subteam_id uuid,
  supervisor_id uuid,
  structure_basis text not null check (structure_basis in ('CURRENT_AT_ANALYSIS')),
  selection_reason text not null,
  transcript_status text not null check (transcript_status in ('COMPLETE', 'INCOMPLETE', 'UNAVAILABLE')),
  transcript_checksum text,
  procedure_document_id uuid references knowledge_documents(id) on delete set null,
  procedure_document_version integer,
  -- RULE_IN_FORCE_AT_CALL = versão publicada vigente na data da chamada; CURRENT_RULE_REEVALUATION = nenhuma versão vigente
  -- naquela data, a chamada foi lida pela regra atual (a perspectiva fica explícita).
  rule_perspective text check (rule_perspective in ('RULE_IN_FORCE_AT_CALL', 'CURRENT_RULE_REEVALUATION')),
  scenario jsonb not null,
  path_assessment text not null check (path_assessment in ('CORRECT', 'INCORRECT', 'PARTIALLY_CORRECT', 'UNDETERMINED', 'NO_PROCEDURE')),
  coverage jsonb not null,
  outcome text not null check (outcome in ('USABLE', 'PARTIAL', 'INSUFFICIENT_EVIDENCE')),
  limitations text[] not null default '{}',
  as_of timestamptz not null,
  is_current boolean not null default true,
  superseded_by uuid references call_assessments(id),
  superseded_at timestamptz,
  supersede_reason text,
  created_at timestamptz not null default now()
);
-- Uma leitura vigente por chamada × procedimento (duas análises de processos diferentes da mesma chamada convivem).
create unique index call_assessments_current_idx on call_assessments (interaction_id, coalesce(procedure_document_id, '00000000-0000-0000-0000-000000000000'::uuid)) where is_current;
create index call_assessments_person_idx on call_assessments (organization_id, person_id, local_date) where is_current;
create index call_assessments_run_idx on call_assessments (analysis_run_id);

create table call_criterion_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  call_assessment_id uuid not null references call_assessments(id) on delete cascade,
  analysis_run_id uuid not null references feedback_analysis_runs(id) on delete cascade,
  interaction_id uuid not null references interactions(id) on delete cascade,
  person_id uuid not null references people(id),
  occurred_at timestamptz not null,
  local_date date not null,
  subject_raw text,
  subject_canonical text,
  team_id uuid,
  subteam_id uuid,
  -- Identidade estável do critério (derivada da base; ver knowledge_criteria).
  criterion_key text not null check (criterion_key ~ '^KC-[0-9a-f]{12}$'),
  identity_basis text not null check (identity_basis in ('FIRST_SEEN', 'UNCHANGED', 'EQUIVALENT_PREVIOUS', 'MODIFIED', 'SOURCE_SPECIFIC')),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  document_version integer not null,
  section_heading text,
  criterion_text text not null,
  on_path boolean not null default true,
  status text not null check (status in ('MET', 'NOT_MET', 'PARTIAL', 'NOT_OBSERVABLE', 'NOT_APPLICABLE', 'NOT_ASSESSED')),
  evidence_kind text check (evidence_kind in ('CONDUCT_OBSERVED', 'DECLARED_ACTION', 'OMISSION', 'COMPLIANCE_BY_ABSENCE', 'CUSTOMER_CONTEXT', 'NONE')),
  evidence jsonb not null default '[]'::jsonb,
  opportunity_turn text,
  rationale text,
  expected text,
  guidance jsonb,
  why_it_matters text,
  materiality text check (materiality in ('HIGH', 'MEDIUM', 'LOW')),
  verification jsonb not null default '{}'::jsonb,
  rule_conflict boolean not null default false,
  limitations text[] not null default '{}',
  as_of timestamptz not null,
  is_current boolean not null default true,
  superseded_by uuid references call_criterion_assessments(id),
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index call_criterion_current_idx on call_criterion_assessments (interaction_id, criterion_key) where is_current;
create index call_criterion_by_criterion_idx on call_criterion_assessments (organization_id, criterion_key, local_date) where is_current;
create index call_criterion_by_person_idx on call_criterion_assessments (organization_id, person_id, local_date) where is_current;
create index call_criterion_by_subject_idx on call_criterion_assessments (organization_id, subject_canonical, local_date) where is_current;
create index call_criterion_by_assessment_idx on call_criterion_assessments (call_assessment_id);

create table knowledge_criteria (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  document_version integer not null,
  -- Chave da LINHA nesta versão (documento + seção + texto normalizado + ocorrência).
  line_key text not null,
  -- Identidade do CRITÉRIO (estável entre versões quando a regra não mudou materialmente).
  criterion_key text not null check (criterion_key ~ '^KC-[0-9a-f]{12}$'),
  section_heading text,
  text text not null,
  position integer not null,
  identity_basis text not null check (identity_basis in ('FIRST_SEEN', 'UNCHANGED', 'EQUIVALENT_PREVIOUS', 'MODIFIED', 'SOURCE_SPECIFIC')),
  previous_criterion_key text,
  extraction_version text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, document_id, document_version, line_key)
);
create index knowledge_criteria_key_idx on knowledge_criteria (organization_id, criterion_key);

create table knowledge_criteria_extractions (
  organization_id uuid not null references organizations(id),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  document_version integer not null,
  extraction_version text not null,
  reconciled_with_version integer,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (document_id, document_version, extraction_version)
);

create table indicator_investigations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  analysis_run_id uuid not null references feedback_analysis_runs(id) on delete cascade,
  person_id uuid not null references people(id),
  indicator_definition_id uuid not null references indicator_definitions(id),
  indicator_code text not null,
  source_kind text not null check (source_kind in ('MEASUREMENT', 'OFFICIAL_CLOSING')),
  source_ref text not null,
  period_start date not null,
  period_end date not null,
  reference_period text,
  team_id uuid,
  subteam_id uuid,
  official jsonb not null,
  localization jsonb not null,
  evidence jsonb not null,
  reference_group jsonb not null,
  questions jsonb not null,
  conclusion text not null check (conclusion in ('PATTERN_SUPPORTED', 'STRENGTH_PATTERN', 'RESULT_RECOGNITION', 'CHANGE_LOCATED_NO_CAUSE', 'MIX_EFFECT', 'INSUFFICIENT_DATA')),
  limitations text[] not null default '{}',
  as_of timestamptz not null,
  is_current boolean not null default true,
  superseded_by uuid references indicator_investigations(id),
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index indicator_investigations_current_idx on indicator_investigations (person_id, indicator_definition_id, source_kind, period_start, period_end) where is_current;
create index indicator_investigations_org_idx on indicator_investigations (organization_id, period_end desc) where is_current;

create table feedback_engine_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  -- WORKFLOW_NODE:<matrícula>:<nó Gerar feedback>:<nó de origem>
  message_key text not null,
  enrollment_id uuid references workflow_enrollments(id) on delete set null,
  workflow_id uuid references workflows(id) on delete set null,
  workflow_version_id uuid references workflow_versions(id) on delete set null,
  node_id text,
  source_node_id text,
  analysis_run_ids uuid[] not null default '{}',
  person_id uuid not null references people(id),
  domain text not null check (domain in ('MONITORING', 'INDICATOR')),
  status text not null check (status in ('RUNNING', 'PUBLISHABLE', 'ABSTAINED', 'FAILED')),
  abstain_reason text,
  finding_keys text[] not null default '{}',
  brief jsonb,
  composition jsonb,
  message jsonb,
  suppressed jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  error text,
  -- Quando a mensagem chegou de fato a uma superfície (Acompanhamento/Chat/Avatar) — base da supressão de repetição.
  delivered_at timestamptz,
  claimed_until timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id, message_key)
);
create index feedback_engine_messages_person_idx on feedback_engine_messages (organization_id, person_id, created_at desc);
create index feedback_engine_messages_findings_idx on feedback_engine_messages using gin (finding_keys);

create table feedback_material_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  message_id uuid not null references feedback_engine_messages(id) on delete cascade,
  person_id uuid not null references people(id),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  document_version integer,
  criterion_keys text[] not null default '{}',
  reason text not null,
  delivered_feedback_id uuid references feedbacks(id) on delete set null,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id, document_id)
);
create index feedback_material_recommendations_doc_idx on feedback_material_recommendations (organization_id, document_id, created_at desc);

alter table workflow_output_emissions add column engine_message_id uuid references feedback_engine_messages(id);
create index workflow_output_emissions_engine_idx on workflow_output_emissions (engine_message_id) where engine_message_id is not null;

alter table reliable_feedback_artifacts add column superseded_at timestamptz;
alter table reliable_feedback_artifacts add column superseded_reason text;
