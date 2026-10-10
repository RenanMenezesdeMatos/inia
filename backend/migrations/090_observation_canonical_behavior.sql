-- V1.7.1m — COMPORTAMENTO CANÔNICO nas observações de processo (uma contribuição por atendimento × comportamento)
--
-- Aditiva: duas colunas novas e a restrição da chave de prática ampliada; nenhuma linha existente muda e nada é apagado.
--   practice_key       passa a aceitar também 'BEHAVIOR:<código>' (ex.: BEHAVIOR:PROVIDE_PROTOCOL). Fontes oficiais diferentes do
--                      MESMO comportamento ("Forneci protocolo?" no checklist do procedimento e "(2) informe o número do protocolo"
--                      no checklist transversal) são UMA prática: com o unique (interaction_id, practice_key) já existente, uma chamada
--                      contribui no máximo uma vez por comportamento para diagnóstico, histórico e futuro Chat.
--   canonical_behavior o código do comportamento (null = etapa sem comportamento no catálogo; a chave continua KB:…).
--   source_lineages    TODAS as fontes que sustentam a observação (documento, versão, seção, hash do trecho, papel e conclusão de
--                      cada uma) — proveniência preservada, sem duplicar o fato.
--
-- Sem backfill: as linhas anteriores foram gravadas por fonte (KB:…) e continuam como estão (as VERIFIED já foram rebaixadas a
-- NEEDS_REVIEW pela 089). Nenhum histórico é reclassificado nem promovido por heurística.

alter table process_checkpoint_observations
  add column canonical_behavior text check (canonical_behavior is null or canonical_behavior ~ '^[A-Z][A-Z_]{2,59}$'),
  add column source_lineages jsonb;

alter table process_checkpoint_observations drop constraint process_checkpoint_observations_practice_key_check;
alter table process_checkpoint_observations
  add constraint process_checkpoint_observations_practice_key_check
  check (practice_key like 'KB:%' or (practice_key like 'BEHAVIOR:%' and canonical_behavior is not null and practice_key = 'BEHAVIOR:' || canonical_behavior));
