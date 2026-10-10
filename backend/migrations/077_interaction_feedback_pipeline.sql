-- V1.5.0 — CONTROLLED FEEDBACK INTEGRATION (InteractionFeedback V1 → Writer → Revisão humana → persistência)
--
-- Só tabelas NOVAS; nenhuma linha inserida; nenhuma tabela existente alterada. O pipeline nasce atrás da flag
-- INIA_INTERACTION_FEEDBACK_PIPELINE (padrão OFF) e NÃO entrega nada ao colaborador nesta versão: não cria Feedback,
-- não aparece no Acompanhamento, não notifica. Quatro conceitos que nunca se fundem:
--   interaction_feedback_runs           → uma composição do feedback de UMA interação (auditoria estrutural completa)
--   interaction_feedback_item_reviews   → COMO um item foi comunicado (texto original do redator + decisão humana)
--   operational_issue_occurrences       → o PROBLEMA estruturado observado (analytics — nunca texto do redator)
--   knowledge_recommendations           → material da base relacionado ao problema (href só da rota canônica)

create table interaction_feedback_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  collaborator_id uuid not null references people(id),
  team_id uuid references teams(id),
  interaction_id uuid,
  pipeline_version text not null,
  contract_version text not null,
  status text not null check (status in ('HAS_POINTS', 'NOTHING_MATERIAL', 'INSUFFICIENT_EVIDENCE')),
  delivery_state text not null check (delivery_state in ('DELIVERABLE', 'NOTHING_MATERIAL', 'INSUFFICIENT_EVIDENCE', 'NOT_DELIVERABLE')),
  writer_invoked boolean not null,
  -- Motivo de não chamar o redator (NOTHING_MATERIAL | INSUFFICIENT_EVIDENCE | DELIVERY_BLOCKED); null quando chamou.
  writer_skipped_reason text,
  writer_error text,
  -- AUDITORIA: o feedback estrutural completo (inclui provenance/raw) e o pedido exato ao redator; nunca vão ao revisor.
  feedback_snapshot jsonb not null,
  writer_input jsonb,
  writer_raw_output jsonb,
  occurred_at timestamptz,
  created_at timestamptz not null
);
create index interaction_feedback_runs_org_collaborator_idx on interaction_feedback_runs (organization_id, collaborator_id, created_at desc);

create table interaction_feedback_item_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  run_id uuid not null references interaction_feedback_runs(id) on delete cascade,
  slot text not null,
  item_index integer not null,
  section text not null check (section in ('STRENGTH', 'OPPORTUNITY')),
  finding_kind text not null,
  guidance_source text not null,
  -- O item exato que o redator recebeu (evidência já exibível) — base da tela de revisão e da validação de edição.
  writer_item jsonb not null,
  interaction_label text not null,
  wording_source text not null check (wording_source in ('WRITER', 'FALLBACK')),
  writer_violations text[] not null default '{}',
  -- Texto ORIGINAL do redator para o slot (como veio; null se o redator não devolveu o slot). Nunca sobrescrito.
  writer_original jsonb,
  -- Texto proposto à revisão (o do redator, ou o fallback determinístico inteiro quando a validação o rejeitou). Nunca sobrescrito.
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
  unique (run_id, slot),
  -- Estado da decisão coerente por construção (defesa em profundidade além do caso de uso).
  check (
    (review_status = 'PENDING_REVIEW' and final_wording is null and reviewed_by is null and reviewed_at is null)
    or (review_status = 'APPROVED_UNCHANGED' and final_wording is null and reviewed_by is not null and reviewed_at is not null)
    or (review_status = 'APPROVED_EDITED' and final_wording is not null and reason_category is not null and reviewed_by is not null and reviewed_at is not null)
    or (review_status = 'REJECTED' and final_wording is null and reason_category is not null and reviewed_by is not null and reviewed_at is not null)
  )
);
create index interaction_feedback_item_reviews_pending_idx on interaction_feedback_item_reviews (organization_id, review_status, created_at);

create table operational_issue_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  run_id uuid not null references interaction_feedback_runs(id) on delete cascade,
  collaborator_id uuid not null references people(id),
  team_id uuid references teams(id),
  interaction_id uuid,
  finding_kind text not null,
  issue_category text not null check (issue_category in ('COMMUNICATION_FRICTION', 'INCONSISTENT_INFORMATION', 'UNRESOLVED_CUSTOMER_NEED', 'PROCEDURAL_DIVERGENCE')),
  structural_polarity text not null,
  ownership text not null,
  scope text not null,
  -- Origem da evidência (turno + hash do trecho bruto + se foi exibível) — nunca o texto bruto.
  evidence_refs jsonb not null,
  -- Refs de finding da execução (escopo da execução; a identidade estável é run_id + ref).
  finding_refs text[] not null,
  delivery_status text not null check (delivery_status in ('ELIGIBLE_PENDING_REVIEW', 'BLOCKED_PROCEDURAL_MATCHING', 'INSUFFICIENT_DISPLAY_EVIDENCE')),
  occurred_at timestamptz,
  pipeline_version text not null,
  created_at timestamptz not null
);
create index operational_issue_occurrences_org_category_idx on operational_issue_occurrences (organization_id, issue_category, occurred_at);
create index operational_issue_occurrences_collaborator_idx on operational_issue_occurrences (organization_id, collaborator_id, occurred_at);

create table knowledge_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  operational_issue_occurrence_id uuid not null references operational_issue_occurrences(id) on delete cascade,
  knowledge_base_id uuid,
  document_id uuid references knowledge_documents(id),
  document_title text not null,
  rule_ref text not null,
  -- Só da rota canônica (`buildKnowledgeMaterialHref(documentId)`); nunca de texto de modelo.
  href text check (href is null or href ~ '^/materiais/'),
  recommendation_reason text not null,
  recommendation_type text not null check (recommendation_type in ('PROCEDURAL_RULE')),
  delivery_status text not null check (delivery_status in ('BLOCKED_PROCEDURAL_MATCHING', 'PENDING_REVIEW', 'NOT_DELIVERED')),
  review_status text not null check (review_status in ('NOT_REVIEWED', 'APPROVED', 'REJECTED')),
  created_at timestamptz not null
);
create index knowledge_recommendations_org_document_idx on knowledge_recommendations (organization_id, document_id, created_at);
