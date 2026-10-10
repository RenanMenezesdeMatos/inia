-- V1.7.1n — ETAPA DE ORIGEM (checkpointRef) nas observações de processo
--
-- Aditiva: uma coluna nova, sem backfill. Desde a V1.7.1n a identidade da etapa é do SISTEMA: o catálogo de etapas avaliáveis
-- (`reliable-feedback/domain/checkpoint-catalog.ts`) dá a cada etapa apresentada ao especialista um código estável
-- ("CP-" + 10 hex = hash de documento + seção + tipo + texto literal) e o especialista devolve esse código — a citação é só evidência.
--   checkpoint_ref  o código da etapa que AVALIA o comportamento nesta observação (as outras fontes continuam em source_lineages,
--                   cada uma com o próprio código). null = observação anterior à V1.7.1n ou avaliação no contrato V2 (sem código).
--
-- Nenhuma linha existente muda e nada é promovido por heurística: histórico sem código continua como está.

alter table process_checkpoint_observations
  add column checkpoint_ref text check (checkpoint_ref is null or checkpoint_ref ~ '^CP-[0-9a-f]{10}$');
