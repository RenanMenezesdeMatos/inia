-- V1.5.1 — PROVENIÊNCIA DO FEEDBACK WRITER (aditiva; só a tabela nova da 077)
--
-- Qual Writer gerou cada texto do piloto: provider, modelo pedido/respondido, versão + sha256 do prompt congelado,
-- versão do schema de saída, contrato de entrada, config (timeout, 0 retry, sem fallback/escalação), hash do request,
-- hash da resposta, uso informado pelo provider e resultado da validação estrutural. Nunca API key nem prompt/resposta
-- em claro. Null = redator não chamado (NOTHING_MATERIAL / INSUFFICIENT_EVIDENCE / DELIVERY_BLOCKED) ou redator sem
-- proveniência (fakes de teste). Nenhuma linha é escrita por esta migration.
alter table interaction_feedback_runs add column writer_provenance jsonb;
