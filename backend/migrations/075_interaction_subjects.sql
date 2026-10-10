-- ASSUNTO CANÔNICO DE INTERAÇÃO (2026-09-18) — rawSubject × canonicalSubject.
--
-- `interactions.reason` continua sendo o assunto BRUTO, exatamente como a fonte cadastrou (ingestão,
-- Central de Dados, massa demo): nunca é reescrito, nunca é classificado por IA. Para COMPARAÇÃO
-- determinística (find_comparable_interactions, segment_indicator por assunto, analyze_peer_patterns)
-- existe um catálogo administrável por organização:
--   - `interaction_subject_definitions`: o assunto canônico (código estável + nome de exibição);
--   - `interaction_subject_aliases`: assunto bruto → canônico, UM alias por texto bruto (case/espaços
--     ignorados). Texto bruto que possa significar dois assuntos NÃO recebe alias — canônico = nulo,
--     e as Tools caem para igualdade exata do bruto. Nada aqui usa LLM.
-- Não há coluna na interação: o canônico é resolvido no join (o bruto é a única verdade persistida).
create table if not exists interaction_subject_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (length(btrim(name)) > 0),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);
comment on table interaction_subject_definitions is 'Assuntos canônicos de interação (por organização). Dimensão de comparação/segmentação — nunca diagnóstico causal.';

create table if not exists interaction_subject_aliases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  subject_definition_id uuid not null references interaction_subject_definitions(id) on delete cascade,
  raw_subject text not null check (length(btrim(raw_subject)) > 0),
  created_at timestamptz not null default now()
);
create unique index if not exists interaction_subject_aliases_raw_unique on interaction_subject_aliases (organization_id, lower(btrim(raw_subject)));
create index if not exists interaction_subject_aliases_definition_idx on interaction_subject_aliases (subject_definition_id);
comment on table interaction_subject_aliases is 'Assunto bruto (interactions.reason, texto exato ignorando caixa/espaços) → assunto canônico. Um bruto ambíguo não tem alias.';
