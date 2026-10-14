-- RESUMO DIÁRIO DE USO E CUSTO DE IA — docs/dev/escala-read-model-e-ciclo-de-vida.md (parte B).
--
-- Aditiva. O gasto do mês (ai-runtime-store.ts `loadMonthSpend`, base dos orçamentos) somava o MÊS INTEIRO de
-- `ai_usage_events` a cada vencimento do cache de 15 s — e, com orçamento de bloqueio, quase a cada chamada de IA. Aqui fica
-- a mesma soma por organização × data local (fuso da organização, o mesmo ORG_TIMEZONE_SQL) × Use Case × provider × moeda,
-- mantida por trigger por statement na MESMA transação de cada evento: o mês corrente vira a soma de até 31 linhas.
-- `ai_usage_events` só recebe insert; UPDATE aplica a diferença. DELETE (retenção futura do bruto) NÃO mexe no resumo: ele
-- é o agregado permanente do uso. Mudar o fuso da operação remonta o resumo a partir do bruto que existir.
create table ai_usage_daily (
  organization_id uuid not null references organizations(id) on delete cascade,
  local_date date not null,
  use_case text not null,
  provider_key text not null,
  currency char(3),
  -- soma de `cost` (null quando nenhum evento do dia teve custo — como o `sum()` do bruto)
  cost_sum numeric(24, 12),
  event_count integer not null,
  unknown_success_count integer not null,
  constraint ai_usage_daily_key unique nulls not distinct (organization_id, local_date, use_case, provider_key, currency)
);

create table ai_usage_daily_state (
  organization_id uuid primary key references organizations(id) on delete cascade,
  time_zone text not null,
  rebuilt_at timestamptz not null default now()
);

create function ai_usage_daily_apply(p_rows jsonb) returns void language sql as $$
  insert into ai_usage_daily as a (organization_id, local_date, use_case, provider_key, currency, cost_sum, event_count, unknown_success_count)
  select r.organization_id, r.local_date, r.use_case, r.provider_key, r.currency, r.cost_sum, r.event_count, r.unknown_success_count
    from jsonb_to_recordset(p_rows) r(organization_id uuid, local_date date, use_case text, provider_key text, currency char(3), cost_sum numeric, event_count integer, unknown_success_count integer)
   where exists (select 1 from organizations o where o.id = r.organization_id)
   order by r.organization_id, r.local_date, r.use_case, r.provider_key, r.currency
  on conflict on constraint ai_usage_daily_key do update set
    cost_sum = case when a.cost_sum is null then excluded.cost_sum when excluded.cost_sum is null then a.cost_sum else a.cost_sum + excluded.cost_sum end,
    event_count = a.event_count + excluded.event_count,
    unknown_success_count = a.unknown_success_count + excluded.unknown_success_count
$$;

create function ai_usage_daily_trigger() returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    perform ai_usage_daily_apply(coalesce((
      select jsonb_agg(g) from (
        select organization_id, (occurred_at at time zone analytics_org_timezone(organization_id))::date local_date, use_case, provider_key, currency,
               sum(cost) cost_sum, count(*)::int event_count, (count(*) filter (where cost_status = 'UNKNOWN' and status = 'SUCCESS'))::int unknown_success_count
          from new_rows where organization_id is not null group by 1, 2, 3, 4, 5) g), '[]'::jsonb));
    perform ai_usage_daily_ensure_state(array(select distinct organization_id from new_rows where organization_id is not null));
  else
    -- UPDATE: tira o antigo e põe o novo (custo com sinal; contagens com sinal).
    perform ai_usage_daily_apply(coalesce((
      select jsonb_agg(g) from (
        select organization_id, local_date, use_case, provider_key, currency, sum(cost) cost_sum, sum(n)::int event_count, sum(u)::int unknown_success_count
          from (
            select organization_id, (occurred_at at time zone analytics_org_timezone(organization_id))::date local_date, use_case, provider_key, currency, cost, 1 n, case when cost_status = 'UNKNOWN' and status = 'SUCCESS' then 1 else 0 end u from new_rows where organization_id is not null
            union all
            select organization_id, (occurred_at at time zone analytics_org_timezone(organization_id))::date, use_case, provider_key, currency, -cost, -1, case when cost_status = 'UNKNOWN' and status = 'SUCCESS' then -1 else 0 end from old_rows where organization_id is not null
          ) d group by 1, 2, 3, 4, 5) g), '[]'::jsonb));
  end if;
  return null;
end $$;

create function ai_usage_daily_ensure_state(p_organization_ids uuid[]) returns void language sql as $$
  insert into ai_usage_daily_state (organization_id, time_zone)
  select o.id, analytics_org_timezone(o.id) from organizations o where o.id = any(p_organization_ids)
  on conflict (organization_id) do nothing
$$;

create trigger ai_usage_events_daily_insert after insert on ai_usage_events referencing new table as new_rows for each statement execute function ai_usage_daily_trigger();
create trigger ai_usage_events_daily_update after update on ai_usage_events referencing old table as old_rows new table as new_rows for each statement execute function ai_usage_daily_trigger();

-- Remonta a organização a partir do bruto existente (fuso atual).
create function ai_usage_daily_rebuild(p_organization_id uuid) returns void language plpgsql as $$
declare
  v_time_zone text := analytics_org_timezone(p_organization_id);
begin
  delete from ai_usage_daily where organization_id = p_organization_id;
  insert into ai_usage_daily (organization_id, local_date, use_case, provider_key, currency, cost_sum, event_count, unknown_success_count)
  select organization_id, (occurred_at at time zone v_time_zone)::date, use_case, provider_key, currency, sum(cost), count(*)::int, (count(*) filter (where cost_status = 'UNKNOWN' and status = 'SUCCESS'))::int
    from ai_usage_events where organization_id = p_organization_id
   group by 1, 2, 3, 4, 5;
  insert into ai_usage_daily_state (organization_id, time_zone, rebuilt_at) values (p_organization_id, v_time_zone, now())
  on conflict (organization_id) do update set time_zone = excluded.time_zone, rebuilt_at = excluded.rebuilt_at;
end $$;

create function ai_usage_daily_operations_trigger() returns trigger language plpgsql as $$
declare
  v_organization_id uuid;
begin
  for v_organization_id in select s.organization_id from ai_usage_daily_state s where s.time_zone is distinct from analytics_org_timezone(s.organization_id) loop
    perform ai_usage_daily_rebuild(v_organization_id);
  end loop;
  return null;
end $$;
create trigger operations_ai_usage_daily_timezone after insert or update or delete on operations for each statement execute function ai_usage_daily_operations_trigger();

select ai_usage_daily_rebuild(o.id) from organizations o;
