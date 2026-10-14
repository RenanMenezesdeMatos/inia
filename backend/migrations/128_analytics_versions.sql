-- VERSÕES POR ORGANIZAÇÃO para os caches do analytics da liderança — docs/dev/escala-read-model-e-ciclo-de-vida.md (A2).
--
-- Aditiva. Um cache em memória só pode servir o que foi carregado sob a MESMA versão que o banco mostra agora; quem sobe a
-- versão é o próprio banco, por trigger por statement, na mesma transação da escrita — Central de Dados, telas admin, seed e
-- scripts ficam cobertos sem que nenhum gravador precise lembrar. A versão vem de uma SEQUÊNCIA (não transacional): uma
-- transação desfeita nunca devolve um número que outra transação possa reaproveitar, então "mesma versão" = "mesmos dados".
--   STRUCTURE — pessoas (só as colunas que o escopo/organograma lê), Grupos e Subgrupos (nomes).
--   OFFICIAL  — fechamento oficial (employee_indicator_performance, employee_prv_performance) e catálogo de indicadores.
create sequence analytics_version_seq;

create table analytics_versions (
  organization_id uuid not null references organizations(id) on delete cascade,
  domain text not null check (domain in ('STRUCTURE', 'OFFICIAL')),
  version bigint not null,
  changed_at timestamptz not null default now(),
  primary key (organization_id, domain)
);

create function analytics_bump_versions(p_domain text, p_organization_ids uuid[]) returns void language sql as $$
  insert into analytics_versions (organization_id, domain, version, changed_at)
  select organization_id, p_domain, nextval('analytics_version_seq'), now()
    from (select distinct organization_id from unnest(p_organization_ids) organization_id where organization_id is not null) changed
   where exists (select 1 from organizations o where o.id = changed.organization_id)
   order by organization_id
  on conflict (organization_id, domain) do update set version = excluded.version, changed_at = excluded.changed_at
$$;

-- Genérica: qualquer linha inserida/alterada/apagada sobe a versão do domínio (TG_ARGV[0]) das organizações tocadas.
create function analytics_bump_version_trigger() returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    perform analytics_bump_versions(TG_ARGV[0], array(select organization_id from new_rows));
  elsif TG_OP = 'DELETE' then
    perform analytics_bump_versions(TG_ARGV[0], array(select organization_id from old_rows));
  else
    perform analytics_bump_versions(TG_ARGV[0], array(select organization_id from new_rows union select organization_id from old_rows));
  end if;
  return null;
end $$;

-- TRUNCATE não tem tabela de transição: sobe a versão de todas as organizações.
create function analytics_bump_all_versions_trigger() returns trigger language plpgsql as $$
begin
  perform analytics_bump_versions(TG_ARGV[0], array(select id from organizations));
  return null;
end $$;

-- people: UPDATE só conta quando muda o que o escopo/organograma lê (PersonNode) — a projeção diária da situação
-- funcional e outras colunas não invalidam o cache.
create function analytics_people_structure_trigger() returns trigger language plpgsql as $$
begin
  perform analytics_bump_versions('STRUCTURE', array(
    select unnest(array[n.organization_id, o.organization_id])
      from new_rows n join old_rows o on o.id = n.id
     where (n.organization_id, n.name, n.role, n.reports_to_id, n.team_id, n.subteam_id, n.avatar_url, n.job_title, n.operational_capital_code, n.active)
           is distinct from (o.organization_id, o.name, o.role, o.reports_to_id, o.team_id, o.subteam_id, o.avatar_url, o.job_title, o.operational_capital_code, o.active)));
  return null;
end $$;

create trigger people_analytics_structure_insert after insert on people referencing new table as new_rows for each statement execute function analytics_bump_version_trigger('STRUCTURE');
create trigger people_analytics_structure_update after update on people referencing old table as old_rows new table as new_rows for each statement execute function analytics_people_structure_trigger();
create trigger people_analytics_structure_delete after delete on people referencing old table as old_rows for each statement execute function analytics_bump_version_trigger('STRUCTURE');
create trigger people_analytics_structure_truncate after truncate on people for each statement execute function analytics_bump_all_versions_trigger('STRUCTURE');

create trigger teams_analytics_structure_insert after insert on teams referencing new table as new_rows for each statement execute function analytics_bump_version_trigger('STRUCTURE');
create trigger teams_analytics_structure_update after update on teams referencing old table as old_rows new table as new_rows for each statement execute function analytics_bump_version_trigger('STRUCTURE');
create trigger teams_analytics_structure_delete after delete on teams referencing old table as old_rows for each statement execute function analytics_bump_version_trigger('STRUCTURE');

create trigger subteams_analytics_structure_insert after insert on subteams referencing new table as new_rows for each statement execute function analytics_bump_version_trigger('STRUCTURE');
create trigger subteams_analytics_structure_update after update on subteams referencing old table as old_rows new table as new_rows for each statement execute function analytics_bump_version_trigger('STRUCTURE');
create trigger subteams_analytics_structure_delete after delete on subteams referencing old table as old_rows for each statement execute function analytics_bump_version_trigger('STRUCTURE');

create trigger eip_analytics_official_insert after insert on employee_indicator_performance referencing new table as new_rows for each statement execute function analytics_bump_version_trigger('OFFICIAL');
create trigger eip_analytics_official_update after update on employee_indicator_performance referencing old table as old_rows new table as new_rows for each statement execute function analytics_bump_version_trigger('OFFICIAL');
create trigger eip_analytics_official_delete after delete on employee_indicator_performance referencing old table as old_rows for each statement execute function analytics_bump_version_trigger('OFFICIAL');
create trigger eip_analytics_official_truncate after truncate on employee_indicator_performance for each statement execute function analytics_bump_all_versions_trigger('OFFICIAL');

create trigger prv_analytics_official_insert after insert on employee_prv_performance referencing new table as new_rows for each statement execute function analytics_bump_version_trigger('OFFICIAL');
create trigger prv_analytics_official_update after update on employee_prv_performance referencing old table as old_rows new table as new_rows for each statement execute function analytics_bump_version_trigger('OFFICIAL');
create trigger prv_analytics_official_delete after delete on employee_prv_performance referencing old table as old_rows for each statement execute function analytics_bump_version_trigger('OFFICIAL');
create trigger prv_analytics_official_truncate after truncate on employee_prv_performance for each statement execute function analytics_bump_all_versions_trigger('OFFICIAL');

create trigger indicator_definitions_analytics_official_insert after insert on indicator_definitions referencing new table as new_rows for each statement execute function analytics_bump_version_trigger('OFFICIAL');
create trigger indicator_definitions_analytics_official_update after update on indicator_definitions referencing old table as old_rows new table as new_rows for each statement execute function analytics_bump_version_trigger('OFFICIAL');
create trigger indicator_definitions_analytics_official_delete after delete on indicator_definitions referencing old table as old_rows for each statement execute function analytics_bump_version_trigger('OFFICIAL');

select analytics_bump_versions('STRUCTURE', array(select id from organizations));
select analytics_bump_versions('OFFICIAL', array(select id from organizations));
