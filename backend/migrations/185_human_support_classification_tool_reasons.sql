-- Apoio com Anjo — motivos de encaminhamento para impedimentos operacionais (2026-11-10, `CLASSIFICATION_CATALOG_V2`).
--
-- O operador também precisa do Anjo quando não consegue executar uma ação por causa de uma ferramenta ou sistema: sem acesso ou
-- permissão (`NO_TOOL_ACCESS`) ou com ela fora do ar, falhando ou instável (`TOOL_UNAVAILABLE`). São problemas diferentes e ficam
-- separados. Nos dois, a ferramenta ou o sistema afetado vai no `reference_title` e os detalhes no `other_description`, ambos
-- opcionais; o resultado continua escolhido à parte (o motivo nunca define o resultado). Só amplia a lista aceita: nenhuma linha
-- existente muda e os códigos da V1 continuam valendo.
alter table human_support_classifications drop constraint if exists human_support_classifications_reason_check;
alter table human_support_classifications add constraint human_support_classifications_reason_check
  check (reason in ('NO_PROCESS','NO_GUIDANCE','QUESTION_UNCLEAR','FOUND_IN_PROCESS','AVAILABLE_ELSEWHERE','NO_TOOL_ACCESS','TOOL_UNAVAILABLE','OTHER'));
