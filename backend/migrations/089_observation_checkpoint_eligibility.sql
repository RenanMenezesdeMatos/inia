-- V1.7.1l — ELEGIBILIDADE DE ETAPA nas observações de processo (política de legado)
--
-- Sem mudança de esquema: nenhuma coluna nova, nenhuma linha apagada. O papel da seção (objetivo, abrangência, conceitos,
-- resultado esperado, referência, exemplos × etapa, checklist, regra, evitar) é DERIVADO do documento publicado no momento da
-- verificação (`section-roles.ts` / `checkpoint-eligibility.ts`) — não é persistido.
--
-- Até aqui uma observação podia chegar a VERIFIED a partir de uma linha de seção NÃO executável: no smoke V1.7.1k, os itens da
-- seção "1. Objetivo" viraram etapas, e "Informação sobre valores, prazos e canais de acompanhamento = não cumprida" ficou
-- VERIFIED e elegível para analytics — memória falsa (o valor foi informado). A linha não guarda a seção de onde veio a regra
-- (practice_key é o hash do trecho), então não dá para reverificar em SQL qual observação veio de uma seção não executável.
--
-- Backfill CONSERVADOR, na mesma política da 088: toda observação VERIFIED gravada antes desta verificação passa a NEEDS_REVIEW
-- com o motivo LEGACY_BEFORE_CHECKPOINT_ELIGIBILITY. Nada é promovido; as linhas continuam como fato histórico da avaliação,
-- só deixam de ser verdade para agregação (diagnóstico de indicador, histórico, futuro Chat).

update process_checkpoint_observations
set analytics_status = 'NEEDS_REVIEW',
    analytics_reasons = array_append(analytics_reasons, 'LEGACY_BEFORE_CHECKPOINT_ELIGIBILITY')
where analytics_status = 'VERIFIED';
