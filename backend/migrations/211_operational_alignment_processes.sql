-- ALINHAMENTOS OPERACIONAIS (17/11/2026, revisão do mesmo dia): um alinhamento pode valer para VÁRIOS processos (bases de
-- procedimento — PR, IT, fluxos…); com mais de mil processos no cadastro, a escolha é por busca e inclusão, um a um ou em lote.
-- Os processos de cada versão ficam em `operational_alignment_version_documents` (mínimo 1, conferido no serviço) e entram na imagem da
-- versão publicada (imutável como o resto dela). `affected_document_id` (209) fica só como legado: copiado para a tabela nova e não
-- é mais lido nem gravado. Ver docs/dev/memoria/alinhamentos-operacionais.md.
create table if not exists operational_alignment_version_documents (
  version_id uuid not null references operational_alignment_versions(id),
  document_id uuid not null references knowledge_documents(id),
  organization_id uuid not null references organizations(id),
  primary key (version_id, document_id)
);
-- Caminho quente (chat e monitoria): versões que valem para as bases autorizadas ao agente.
create index if not exists operational_alignment_version_documents_document on operational_alignment_version_documents (organization_id, document_id, version_id);

insert into operational_alignment_version_documents (version_id, document_id, organization_id)
select id, affected_document_id, organization_id from operational_alignment_versions where affected_document_id is not null
on conflict do nothing;

alter table operational_alignment_versions alter column affected_document_id drop not null;
drop index if exists operational_alignment_versions_applicability;
create index if not exists operational_alignment_versions_in_force on operational_alignment_versions (organization_id, effective_from, effective_until)
  where status in ('PUBLISHED', 'SUPERSEDED');
