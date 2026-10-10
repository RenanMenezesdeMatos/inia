-- Jornada prevista do colaborador (horário de entrada + carga horária), como entidade própria
-- com vigência — não colunas soltas em `people` — porque a jornada pode mudar ao longo do
-- tempo e precisa manter histórico (Trigger "Por agenda" relativo ao expediente).
-- Sem coluna de "dias de trabalho" nesta versão: a aplicação assume Segunda a Sexta como dias
-- úteis (limitação documentada, só vale pra massa de teste/dev — ver docs/workflow-engine-wiki.md).

create table employee_work_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  start_time time not null,
  work_minutes int not null check (work_minutes > 0),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create index idx_employee_work_shifts_person on employee_work_shifts (person_id, effective_from desc);
