create type feedback_kind as enum ('INDICATOR', 'MONITORING');

alter table feedbacks
  add column feedback_kind feedback_kind not null default 'INDICATOR',
  add column strengths jsonb not null default '[]'::jsonb,
  add column improvement_points jsonb not null default '[]'::jsonb,
  add column best_practices jsonb not null default '[]'::jsonb,
  add column context_snapshot jsonb not null default '{}'::jsonb;

create table indicator_glossary (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  indicator_definition_id uuid not null references indicator_definitions(id),
  description text not null,
  interpretation text not null,
  good_practices text not null,
  feedback_guidance text not null,
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, indicator_definition_id, version)
);

create table monitoring_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  interaction_id uuid not null references interactions(id),
  operator_id uuid not null references people(id),
  score numeric check (score between 0 and 100),
  strengths jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  best_practices jsonb not null default '[]'::jsonb,
  knowledge_version_ids uuid[] not null default '{}',
  diagnostic_insight_ids uuid[] not null default '{}',
  status text not null check (status in ('PENDING', 'ANALYZED', 'REVIEWED')) default 'PENDING',
  created_at timestamptz not null default now()
);

create table development_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  operator_id uuid not null references people(id),
  case_id uuid references supervision_cases(id),
  title text not null,
  objective text not null,
  status text not null check (status in ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')) default 'DRAFT',
  owner_id uuid references people(id),
  starts_at date not null,
  due_at date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_at >= starts_at)
);

create table development_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  plan_id uuid not null references development_plans(id) on delete cascade,
  action_type text not null check (action_type in ('COACHING', 'TRAINING', 'CONTENT', 'RECYCLING', 'MONITORING')),
  description text not null,
  status text not null check (status in ('PENDING', 'IN_PROGRESS', 'COMPLETED')) default 'PENDING',
  due_at date not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table operator_diagnostics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  operator_id uuid not null references people(id),
  indicator_definition_id uuid references indicator_definitions(id),
  interaction_id uuid references interactions(id),
  diagnostic_type text not null check (diagnostic_type in ('INDICATOR', 'MONITORING')),
  summary text not null,
  root_cause text not null,
  confidence numeric not null check (confidence between 0 and 1),
  evidence_ids uuid[] not null default '{}',
  generated_at timestamptz not null default now()
);

insert into indicator_definitions (id, organization_id, code, name, unit, desired_direction) values
 ('00000000-0000-4000-8000-000000000300', '00000000-0000-4000-8000-000000000001', 'TMA', 'Tempo Médio de Atendimento', 'SECONDS', 'LOWER'),
 ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', 'NPS', 'Net Promoter Score', 'POINTS', 'HIGHER'),
 ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', 'QUALIDADE', 'Qualidade de monitoria', 'PERCENT', 'HIGHER');

insert into goals (organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from) values
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000300', 'TEAM', '00000000-0000-4000-8000-000000000020', 300, '2026-01-01'),
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000301', 'TEAM', '00000000-0000-4000-8000-000000000020', 70, '2026-01-01'),
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000302', 'TEAM', '00000000-0000-4000-8000-000000000020', 85, '2026-01-01');

insert into indicator_glossary (organization_id, indicator_definition_id, description, interpretation, good_practices, feedback_guidance) values
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000300', 'Tempo médio gasto nos atendimentos.', 'Deve ser analisado com qualidade e resolução; menor nem sempre significa melhor.', 'Objetividade, leitura rápida de cenário e fechamento claro.', 'Evitar cobrar velocidade sem apontar comportamento e evidência.'),
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000301', 'Percepção do cliente sobre a experiência.', 'Valores maiores indicam melhor recomendação.', 'Acolhimento, segurança, expectativa e responsabilidade pelo acompanhamento.', 'Relacionar a nota aos comportamentos observados na interação.'),
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000302', 'Aderência aos critérios de monitoria.', 'Valores maiores indicam maior conformidade e qualidade.', 'Seguir procedimentos e explicar os próximos passos.', 'Citar o critério, o trecho e o procedimento relacionado.');

insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source) values
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000300', 'PERSON', '00000000-0000-4000-8000-000000000030', 381, now() - interval '7 days', now(), 'demo'),
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000301', 'PERSON', '00000000-0000-4000-8000-000000000030', 56, now() - interval '7 days', now(), 'demo'),
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000302', 'PERSON', '00000000-0000-4000-8000-000000000030', 78, now() - interval '7 days', now(), 'demo');

insert into development_plans (id, organization_id, operator_id, case_id, title, objective, status, owner_id, starts_at, due_at) values
 ('00000000-0000-4000-8000-000000000400', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000100', 'Fechamento objetivo e seguro', 'Reduzir TMA preservando qualidade e clareza.', 'ACTIVE', '00000000-0000-4000-8000-000000000031', current_date, current_date + 14);

insert into development_actions (organization_id, plan_id, action_type, description, status, due_at) values
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000400', 'COACHING', 'Revisar dois atendimentos com a supervisão.', 'IN_PROGRESS', current_date + 3),
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000400', 'MONITORING', 'Aplicar checklist nas próximas cinco interações.', 'PENDING', current_date + 7);

create index idx_monitoring_operator on monitoring_evaluations (operator_id, created_at desc);
create index idx_plans_operator_status on development_plans (operator_id, status, due_at);
create index idx_diagnostics_operator on operator_diagnostics (operator_id, generated_at desc);
