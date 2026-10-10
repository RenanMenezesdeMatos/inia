-- Checkpoint Registry Foundation — checkpoints derivados da Base de Conhecimento, governados pelo administrador e versionados
--
-- Aditiva: tabelas novas + duas colunas nulas em process_checkpoint_observations + a chave de prática ampliada. Nenhuma linha
-- existente muda e nada é apagado; nenhum backfill (histórico sem registry continua exatamente como está — comportamento legado).
--
--   BASE DE CONHECIMENTO (fonte da verdade) → extração estrutural na publicação → CANDIDATOS → RECONCILIAÇÃO com o registry
--   → DELTA governado pelo administrador → versões ATIVAS → monitoria (o especialista avalia pelo checkpointRef) → observações.
--
--   checkpoint_change_sets        uma extração/reconciliação por (documento, versão PUBLICADA da base) — idempotente.
--   checkpoint_definitions        IDENTIDADE LÓGICA do checkpoint (continua através das versões da base) + configuração
--                                 OPERACIONAL do administrador (rótulo, criticidade, feedback, analytics, destaque, ativo). A regra
--                                 oficial NUNCA mora aqui: é da base.
--   checkpoint_versions           a definição vinculada a UMA versão da base: literal oficial (read-only), etapa, código
--                                 checkpointRef, aplicabilidade/evidência esperada extraídas, tipo de mudança da reconciliação e
--                                 estado de governança (PROPOSED → ACTIVE; NEEDS_REVIEW; REJECTED; SUPERSEDED; REMOVED). Vigência por
--                                 effective_from/until — "qual regra valia na data desta chamada?" sem reinterpretar o histórico.
--   checkpoint_scopes             onde a definição se aplica (organização, domínio, Grupo, Subgrupo) — associação, nunca cópia.
--   checkpoint_governed_documents documento cuja monitoria passou a usar SÓ as versões ATIVAS do registry (opt-in do admin; sem
--                                 isto, o runtime continua com o catálogo estrutural de sempre).
--   process_checkpoint_observations.checkpoint_definition_id / checkpoint_version_id — a observação guarda a identidade lógica e a
--                                 versão da regra que a avaliou; practice_key passa a aceitar 'CHECKPOINT:<definição>' (cauda longa
--                                 sem comportamento canônico: série histórica pela identidade lógica, sem enum novo).

create table checkpoint_change_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  knowledge_document_id uuid not null references knowledge_documents(id),
  knowledge_version integer not null check (knowledge_version > 0),
  previous_knowledge_version integer check (previous_knowledge_version is null or previous_knowledge_version > 0),
  extractor_version text not null,
  reconciliation_version text not null,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (knowledge_document_id, knowledge_version)
);
create index checkpoint_change_sets_org_idx on checkpoint_change_sets (organization_id, knowledge_document_id, knowledge_version desc);

create table checkpoint_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  knowledge_document_id uuid not null references knowledge_documents(id),
  canonical_behavior text check (canonical_behavior is null or canonical_behavior ~ '^[A-Z][A-Z_]{2,59}$'),
  operational_label text check (operational_label is null or length(operational_label) between 2 and 120),
  criticality text not null default 'NORMAL' check (criticality in ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  feedback_enabled boolean not null default true,
  analytics_enabled boolean not null default true,
  highlight boolean not null default false,
  operational_status text not null default 'ACTIVE' check (operational_status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index checkpoint_definitions_document_idx on checkpoint_definitions (organization_id, knowledge_document_id);

create table checkpoint_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  definition_id uuid not null references checkpoint_definitions(id),
  change_set_id uuid not null references checkpoint_change_sets(id),
  previous_version_id uuid references checkpoint_versions(id),
  knowledge_document_id uuid not null references knowledge_documents(id),
  knowledge_version integer not null check (knowledge_version > 0),
  -- versão da REGRA (muda com texto equivalente/modificado; a mesma regra em outra versão da base mantém o número).
  definition_version integer not null check (definition_version > 0),
  checkpoint_ref text check (checkpoint_ref is null or checkpoint_ref ~ '^CP-[0-9a-f]{10}$'),
  kind text not null check (kind in ('LIST_ITEM', 'COMPOSITE_LIST', 'SENTENCE')),
  segment_role text not null check (segment_role in ('RULE', 'AVOID')),
  section_heading text,
  chunk_index integer,
  lead_in text,
  list_position integer,
  source_literal text not null check (length(source_literal) > 0),
  requirement text not null check (length(requirement) > 0),
  name text not null check (length(name) between 2 and 160),
  applicability text,
  expected_evidence_kind text not null check (expected_evidence_kind in ('OPERATOR_ACTION', 'OPERATOR_QUESTION', 'OPERATOR_STATEMENT', 'AVOIDED_PHRASE', 'COMPOSITE_LIST')),
  canonical_behavior text check (canonical_behavior is null or canonical_behavior ~ '^[A-Z][A-Z_]{2,59}$'),
  change_kind text not null check (change_kind in ('NEW', 'UNCHANGED', 'SEMANTICALLY_EQUIVALENT', 'MODIFIED', 'REMOVED', 'AMBIGUOUS')),
  change_detail jsonb not null default '{}'::jsonb,
  status text not null check (status in ('PROPOSED', 'ACTIVE', 'NEEDS_REVIEW', 'REJECTED', 'SUPERSEDED', 'REMOVED')),
  effective_from timestamptz,
  effective_until timestamptz,
  reviewed_by uuid references people(id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 1000),
  extractor_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- uma linha por definição × versão da base; o código da etapa é único dentro da versão da base (REMOVED não tem código).
  unique (definition_id, knowledge_version),
  check ((status = 'REMOVED') = (change_kind = 'REMOVED')),
  check (status <> 'REMOVED' or checkpoint_ref is null),
  check (status in ('REMOVED', 'REJECTED') or checkpoint_ref is not null),
  check (status <> 'ACTIVE' or effective_from is not null),
  check (effective_until is null or effective_from is null or effective_until >= effective_from)
);
create unique index checkpoint_versions_ref_per_knowledge_version on checkpoint_versions (knowledge_document_id, knowledge_version, checkpoint_ref) where checkpoint_ref is not null;
create index checkpoint_versions_definition_idx on checkpoint_versions (definition_id, knowledge_version desc);
create index checkpoint_versions_runtime_idx on checkpoint_versions (organization_id, knowledge_document_id, knowledge_version, status);

create table checkpoint_scopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  definition_id uuid not null references checkpoint_definitions(id) on delete cascade,
  scope_type text not null check (scope_type in ('BUSINESS_DOMAIN', 'TEAM', 'SUBTEAM')),
  business_domain_id uuid references business_domains(id),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  created_at timestamptz not null default now(),
  check ((scope_type = 'BUSINESS_DOMAIN') = (business_domain_id is not null)),
  check (scope_type <> 'TEAM' or (team_id is not null and subteam_id is null)),
  check (scope_type <> 'SUBTEAM' or subteam_id is not null)
);
create unique index checkpoint_scopes_unique on checkpoint_scopes (definition_id, scope_type, coalesce(business_domain_id, team_id, subteam_id));

create table checkpoint_governed_documents (
  knowledge_document_id uuid primary key references knowledge_documents(id),
  organization_id uuid not null references organizations(id),
  enabled_by uuid references people(id),
  enabled_at timestamptz not null default now()
);

alter table process_checkpoint_observations
  add column checkpoint_definition_id uuid references checkpoint_definitions(id),
  add column checkpoint_version_id uuid references checkpoint_versions(id);

alter table process_checkpoint_observations drop constraint process_checkpoint_observations_practice_key_check;
alter table process_checkpoint_observations
  add constraint process_checkpoint_observations_practice_key_check
  check (
    practice_key like 'KB:%'
    or (practice_key like 'BEHAVIOR:%' and canonical_behavior is not null and practice_key = 'BEHAVIOR:' || canonical_behavior)
    or (practice_key like 'CHECKPOINT:%' and checkpoint_definition_id is not null and practice_key = 'CHECKPOINT:' || checkpoint_definition_id::text)
  );
