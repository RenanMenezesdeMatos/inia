-- "COMO ISSO AJUDA NO RESULTADO" NA PRÁTICA (2026-10-22, BEST_PRACTICE_HOW_IT_HELPS_V1). A base mede associação (os melhores fazem isso
-- a mais), nunca causa. Para o feedback poder dizer COMO a prática ajuda no indicador ou no sinal, quem revisa escreve (ou corrige o
-- rascunho da IA da descoberta) e aprova esse texto; sem ele, o feedback não liga a prática ao resultado.
--
--   best_practice_patterns.how_it_helps   o texto vigente, opcional. Nasce do rascunho da descoberta (que também fica em
--                                         best_practice_pattern_versions.proposed->>'howItHelps'); quem revisa edita pela ação EDIT, que
--                                         devolve o padrão para revisão (só vale depois de aprovado). Reanálise nunca sobrescreve.
-- Ver docs/dev/memoria/boas-praticas.md.

alter table best_practice_patterns add column how_it_helps text;
alter table best_practice_patterns add constraint best_practice_patterns_how_it_helps_length check (how_it_helps is null or char_length(how_it_helps) between 3 and 1000);
