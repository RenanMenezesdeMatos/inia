-- V1.7.1i — COMPLETUDE DE ETAPA COMPOSTA nas observações de processo (base do diagnóstico de indicador, histórico e chat)
--
-- Aditiva: duas colunas novas e uma restrição; nenhuma linha existente muda (todas ficam com completeness nulo = etapa simples).
-- Uma etapa COMPOSTA (ex.: recapitulação com 10 itens) cumprida só em parte é gravada como NOT_FOLLOWED com completeness =
-- 'PARTIAL' e os subitens (observado, verificadamente ausente, desconhecido, condicional) — nunca como FOLLOWED. A restrição
-- garante que nenhum agregado futuro leia uma etapa parcial ou de completude desconhecida como "cumprida".

alter table process_checkpoint_observations
  add column completeness text check (completeness in ('COMPLETE', 'PARTIAL', 'UNKNOWN')),
  add column sub_items jsonb;

alter table process_checkpoint_observations
  add constraint process_checkpoint_observations_followed_complete_check
  check (status <> 'FOLLOWED' or completeness is null or completeness = 'COMPLETE');
