-- ALINHAMENTOS OPERACIONAIS (17/11/2026, revisão do mesmo dia): o alinhamento é sempre de um PROCESSO (a base do procedimento,
-- `affected_document_id`, continua obrigatória), mas nem sempre muda um trecho dele — pode trazer orientação NOVA, que a base ainda
-- não tem. O assunto/trecho afetado passa a ser opcional (vazio = orientação do processo, sem trecho indicado).
-- Ver docs/dev/memoria/alinhamentos-operacionais.md.
alter table operational_alignment_versions alter column affected_topic drop not null;
alter table operational_alignment_versions drop constraint if exists operational_alignment_versions_affected_topic_check;
alter table operational_alignment_versions add constraint operational_alignment_versions_affected_topic_check
  check (affected_topic is null or char_length(btrim(affected_topic)) between 3 and 500);
