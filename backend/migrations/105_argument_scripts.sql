-- ARGUMENTÁRIOS (evolução das "Regras de chamada"): cadastro estruturado, versionado e com vigência, administrado por escopo
-- (Grupo/Subgrupo) com as permissões existentes (`configuration.manage`). Ver docs/dev/feedback-engine.md › Argumentários.
--
--   argument_scripts           identidade + escopo de aplicação + área responsável (domínio de negócio) + estado
--   argument_script_versions   conteúdo estruturado (ARGUMENT_SCRIPT_CONTENT_V1) por versão; publicada = imutável; vigência
--                              [effective_from, effective_until) — a análise usa a versão VIGENTE NA DATA DA CHAMADA
--
-- Compatibilidade: `call_expectations` NÃO é apagada nem alterada. Cada linha vira um argumentário com o MESMO escopo, assunto e
-- estado, conteúdo preservado literalmente em `legacyExpectation` e uma orientação SEM classificação de obrigatoriedade
-- (`UNSPECIFIED`). Nenhum gatilho, ponto obrigatório ou conduta a evitar é inventado: a conversão é `LEGACY_UNSTRUCTURED` e o motor
-- de feedback não cria critério a partir dela até o administrador estruturar os campos.
--
-- Memória do motor: `call_criterion_assessments` passa a aceitar critérios vindos de argumentário (`source_kind`) e registra, por
-- critério, aplicabilidade, observabilidade (onde a conduta acontece), alegação de execução (declarada/intenção) e a parte da regra
-- avaliada (regra composta). `call_assessments.argument_scripts` guarda a aplicabilidade de cada argumentário considerado.

create table argument_scripts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null check (length(btrim(name)) between 3 and 160),
  -- Área responsável = domínio de negócio (Administração › Domínios de negócio). Nulo só no legado convertido.
  business_domain_id uuid references business_domains(id),
  scope_type text not null check (scope_type in ('ALL_TEAMS', 'TEAM', 'SUBTEAM')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  -- Assunto do cadastro antigo (preservado; informativo — a aplicabilidade vem da condição/gatilho).
  subject_id uuid references subjects(id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  conversion text not null default 'NATIVE' check (conversion in ('NATIVE', 'LEGACY_UNSTRUCTURED')),
  legacy_call_expectation_id uuid unique references call_expectations(id),
  created_by uuid references people(id),
  updated_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'ALL_TEAMS' and team_id is null and subteam_id is null) or
    (scope_type = 'TEAM' and team_id is not null and subteam_id is null) or
    (scope_type = 'SUBTEAM' and subteam_id is not null)
  )
);
create index argument_scripts_scope_idx on argument_scripts (organization_id, scope_type, team_id, subteam_id);

create table argument_script_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  script_id uuid not null references argument_scripts(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null check (status in ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  content jsonb not null,
  content_hash text not null,
  -- Procedimento de origem (base de conhecimento) e referência livre da fonte (planilha, item…).
  source_document_id uuid references knowledge_documents(id),
  source_reference text,
  effective_from timestamptz,
  effective_until timestamptz,
  published_at timestamptz,
  published_by uuid references people(id),
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (script_id, version),
  check (status = 'DRAFT' or (effective_from is not null and published_at is not null)),
  check (effective_until is null or effective_from is null or effective_until > effective_from)
);
create unique index argument_script_versions_one_draft on argument_script_versions (script_id) where status = 'DRAFT';
create unique index argument_script_versions_one_published on argument_script_versions (script_id) where status = 'PUBLISHED';
create index argument_script_versions_in_force on argument_script_versions (organization_id, effective_from) where status in ('PUBLISHED', 'SUPERSEDED');

-- Versão publicada é histórico: o conteúdo, a fonte e o início da vigência nunca mudam (só o estado e o FIM da vigência, ao
-- ser substituída ou encerrada). Apagar uma versão publicada só pela cascata do argumentário (que o serviço não permite).
create function argument_script_versions_immutable() returns trigger language plpgsql as $$
begin
  if old.status in ('PUBLISHED', 'SUPERSEDED') then
    if tg_op = 'DELETE' then
      if pg_trigger_depth() > 1 then return old; end if;
      raise exception 'Versão publicada de argumentário não pode ser apagada.' using errcode = 'P0001';
    end if;
    if new.content is distinct from old.content or new.content_hash is distinct from old.content_hash
       or new.source_document_id is distinct from old.source_document_id or new.source_reference is distinct from old.source_reference
       or new.effective_from is distinct from old.effective_from or new.version is distinct from old.version
       or new.script_id is distinct from old.script_id or new.published_at is distinct from old.published_at
       or (new.status = 'DRAFT') then
      raise exception 'Versão publicada de argumentário é imutável (só o estado e o fim da vigência mudam).' using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger argument_script_versions_immutable before update or delete on argument_script_versions
  for each row execute function argument_script_versions_immutable();

-- Conversão do cadastro antigo: mesmo escopo, assunto e estado; texto preservado; nada inventado.
insert into argument_scripts (id, organization_id, name, business_domain_id, scope_type, team_id, subteam_id, subject_id, status, conversion, legacy_call_expectation_id, created_at, updated_at)
select gen_random_uuid(), ce.organization_id, left(btrim(regexp_replace(ce.expectation, '\s+', ' ', 'g')), 160), null, ce.scope_type, ce.team_id, ce.subteam_id, ce.subject_id,
       case when ce.active then 'ACTIVE' else 'ARCHIVED' end, 'LEGACY_UNSTRUCTURED', ce.id, ce.created_at, ce.updated_at
from call_expectations ce
where length(btrim(ce.expectation)) >= 3;

insert into argument_script_versions (organization_id, script_id, version, status, content, content_hash, effective_from, effective_until, published_at, created_at, updated_at)
select s.organization_id, s.id, 1, 'PUBLISHED', c.content, encode(sha256(convert_to(c.content::text, 'UTF8')), 'hex'),
       ce.created_at, case when ce.active then null else greatest(ce.updated_at, ce.created_at + interval '1 second') end, ce.created_at, ce.created_at, ce.updated_at
from argument_scripts s
join call_expectations ce on ce.id = s.legacy_call_expectation_id
cross join lateral (select jsonb_build_object(
  'schemaVersion', 1,
  'trigger', null,
  'notApplicableWhen', null,
  'operatorGuidance', jsonb_build_array(jsonb_build_object('key', 'legacy-' || left(replace(ce.id::text, '-', ''), 12), 'text', btrim(ce.expectation), 'modality', 'UNSPECIFIED')),
  'requiredPoints', '[]'::jsonb,
  'avoid', '[]'::jsonb,
  'suggestedScript', null,
  'monitoringReference', null,
  'legacyExpectation', ce.expectation
) content) c;

-- Memória do motor: critérios de argumentário, aplicabilidade × observabilidade × execução, parte da regra composta, escopo.
alter table call_criterion_assessments alter column document_id drop not null;
alter table call_criterion_assessments
  add column source_kind text not null default 'KNOWLEDGE_DOCUMENT' check (source_kind in ('KNOWLEDGE_DOCUMENT', 'ARGUMENT_SCRIPT')),
  add column argument_script_id uuid references argument_scripts(id),
  add column argument_script_version integer,
  add column applicability text check (applicability in ('APPLIES', 'DOES_NOT_APPLY', 'UNCERTAIN')),
  add column observability text check (observability in ('IN_CONVERSATION', 'OUTSIDE_CONVERSATION')),
  add column execution_claim text check (execution_claim in ('DECLARED', 'INTENDED', 'NONE')),
  add column parent_criterion_key text,
  add column obligation jsonb,
  add column scope jsonb;
alter table call_criterion_assessments drop constraint if exists call_criterion_assessments_criterion_key_check;
alter table call_criterion_assessments add constraint call_criterion_assessments_criterion_key_check check (criterion_key ~ '^(KC|AG)-[0-9a-f]{12}$');
alter table call_criterion_assessments add constraint call_criterion_assessments_source_check check (
  (source_kind = 'KNOWLEDGE_DOCUMENT' and document_id is not null) or
  (source_kind = 'ARGUMENT_SCRIPT' and argument_script_id is not null and argument_script_version is not null)
);
create index call_criterion_by_argument_idx on call_criterion_assessments (organization_id, argument_script_id, local_date) where is_current and argument_script_id is not null;

alter table call_assessments add column argument_scripts jsonb not null default '[]'::jsonb;
