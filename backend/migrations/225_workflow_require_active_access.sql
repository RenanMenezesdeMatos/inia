-- Workflow: "Somente quem tem acesso ativo à INIA".
--
-- Opção do Workflow (modo Individual), desligada por padrão: com ela ligada, só nasce execução para quem tem cadastro ativo E
-- conta de acesso ativa (`user_accounts.active`) no momento em que a execução nasce. É parte de "quem participa" e segue a
-- regra rascunho × publicada (migration 144): o editor grava o rascunho, o runtime lê a publicada, só muda ao Publicar.
--
-- NÃO muda o conceito de "ativo" do cadastro (`people.active`): quartil, ranking, Equipe, estrutura e indicadores continuam
-- olhando a população inteira. A exigência vale só na porta de entrada do Workflow (workflow-eligibility.ts).

alter table workflows_all
  add column require_active_access boolean not null default false,
  add column draft_require_active_access boolean not null default false;

-- A visão dos não excluídos (175/177) recebe as colunas novas no fim (create or replace só acrescenta). A função é
-- "create or replace": numa instalação nova todas as migrations rodam na mesma sessão e a 197/223 já a criaram em pg_temp.
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

-- Versão publicada guarda a opção junto da configuração (snapshot do que valeu). Versões anteriores ficam nulas = desligada.
alter table workflow_versions add column require_active_access boolean;

-- Rascunho × publicada (144, 197): a opção entra no mesmo espelho live → rascunho.
create or replace function workflows_sync_draft_configuration() returns trigger language plpgsql as $fn$
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
     and (new.draft_trigger_config, new.draft_scope_type, new.draft_team_id, new.draft_subteam_id, new.draft_consolidated_structure, new.draft_population_filter, new.draft_operating_universe, new.draft_require_active_access)
       is not distinct from (old.draft_trigger_config, old.draft_scope_type, old.draft_team_id, old.draft_subteam_id, old.draft_consolidated_structure, old.draft_population_filter, old.draft_operating_universe, old.draft_require_active_access)
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
$fn$;
