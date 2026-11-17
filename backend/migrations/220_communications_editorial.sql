-- PUBLICAÇÕES — área editorial dos comunicados (17/11/2026). Ver docs/dev/memoria/experiencia-do-colaborador.md › "Publicações".
--
-- O comunicado deixa de nascer publicado: tem RASCUNHO, PUBLICAÇÃO imediata ou AGENDADA (published_at no futuro), período de
-- exibição (display_until), resumo, destaque, produto relacionado e ARQUIVAMENTO (sai de circulação sem ser excluído; volta pelo
-- "Desarquivar"). Retirar (deleted_at, 199/201) continua sendo a exclusão lógica.
--
-- Compatibilidade: todo comunicado existente vira status PUBLISHED, created_at = published_at, sem fim de exibição, sem resumo,
-- sem destaque — exatamente o comportamento de antes.
--
-- Público novo SEGMENT (só com `communications.publish_organization`): universo de atuação e/ou Grupos e/ou Subgrupos, avaliado
-- AO LER (a pessoa como está no cadastro agora — é o que vale para o chat responder "a regra de hoje"). TEAM continua gravado em
-- communication_recipients na publicação (ou no agendamento); ORGANIZATION continua sem linhas.

alter table communications drop constraint if exists communications_audience_check;
alter table communications add constraint communications_audience_check check (audience in ('TEAM', 'ORGANIZATION', 'SEGMENT'));

alter table communications
  add column if not exists status text not null default 'PUBLISHED',
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists summary text,
  add column if not exists featured boolean not null default false,
  add column if not exists display_until timestamptz,
  add column if not exists segment_universe text,
  add column if not exists segment_team_ids uuid[] not null default '{}',
  add column if not exists segment_subteam_ids uuid[] not null default '{}',
  add column if not exists product_node_id uuid references product_catalog_nodes_all(id),
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by_person_id uuid references people(id);

update communications set created_at = published_at where created_at is null;
alter table communications alter column created_at set default now();
alter table communications alter column created_at set not null;

alter table communications add constraint communications_status_check check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED'));
alter table communications add constraint communications_summary_check check (summary is null or char_length(summary) <= 280);
alter table communications add constraint communications_segment_universe_check check (segment_universe is null or segment_universe in ('B2B', 'B2C', 'B2X'));
alter table communications add constraint communications_segment_check check (
  audience <> 'SEGMENT' or segment_universe is not null or cardinality(segment_team_ids) > 0 or cardinality(segment_subteam_ids) > 0
);
alter table communications add constraint communications_archived_check check ((status = 'ARCHIVED') = (archived_at is not null));

-- Rascunho não tem instante de publicação e pode estar incompleto (sem texto ou categoria); publicado/arquivado continua exigindo tudo.
alter table communications alter column published_at drop not null;
alter table communications drop constraint if exists communications_content_html_check;
alter table communications drop constraint if exists communications_plain_text_check;
alter table communications drop constraint if exists communications_tags_check;
alter table communications add constraint communications_content_html_check check (octet_length(content_html) <= 2200000);
alter table communications add constraint communications_plain_text_check check (char_length(plain_text) <= 5000);
alter table communications add constraint communications_tags_check check (cardinality(tags) <= 3 and tags <@ array['Aviso', 'Processos', 'Campanha']::text[]);
alter table communications add constraint communications_complete_check check (
  status = 'DRAFT' or (published_at is not null and octet_length(content_html) >= 1 and char_length(plain_text) >= 1 and cardinality(tags) >= 1)
);
alter table communications add constraint communications_display_window_check check (display_until is null or published_at is null or display_until > published_at);

-- Área editorial: as publicações do autor, mais recentes primeiro (inclui rascunho e arquivado).
create index if not exists communications_author_editorial on communications (organization_id, author_person_id, coalesce(updated_at, created_at) desc) where deleted_at is null;
-- Ramo SEGMENT do feed e do chat (avaliado ao ler).
create index if not exists communications_segment_feed on communications (organization_id, published_at desc, id desc) where deleted_at is null and audience = 'SEGMENT' and status = 'PUBLISHED';

-- Versões guardadas passam a levar também os campos editoriais (null nas antigas).
alter table communication_revisions
  add column if not exists summary text,
  add column if not exists display_until timestamptz,
  add column if not exists featured boolean;
