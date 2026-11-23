-- ALCANCE POR VÁRIOS GRUPOS EM AGENTES, ORQUESTRADORES E WORKFLOWS (23/11/2026).
--
-- Antes: um escopo só por registro (`scope_type` ALL_TEAMS | TEAM | SUBTEAM + `team_id`/`subteam_id`). Agora:
--   ALL_TEAMS = todos os Grupos e Subgrupos (do universo do registro, quando ele tem universo — os consumidores aplicam o universo por
--               cima, como antes), inclusive os que forem criados depois;
--   GROUPS    = os vínculos em `<entidade>_scope_links`, cada um um Grupo INTEIRO (`subteam_id` nulo) ou UM Subgrupo daquele Grupo
--               (o mesmo modelo da 223: FK composta garante que o Subgrupo é do Grupo; escolher um Subgrupo não leva os irmãos).
-- `team_id`/`subteam_id` do registro ficam nulos (a verdade são os vínculos). Os escopos antigos viram um vínculo cada, com o mesmo
-- alcance: TEAM → Grupo inteiro; SUBTEAM → aquele Subgrupo com o Grupo-pai REAL. Rascunhos (`agents.draft_config`, `workflows_all.draft_*`)
-- guardam os vínculos em JSON (`scopeLinks` / `draft_scope_links`), conferidos pelo serviço ao salvar e ao publicar; snapshots de versão
-- (`agent_versions.config`, `assistant_orchestrator_versions.config`, `workflow_versions`) não são reescritos: o leitor entende o formato
-- antigo (TEAM/SUBTEAM) e o novo (GROUPS + `scopeLinks`).

-- 1. Tabelas de vínculos ------------------------------------------------------------------------------------------------------------
create table if not exists agent_scope_links (
  agent_id uuid not null references agents_all (id) on delete cascade,
  organization_id uuid not null references organizations (id),
  team_id uuid not null references teams (id),
  subteam_id uuid,
  created_at timestamptz not null default now(),
  foreign key (subteam_id, team_id) references subteams (id, team_id)
);
create unique index if not exists agent_scope_links_unique on agent_scope_links (agent_id, team_id, subteam_id) nulls not distinct;
create index if not exists agent_scope_links_team on agent_scope_links (team_id);
create index if not exists agent_scope_links_subteam on agent_scope_links (subteam_id) where subteam_id is not null;

create table if not exists assistant_orchestrator_scope_links (
  orchestrator_id uuid not null references assistant_orchestrators_all (id) on delete cascade,
  organization_id uuid not null references organizations (id),
  team_id uuid not null references teams (id),
  subteam_id uuid,
  created_at timestamptz not null default now(),
  foreign key (subteam_id, team_id) references subteams (id, team_id)
);
create unique index if not exists assistant_orchestrator_scope_links_unique on assistant_orchestrator_scope_links (orchestrator_id, team_id, subteam_id) nulls not distinct;
create index if not exists assistant_orchestrator_scope_links_team on assistant_orchestrator_scope_links (team_id);
create index if not exists assistant_orchestrator_scope_links_subteam on assistant_orchestrator_scope_links (subteam_id) where subteam_id is not null;

create table if not exists workflow_scope_links (
  workflow_id uuid not null references workflows_all (id) on delete cascade,
  organization_id uuid not null references organizations (id),
  team_id uuid not null references teams (id),
  subteam_id uuid,
  created_at timestamptz not null default now(),
  foreign key (subteam_id, team_id) references subteams (id, team_id)
);
create unique index if not exists workflow_scope_links_unique on workflow_scope_links (workflow_id, team_id, subteam_id) nulls not distinct;
create index if not exists workflow_scope_links_team on workflow_scope_links (team_id);
create index if not exists workflow_scope_links_subteam on workflow_scope_links (subteam_id) where subteam_id is not null;

alter table workflows_all add column if not exists draft_scope_links jsonb not null default '[]'::jsonb;
alter table workflow_versions add column if not exists scope_links jsonb;

-- A visão dos não excluídos (175/177) recebe a coluna nova no fim (create or replace só acrescenta).
create or replace function pg_temp.refresh_logical_view(target text) returns void language plpgsql as $fn$
declare view_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into view_columns
    from information_schema.columns
   where table_schema = 'public' and table_name = target || '_all' and column_name not in ('deleted_at', 'deleted_by_person_id');
  execute format('create or replace view %I as select %s from %I where deleted_at is null', target, view_columns, target || '_all');
end
$fn$;
select pg_temp.refresh_logical_view('workflows');

-- 2. Restrições antigas saem antes da conversão ---------------------------------------------------------------------------------------
alter table agents_all drop constraint if exists agents_scope_check;
alter table agents_all drop constraint if exists agents_scope_type_check;
alter table assistant_orchestrators_all drop constraint if exists assistant_orchestrators_check;
alter table assistant_orchestrators_all drop constraint if exists assistant_orchestrators_scope_type_check;
alter table workflows_all drop constraint if exists workflows_check;
alter table workflows_all drop constraint if exists workflows_scope_type_check;
alter table workflows_all drop constraint if exists workflows_draft_scope_check;
-- Um ativo interativo por escopo: com vínculos, a sobreposição é conferida pelo serviço (vínculo idêntico com outro ativo = recusado);
-- o índice continua valendo para ALL_TEAMS (um "todos os Grupos" ativo por organização e universo de atuação).
drop index if exists uq_assistant_orchestrator_active_scope;

-- 3. Conversão: cada escopo antigo vira um vínculo, com o Grupo-pai real do Subgrupo --------------------------------------------------
do $$
declare
  orphan int;
begin
  -- Subgrupo inexistente (ou de outro Grupo sem pai resolvível) não vira acesso global: avisa e mantém o registro sem vínculo
  -- (a tela pede um alcance antes de salvar; os consumidores não alcançam ninguém).
  select count(*) into orphan from agents_all a left join subteams s on s.id = a.subteam_id where a.scope_type = 'SUBTEAM' and s.id is null;
  if orphan > 0 then raise notice '249: % agente(s) com Subgrupo inexistente ficaram sem vínculo', orphan; end if;
  select count(*) into orphan from assistant_orchestrators_all o left join subteams s on s.id = o.subteam_id where o.scope_type = 'SUBTEAM' and s.id is null;
  if orphan > 0 then raise notice '249: % orquestrador(es) com Subgrupo inexistente ficaram sem vínculo', orphan; end if;
  select count(*) into orphan from workflows_all w left join subteams s on s.id = w.subteam_id where w.scope_type = 'SUBTEAM' and s.id is null;
  if orphan > 0 then raise notice '249: % workflow(s) com Subgrupo inexistente ficaram sem vínculo', orphan; end if;
end $$;

insert into agent_scope_links (agent_id, organization_id, team_id, subteam_id)
select a.id, a.organization_id, case when a.scope_type = 'SUBTEAM' then s.team_id else a.team_id end, case when a.scope_type = 'SUBTEAM' then a.subteam_id end
  from agents_all a left join subteams s on s.id = a.subteam_id
 where (a.scope_type = 'TEAM' and a.team_id is not null) or (a.scope_type = 'SUBTEAM' and s.id is not null)
on conflict do nothing;
update agents_all set scope_type = 'GROUPS', team_id = null, subteam_id = null where scope_type in ('TEAM', 'SUBTEAM');

insert into assistant_orchestrator_scope_links (orchestrator_id, organization_id, team_id, subteam_id)
select o.id, o.organization_id, case when o.scope_type = 'SUBTEAM' then s.team_id else o.team_id end, case when o.scope_type = 'SUBTEAM' then o.subteam_id end
  from assistant_orchestrators_all o left join subteams s on s.id = o.subteam_id
 where (o.scope_type = 'TEAM' and o.team_id is not null) or (o.scope_type = 'SUBTEAM' and s.id is not null)
on conflict do nothing;
update assistant_orchestrators_all set scope_type = 'GROUPS', team_id = null, subteam_id = null where scope_type in ('TEAM', 'SUBTEAM');

-- Workflows: o trigger de rascunho (144) copiaria o publicado para o rascunho quando só o publicado muda; aqui os dois mudam juntos.
insert into workflow_scope_links (workflow_id, organization_id, team_id, subteam_id)
select w.id, w.organization_id, case when w.scope_type = 'SUBTEAM' then s.team_id else w.team_id end, case when w.scope_type = 'SUBTEAM' then w.subteam_id end
  from workflows_all w left join subteams s on s.id = w.subteam_id
 where (w.scope_type = 'TEAM' and w.team_id is not null) or (w.scope_type = 'SUBTEAM' and s.id is not null)
on conflict do nothing;
update workflows_all w
   set draft_scope_links = case
         when w.draft_scope_type = 'TEAM' then jsonb_build_array(jsonb_build_object('teamId', w.draft_team_id, 'subteamId', null))
         when w.draft_scope_type = 'SUBTEAM' then coalesce((select jsonb_build_array(jsonb_build_object('teamId', s.team_id, 'subteamId', s.id)) from subteams s where s.id = w.draft_subteam_id), '[]'::jsonb)
         else '[]'::jsonb end,
       draft_scope_type = case when w.draft_scope_type in ('TEAM', 'SUBTEAM') then 'GROUPS' else w.draft_scope_type end,
       draft_team_id = null, draft_subteam_id = null,
       scope_type = case when w.scope_type in ('TEAM', 'SUBTEAM') then 'GROUPS' else w.scope_type end,
       team_id = null, subteam_id = null
 where w.scope_type in ('TEAM', 'SUBTEAM') or w.draft_scope_type in ('TEAM', 'SUBTEAM');

-- 4. Restrições novas ----------------------------------------------------------------------------------------------------------------
alter table agents_all add constraint agents_scope_check check (scope_type in ('ALL_TEAMS', 'GROUPS') and team_id is null and subteam_id is null);
alter table assistant_orchestrators_all add constraint assistant_orchestrators_scope_check check (scope_type in ('ALL_TEAMS', 'GROUPS') and team_id is null and subteam_id is null);
alter table workflows_all add constraint workflows_scope_check check (scope_type in ('ALL_TEAMS', 'GROUPS') and team_id is null and subteam_id is null);
alter table workflows_all add constraint workflows_draft_scope_check check (draft_scope_type in ('ALL_TEAMS', 'GROUPS') and draft_team_id is null and draft_subteam_id is null and jsonb_typeof(draft_scope_links) = 'array');
create unique index if not exists uq_assistant_orchestrator_active_all_teams on assistant_orchestrators_all (organization_id, coalesce(operating_universe, '')) where active and scope_type = 'ALL_TEAMS' and invocation_mode in ('INTERACTIVE', 'BOTH');

-- 5. Rascunho do Workflow: os vínculos do rascunho seguem o publicado enquanto o rascunho não diverge (mesma regra da 144) ----------
create or replace function workflows_sync_draft_configuration() returns trigger language plpgsql as $function$
begin
  if tg_op = 'INSERT' then
    if new.draft_scope_type is null then
      new.draft_trigger_config := new.trigger_config;
      new.draft_scope_type := new.scope_type;
      new.draft_team_id := new.team_id;
      new.draft_subteam_id := new.subteam_id;
      new.draft_consolidated_structure := new.consolidated_structure;
      new.draft_population_filter := new.population_filter;
      new.draft_operating_universe := new.operating_universe;
      new.draft_require_active_access := new.require_active_access;
    end if;
    return new;
  end if;
  if (new.trigger_config, new.scope_type, new.team_id, new.subteam_id, new.consolidated_structure, new.population_filter, new.operating_universe, new.require_active_access)
       is distinct from (old.trigger_config, old.scope_type, old.team_id, old.subteam_id, old.consolidated_structure, old.population_filter, old.operating_universe, old.require_active_access)
     and (new.draft_trigger_config, new.draft_scope_type, new.draft_team_id, new.draft_subteam_id, new.draft_consolidated_structure, new.draft_population_filter, new.draft_operating_universe, new.draft_require_active_access, new.draft_scope_links)
       is not distinct from (old.draft_trigger_config, old.draft_scope_type, old.draft_team_id, old.draft_subteam_id, old.draft_consolidated_structure, old.draft_population_filter, old.draft_operating_universe, old.draft_require_active_access, old.draft_scope_links)
     and (old.draft_trigger_config, old.draft_scope_type, old.draft_team_id, old.draft_subteam_id, old.draft_consolidated_structure, old.draft_population_filter, old.draft_operating_universe, old.draft_require_active_access)
       is not distinct from (old.trigger_config, old.scope_type, old.team_id, old.subteam_id, old.consolidated_structure, old.population_filter, old.operating_universe, old.require_active_access)
  then
    new.draft_trigger_config := new.trigger_config;
    new.draft_scope_type := new.scope_type;
    new.draft_team_id := new.team_id;
    new.draft_subteam_id := new.subteam_id;
    new.draft_consolidated_structure := new.consolidated_structure;
    new.draft_population_filter := new.population_filter;
    new.draft_operating_universe := new.operating_universe;
    new.draft_require_active_access := new.require_active_access;
  end if;
  return new;
end
$function$;
