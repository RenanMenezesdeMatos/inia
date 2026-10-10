-- CATÁLOGO-BASE DE FERIADOS (reference data com proveniência) + POLÍTICA de feriado no fallback.
--
--   holiday_catalog → feriados LEGAIS conhecidos: NATIONAL (todos), STATE (por UF) e MUNICIPAL_CAPITAL
--                     (por capital). Toda linha carrega fonte verificável (source_name/source_reference)
--                     e, quando existe, a base legal. Populado por `npm run db:seed:reference`
--                     (infrastructure/database/reference-data), NUNCA pela massa demo; feriado
--                     extraordinário de um ano tem só aquela data (não vira recorrente). Ponto
--                     facultativo NÃO entra: só feriado com base legal.
--   organization_holidays (063) continua como OVERLAY administrativo: datas próprias da operação —
--                     o admin não recadastra o Natal 27 vezes.
--   organizations.holiday_fallback_policy → IGNORE | EXCLUDE_APPLICABLE_HOLIDAYS. Só afeta quem está
--                     no FALLBACK seg–sex (sem escala explícita); escala explícita SEMPRE vence
--                     feriado (call center opera em feriado quando a escala diz que trabalha).
--                     Default IGNORE; organizações que já tinham feriado próprio ativo (o overlay da
--                     063 excluía no fallback) recebem EXCLUDE para não mudar elegibilidade em silêncio.
--   organizations.schedule_horizon_warning_days → aviso "calendário termina em N dias" (horizonte ≠ freshness).

create table if not exists holiday_catalog (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null,
  scope text not null check (scope in ('NATIONAL', 'STATE', 'MUNICIPAL_CAPITAL')),
  country_code char(2) not null default 'BR',
  state_code char(2),
  capital_code text references brazilian_capitals(code),
  source_name text not null,
  source_reference text not null,
  legal_reference text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holiday_catalog_scope_refs_check check (
    (scope = 'NATIONAL' and state_code is null and capital_code is null)
    or (scope = 'STATE' and state_code is not null and capital_code is null)
    or (scope = 'MUNICIPAL_CAPITAL' and capital_code is not null)
  )
);
-- Chave natural com NULL tratado como valor (índice por expressão: portável, sem "nulls not distinct").
create unique index if not exists holiday_catalog_natural_key
  on holiday_catalog (holiday_date, scope, country_code, coalesce(state_code, ''), coalesce(capital_code, ''), name);
create index if not exists idx_holiday_catalog_date on holiday_catalog (holiday_date) where active;
create index if not exists idx_holiday_catalog_state_date on holiday_catalog (state_code, holiday_date) where active and scope = 'STATE';
create index if not exists idx_holiday_catalog_capital_date on holiday_catalog (capital_code, holiday_date) where active and scope = 'MUNICIPAL_CAPITAL';

alter table organizations
  add column if not exists holiday_fallback_policy text not null default 'IGNORE';
alter table organizations
  drop constraint if exists organizations_holiday_fallback_policy_check;
alter table organizations
  add constraint organizations_holiday_fallback_policy_check
  check (holiday_fallback_policy in ('IGNORE', 'EXCLUDE_APPLICABLE_HOLIDAYS'));
alter table organizations
  add column if not exists schedule_horizon_warning_days integer not null default 7
  check (schedule_horizon_warning_days between 1 and 90);

-- Retrocompatibilidade: quem já tinha feriado próprio ATIVO dependia do overlay da 063 (excluía no
-- fallback). Preserva esse comportamento explicitamente em vez de mudá-lo em silêncio.
update organizations o set holiday_fallback_policy = 'EXCLUDE_APPLICABLE_HOLIDAYS'
 where o.holiday_fallback_policy = 'IGNORE'
   and exists (select 1 from organization_holidays h where h.organization_id = o.id and h.active);
