-- V1.7.1m — POLÍTICA DE LEGADO das observações gravadas POR FONTE (antes do comportamento canônico)
--
-- Sem mudança de esquema; nada é apagado. Até a 090 cada fonte oficial virava uma observação (practice_key KB:<documento>:<trecho>):
-- a mesma chamada podia contar duas vezes o mesmo fato — no smoke V1.7.1l, "Forneci protocolo?" e "(2) informe o número do
-- protocolo", "Confirmei se restaram dúvidas?" e "(4) confirme se o cliente tem mais alguma dúvida", "Informei prazo…" e "(3)
-- explique o próximo passo e o prazo" ficaram VERIFIED lado a lado. A linha não guarda a etapa canônica nem as outras fontes, e não
-- dá para reconstruir o comportamento em SQL sem heurística.
--
-- Backfill CONSERVADOR (mesma política da 088/089): toda observação VERIFIED por FONTE (practice_key KB:…) passa a NEEDS_REVIEW
-- com o motivo LEGACY_BEFORE_CANONICAL_BEHAVIOR. Nada é promovido nem reclassificado; as linhas novas (BEHAVIOR:…) não são tocadas.

update process_checkpoint_observations
set analytics_status = 'NEEDS_REVIEW',
    analytics_reasons = array_append(analytics_reasons, 'LEGACY_BEFORE_CANONICAL_BEHAVIOR')
where analytics_status = 'VERIFIED' and practice_key like 'KB:%';
