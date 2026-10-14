-- READ MODEL OPERACIONAL DO ANALYTICS DA LIDERANÇA — docs/dev/escala-read-model-e-ciclo-de-vida.md (A4).
--
-- Aditiva. O resumo operacional da estrutura (Indicadores › estrutura) resolvia, a cada clique, a elegibilidade de cada
-- pessoa × dia e agregava as medições diárias brutas de todos os membros, indicador por indicador. Aqui ficam, por pessoa ×
-- comparação da tela × fase (atual/anterior), os COMPONENTES BRUTOS que o resolvedor único já calcula (as mesmas colunas de
-- `aggregateColumns`, numéricos em `numeric`) e os fatos de elegibilidade da janela. A leitura aplica as mesmas funções de
-- hoje (`finishWindow`, `combineWindowComponents`) — o read model decide o custo, nunca o número.
--
-- Atualização incremental e idempotente: triggers por statement gravam no log `analytics_operational_dirty` (só inserção;
-- quem escreve nunca espera) a pessoa cujo cálculo pode ter mudado; a tarefa `analytics-rollup` recalcula da fonte e apaga
-- exatamente as marcas que leu. Marca sem pessoa = organização inteira (feriados, política, fuso, catálogo de indicadores).
-- Depois da meia-noite local tudo é refeito para o novo dia. Quem lê confere as datas da janela, as marcas e `valid_until`:
-- pessoa pendente passa pelo caminho original naquele mesmo snapshot.

create table analytics_rollup_state (
  organization_id uuid primary key references organizations(id) on delete cascade,
  as_of_date date,
  time_zone text,
  generation bigint not null default 0,
  full_build_started_at timestamptz,
  full_build_finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create table analytics_member_window (
  organization_id uuid not null,
  person_id uuid not null,
  comparison text not null,
  phase text not null check (phase in ('CURRENT', 'PREVIOUS')),
  first_date date not null,
  last_date date not null,
  eligible_days integer not null,
  unjustified_absence_days integer not null,
  -- Janela atual termina em "agora": a primeira medição da pessoa que começa depois do cálculo (ainda hoje) invalida a linha.
  valid_until timestamptz,
  built_at timestamptz not null,
  primary key (organization_id, person_id, comparison, phase)
);

create table analytics_member_window_indicator (
  organization_id uuid not null,
  person_id uuid not null,
  comparison text not null,
  phase text not null check (phase in ('CURRENT', 'PREVIOUS')),
  indicator_code text not null,
  avg_value numeric,
  min_value numeric,
  max_value numeric,
  sample_count integer not null,
  sum_value numeric,
  latest_value numeric,
  latest_period_end timestamptz,
  latest_id uuid,
  weighted_sum numeric,
  weight_total numeric,
  numerator_sum numeric,
  denominator_sum numeric,
  rows_with_components integer not null,
  sample_total integer,
  days_with_data integer not null,
  ignored_count integer not null,
  absence_days_with_data integer not null,
  primary key (organization_id, person_id, comparison, phase, indicator_code)
);

create table analytics_operational_dirty (
  id bigserial primary key,
  organization_id uuid not null,
  -- null = a organização inteira
  person_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);
create index idx_analytics_operational_dirty_org on analytics_operational_dirty (organization_id, person_id);

-- Marca as pessoas (organization_id, person_id) das linhas tocadas. TG_ARGV[0] = motivo.
create function analytics_mark_people_dirty() returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
    insert into analytics_operational_dirty (organization_id, person_id, reason) select distinct organization_id, person_id, TG_ARGV[0] from new_rows where person_id is not null;
  end if;
  if TG_OP = 'DELETE' or TG_OP = 'UPDATE' then
    insert into analytics_operational_dirty (organization_id, person_id, reason) select distinct organization_id, person_id, TG_ARGV[0] from old_rows where person_id is not null;
  end if;
  return null;
end $$;

-- Medições: só as de pessoa.
create function analytics_mark_measurements_dirty() returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
    insert into analytics_operational_dirty (organization_id, person_id, reason) select distinct organization_id, subject_id, 'MEASUREMENT' from new_rows where subject_type = 'PERSON';
  end if;
  if TG_OP = 'DELETE' or TG_OP = 'UPDATE' then
    insert into analytics_operational_dirty (organization_id, person_id, reason) select distinct organization_id, subject_id, 'MEASUREMENT' from old_rows where subject_type = 'PERSON';
  end if;
  return null;
end $$;

-- Organização inteira (TG_ARGV[0] = motivo). Tabela sem organização (catálogo de feriados) = todas.
create function analytics_mark_organization_dirty() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME = 'holiday_catalog' then
    insert into analytics_operational_dirty (organization_id, person_id, reason) select id, null, TG_ARGV[0] from organizations;
  elsif TG_TABLE_NAME = 'organizations' then
    insert into analytics_operational_dirty (organization_id, person_id, reason)
    select n.id, null, TG_ARGV[0] from new_rows n join old_rows o on o.id = n.id where n.holiday_fallback_policy is distinct from o.holiday_fallback_policy;
  elsif TG_OP = 'DELETE' then
    insert into analytics_operational_dirty (organization_id, person_id, reason) select distinct organization_id, null::uuid, TG_ARGV[0] from old_rows;
  else
    insert into analytics_operational_dirty (organization_id, person_id, reason) select distinct organization_id, null::uuid, TG_ARGV[0] from new_rows;
    if TG_OP = 'UPDATE' then
      insert into analytics_operational_dirty (organization_id, person_id, reason) select distinct organization_id, null::uuid, TG_ARGV[0] from old_rows;
    end if;
  end if;
  return null;
end $$;

-- Pessoas: admissão e capital operacional (feriados) entram na elegibilidade; cargo/vínculo/atividade só mudam QUEM é
-- membro, o que a leitura resolve na hora (escopo).
create function analytics_mark_people_profile_dirty() returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    insert into analytics_operational_dirty (organization_id, person_id, reason) select organization_id, id, 'PERSON' from new_rows;
  else
    insert into analytics_operational_dirty (organization_id, person_id, reason)
    select n.organization_id, n.id, 'PERSON' from new_rows n join old_rows o on o.id = n.id
     where (n.hired_at, n.operational_capital_code, n.organization_id) is distinct from (o.hired_at, o.operational_capital_code, o.organization_id);
  end if;
  return null;
end $$;

-- Atividade diária: só quando a pessoa passa a ter (ou deixa de ter) interação no dia — a evidência é booleana.
create function analytics_mark_activity_dirty() returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    insert into analytics_operational_dirty (organization_id, person_id, reason) select distinct organization_id, person_id, 'ACTIVITY' from new_rows;
  else
    insert into analytics_operational_dirty (organization_id, person_id, reason) select distinct organization_id, person_id, 'ACTIVITY' from old_rows;
  end if;
  return null;
end $$;

create trigger indicator_measurements_analytics_dirty_insert after insert on indicator_measurements referencing new table as new_rows for each statement execute function analytics_mark_measurements_dirty();
create trigger indicator_measurements_analytics_dirty_update after update on indicator_measurements referencing old table as old_rows new table as new_rows for each statement execute function analytics_mark_measurements_dirty();
create trigger indicator_measurements_analytics_dirty_delete after delete on indicator_measurements referencing old table as old_rows for each statement execute function analytics_mark_measurements_dirty();

create trigger person_daily_activity_analytics_dirty_insert after insert on person_daily_activity referencing new table as new_rows for each statement execute function analytics_mark_activity_dirty();
create trigger person_daily_activity_analytics_dirty_delete after delete on person_daily_activity referencing old table as old_rows for each statement execute function analytics_mark_activity_dirty();

create trigger people_analytics_dirty_insert after insert on people referencing new table as new_rows for each statement execute function analytics_mark_people_profile_dirty();
create trigger people_analytics_dirty_update after update on people referencing old table as old_rows new table as new_rows for each statement execute function analytics_mark_people_profile_dirty();

create trigger employee_status_periods_analytics_dirty_insert after insert on employee_status_periods referencing new table as new_rows for each statement execute function analytics_mark_people_dirty('EMPLOYMENT_STATUS');
create trigger employee_status_periods_analytics_dirty_update after update on employee_status_periods referencing old table as old_rows new table as new_rows for each statement execute function analytics_mark_people_dirty('EMPLOYMENT_STATUS');
create trigger employee_status_periods_analytics_dirty_delete after delete on employee_status_periods referencing old table as old_rows for each statement execute function analytics_mark_people_dirty('EMPLOYMENT_STATUS');

create trigger employee_schedule_days_analytics_dirty_insert after insert on employee_schedule_days referencing new table as new_rows for each statement execute function analytics_mark_people_dirty('SCHEDULE');
create trigger employee_schedule_days_analytics_dirty_update after update on employee_schedule_days referencing old table as old_rows new table as new_rows for each statement execute function analytics_mark_people_dirty('SCHEDULE');
create trigger employee_schedule_days_analytics_dirty_delete after delete on employee_schedule_days referencing old table as old_rows for each statement execute function analytics_mark_people_dirty('SCHEDULE');

create trigger employee_work_shifts_analytics_dirty_insert after insert on employee_work_shifts referencing new table as new_rows for each statement execute function analytics_mark_people_dirty('SCHEDULE_REGIME');
create trigger employee_work_shifts_analytics_dirty_update after update on employee_work_shifts referencing old table as old_rows new table as new_rows for each statement execute function analytics_mark_people_dirty('SCHEDULE_REGIME');
create trigger employee_work_shifts_analytics_dirty_delete after delete on employee_work_shifts referencing old table as old_rows for each statement execute function analytics_mark_people_dirty('SCHEDULE_REGIME');

create trigger employee_schedule_exceptions_analytics_dirty_insert after insert on employee_schedule_exceptions referencing new table as new_rows for each statement execute function analytics_mark_people_dirty('SCHEDULE_EXCEPTION');
create trigger employee_schedule_exceptions_analytics_dirty_update after update on employee_schedule_exceptions referencing old table as old_rows new table as new_rows for each statement execute function analytics_mark_people_dirty('SCHEDULE_EXCEPTION');
create trigger employee_schedule_exceptions_analytics_dirty_delete after delete on employee_schedule_exceptions referencing old table as old_rows for each statement execute function analytics_mark_people_dirty('SCHEDULE_EXCEPTION');

create trigger workday_classifications_analytics_dirty_insert after insert on workday_classifications referencing new table as new_rows for each statement execute function analytics_mark_people_dirty('WORKDAY_CLASSIFICATION');
create trigger workday_classifications_analytics_dirty_update after update on workday_classifications referencing old table as old_rows new table as new_rows for each statement execute function analytics_mark_people_dirty('WORKDAY_CLASSIFICATION');
create trigger workday_classifications_analytics_dirty_delete after delete on workday_classifications referencing old table as old_rows for each statement execute function analytics_mark_people_dirty('WORKDAY_CLASSIFICATION');

create trigger organization_holidays_analytics_dirty_insert after insert on organization_holidays referencing new table as new_rows for each statement execute function analytics_mark_organization_dirty('HOLIDAYS');
create trigger organization_holidays_analytics_dirty_update after update on organization_holidays referencing old table as old_rows new table as new_rows for each statement execute function analytics_mark_organization_dirty('HOLIDAYS');
create trigger organization_holidays_analytics_dirty_delete after delete on organization_holidays referencing old table as old_rows for each statement execute function analytics_mark_organization_dirty('HOLIDAYS');

create trigger holiday_catalog_analytics_dirty after insert or update or delete on holiday_catalog for each statement execute function analytics_mark_organization_dirty('HOLIDAY_CATALOG');

create trigger organizations_analytics_dirty_update after update on organizations referencing old table as old_rows new table as new_rows for each statement execute function analytics_mark_organization_dirty('HOLIDAY_POLICY');

create trigger operations_analytics_dirty_insert after insert on operations referencing new table as new_rows for each statement execute function analytics_mark_organization_dirty('TIMEZONE');
create trigger operations_analytics_dirty_update after update on operations referencing old table as old_rows new table as new_rows for each statement execute function analytics_mark_organization_dirty('TIMEZONE');
create trigger operations_analytics_dirty_delete after delete on operations referencing old table as old_rows for each statement execute function analytics_mark_organization_dirty('TIMEZONE');

create trigger indicator_definitions_analytics_dirty_insert after insert on indicator_definitions referencing new table as new_rows for each statement execute function analytics_mark_organization_dirty('INDICATOR_CATALOG');
create trigger indicator_definitions_analytics_dirty_update after update on indicator_definitions referencing old table as old_rows new table as new_rows for each statement execute function analytics_mark_organization_dirty('INDICATOR_CATALOG');
create trigger indicator_definitions_analytics_dirty_delete after delete on indicator_definitions referencing old table as old_rows for each statement execute function analytics_mark_organization_dirty('INDICATOR_CATALOG');

-- TRUNCATE de medições ou interações: organização inteira, todas.
create function analytics_mark_all_organizations_dirty() returns trigger language plpgsql as $$
begin
  insert into analytics_operational_dirty (organization_id, person_id, reason) select id, null, TG_ARGV[0] from organizations;
  return null;
end $$;
create trigger indicator_measurements_analytics_dirty_truncate after truncate on indicator_measurements for each statement execute function analytics_mark_all_organizations_dirty('MEASUREMENT');
create trigger person_daily_activity_analytics_dirty_truncate after truncate on person_daily_activity for each statement execute function analytics_mark_all_organizations_dirty('ACTIVITY');
