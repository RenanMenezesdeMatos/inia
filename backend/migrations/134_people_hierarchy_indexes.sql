-- Hierarquia e equipe em `people` (auditoria de escalabilidade, 2026-10-13).
--
-- Escopo de acesso, "Minha estrutura", destinatário de Workflow, materiais de apoio e analytics percorrem a cadeia de gestão
-- (`reports_to_id`) em CTEs recursivas e buscam membros por equipe (`team_id`) a cada request. Sem índice, cada ponto de
-- partida da CTE e cada busca por equipe varria `people` inteira. Os pontos de partida sempre filtram a organização, por isso
-- a organização vem primeiro. O passo recursivo (`p.reports_to_id = s.id`) continua um Hash Join sobre `people`, por escolha
-- do planejador: no tamanho alvo (≈4.000 pessoas) uma passada por nível sai mais barata que milhares de buscas no índice.
-- Medição em docs/dev/escalabilidade-consultas.md.

create index idx_people_org_reports_to on people (organization_id, reports_to_id) where reports_to_id is not null;
create index idx_people_org_team on people (organization_id, team_id) where team_id is not null;
