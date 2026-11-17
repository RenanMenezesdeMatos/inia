-- ALINHAMENTOS OPERACIONAIS (17/11/2026). A operação muda antes da documentação oficial (PR, IT, demais bases): no intervalo, a gestão
-- publica uma orientação TEMPORÁRIA que passa a valer como procedimento para um público e um período. O conteúdo oficial nunca é
-- alterado: o alinhamento é uma SOBREPOSIÇÃO ao trecho conflitante do procedimento afetado; o resto do procedimento continua valendo.
-- Ver docs/dev/memoria/alinhamentos-operacionais.md.
--
-- Vigência em DATAS CIVIS no fuso da organização (gravado na versão): começa às 00:00 do início e termina no FIM do dia do término
-- (inclusivo). `effective_from`/`effective_until` (exclusivo) são o mesmo intervalo em instantes, calculados na publicação — é o que a
-- regra de aplicabilidade compara com a data de referência (data do atendimento na monitoria; agora no chat).
--
-- Versões imutáveis depois de publicadas. Alterar = nova versão (rascunho → publicar), que SUBSTITUI a anterior a partir do início
-- dela (a anterior fica valendo até lá, com o intervalo encurtado e guardado). Encerrar antes = o intervalo termina no momento do
-- encerramento (o que já passou continua coberto). Quem publicou, alterou ou encerrou fica na versão e em `audit_logs`.
-- A avaliação grava a versão usada (`call_assessments.operational_alignments`): uma avaliação histórica sempre aponta para a versão que
-- a sustentou.

create table if not exists operational_alignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  -- Exclusão sempre lógica e só sem versão publicada (rascunho descartado); publicado se encerra, nunca some.
  deleted_at timestamptz,
  deleted_by uuid references people(id)
);
create index if not exists operational_alignments_org on operational_alignments (organization_id, created_at desc) where deleted_at is null;

create table if not exists operational_alignment_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  alignment_id uuid not null references operational_alignments(id),
  version integer not null check (version >= 1),
  status text not null check (status in ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'CANCELLED')),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  -- A orientação que passa a valer (o que o operador deve fazer durante a vigência).
  guidance text not null check (char_length(btrim(guidance)) between 10 and 8000),
  -- Procedimento afetado (a base oficial que deixa de valer NO TRECHO conflitante) e o assunto/trecho afetado, em linguagem natural.
  affected_document_id uuid not null references knowledge_documents(id),
  affected_topic text not null check (char_length(btrim(affected_topic)) between 3 and 500),
  justification text not null check (char_length(btrim(justification)) between 10 and 4000),
  -- Público: universo SEMPRE (B2B/B2C/B2X são mundos separados) + recorte de Grupo ou Subgrupo (ou o universo inteiro) + produto opcional.
  operating_universe text not null check (operating_universe in ('B2B', 'B2C', 'B2X')),
  scope_type text not null check (scope_type in ('UNIVERSE', 'TEAM', 'SUBTEAM')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  product_id uuid references product_catalog_nodes_all(id),
  starts_on date not null,
  ends_on date not null,
  time_zone text not null,
  effective_from timestamptz not null,
  effective_until timestamptz not null,
  content_hash text not null,
  change_reason text check (change_reason is null or char_length(btrim(change_reason)) between 3 and 1000),
  created_by uuid not null references people(id),
  created_at timestamptz not null default now(),
  updated_by uuid references people(id),
  updated_at timestamptz,
  published_by uuid references people(id),
  published_at timestamptz,
  superseded_by_version_id uuid references operational_alignment_versions(id),
  superseded_at timestamptz,
  ended_by uuid references people(id),
  ended_at timestamptz,
  end_reason text check (end_reason is null or char_length(btrim(end_reason)) between 3 and 1000),
  unique (alignment_id, version),
  check (ends_on >= starts_on),
  check (effective_until >= effective_from),
  check (
    (scope_type = 'UNIVERSE' and team_id is null and subteam_id is null) or
    (scope_type = 'TEAM' and team_id is not null and subteam_id is null) or
    (scope_type = 'SUBTEAM' and team_id is not null and subteam_id is not null)
  ),
  check (status = 'DRAFT' or (published_by is not null and published_at is not null))
);
create unique index if not exists operational_alignment_versions_one_draft on operational_alignment_versions (alignment_id) where status = 'DRAFT';
create unique index if not exists operational_alignment_versions_one_published on operational_alignment_versions (alignment_id) where status = 'PUBLISHED';
-- Leitura do caminho quente (chat e monitoria): procedimento afetado + intervalo.
create index if not exists operational_alignment_versions_applicability on operational_alignment_versions (organization_id, affected_document_id, effective_from, effective_until)
  where status in ('PUBLISHED', 'SUPERSEDED');

-- Relação declarada NA PUBLICAÇÃO com outro alinhamento que alcança o mesmo público, o mesmo procedimento e o mesmo período:
--   SAME_TOPIC  = tratam do mesmo ponto → precedência pelo recorte mais específico (Subgrupo > Grupo > universo; com produto > sem);
--                 mesmo recorte = conflito sem precedência → a publicação é recusada;
--   INDEPENDENT = pontos diferentes do mesmo procedimento → os dois valem.
create table if not exists operational_alignment_relations (
  version_id uuid not null references operational_alignment_versions(id),
  other_alignment_id uuid not null references operational_alignments(id),
  organization_id uuid not null references organizations(id),
  relation text not null check (relation in ('SAME_TOPIC', 'INDEPENDENT')),
  decided_by uuid not null references people(id),
  decided_at timestamptz not null default now(),
  primary key (version_id, other_alignment_id)
);

-- Fotografia do que a avaliação usou: alinhamentos apresentados (id, versão, vigência, público) e as linhas oficiais superadas por eles.
alter table call_assessments add column if not exists operational_alignments jsonb not null default '[]'::jsonb;
