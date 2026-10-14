-- ATIVIDADE DIÁRIA POR PESSOA — docs/dev/escala-read-model-e-ciclo-de-vida.md (A3).
--
-- Aditiva. A evidência de trabalho (people/domain/work-activity-evidence.ts) contava as interações BRUTAS de cada pessoa
-- por dia a cada resolução de dias de trabalho (~60 linhas por pessoa por dia; o trimestre de um diretor com 4.000 pessoas
-- seriam ~24 milhões de linhas por clique). Esta tabela guarda a mesma contagem — interações por operador × data local no
-- fuso da organização (o mesmo de resolveOrganizationTimezone: operations.timezone da operação mais antiga, ou
-- America/Fortaleza) — mantida por trigger por statement em `interactions`, NA MESMA TRANSAÇÃO da escrita: nunca atrasa e
-- nunca diverge da contagem bruta. Linhas que chegam a zero são apagadas. As linhas são aplicadas em ordem de
-- (pessoa, data) para que dois lotes concorrentes nunca travem um ao outro em ordem cruzada.
--
-- `person_daily_activity_state` guarda o fuso com que as linhas da organização foram montadas; mudar o fuso da operação
-- remonta a organização inteira (ação administrativa rara). Quem lê com outro fuso cai na contagem bruta.
create function analytics_org_timezone(p_organization_id uuid) returns text language sql stable as $$
  select coalesce((select timezone from operations where organization_id = p_organization_id order by created_at limit 1), 'America/Fortaleza')
$$;

create table person_daily_activity (
  person_id uuid not null,
  local_date date not null,
  organization_id uuid not null,
  interaction_count integer not null check (interaction_count > 0),
  primary key (person_id, local_date)
);

create index idx_person_daily_activity_org on person_daily_activity (organization_id, local_date);

create table person_daily_activity_state (
  organization_id uuid primary key references organizations(id) on delete cascade,
  time_zone text not null,
  rebuilt_at timestamptz not null default now()
);

-- Aplica variações (+/-) de contagem. Devolve as chaves que NASCERAM (0 → >0) ou MORRERAM (>0 → 0) — a única mudança que
-- altera "houve trabalho observado no dia" (a evidência é booleana para a elegibilidade).
create function person_daily_activity_apply(p_person_ids uuid[], p_dates date[], p_organization_ids uuid[], p_deltas integer[])
returns table (person_id uuid, local_date date, organization_id uuid, flipped boolean) language plpgsql as $$
#variable_conflict use_column
begin
  return query
  with delta as (
    select d.person_id, d.local_date, min(d.organization_id::text)::uuid organization_id, sum(d.delta)::integer delta
      from unnest(p_person_ids, p_dates, p_organization_ids, p_deltas) d(person_id, local_date, organization_id, delta)
     group by d.person_id, d.local_date
    having sum(d.delta) <> 0
  ),
  upserted as (
    insert into person_daily_activity as a (person_id, local_date, organization_id, interaction_count)
    select d.person_id, d.local_date, d.organization_id, d.delta from delta d where d.delta > 0
     order by d.person_id, d.local_date
    on conflict on constraint person_daily_activity_pkey do update set interaction_count = a.interaction_count + excluded.interaction_count
    returning a.person_id, a.local_date, a.organization_id, (a.xmax = 0) inserted
  ),
  decremented as (
    update person_daily_activity a set interaction_count = a.interaction_count + d.delta
      from (select x.* from delta x where x.delta < 0 order by x.person_id, x.local_date) d
     where a.person_id = d.person_id and a.local_date = d.local_date and a.interaction_count + d.delta > 0
    returning a.person_id, a.local_date, a.organization_id
  ),
  removed as (
    delete from person_daily_activity a using delta d
     where d.delta < 0 and a.person_id = d.person_id and a.local_date = d.local_date and a.interaction_count + d.delta <= 0
    returning a.person_id, a.local_date, a.organization_id
  )
  select u.person_id, u.local_date, u.organization_id, u.inserted from upserted u
  union all select r.person_id, r.local_date, r.organization_id, true from removed r
  union all select x.person_id, x.local_date, x.organization_id, false from decremented x;
end $$;

create function person_daily_activity_ensure_state(p_organization_ids uuid[]) returns void language sql as $$
  insert into person_daily_activity_state (organization_id, time_zone)
  select distinct o.id, analytics_org_timezone(o.id) from organizations o where o.id = any(p_organization_ids)
  on conflict (organization_id) do nothing
$$;

create function person_daily_activity_interactions_trigger() returns trigger language plpgsql as $$
declare
  v_person_ids uuid[];
  v_dates date[];
  v_organization_ids uuid[];
  v_deltas integer[];
begin
  if TG_OP = 'INSERT' then
    select array_agg(r.operator_id), array_agg((r.started_at at time zone s.time_zone)::date), array_agg(r.organization_id), array_agg(1)
      into v_person_ids, v_dates, v_organization_ids, v_deltas
      from new_rows r join lateral (select analytics_org_timezone(r.organization_id) time_zone) s on true
     where r.operator_id is not null;
    perform person_daily_activity_ensure_state(array(select distinct organization_id from new_rows));
  elsif TG_OP = 'DELETE' then
    select array_agg(r.operator_id), array_agg((r.started_at at time zone s.time_zone)::date), array_agg(r.organization_id), array_agg(-1)
      into v_person_ids, v_dates, v_organization_ids, v_deltas
      from old_rows r join lateral (select analytics_org_timezone(r.organization_id) time_zone) s on true
     where r.operator_id is not null;
  else
    select array_agg(x.person_id), array_agg(x.local_date), array_agg(x.organization_id), array_agg(x.delta)
      into v_person_ids, v_dates, v_organization_ids, v_deltas
      from (
        select r.operator_id person_id, (r.started_at at time zone analytics_org_timezone(r.organization_id))::date local_date, r.organization_id, 1 delta from new_rows r where r.operator_id is not null
        union all
        select r.operator_id, (r.started_at at time zone analytics_org_timezone(r.organization_id))::date, r.organization_id, -1 from old_rows r where r.operator_id is not null
      ) x;
    perform person_daily_activity_ensure_state(array(select distinct organization_id from new_rows));
  end if;
  if v_person_ids is not null then
    perform person_daily_activity_apply(v_person_ids, v_dates, v_organization_ids, v_deltas);
  end if;
  return null;
end $$;

create trigger interactions_daily_activity_insert after insert on interactions referencing new table as new_rows for each statement execute function person_daily_activity_interactions_trigger();
create trigger interactions_daily_activity_update after update on interactions referencing old table as old_rows new table as new_rows for each statement execute function person_daily_activity_interactions_trigger();
create trigger interactions_daily_activity_delete after delete on interactions referencing old table as old_rows for each statement execute function person_daily_activity_interactions_trigger();

create function person_daily_activity_truncate_trigger() returns trigger language plpgsql as $$
begin
  delete from person_daily_activity;
  return null;
end $$;
create trigger interactions_daily_activity_truncate after truncate on interactions for each statement execute function person_daily_activity_truncate_trigger();

-- Remonta a organização inteira a partir das interações (fuso atual da operação).
create function person_daily_activity_rebuild(p_organization_id uuid) returns void language plpgsql as $$
declare
  v_time_zone text := analytics_org_timezone(p_organization_id);
begin
  delete from person_daily_activity where organization_id = p_organization_id;
  insert into person_daily_activity (person_id, local_date, organization_id, interaction_count)
  select operator_id, (started_at at time zone v_time_zone)::date, p_organization_id, count(*)::integer
    from interactions
   where organization_id = p_organization_id and operator_id is not null
   group by 1, 2
   order by 1, 2;
  insert into person_daily_activity_state (organization_id, time_zone, rebuilt_at) values (p_organization_id, v_time_zone, now())
  on conflict (organization_id) do update set time_zone = excluded.time_zone, rebuilt_at = excluded.rebuilt_at;
end $$;

-- Fuso da organização mudou (operação criada/alterada/apagada): remonta só se o fuso efetivo mudou.
create function person_daily_activity_operations_trigger() returns trigger language plpgsql as $$
declare
  v_organization_id uuid;
begin
  for v_organization_id in
    select s.organization_id from person_daily_activity_state s
     where s.time_zone is distinct from analytics_org_timezone(s.organization_id)
  loop
    perform person_daily_activity_rebuild(v_organization_id);
  end loop;
  return null;
end $$;
create trigger operations_daily_activity_timezone after insert or update or delete on operations for each statement execute function person_daily_activity_operations_trigger();

-- Carga inicial: uma remontagem por organização que tem interações.
select person_daily_activity_rebuild(o.id) from organizations o where exists (select 1 from interactions i where i.organization_id = o.id);
