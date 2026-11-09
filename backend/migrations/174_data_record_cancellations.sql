-- CANCELAMENTO DE REGISTROS IMPORTADOS (Central de Dados › Consultar dados). O registro cancelado continua no banco, aparece como cancelado na consulta
-- e sai de toda a lógica. Ver docs/dev/central-de-dados-cancelamento-varredura.md.
--
-- A tabela passa a se chamar `<nome>_all` e o nome antigo vira uma visão que esconde os cancelados: quem lê não precisa lembrar de filtrar, nem hoje
-- nem no futuro. Quem precisa do cancelado usa `_all` de propósito: a carga (para reativar), a consulta e as telas de histórico.
-- Chaves, índices e gatilhos seguem na tabela. Coluna nova nestas tabelas: `alter table <nome>_all` e recriar a visão; a migration falha na hora se esquecer.

create table data_record_cancellations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  dataset text not null check (dataset ~ '^[a-z][a-z0-9_]{0,62}$'),
  reason text not null check (char_length(reason) between 10 and 500),
  row_count integer not null check (row_count > 0),
  -- Unidade e estratégia dos indicadores no momento do cancelamento. Se mudarem, reativar fica barrado: quem corrigiu o indicador precisa de uma carga nova.
  indicator_rules jsonb not null default '{}'::jsonb,
  cancelled_by_person_id uuid references people(id),
  cancelled_by_account_id uuid not null,
  created_at timestamptz not null default now(),
  reactivated_at timestamptz,
  reactivated_by_person_id uuid references people(id),
  reactivated_rows integer check (reactivated_rows is null or reactivated_rows >= 0)
);

create index idx_data_record_cancellations_dataset on data_record_cancellations (organization_id, dataset, created_at desc, id desc);

-- `not valid`: as colunas acabaram de nascer vazias, então não há o que conferir nas linhas antigas, e a tabela grande não é varrida. Linha nova é conferida.
alter table indicator_measurements add column cancelled_at timestamptz, add column cancellation_id uuid;
alter table indicator_measurements add constraint indicator_measurements_cancellation_fk foreign key (cancellation_id) references data_record_cancellations(id) not valid;
alter table indicator_measurements add constraint indicator_measurements_cancellation_check check ((cancelled_at is null) = (cancellation_id is null)) not valid;
alter table indicator_measurements rename to indicator_measurements_all;
create view indicator_measurements as
  select id, organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, created_at, granularity, numerator, denominator, sample_count
    from indicator_measurements_all where cancelled_at is null;
create index idx_indicator_measurements_cancellation on indicator_measurements_all (cancellation_id) where cancellation_id is not null;
create index idx_indicator_measurements_cancelled on indicator_measurements_all (organization_id, cancelled_at desc, id desc) where cancelled_at is not null;

alter table goals add column cancelled_at timestamptz, add column cancellation_id uuid;
alter table goals add constraint goals_cancellation_fk foreign key (cancellation_id) references data_record_cancellations(id) not valid;
alter table goals add constraint goals_cancellation_check check ((cancelled_at is null) = (cancellation_id is null)) not valid;
alter table goals rename to goals_all;
create view goals as
  select id, organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from, valid_until, created_at
    from goals_all where cancelled_at is null;
create index idx_goals_cancellation on goals_all (cancellation_id) where cancellation_id is not null;
create index idx_goals_cancelled on goals_all (organization_id, cancelled_at desc, id desc) where cancelled_at is not null;

alter table employee_indicator_performance add column cancelled_at timestamptz, add column cancellation_id uuid;
alter table employee_indicator_performance add constraint employee_indicator_performance_cancellation_fk foreign key (cancellation_id) references data_record_cancellations(id) not valid;
alter table employee_indicator_performance add constraint employee_indicator_performance_cancellation_check check ((cancelled_at is null) = (cancellation_id is null)) not valid;
alter table employee_indicator_performance rename to employee_indicator_performance_all;
create view employee_indicator_performance as
  select id, organization_id, person_id, indicator_definition_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, source, created_at, numerator, denominator
    from employee_indicator_performance_all where cancelled_at is null;
create index idx_employee_indicator_performance_cancellation on employee_indicator_performance_all (cancellation_id) where cancellation_id is not null;
create index idx_employee_indicator_performance_cancelled on employee_indicator_performance_all (organization_id, cancelled_at desc, id desc) where cancelled_at is not null;

alter table employee_prv_performance add column cancelled_at timestamptz, add column cancellation_id uuid;
alter table employee_prv_performance add constraint employee_prv_performance_cancellation_fk foreign key (cancellation_id) references data_record_cancellations(id) not valid;
alter table employee_prv_performance add constraint employee_prv_performance_cancellation_check check ((cancelled_at is null) = (cancellation_id is null)) not valid;
alter table employee_prv_performance rename to employee_prv_performance_all;
create view employee_prv_performance as
  select id, organization_id, person_id, subteam_id, reference_period, achievement_percent, quartile, source, created_at
    from employee_prv_performance_all where cancelled_at is null;
create index idx_employee_prv_performance_cancellation on employee_prv_performance_all (cancellation_id) where cancellation_id is not null;
create index idx_employee_prv_performance_cancelled on employee_prv_performance_all (organization_id, cancelled_at desc, id desc) where cancelled_at is not null;

-- Sem estatística da coluna nova, o planejador supõe muitos cancelados e varre o índice de ordenação: 508 ms contra 1 ms na cópia com 1,6 milhão de medições.
analyze indicator_measurements_all (cancelled_at, cancellation_id);
analyze goals_all (cancelled_at, cancellation_id);
analyze employee_indicator_performance_all (cancelled_at, cancellation_id);
analyze employee_prv_performance_all (cancelled_at, cancellation_id);

-- A prévia do cancelamento conta as evidências que apontam para o registro. A referência é por texto, sem chave estrangeira.
create index idx_evidences_source on evidences (organization_id, source_type, source_id);
