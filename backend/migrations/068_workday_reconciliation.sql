-- CALENDÁRIO OPERACIONAL — fechamento V1: PLANEJADO × OBSERVADO.
--
-- Até aqui a elegibilidade era só o PLANEJADO (situação funcional + escala + exceções + feriado). Esta
-- migration acrescenta o OBSERVADO — evidência confiável de que houve trabalho num dia — e o que
-- decorre disso: (1) quais indicadores podem PROVAR atividade (configuração, nunca código);
-- (2) exceções provisionadas pelo Supervisor, com origem e auditoria, na MESMA tabela da Central;
-- (3) o registro de reconciliação de um dia (produção ausente, produção em dia planejado como
-- não trabalhado, produção com situação não produtiva) que vira Pendência/aviso para o Supervisor.
-- Nada anterior é apagado: escala, exceção e medição continuam intactas; o estado do dia é DERIVADO.

-- 1) Evidência de produção por indicador: SÓ um indicador explicitamente marcado prova que houve
--    atividade (uma linha de Qualidade ou TMA atrasada não prova presença). Default false.
alter table indicator_definitions
  add column if not exists proves_work_activity boolean not null default false;

-- 2) Exceções: novos motivos (ATESTADO — só motivo operacional, nunca diagnóstico/CID; AJUSTE_ESCALA —
--    override operacional registrado pela resolução "Corrigir escala"), ORIGEM (Central × Supervisor ×
--    reconciliação do sistema) e auditoria de quem provisionou/cancelou. `source` continua sendo o
--    namespace do feed (Central) ou MANUAL (Supervisor); `origin` é a classificação de produto.
alter table employee_schedule_exceptions drop constraint if exists employee_schedule_exceptions_code_check;
alter table employee_schedule_exceptions
  add constraint employee_schedule_exceptions_code_check check (code in ('BANCO_HORAS', 'DAY_OFF', 'FOLGA_EXTRAORDINARIA', 'ATESTADO', 'AJUSTE_ESCALA'));

alter table employee_schedule_exceptions
  add column if not exists origin text not null default 'CENTRAL_DATA',
  add column if not exists created_by_person_id uuid references people(id),
  add column if not exists provision_group_id uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_person_id uuid references people(id),
  -- true quando um Supervisor cancelou/alterou uma exceção que veio da Central: a Central não a
  -- reativa em silêncio (o writer registra conflito auditável em vez de sobrescrever).
  add column if not exists manual_override boolean not null default false;

alter table employee_schedule_exceptions drop constraint if exists employee_schedule_exceptions_origin_check;
alter table employee_schedule_exceptions
  add constraint employee_schedule_exceptions_origin_check check (origin in ('CENTRAL_DATA', 'SUPERVISOR_MANUAL', 'SYSTEM_RECONCILIATION'));

update employee_schedule_exceptions set origin = 'SUPERVISOR_MANUAL' where source = 'MANUAL' and origin = 'CENTRAL_DATA';

create index if not exists idx_employee_schedule_exceptions_person_date on employee_schedule_exceptions (person_id, exception_date);

-- 3) Proveniência do catálogo de feriados: força da verificação de cada linha (OFFICIAL = ato/portal
--    oficial; LEGAL_DATABASE = base de legislação; SECONDARY = agregador/imprensa citando a lei).
--    Preenchida pelo seed de reference data (db:seed:reference / db:bootstrap); null = seed anterior.
alter table holiday_catalog
  add column if not exists verification text check (verification in ('OFFICIAL', 'LEGAL_DATABASE', 'SECONDARY'));

-- 4) Evidência de produção: interações por colaborador × dia (fonte preferencial de WorkActivityEvidence).
create index if not exists idx_interactions_operator_started on interactions (operator_id, started_at);

-- 5) RECONCILIAÇÃO DE UM DIA DE TRABALHO — fato auditável "plano × realidade" de uma pessoa numa data.
--    kind:
--      MISSING_EXPECTED_PRODUCTION   — EM_PRODUCAO, programado, sem exceção, turno encerrado, sem evidência → PENDÊNCIA (status OPEN)
--      PRODUCTION_ON_NON_WORKING_DAY — produção observada em dia planejado como folga/day off/banco/etc. → aviso (NOTED), não é erro
--      PRODUCTION_WITH_NON_ELIGIBLE_STATUS — produção observada com situação ≠ EM_PRODUCAO → inconsistência de dados (NOTED); NUNCA altera a situação
--    resolution (só MISSING_EXPECTED_PRODUCTION): NOT_WORKED (cria exceção auditável) | WORKED_DATA_MISSING (dia
--    continua esperado; nada é inventado) | SCHEDULE_CORRECTED (override AJUSTE_ESCALA) | PRODUCTION_RECEIVED_AFTER_ALERT
--    (automática: a carga atrasada chegou) | PLAN_UPDATED_AFTER_ALERT (automática: exceção/escala/situação passou a dizer
--    que a pessoa não deveria produzir naquele dia — ex.: Supervisor provisionou pelo Calendário depois do alerta).
--    Uma linha por pessoa × data × kind (idempotência do job). O alerta (sino) aponta para esta linha.
create table if not exists workday_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  workday date not null,
  kind text not null check (kind in ('MISSING_EXPECTED_PRODUCTION', 'PRODUCTION_ON_NON_WORKING_DAY', 'PRODUCTION_WITH_NON_ELIGIBLE_STATUS')),
  status text not null check (status in ('OPEN', 'NOTED', 'RESOLVED')),
  -- Retrato do que o sistema sabia ao detectar: base da escala, exceção, situação, fontes de evidência.
  snapshot jsonb not null default '{}'::jsonb,
  recipient_person_id uuid references people(id),
  alert_id uuid references alerts(id),
  resolution text check (resolution is null or resolution in ('NOT_WORKED', 'WORKED_DATA_MISSING', 'SCHEDULE_CORRECTED', 'PRODUCTION_RECEIVED_AFTER_ALERT', 'PLAN_UPDATED_AFTER_ALERT')),
  resolution_exception_id uuid references employee_schedule_exceptions(id),
  resolved_by_person_id uuid references people(id),
  resolved_at timestamptz,
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, workday, kind)
);
create index if not exists idx_workday_reconciliations_recipient_open on workday_reconciliations (recipient_person_id, status) where status = 'OPEN';
create index if not exists idx_workday_reconciliations_org_workday on workday_reconciliations (organization_id, workday);
