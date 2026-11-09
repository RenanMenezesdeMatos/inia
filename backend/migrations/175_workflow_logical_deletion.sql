-- EXCLUSÃO LÓGICA DE WORKFLOW. Excluir apagava o fluxo, as versões, as execuções e os recados em cascata, e o histórico se perdia. Agora o Workflow sai das telas e para de rodar, e
-- tudo continua guardado e visível na Central de Dados › Consultar dados.
--
-- Mesmo desenho da migration 174: a tabela passa a se chamar `workflows_all` e o nome antigo é uma visão que esconde o excluído. Gatilhos, Agents, indicadores e as telas de
-- configuração continuam lendo `workflows` e deixam de ver o excluído sem precisar lembrar de filtrar. Quem mostra o passado lê `workflows_all` de propósito.
-- Coluna nova: `alter table workflows_all` e recriar a visão; a migration falha na hora se esquecer.

alter table workflows add column deleted_at timestamptz, add column deleted_by_person_id uuid references people(id);
alter table workflows rename to workflows_all;
create view workflows as
  select id, organization_id, name, description, scope_type, team_id, subteam_id, active, created_by, created_at, updated_at, trigger_config, draft_graph, active_version_id, consolidated_structure, population_filter,
         draft_trigger_config, draft_scope_type, draft_team_id, draft_subteam_id, draft_consolidated_structure, draft_population_filter
    from workflows_all where deleted_at is null;
create index idx_workflows_deleted on workflows_all (organization_id, deleted_at desc) where deleted_at is not null;
analyze workflows_all (deleted_at);
