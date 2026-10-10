-- Corrige um bug do backfill em 023: o nó "action" foi criado sem o campo
-- "actionType" dentro de config (só existia como coluna separada na tabela antiga
-- workflow_actions, já removida). Sem esse campo o grafo não valida no schema novo.

update workflows
set draft_graph = jsonb_set(
  draft_graph, '{nodes}',
  (
    select jsonb_agg(
      case
        when node ->> 'type' = 'action' and not (node -> 'config' ? 'actionType') then
          jsonb_set(node, '{config,actionType}', to_jsonb(case when node -> 'config' ? 'agentId' then 'CALL_AGENT' else 'SET_CONFIG_VALUE' end))
        else node
      end
    )
    from jsonb_array_elements(draft_graph -> 'nodes') as node
  )
)
where draft_graph -> 'nodes' @> '[{"type":"action"}]'::jsonb;

update workflow_versions
set graph = jsonb_set(
  graph, '{nodes}',
  (
    select jsonb_agg(
      case
        when node ->> 'type' = 'action' and not (node -> 'config' ? 'actionType') then
          jsonb_set(node, '{config,actionType}', to_jsonb(case when node -> 'config' ? 'agentId' then 'CALL_AGENT' else 'SET_CONFIG_VALUE' end))
        else node
      end
    )
    from jsonb_array_elements(graph -> 'nodes') as node
  )
)
where graph -> 'nodes' @> '[{"type":"action"}]'::jsonb;
