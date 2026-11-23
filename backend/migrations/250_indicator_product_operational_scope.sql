-- ALCANCE OPERACIONAL DE INDICADORES E PRODUTOS (23/11/2026).
--
-- Indicador (definição) e Produto pertencem a um universo de atuação (`operating_universe`, 197 — pertencimento, inalterado). Agora têm
-- também um ALCANCE próprio, separado do pertencimento: ALL_TEAMS (todos os Grupos e Subgrupos do universo deles, inclusive os criados
-- depois — o comportamento de sempre, por isso é o padrão de todos os registros existentes) ou GROUPS (só os vínculos, cada um um Grupo
-- inteiro ou UM Subgrupo, com FK composta como na 223/249). Decisão de 23/11/2026: o alcance é gravado, validado e usado na
-- Administração (listas, filtros e seleção); a análise de chamada (motor de feedback) e os cálculos de indicador NÃO o leem.
--
-- `product_operational_scope_links` é outra coisa que `product_scope_assignments` (154): aquela diz a que PRODUTOS uma base/argumentário
-- vale; esta diz a que GRUPOS/SUBGRUPOS um produto vale. Família (FAMILY) não tem alcance.

alter table indicator_definitions_all add column if not exists scope_type text not null default 'ALL_TEAMS';
alter table indicator_definitions_all drop constraint if exists indicator_definitions_scope_type_check;
alter table indicator_definitions_all add constraint indicator_definitions_scope_type_check check (scope_type in ('ALL_TEAMS', 'GROUPS'));

alter table product_catalog_nodes_all add column if not exists scope_type text not null default 'ALL_TEAMS';
alter table product_catalog_nodes_all drop constraint if exists product_catalog_nodes_scope_type_check;
alter table product_catalog_nodes_all add constraint product_catalog_nodes_scope_type_check check (scope_type in ('ALL_TEAMS', 'GROUPS') and (kind = 'PRODUCT' or scope_type = 'ALL_TEAMS'));

create table if not exists indicator_scope_links (
  indicator_id uuid not null references indicator_definitions_all (id) on delete cascade,
  organization_id uuid not null references organizations (id),
  team_id uuid not null references teams (id),
  subteam_id uuid,
  created_at timestamptz not null default now(),
  foreign key (subteam_id, team_id) references subteams (id, team_id)
);
create unique index if not exists indicator_scope_links_unique on indicator_scope_links (indicator_id, team_id, subteam_id) nulls not distinct;
create index if not exists indicator_scope_links_team on indicator_scope_links (team_id);
create index if not exists indicator_scope_links_subteam on indicator_scope_links (subteam_id) where subteam_id is not null;

create table if not exists product_operational_scope_links (
  product_node_id uuid not null references product_catalog_nodes_all (id) on delete cascade,
  organization_id uuid not null references organizations (id),
  team_id uuid not null references teams (id),
  subteam_id uuid,
  created_at timestamptz not null default now(),
  foreign key (subteam_id, team_id) references subteams (id, team_id)
);
create unique index if not exists product_operational_scope_links_unique on product_operational_scope_links (product_node_id, team_id, subteam_id) nulls not distinct;
create index if not exists product_operational_scope_links_team on product_operational_scope_links (team_id);
create index if not exists product_operational_scope_links_subteam on product_operational_scope_links (subteam_id) where subteam_id is not null;

-- As visões dos não excluídos (175/177) recebem a coluna nova no fim (create or replace só acrescenta).
create or replace function pg_temp.refresh_logical_view(target text) returns void language plpgsql as $fn$
declare view_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into view_columns
    from information_schema.columns
   where table_schema = 'public' and table_name = target || '_all' and column_name not in ('deleted_at', 'deleted_by_person_id');
  execute format('create or replace view %I as select %s from %I where deleted_at is null', target, view_columns, target || '_all');
end
$fn$;
select pg_temp.refresh_logical_view('indicator_definitions');
select pg_temp.refresh_logical_view('product_catalog_nodes');
