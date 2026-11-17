-- ALINHAMENTOS OPERACIONAIS — MOTIVOS (17/11/2026, pedido do usuário para os Indicadores de sucesso).
--
-- 1. Motivo do ALINHAMENTO (por que a operação mudou antes da base): catálogo da organização, administrável (nome, ativo, ordem), com uma
--    lista inicial. Cada versão do alinhamento aponta para um motivo (obrigatório no cadastro novo; a coluna aceita nulo só para o que já
--    existia antes desta migration).
-- 2. Motivo do PEDIDO DO CLIENTE: o catálogo de assuntos canônicos que a monitoria já usa (`interaction_subject_definitions`) — 0..N por
--    versão. Não é uma lista nova: é o mesmo assunto com que as chamadas são classificadas.
-- Ver docs/dev/memoria/alinhamentos-operacionais.md.

create table if not exists operational_alignment_reasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  active boolean not null default true,
  position integer not null default 0,
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_by uuid references people(id),
  updated_at timestamptz
);
create unique index if not exists operational_alignment_reasons_name on operational_alignment_reasons (organization_id, lower(btrim(name)));

insert into operational_alignment_reasons (organization_id, name, position)
select o.id, r.name, r.position
from organizations o
cross join (values ('Processo em alteração', 1), ('Processo desatualizado', 2), ('Contingência', 3), ('Falha de sistema', 4), ('Mudança regulatória', 5), ('Ação comercial ou campanha', 6), ('Outro', 99)) as r(name, position)
on conflict do nothing;

alter table operational_alignment_versions add column if not exists reason_id uuid references operational_alignment_reasons(id);

create table if not exists operational_alignment_version_subjects (
  version_id uuid not null references operational_alignment_versions(id),
  subject_id uuid not null references interaction_subject_definitions(id),
  organization_id uuid not null references organizations(id),
  primary key (version_id, subject_id)
);
create index if not exists operational_alignment_version_subjects_subject on operational_alignment_version_subjects (organization_id, subject_id);
