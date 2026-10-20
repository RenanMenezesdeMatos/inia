-- Endurecimento da API Push (liberação na Vivo, 2026-10-20 — R-28/R-29).
--
-- Token de integração com VALIDADE e REDES autorizadas: um token vazado deixa de valer sozinho no prazo e não funciona fora da
-- rede do sistema que integra. Tokens já emitidos ficam como eram (sem validade, qualquer rede) até serem rotacionados.
--
-- Idempotency-Key com o hash do corpo: o mesmo `Idempotency-Key` com um corpo DIFERENTE era devolvido em silêncio como se fosse a
-- carga anterior (o lote novo se perdia). Agora a API compara o hash e recusa (422). Cargas antigas, sem hash, seguem
-- deduplicadas como antes.

alter table data_push_tokens
  add column expires_at timestamptz,
  add column allowed_networks text[] check (allowed_networks is null or (cardinality(allowed_networks) between 1 and 20));

alter table data_ingestion_runs
  add column idempotency_body_sha256 text check (idempotency_body_sha256 is null or idempotency_body_sha256 ~ '^[0-9a-f]{64}$');
