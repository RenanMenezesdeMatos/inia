-- Dados de performance de colaborador que VÊM DE FORA (base/fonte oficial de indicadores) — a
-- aplicação recebe, persiste e consulta, mas NUNCA calcula atingimento%, PRV consolidado ou
-- quartil. Granularidade mensal (reference_period 'YYYY-MM'), cadência real de PRV; source
-- documenta a proveniência (hoje só seed manual de teste, futuramente feed externo real).
create table employee_indicator_performance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  indicator_definition_id uuid not null references indicator_definitions(id),
  subteam_id uuid references subteams(id),
  reference_period text not null,
  value numeric not null,
  target_value numeric,
  achievement_percent numeric,
  weight_percent numeric,
  quartile text check (quartile in ('Q1', 'Q2', 'Q3', 'Q4')),
  source text not null default 'MANUAL_SEED',
  created_at timestamptz not null default now(),
  unique (organization_id, person_id, indicator_definition_id, reference_period)
);
create index idx_employee_indicator_performance_person on employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period desc);

-- Q1 = melhor quartil, Q4 = pior — sempre, independente do indicador ter "maior é melhor" ou
-- "menor é melhor". O dado já chega normalizado da fonte; a aplicação nunca infere quartil a
-- partir do valor bruto.
create table employee_prv_performance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  subteam_id uuid references subteams(id),
  reference_period text not null,
  achievement_percent numeric not null,
  quartile text not null check (quartile in ('Q1', 'Q2', 'Q3', 'Q4')),
  source text not null default 'MANUAL_SEED',
  created_at timestamptz not null default now(),
  unique (organization_id, person_id, reference_period)
);
create index idx_employee_prv_performance_person on employee_prv_performance (organization_id, person_id, reference_period desc);
