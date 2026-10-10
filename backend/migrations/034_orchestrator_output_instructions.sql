-- Instrução opcional (texto livre escrito pelo admin) de como o orquestrador deve formatar um
-- resultado estruturado (JSON) ao final da resposta, além do texto normal — nulo por padrão,
-- preservando 100% do comportamento atual (resposta sempre em texto livre) até um admin optar
-- por configurar isso. Ver run-orchestrated-reply.ts.
alter table assistant_orchestrators
  add column output_instructions text;
