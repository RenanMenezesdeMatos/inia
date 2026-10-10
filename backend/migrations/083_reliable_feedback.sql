-- V1.5.12 — WORKFLOW-CENTRIC RELIABLE FEEDBACK
--
-- Aditiva: só tabelas NOVAS; nenhuma coluna/linha existente muda. O feedback oficial de MONITORIA e de INDICADOR passa a
-- seguir o Workflow: Agent/Orquestrador (inteligência) → "Gerar feedback" (camada de confiabilidade OBRIGATÓRIA) → Revisão
-- humana opcional → Output (destino). Três conceitos, três tabelas:
--
--   reliable_feedback_artifacts     → o ARTEFATO confiável gerado por UM nó "Gerar feedback" de UMA matrícula a partir de UM
--                                     nó de origem (idempotência: a mesma matrícula/nó/origem nunca gera duas vezes, nunca
--                                     chama o redator duas vezes depois de concluído). Guarda o resultado normalizado da
--                                     origem, o contexto CANÔNICO (indicador), o artefato (itens + disposições) e a
--                                     proveniência do redator — nunca prompt/resposta em claro fora do que já é auditado.
--   reliable_feedback_item_reviews  → QA de EXCEÇÃO por item (só HOLD_FOR_QA): mesmo contrato de decisão do QA de feedback
--                                     (APPROVED_UNCHANGED | APPROVED_EDITED | REJECTED), texto proposto nunca sobrescrito.
--   workflow_output_emissions       → idempotência por nó Output: a mesma matrícula/nó/superfície/destinatário emite no
--                                     máximo UMA vez (retry, concorrência) — o feedback publicado fica referenciado aqui.
--
-- "Gerar feedback" NÃO entrega: quem publica é sempre o Output. HOLD_FOR_QA deixa a matrícula esperando; a decisão de QA
-- reativa a MESMA matrícula (o Workflow continua dono da sequência). BLOCKED nunca é emitido; QA não o desbloqueia.

create table reliable_feedback_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  -- WORKFLOW_NODE:<matrícula>:<nó Gerar feedback>:<nó de origem>
  artifact_key text not null,
  enrollment_id uuid references workflow_enrollments(id) on delete set null,
  workflow_id uuid references workflows(id) on delete set null,
  workflow_version_id uuid references workflow_versions(id) on delete set null,
  node_id text not null,
  source_node_id text not null,
  source_type text not null check (source_type in ('AGENT', 'ORCHESTRATOR')),
  domain text not null check (domain in ('MONITORING', 'INDICATOR')),
  collaborator_id uuid not null references people(id),
  interaction_id uuid references interactions(id),
  indicator_measurement_id uuid references indicator_measurements(id),
  contract_version text not null,
  -- PENDING = alguém possui a geração (lease); COMPLETED = artefato gravado; FAILED = falha técnica (retomável).
  status text not null check (status in ('PENDING', 'COMPLETED', 'FAILED')),
  -- Disposição do artefato (o que o Workflow faz): READY → segue; HOLD_FOR_QA → espera o QA; BLOCKED → nunca emitido;
  -- REJECTED → o QA rejeitou tudo o que era emitível. Null enquanto não concluído.
  disposition text check (disposition in ('READY', 'HOLD_FOR_QA', 'BLOCKED', 'REJECTED')),
  policy_version text,
  claimed_until timestamptz,
  attempts integer not null default 0,
  last_error text,
  -- AUDITORIA (nunca ao colaborador): o que a origem disse (normalizado), o contexto canônico do sistema e o artefato.
  normalized_input jsonb,
  canonical_context jsonb,
  artifact jsonb,
  writer_input jsonb,
  writer_raw_output jsonb,
  writer_error text,
  writer_provenance jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  -- Quando o QA resolveu todos os itens retidos (a matrícula é reativada nesse momento).
  qa_resolved_at timestamptz,
  unique (organization_id, artifact_key),
  check ((status = 'COMPLETED') = (completed_at is not null)),
  check (status <> 'COMPLETED' or (disposition is not null and artifact is not null)),
  check (domain <> 'MONITORING' or interaction_id is not null),
  check (domain <> 'INDICATOR' or indicator_measurement_id is not null)
);
create index reliable_feedback_artifacts_enrollment_idx on reliable_feedback_artifacts (organization_id, enrollment_id);
create index reliable_feedback_artifacts_collaborator_idx on reliable_feedback_artifacts (organization_id, collaborator_id, created_at desc);

create table reliable_feedback_item_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  artifact_id uuid not null references reliable_feedback_artifacts(id) on delete cascade,
  item_index integer not null,
  section text not null check (section in ('STRENGTH', 'OPPORTUNITY')),
  item_kind text not null,
  -- Rótulo exibível (data + assunto do atendimento, ou indicador + período) — nunca identificador interno.
  subject_label text not null,
  -- O item como o revisor precisa vê-lo (evidência exibível ou fatos canônicos, significado seguro) — nunca raw/refs.
  review_item jsonb not null,
  wording_source text not null check (wording_source in ('WRITER', 'FALLBACK')),
  writer_violations text[] not null default '{}',
  -- Texto proposto (redator validado ou fallback determinístico). Nunca sobrescrito.
  proposed_wording jsonb not null,
  review_required_by text[] not null,
  review_status text not null default 'PENDING_REVIEW' check (review_status in ('PENDING_REVIEW', 'APPROVED_UNCHANGED', 'APPROVED_EDITED', 'REJECTED')),
  final_wording jsonb,
  reason_category text check (reason_category in ('FACTUAL_OVERCLAIM', 'UNSUPPORTED_EFFECT', 'UNSUPPORTED_PROCEDURE', 'TOO_GENERIC', 'NOT_ACTIONABLE', 'TONE', 'PRIVACY', 'WRONG_FOCUS', 'OTHER')),
  reviewer_comment text check (reviewer_comment is null or length(reviewer_comment) <= 2000),
  edit_warnings text[] not null default '{}',
  reviewed_by uuid references people(id),
  reviewed_at timestamptz,
  created_at timestamptz not null,
  unique (artifact_id, item_index),
  check (
    (review_status = 'PENDING_REVIEW' and final_wording is null and reviewed_by is null and reviewed_at is null)
    or (review_status = 'APPROVED_UNCHANGED' and final_wording is null and reviewed_by is not null and reviewed_at is not null)
    or (review_status = 'APPROVED_EDITED' and final_wording is not null and reason_category is not null and reviewed_by is not null and reviewed_at is not null)
    or (review_status = 'REJECTED' and final_wording is null and reason_category is not null and reviewed_by is not null and reviewed_at is not null)
  )
);
create index reliable_feedback_item_reviews_pending_idx on reliable_feedback_item_reviews (organization_id, review_status, created_at);

create table workflow_output_emissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  enrollment_id uuid not null references workflow_enrollments(id) on delete cascade,
  node_id text not null,
  surface text not null,
  recipient_id uuid not null references people(id),
  artifact_id uuid references reliable_feedback_artifacts(id),
  case_id uuid references supervision_cases(id),
  feedback_id uuid references feedbacks(id),
  created_at timestamptz not null,
  unique (enrollment_id, node_id, surface, recipient_id)
);
create index workflow_output_emissions_artifact_idx on workflow_output_emissions (artifact_id) where artifact_id is not null;
