-- UNIVERSO DE ATUAÇÃO (B2B, B2C, B2X) — etapa 1 de 3 (16/11/2026). Ver docs/dev/memoria/universo-de-atuacao.md.
-- Esta migration só ACRESCENTA colunas anuláveis: nenhum registro existente muda, nenhum vínculo é tocado e nada é preenchido por
-- adivinhação (nome de Grupo, de operação ou de produto não é evidência). Nulo = "pendente de classificação".
-- Etapa 2 (backend): a organização ativa a exigência (organizations.operating_universe_enforced_at) pela tela; daí em diante cadastro
-- novo exige universo e as consultas operacionais filtram. Etapa 3 (banco): migrations/pending/208_operating_universe_required.sql,
-- aplicada só quando a contagem de pendentes for zero — torna a coluna obrigatória no banco.

alter table organizations
  add column operating_universe_enforced_at timestamptz,
  add column operating_universe_enforced_by uuid references people(id);

-- Colaborador: onde ele atua. Vem do cadastro (Central de Dados › Colaboradores, campo "Universo de atuação", ou Pessoas).
alter table people add column operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X'));
create index people_operating_universe_idx on people (organization_id, operating_universe) where active;

-- Histórico com vigência: preserva em que universo a pessoa estava em cada momento (a troca de operação nunca reescreve o passado).
create table person_operating_universe_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  check (valid_until is null or valid_until >= valid_from)
);
create unique index person_operating_universe_history_open_idx on person_operating_universe_history (person_id) where valid_until is null;
create index person_operating_universe_history_person_idx on person_operating_universe_history (person_id, valid_from desc);

-- Caso de supervisão: universo carimbado NA ORIGEM (como team_id). Feedbacks, evidências e escalonamentos são rastreados ao caso.
alter table supervision_cases add column operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X'));
create index supervision_cases_universe_idx on supervision_cases (organization_id, operating_universe);

create function stamp_supervision_case_universe() returns trigger language plpgsql as $fn$
begin
  if new.operating_universe is null then
    select p.operating_universe into new.operating_universe from people p where p.id = new.operator_id;
  end if;
  return new;
end
$fn$;
create trigger supervision_cases_stamp_universe before insert on supervision_cases for each row execute function stamp_supervision_case_universe();

-- Toda escrita em people (Pessoas, Central de Dados, seeds) passa por aqui: abre/fecha a vigência. Na PRIMEIRA classificação de uma
-- pessoa (nulo → universo), o período anterior sem classificação (legado) e os casos dela ainda sem carimbo recebem esse universo — é o
-- mesmo cadastro que a operação acabou de declarar. Depois disso, trocar de universo fecha a vigência anterior e abre outra: o passado
-- (indicadores do período, casos carimbados) continua no universo em que aconteceu.
create function track_person_operating_universe() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'INSERT' then
    -- Primeira vigência vale "desde sempre": cargas de histórico chegam depois do cadastro e pertencem ao universo de entrada.
    insert into person_operating_universe_history (organization_id, person_id, operating_universe, valid_from) values (new.organization_id, new.id, new.operating_universe, '-infinity');
    return new;
  end if;
  if new.operating_universe is not distinct from old.operating_universe then
    return new;
  end if;
  if old.operating_universe is null and not exists (
    select 1 from person_operating_universe_history h where h.person_id = new.id and h.operating_universe is not null
  ) then
    update person_operating_universe_history set operating_universe = new.operating_universe where person_id = new.id and operating_universe is null;
    update supervision_cases set operating_universe = new.operating_universe where operator_id = new.id and operating_universe is null;
    if not exists (select 1 from person_operating_universe_history h where h.person_id = new.id) then
      insert into person_operating_universe_history (organization_id, person_id, operating_universe, valid_from) values (new.organization_id, new.id, new.operating_universe, '-infinity');
    end if;
    return new;
  end if;
  update person_operating_universe_history set valid_until = now() where person_id = new.id and valid_until is null;
  insert into person_operating_universe_history (organization_id, person_id, operating_universe) values (new.organization_id, new.id, new.operating_universe);
  return new;
end
$fn$;
create trigger people_track_operating_universe after insert or update of operating_universe on people for each row execute function track_person_operating_universe();

-- Vigência inicial: desde sempre ("-infinity"), porque o legado não tem data de entrada no universo.
insert into person_operating_universe_history (organization_id, person_id, operating_universe, valid_from)
select organization_id, id, operating_universe, '-infinity' from people;

-- Base de conhecimento.
alter table knowledge_documents add column operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X'));
create index knowledge_documents_universe_idx on knowledge_documents (organization_id, operating_universe) where deleted_at is null;

-- Workflow: o universo é parte da abrangência e segue a regra rascunho × publicada (migration 144): só vale ao Publicar.
alter table workflows_all
  add column operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X')),
  add column draft_operating_universe text check (draft_operating_universe in ('B2B', 'B2C', 'B2X'));
update workflows_all set draft_operating_universe = operating_universe;

-- Produto: cada produto pertence a exatamente um universo (categoria não tem universo próprio — vale para os produtos dela).
alter table product_catalog_nodes_all add column operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X'));
alter table product_catalog_nodes_all add constraint product_catalog_nodes_universe_only_products check (kind = 'PRODUCT' or operating_universe is null);

-- Universos são mundos SEPARADOS: indicadores, domínios de negócio, agentes, orquestradores e argumentários também pertencem a um universo
-- (nulo = pendente). Vínculo entre recursos de universos diferentes é recusado pelo backend (operating-universe/application).
alter table indicator_definitions_all add column operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X'));
alter table business_domains_all add column operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X'));
alter table agents_all add column operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X'));
alter table assistant_orchestrators_all add column operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X'));
alter table argument_scripts_all add column operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X'));

-- As visões dos não excluídos (177) recebem as colunas novas no fim (create or replace só acrescenta).
create function pg_temp.refresh_logical_view(target text) returns void language plpgsql as $fn$
declare view_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into view_columns
    from information_schema.columns
   where table_schema = 'public' and table_name = target || '_all' and column_name not in ('deleted_at', 'deleted_by_person_id');
  execute format('create or replace view %I as select %s from %I where deleted_at is null', target, view_columns, target || '_all');
end
$fn$;
select pg_temp.refresh_logical_view('workflows');
select pg_temp.refresh_logical_view('product_catalog_nodes');
select pg_temp.refresh_logical_view('indicator_definitions');
select pg_temp.refresh_logical_view('business_domains');
select pg_temp.refresh_logical_view('agents');
select pg_temp.refresh_logical_view('assistant_orchestrators');
select pg_temp.refresh_logical_view('argument_scripts');

-- Versão publicada guarda o universo junto da abrangência (snapshot imutável do que valeu).
alter table workflow_versions add column operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X'));

-- Rascunho × publicada (144): o universo entra no mesmo espelho live → rascunho.
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
    end if;
    return new;
  end if;
  if (new.trigger_config, new.scope_type, new.team_id, new.subteam_id, new.consolidated_structure, new.population_filter, new.operating_universe)
       is distinct from (old.trigger_config, old.scope_type, old.team_id, old.subteam_id, old.consolidated_structure, old.population_filter, old.operating_universe)
     and (new.draft_trigger_config, new.draft_scope_type, new.draft_team_id, new.draft_subteam_id, new.draft_consolidated_structure, new.draft_population_filter, new.draft_operating_universe)
       is not distinct from (old.draft_trigger_config, old.draft_scope_type, old.draft_team_id, old.draft_subteam_id, old.draft_consolidated_structure, old.draft_population_filter, old.draft_operating_universe)
     and (old.draft_trigger_config, old.draft_scope_type, old.draft_team_id, old.draft_subteam_id, old.draft_consolidated_structure, old.draft_population_filter, old.draft_operating_universe)
       is not distinct from (old.trigger_config, old.scope_type, old.team_id, old.subteam_id, old.consolidated_structure, old.population_filter, old.operating_universe)
  then
    new.draft_trigger_config := new.trigger_config;
    new.draft_scope_type := new.scope_type;
    new.draft_team_id := new.team_id;
    new.draft_subteam_id := new.subteam_id;
    new.draft_consolidated_structure := new.consolidated_structure;
    new.draft_population_filter := new.population_filter;
    new.draft_operating_universe := new.operating_universe;
  end if;
  return new;
end
$fn$;

-- O grafo de pessoas em cache (analytics) carrega o universo: mudar o universo de alguém precisa invalidar a versão STRUCTURE.
create or replace function analytics_people_structure_trigger() returns trigger language plpgsql as $fn$
begin
  perform analytics_bump_versions('STRUCTURE', array(
    select unnest(array[n.organization_id, o.organization_id])
      from new_rows n join old_rows o on o.id = n.id
     where (n.organization_id, n.name, n.role, n.reports_to_id, n.team_id, n.subteam_id, n.avatar_url, n.job_title, n.operational_capital_code, n.active, n.operating_universe)
           is distinct from (o.organization_id, o.name, o.role, o.reports_to_id, o.team_id, o.subteam_id, o.avatar_url, o.job_title, o.operational_capital_code, o.active, o.operating_universe)));
  return null;
end
$fn$;
