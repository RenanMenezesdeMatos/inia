-- BOAS PRÁTICAS POR SUBGRUPO (2026-10-22, BEST_PRACTICE_ANALYSIS_V2 / BEST_PRACTICE_SELECTION_V1). A análise passa a poder comparar
-- os operadores de UM Subgrupo (os melhores do subgrupo × os demais do subgrupo), além do Grupo inteiro. O padrão guarda a população
-- em que foi descoberto: padrão do Subgrupo e padrão do Grupo são revisados separados, e o feedback usa primeiro o do Subgrupo da
-- pessoa e, sem prática sustentada ali, o do Grupo (`best-practices/domain/selection-levels.ts`). O quartil continua o OFICIAL.
--
-- O Subgrupo sempre pertence ao Grupo da análise/do padrão: a chave (subteam_id, team_id) aponta para o par existente em `subteams`.
-- Ver docs/dev/memoria/boas-praticas.md.

alter table subteams add constraint subteams_id_team_key unique (id, team_id);

alter table best_practice_analyses add column subteam_id uuid;
alter table best_practice_analyses
  add constraint best_practice_analyses_subteam_fk foreign key (subteam_id, team_id) references subteams (id, team_id) on delete cascade;

alter table best_practice_patterns add column subteam_id uuid;
alter table best_practice_patterns
  add constraint best_practice_patterns_subteam_fk foreign key (subteam_id, team_id) references subteams (id, team_id) on delete cascade;

create index idx_best_practice_patterns_population on best_practice_patterns (organization_id, team_id, subteam_id) where data_origin = 'REAL';
