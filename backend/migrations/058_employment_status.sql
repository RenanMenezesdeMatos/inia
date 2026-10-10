-- Situação funcional do colaborador (ATIVO / FÉRIAS / AFASTADO / INATIVO) com HISTÓRICO por
-- período — a INIA é CONSUMIDORA desse dado (vem da fonte de colaboradores), nunca um sistema
-- de RH: não solicita, aprova nem calcula férias.
--
-- Conceitos separados de propósito:
--   people.active                     → cadastro/conta ativos (login, população da plataforma);
--   people.current_employment_status  → situação funcional ATUAL (denormalizada do último período);
--   employee_status_periods           → a dimensão temporal: "qual era a situação no dia 10/09?".
--
-- Regras de domínio (código em modules/people/domain/employment-status.ts):
--   • dia sem período registrado = ATIVO presumido (nunca retroage sem evidência);
--   • ACTIVE elegível; VACATION/LEAVE/INACTIVE não elegíveis operacionalmente;
--   • effective_from vem da fonte quando informado; senão é a data LOCAL da observação
--     (effective_from_inferred = true — "situação conhecida a partir desta carga");
--   • observed_at = quando a INIA observou; source_updated_at = quando a fonte diz que mudou;
--   • períodos da mesma pessoa nunca se sobrepõem (exclusion constraint + validação no serviço).
-- Situação funcional NUNCA recalcula fechamento oficial (atingimento/quartil/peso/PRV).

create extension if not exists btree_gist;

alter table people
  add column if not exists current_employment_status text not null default 'ACTIVE';
alter table people
  drop constraint if exists people_current_employment_status_check;
alter table people
  add constraint people_current_employment_status_check
  check (current_employment_status in ('ACTIVE', 'VACATION', 'LEAVE', 'INACTIVE'));

create table if not exists employee_status_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  status text not null check (status in ('ACTIVE', 'VACATION', 'LEAVE', 'INACTIVE')),
  raw_status text,                                   -- como a fonte escreveu (FERIAS, FR, VACATION…), só auditoria
  effective_from date not null,
  effective_to date,                                 -- null = em aberto; inclusivo quando informado
  effective_from_inferred boolean not null default false,
  observed_at timestamptz not null default now(),    -- quando a INIA recebeu/observou
  source_updated_at timestamptz,                     -- quando a fonte diz que a situação mudou (se confiável)
  source text not null,                              -- DEMO_SEED | MANUAL | DATA_HUB | …
  source_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_status_periods_range_check check (effective_to is null or effective_to >= effective_from),
  constraint employee_status_periods_no_overlap exclude using gist (
    person_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
);
create index if not exists idx_employee_status_periods_person_from on employee_status_periods (person_id, effective_from);
create index if not exists idx_employee_status_periods_org_status on employee_status_periods (organization_id, status) where effective_to is null;
