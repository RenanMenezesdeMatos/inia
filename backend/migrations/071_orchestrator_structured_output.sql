-- Resultado estruturado do Orquestrador como FONTE ÚNICA DA VERDADE (2026-09-17).
--
-- Até aqui o admin mantinha à mão duas representações da mesma coisa: `output_instructions`
-- (texto que instrui o LLM, migration 034) e `output_schema` (metadado grupo › campo lido pelo
-- Workflow Builder, migration 035) — podiam divergir sem ninguém perceber. `structured_output`
-- guarda a definição visual única ({ schemaVersion: 1, nodes: [...] }, ver
-- assistant/domain/structured-output-definition.ts); a partir dela o backend DERIVA o contrato
-- para a IA, o validador do JSON devolvido, o catálogo de campos do Builder e a prévia.
--
-- Transição (dual-read/dual-write, aplicada pelo código, nunca por este SQL):
--   * linha com `structured_output` → é ela que manda; `output_instructions`/`output_schema`
--     passam a ser GERADOS a cada gravação (compatibilidade com leitores antigos);
--   * linha só com as colunas antigas → continua funcionando exatamente como antes (texto
--     legado para o modelo, metadado para o Builder), com a definição reconstruída em leitura;
--     divergência entre texto e metadado vira revisão pendente exibida ao admin — nunca é
--     corrigida em silêncio. Por isso NÃO há backfill aqui: reescrever o texto enviado à IA de
--     um Orquestrador em produção sem revisão humana seria exatamente o que a regra proíbe.
alter table assistant_orchestrators
  add column structured_output jsonb;

comment on column assistant_orchestrators.structured_output is
  'Definição única do resultado estruturado (schemaVersion 1). Null = legado (output_schema/output_instructions) ou só texto livre.';
