-- Unidade de Análise (evolução de Abrangência/Escopo Administrativo) — QUEM ou QUAL estrutura o
-- Workflow analisa, dentro da Abrangência já existente. Vive na linha mutável de `workflows`
-- (mesmo padrão de scope_type/team_id/subteam_id — nunca versionado junto do grafo publicado),
-- editável via "Configurações do workflow" no editor. Ausente/null = OPERATOR (comportamento
-- implícito de sempre — Flag/Indicador resolvem o operador do próprio evento; Agenda relativa ao
-- expediente é por definição individual). Nenhum dado existente precisa de backfill: todo
-- Workflow atual já se comporta como OPERATOR hoje.
alter table workflows add column unit_of_analysis jsonb;
