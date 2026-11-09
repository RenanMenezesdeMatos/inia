-- PEN-008 (decisão aprovada em 04/11/2026): atualização automática, status e histórico comparável das bases de conhecimento.
-- A base mantém a identidade; editar grava um rascunho; publicar pede a disponibilização; a versão só vira PUBLISHED (vigente,
-- pela mesma regra de sempre: live-knowledge-version.ts) quando está processada e pronta. Reaproveita knowledge_versions: nenhuma
-- tabela paralela de versões. As colunas de knowledge_documents e as tabelas de alcance continuam sendo a configuração em uso.
--
-- Migração só acrescenta: não muda status, conteúdo nem hash de nenhuma versão. Rascunho continua rascunho, base arquivada continua
-- arquivada e nenhuma versão passa a valer ou deixa de valer.

alter table knowledge_versions drop constraint knowledge_versions_status_check;
alter table knowledge_versions add constraint knowledge_versions_status_check
  check (status in ('DRAFT', 'APPROVED', 'PROCESSING', 'FAILED', 'SUPERSEDED', 'PUBLISHED', 'ARCHIVED'));

alter table knowledge_versions
  -- Configuração da versão (título, tipo, arquivo, alcance, assuntos, produtos). Nula = versão anterior a este registro: a
  -- configuração da época não foi guardada, e a comparação diz isso em vez de inventar.
  add column config jsonb,
  add column file_id uuid references knowledge_files(id) on delete set null,
  -- UNAVAILABLE = arquivo sem texto extraído nem digitado: a versão não pode ficar pronta e a comparação do conteúdo não é possível.
  add column text_status text not null default 'AVAILABLE' check (text_status in ('AVAILABLE', 'UNAVAILABLE')),
  add column origin text not null default 'EDIT' check (origin in ('MIGRATION', 'CREATE', 'EDIT', 'REVERT')),
  add column reverted_from_version_id uuid references knowledge_versions(id) on delete set null,
  add column change_summary text,
  add column created_by_name text,
  add column updated_at timestamptz,
  add column updated_by_name text,
  add column publish_requested_at timestamptz,
  add column publish_requested_by_name text,
  add column published_at timestamptz,
  add column published_by_name text,
  add column processing_attempts int not null default 0,
  add column processing_lease_until timestamptz,
  add column processing_finished_at timestamptz,
  add column processing_error_code text,
  add column processing_error_message text,
  add column chunk_count int,
  -- SUPERSEDED: NEWER_VERSION (uma versão mais nova ficou pronta antes) ou ARCHIVED (a base foi arquivada durante o processamento).
  add column superseded_reason text check (superseded_reason in ('NEWER_VERSION', 'ARCHIVED'));

create index knowledge_versions_processing_idx on knowledge_versions (processing_lease_until) where status = 'PROCESSING';

-- Versões já existentes: origem da migração, data de publicação conhecida e o arquivo (até aqui só havia um por base, enviado na criação).
update knowledge_versions v
   set origin = 'MIGRATION',
       published_at = case when v.status in ('PUBLISHED', 'ARCHIVED') then coalesce(v.effective_from, v.created_at) end,
       file_id = (select f.id from knowledge_files f where f.knowledge_document_id = v.document_id order by f.created_at desc limit 1);

-- A configuração de hoje é a da versão vigente e a do rascunho em cima dela: título, tipo e alcance valiam na hora, sem versão.
-- Versões mais antigas ficam sem configuração registrada (nunca se atribui a elas a configuração de hoje).
with live as (
  select distinct on (document_id) document_id, version from knowledge_versions
   where status in ('PUBLISHED', 'ARCHIVED') order by document_id, version desc
), latest as (
  select distinct on (document_id) document_id, id, version from knowledge_versions order by document_id, version desc
), targets as (
  select v.id, v.document_id from knowledge_versions v
    left join live on live.document_id = v.document_id
    join latest on latest.document_id = v.document_id
   where v.version = live.version or v.id = latest.id
)
update knowledge_versions v
   set config = jsonb_build_object(
     'title', d.title,
     'documentType', d.document_type,
     'sourceType', d.source_type,
     'file', case when f.id is null then null else jsonb_build_object('id', f.id, 'filename', d.original_filename, 'mimeType', d.mime_type, 'sizeBytes', d.file_size_bytes, 'checksum', f.checksum) end,
     'orgScopes', coalesce((select jsonb_agg(jsonb_build_object('scopeType', os.scope_type, 'teamId', os.team_id, 'subteamId', os.subteam_id) order by os.scope_type, os.team_id, os.subteam_id) from knowledge_document_org_scopes os where os.knowledge_document_id = d.id), '[]'::jsonb),
     'subjectScopes', coalesce((select jsonb_agg(jsonb_build_object('scopeType', ss.scope_type, 'subjectId', ss.subject_id) order by ss.scope_type, ss.subject_id) from knowledge_document_subject_scopes ss where ss.knowledge_document_id = d.id), '[]'::jsonb),
     'productNodeIds', coalesce((select to_jsonb(s.node_ids) from product_scope_assignments s where s.source_kind = 'KNOWLEDGE_DOCUMENT' and s.source_id = d.id and s.effective_until is null limit 1), '[]'::jsonb)
   )
  from targets t
  join knowledge_documents d on d.id = t.document_id
  left join lateral (select id, checksum from knowledge_files where knowledge_document_id = d.id order by created_at desc limit 1) f on true
 where v.id = t.id;

-- Conteúdo e configuração de uma versão que saiu do rascunho nunca mudam (PEN-008). Só a situação e os dados do processamento mudam.
-- O que chega por chave estrangeira (arquivo removido junto com a base) passa: a profundidade 1 é a da própria atualização direta.
create function knowledge_version_content_immutable() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if old.status not in ('DRAFT', 'APPROVED')
     and (new.content is distinct from old.content or new.content_hash is distinct from old.content_hash
       or new.config is distinct from old.config or new.file_id is distinct from old.file_id
       or new.text_status is distinct from old.text_status or new.version is distinct from old.version
       or new.document_id is distinct from old.document_id or new.organization_id is distinct from old.organization_id
       or new.origin is distinct from old.origin or new.reverted_from_version_id is distinct from old.reverted_from_version_id) then
    raise exception 'Versão de base de conhecimento publicada é imutável.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger knowledge_versions_content_immutable before update on knowledge_versions
  for each row execute function knowledge_version_content_immutable();

-- Quais versões cada consulta usou (PEN-008). Registro de rastreabilidade, como `ai_usage_events`: a origem é referência sem chave
-- estrangeira, para não prender a limpeza de conversas e execuções.
create table knowledge_version_usages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  version_id uuid not null references knowledge_versions(id) on delete cascade,
  version int not null,
  source_kind text not null check (source_kind in ('AGENT_RUN', 'CONVERSATION', 'WORKFLOW')),
  source_id uuid not null,
  agent_id uuid,
  agent_version_id uuid,
  created_at timestamptz not null default now(),
  unique (source_kind, source_id, version_id, agent_id)
);
create index knowledge_version_usages_version_idx on knowledge_version_usages (version_id, created_at desc);
create index knowledge_version_usages_source_idx on knowledge_version_usages (source_kind, source_id);
