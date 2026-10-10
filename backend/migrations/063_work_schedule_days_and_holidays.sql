-- ESCALA REAL DE TRABALHO — "este colaborador estava programado para trabalhar nesta data?".
-- Regime (5x2 / 6x1) é metadata; a EVIDÊNCIA de elegibilidade é o calendário programado por dia.
--
--   employee_work_shifts.schedule_type   → regime vigente (FIVE_BY_TWO | SIX_BY_ONE), com a vigência
--                                          que a tabela já tem (effective_from/to) = histórico do regime;
--   employee_schedule_days               → calendário explícito: um registro por pessoa × data, com
--                                          scheduled_to_work TRUE (trabalha) ou FALSE (folga).
--                                          Ausência de linha NÃO é folga: é "fonte não informou".
--   organization_holidays                → catálogo administrativo pequeno de feriados; só atua como
--                                          overlay do fallback seg–sex (escala explícita vence feriado).
-- Regra final (indicators/application/operational-measurement-resolver.ts):
--   elegível = admitido ∧ situação EM_PRODUCAO ∧ escala diz que trabalha ∧ sem exclusão de calendário.

alter table employee_work_shifts
  add column if not exists schedule_type text;
alter table employee_work_shifts
  drop constraint if exists employee_work_shifts_schedule_type_check;
alter table employee_work_shifts
  add constraint employee_work_shifts_schedule_type_check
  check (schedule_type is null or schedule_type in ('FIVE_BY_TWO', 'SIX_BY_ONE'));

create table if not exists employee_schedule_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  schedule_date date not null,
  scheduled_to_work boolean not null,
  shift_start time,
  shift_end time,
  schedule_type text check (schedule_type is null or schedule_type in ('FIVE_BY_TWO', 'SIX_BY_ONE')),
  source text not null,                       -- DEMO_SEED | MANUAL | namespace do feed da Central
  source_reference text,                      -- externalScheduleId / chave do registro na fonte
  source_updated_at timestamptz,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, schedule_date)
);
create index if not exists idx_employee_schedule_days_org_date on employee_schedule_days (organization_id, schedule_date);

create table if not exists organization_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  holiday_date date not null,
  name text not null,
  scope text not null default 'ORGANIZATION',  -- ORGANIZATION | NATIONAL | STATE | CITY (informativo)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, holiday_date, name)
);
create index if not exists idx_organization_holidays_org_date on organization_holidays (organization_id, holiday_date) where active;
