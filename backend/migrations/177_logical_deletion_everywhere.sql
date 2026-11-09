-- EXCLUSÃO LÓGICA EM TODOS OS OBJETOS (06/11/2026). Excluir tira o objeto das telas e da lógica; nada é apagado, e a Central de Dados mostra e restaura.
-- Mesmo desenho da 174 e da 175: a tabela vira `<nome>_all` e o nome antigo vira uma visão que esconde os excluídos. Quem esquecer um filtro no futuro não vê excluído por engano.
-- A lista de colunas da visão sai do banco na hora da migration, para não perder coluna que outro branch tenha acrescentado antes desta.
-- Migration futura que acrescenta coluna nestas tabelas altera `<nome>_all` e recria a visão; `alter table <nome>` falha na hora, nunca em silêncio.

create function pg_temp.enable_logical_deletion(target text, has_organization boolean default true) returns void
language plpgsql as $fn$
declare
  real_table text := target || '_all';
  view_columns text;
begin
  execute format('alter table %I add column deleted_at timestamptz, add column deleted_by_person_id uuid references people(id)', target);
  execute format('alter table %I rename to %I', target, real_table);
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into view_columns
    from information_schema.columns
   where table_schema = 'public' and table_name = real_table and column_name not in ('deleted_at', 'deleted_by_person_id');
  execute format('create view %I as select %s from %I where deleted_at is null', target, view_columns, real_table);
  if has_organization then
    execute format('create index %I on %I (organization_id, deleted_at desc) where deleted_at is not null', 'idx_' || target || '_deleted', real_table);
  else
    execute format('create index %I on %I (deleted_at desc) where deleted_at is not null', 'idx_' || target || '_deleted', real_table);
  end if;
  execute format('analyze %I (deleted_at)', real_table);
end
$fn$;

select pg_temp.enable_logical_deletion('agents');
select pg_temp.enable_logical_deletion('assistant_orchestrators');
select pg_temp.enable_logical_deletion('argument_scripts');
select pg_temp.enable_logical_deletion('business_domains');
select pg_temp.enable_logical_deletion('channel_flags');
select pg_temp.enable_logical_deletion('prohibited_topics');
select pg_temp.enable_logical_deletion('glossary_terms');
select pg_temp.enable_logical_deletion('indicator_definitions');
select pg_temp.enable_logical_deletion('inia_scenes');
select pg_temp.enable_logical_deletion('organization_holidays');
select pg_temp.enable_logical_deletion('product_catalog_nodes');
select pg_temp.enable_logical_deletion('product_identification_criteria');
select pg_temp.enable_logical_deletion('ai_connections');
select pg_temp.enable_logical_deletion('ai_models');
select pg_temp.enable_logical_deletion('ai_budgets');
select pg_temp.enable_logical_deletion('workflow_variables', false);

-- Nome e código voltam a ficar livres quando o dono é excluído. Os índices mantêm o nome das restrições antigas: o tratamento de duplicidade continua igual.
alter table agents_all drop constraint agents_organization_id_name_key;
create unique index agents_organization_id_name_key on agents_all (organization_id, name) where deleted_at is null;

alter table business_domains_all drop constraint business_domains_organization_id_code_key;
create unique index business_domains_organization_id_code_key on business_domains_all (organization_id, code) where deleted_at is null;

alter table channel_flags_all drop constraint channel_flags_organization_id_channel_flag_name_key;
create unique index channel_flags_organization_id_channel_flag_name_key on channel_flags_all (organization_id, channel, flag_name) where deleted_at is null;

alter table prohibited_topics_all drop constraint prohibited_topics_organization_id_name_key;
create unique index prohibited_topics_organization_id_name_key on prohibited_topics_all (organization_id, name) where deleted_at is null;

alter table glossary_terms_all drop constraint glossary_terms_organization_id_term_key;
create unique index glossary_terms_organization_id_term_key on glossary_terms_all (organization_id, term) where deleted_at is null;

alter table indicator_definitions_all drop constraint indicator_definitions_organization_id_code_key;
create unique index indicator_definitions_organization_id_code_key on indicator_definitions_all (organization_id, code) where deleted_at is null;

alter table organization_holidays_all drop constraint organization_holidays_organization_id_holiday_date_name_key;
create unique index organization_holidays_organization_id_holiday_date_name_key on organization_holidays_all (organization_id, holiday_date, name) where deleted_at is null;

alter table product_catalog_nodes_all drop constraint product_catalog_nodes_organization_id_code_key;
create unique index product_catalog_nodes_organization_id_code_key on product_catalog_nodes_all (organization_id, code) where deleted_at is null;

drop index inia_scenes_name_unique;
create unique index inia_scenes_name_unique on inia_scenes_all (organization_id, lower(btrim(name))) where deleted_at is null;

drop index ai_connections_org_name_uidx;
create unique index ai_connections_org_name_uidx on ai_connections_all (organization_id, lower(name)) where deleted_at is null;

drop index ai_models_connection_model_uidx;
create unique index ai_models_connection_model_uidx on ai_models_all (connection_id, provider_model_id) where deleted_at is null;

drop index ai_budgets_scope_uidx;
create unique index ai_budgets_scope_uidx on ai_budgets_all (organization_id, scope, coalesce(scope_key, ''), currency) where deleted_at is null;

-- O gatilho compara o nome da tabela: depois de renomear, sem isto, ele trataria a linha do cenário como se fosse uma imagem e falharia em toda alteração de cenário.
create or replace function inia_scene_images_consistency() returns trigger language plpgsql as $fn$
declare
  target uuid;
  total integer;
  primaries integer;
begin
  if tg_table_name = 'inia_scenes_all' then
    target := new.id;
  elsif tg_op = 'DELETE' then
    target := old.scene_id;
  else
    target := new.scene_id;
  end if;
  -- Cenário excluído: nada a conferir.
  if not exists (select 1 from inia_scenes where id = target) then
    return null;
  end if;
  select count(*), count(*) filter (where is_primary) into total, primaries from inia_scene_images where scene_id = target;
  if total = 0 or primaries <> 1 then
    raise exception 'Cenário da INIA % precisa de pelo menos uma imagem e exatamente uma principal (imagens: %, principais: %).', target, total, primaries
      using errcode = '23514';
  end if;
  return null;
end
$fn$;

-- Os que já eram lógicos ganham quem excluiu. Reports já guarda a conta.
alter table knowledge_documents add column deleted_by_person_id uuid references people(id);
alter table data_sources add column deleted_by_person_id uuid references people(id);
alter table data_feeds add column deleted_by_person_id uuid references people(id);
alter table indicator_calculation_rules add column deleted_by_person_id uuid references people(id);

create index idx_knowledge_documents_deleted on knowledge_documents (organization_id, deleted_at desc) where deleted_at is not null;
create index idx_data_sources_deleted on data_sources (organization_id, deleted_at desc) where deleted_at is not null;
create index idx_data_feeds_deleted on data_feeds (organization_id, deleted_at desc) where deleted_at is not null;
create index idx_indicator_calculation_rules_deleted on indicator_calculation_rules (organization_id, deleted_at desc) where deleted_at is not null;
create index idx_reports_deleted on reports (organization_id, deleted_at desc) where deleted_at is not null;
