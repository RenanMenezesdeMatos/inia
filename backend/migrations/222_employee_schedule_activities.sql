-- ATIVIDADES ESCALADAS — horário de login, pausas e outras atividades previstas na escala de cada colaborador, por data (17/11/2026,
-- pedido do responsável: "colocar os dados de pausa como um contrato que o cliente precisa mandar na Central de Dados; precisamos do
-- horário de login e pausas"). Contrato WORK_SCHEDULE_ACTIVITIES (exemplo de origem: MIS_FAT_ATIVIDADE_ESCALADO). Ver
-- people/domain/schedule-activity.ts e docs/dev/memoria/experiencia-do-colaborador.md › "Minha jornada".
--
-- `activity_type` = como a INIA mostra (LOGGED_IN | BREAK | OTHER); `activity_name` = o nome da fonte, preservado. Horários HH:mm no
-- fuso da operação; fim menor ou igual ao início = a atividade termina no dia seguinte.
--
-- A carga de uma data traz o DIA INTEIRO da pessoa: a linha que ficou de fora de uma carga mais nova daquele dia (pausa remarcada)
-- é desativada (`active = false`, `superseded_at`), nunca apagada. `last_run_id` separa a carga atual das anteriores.
create table if not exists employee_schedule_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  schedule_date date not null,
  activity_type text not null check (activity_type in ('LOGGED_IN', 'BREAK', 'OTHER')),
  activity_name text not null check (char_length(activity_name) between 1 and 120),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  superseded_at timestamptz,
  source text not null,                       -- DEMO_SEED | namespace do feed da Central
  source_reference text,                      -- externalActivityId / chave do registro na fonte
  source_updated_at timestamptz,
  last_run_id text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time <> end_time),
  unique (person_id, schedule_date, start_time, activity_name)
);
create index if not exists idx_employee_schedule_activities_person_date on employee_schedule_activities (person_id, schedule_date) where active;
create index if not exists idx_employee_schedule_activities_org_date on employee_schedule_activities (organization_id, schedule_date);
