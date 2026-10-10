-- Meta por Subgrupo (Parte 1 do pedido) — cada Subgrupo pode ter seus próprios indicadores,
-- metas, pesos e dados de atingimento; a tabela `goals` só aceitava subject_type
-- ORGANIZATION/OPERATION/TEAM/PERSON, então era literalmente impossível cadastrar uma meta por
-- Subgrupo. Amplia o domínio aceito — nenhuma linha existente é tocada, nenhum dado apagado.
alter table goals drop constraint goals_subject_type_check;
alter table goals add constraint goals_subject_type_check
  check (subject_type in ('ORGANIZATION', 'OPERATION', 'TEAM', 'SUBTEAM', 'PERSON'));
