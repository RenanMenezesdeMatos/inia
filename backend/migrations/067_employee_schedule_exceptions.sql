-- EXCEÇÕES INDIVIDUAIS DE CALENDÁRIO — alterações excepcionais ao calendário programado.
--
-- A folga NORMAL do 6x1 NÃO é exceção: é `employee_schedule_days.scheduled_to_work = false`.
-- Banco de horas, day off e folga extraordinária são exceções: a escala original dizia "trabalha" e
-- uma decisão posterior tirou a pessoa da produção naquele dia. Preservamos os dois fatos — o
-- calendário programado E a exceção — em vez de fingir que a escala sempre disse folga.
--
-- O motor entende `effect` (nesta V1 só NON_WORKING); `code` explica o PORQUÊ (BANCO_HORAS | DAY_OFF |
-- FOLGA_EXTRAORDINARIA) e `raw_reason` preserva o texto da fonte. Precedência (people/domain/work-schedule.ts):
-- situação ≠ EM_PRODUCAO > exceção NON_WORKING > folga explícita > trabalha explícito > fallback.
-- `active = false` cancela a exceção sem apagar a linha (correção rastreável pela Central).

create table if not exists employee_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  exception_date date not null,
  code text not null check (code in ('BANCO_HORAS', 'DAY_OFF', 'FOLGA_EXTRAORDINARIA')),
  effect text not null default 'NON_WORKING' check (effect in ('NON_WORKING')),
  raw_reason text,
  active boolean not null default true,
  source text not null,                       -- DEMO_SEED | MANUAL | namespace do feed da Central
  source_reference text,                      -- externalExceptionId / chave do registro na fonte
  source_updated_at timestamptz,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, exception_date, code)
);
create index if not exists idx_employee_schedule_exceptions_org_date on employee_schedule_exceptions (organization_id, exception_date) where active;
