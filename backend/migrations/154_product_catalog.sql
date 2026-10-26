-- PRODUTOS E APLICABILIDADE (PRODUCT_APPLICABILITY_V1). Ver docs/dev/produtos-e-aplicabilidade.md.
--
-- Um mesmo motivo ("segunda via de fatura") existe em produtos diferentes, e cada produto pode ter procedimento próprio. O motivo
-- não determina o produto. Este cadastro dá à análise de chamada o conhecimento da OPERAÇÃO para identificar o produto de cada
-- solicitação e para saber quais fontes valem para quais produtos — nada disso é codificado no código.
--
--   product_catalog_nodes                       famílias e produtos (árvore: produto sob família; família sob família)
--   product_identification_criteria             identidade de um critério de identificação (título + estado)
--   product_identification_criterion_versions   o critério em linguagem natural, por versão: o que permite identificar, em qual
--                                               contexto vale, exceções/limitações, conclusivo (sob quais condições) × indicativo,
--                                               fonte, vigência [effective_from, effective_until) e aprovação. Aprovada = imutável.
--   product_scope_assignments                   abrangência por produto de uma fonte (documento da base ou argumentário), com
--                                               vigência própria: mudar a abrangência nunca reescreve o que valia antes.
--
-- Memória do motor: `call_assessments.product_identification` guarda, por solicitação, os candidatos, as evidências (com a origem
-- e os trechos), os conflitos, as versões do cadastro usadas e o efeito sobre cada regra avaliada. É uma fotografia: alterar o
-- cadastro depois nunca muda o fundamento de uma análise gravada.

create table product_catalog_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  kind text not null check (kind in ('FAMILY', 'PRODUCT')),
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  description text,
  parent_id uuid references product_catalog_nodes(id),
  active boolean not null default true,
  archived_at timestamptz,
  created_by uuid references people(id),
  updated_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  check (parent_id is null or parent_id <> id),
  check (active or archived_at is not null)
);
create index product_catalog_nodes_org_idx on product_catalog_nodes (organization_id, active);
create index product_catalog_nodes_parent_idx on product_catalog_nodes (parent_id);

create table product_identification_criteria (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  title text not null check (length(btrim(title)) between 3 and 160),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_by uuid references people(id),
  updated_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_identification_criteria_org_idx on product_identification_criteria (organization_id, status);

create table product_identification_criterion_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  criterion_id uuid not null references product_identification_criteria(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null check (status in ('DRAFT', 'APPROVED', 'SUPERSEDED')),
  -- O critério, em linguagem natural (o que a pessoa da operação escreveria num manual). Nunca vira expressão regular.
  statement text not null default '',
  -- O que ele permite identificar: um produto, uma família ou um conjunto ("um destes").
  target_node_ids uuid[] not null default '{}',
  context text,
  limitations text,
  strength text not null default 'INDICATIVE' check (strength in ('CONCLUSIVE', 'INDICATIVE')),
  conclusive_when text,
  source_document_id uuid references knowledge_documents(id),
  source_reference text,
  content_hash text not null,
  effective_from timestamptz,
  effective_until timestamptz,
  approved_at timestamptz,
  approved_by uuid references people(id),
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (criterion_id, version),
  check (status = 'DRAFT' or (effective_from is not null and approved_at is not null and cardinality(target_node_ids) > 0 and length(btrim(statement)) > 0)),
  check (effective_until is null or effective_from is null or effective_until > effective_from),
  check (strength = 'INDICATIVE' or status = 'DRAFT' or length(btrim(coalesce(conclusive_when, ''))) > 0)
);
create unique index product_identification_versions_one_draft on product_identification_criterion_versions (criterion_id) where status = 'DRAFT';
create unique index product_identification_versions_one_approved on product_identification_criterion_versions (criterion_id) where status = 'APPROVED';
create index product_identification_versions_in_force on product_identification_criterion_versions (organization_id, effective_from) where status in ('APPROVED', 'SUPERSEDED');

-- Versão aprovada é histórico: texto, alvo, força, fonte e início da vigência nunca mudam (só o estado e o FIM da vigência, ao ser
-- substituída ou encerrada). Apagar versão aprovada só pela cascata do critério (que o serviço só permite sem uso).
create function product_identification_versions_immutable() returns trigger language plpgsql as $$
begin
  if old.status in ('APPROVED', 'SUPERSEDED') then
    if tg_op = 'DELETE' then
      if pg_trigger_depth() > 1 then return old; end if;
      raise exception 'Versão aprovada de critério de identificação não pode ser apagada.' using errcode = 'P0001';
    end if;
    if new.statement is distinct from old.statement or new.target_node_ids is distinct from old.target_node_ids
       or new.context is distinct from old.context or new.limitations is distinct from old.limitations
       or new.strength is distinct from old.strength or new.conclusive_when is distinct from old.conclusive_when
       or new.source_document_id is distinct from old.source_document_id or new.source_reference is distinct from old.source_reference
       or new.content_hash is distinct from old.content_hash or new.effective_from is distinct from old.effective_from
       or new.version is distinct from old.version or new.criterion_id is distinct from old.criterion_id
       or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by
       or new.status = 'DRAFT' then
      raise exception 'Versão aprovada de critério de identificação é imutável.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger product_identification_versions_immutable before update or delete on product_identification_criterion_versions
  for each row execute function product_identification_versions_immutable();

create table product_scope_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  source_kind text not null check (source_kind in ('KNOWLEDGE_DOCUMENT', 'ARGUMENT_SCRIPT')),
  source_id uuid not null,
  node_ids uuid[] not null check (cardinality(node_ids) > 0),
  effective_from timestamptz not null,
  effective_until timestamptz,
  created_by uuid references people(id),
  ended_by uuid references people(id),
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until > effective_from)
);
create unique index product_scope_assignments_one_open on product_scope_assignments (source_kind, source_id) where effective_until is null;
create index product_scope_assignments_lookup on product_scope_assignments (organization_id, source_id, effective_from);

-- Abrangência registrada é histórico: só o FIM da vigência pode ser preenchido (uma vez).
create function product_scope_assignments_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Abrangência por produto é histórico e não pode ser apagada.' using errcode = 'P0001';
  end if;
  if new.node_ids is distinct from old.node_ids or new.source_id is distinct from old.source_id or new.source_kind is distinct from old.source_kind
     or new.effective_from is distinct from old.effective_from or (old.effective_until is not null and new.effective_until is distinct from old.effective_until) then
    raise exception 'Abrangência por produto é imutável (só o fim da vigência pode ser registrado).' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger product_scope_assignments_immutable before update or delete on product_scope_assignments
  for each row execute function product_scope_assignments_immutable();

-- Fotografia da identificação do produto por solicitação (nulo = análise sem cadastro de produtos ou anterior a esta migration).
alter table call_assessments add column product_identification jsonb;
