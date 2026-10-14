-- outbox_events DESCONTINUADA — docs/dev/escala-read-model-e-ciclo-de-vida.md (parte B; decisão aprovada em 13/10/2026).
--
-- A tabela recebia eventos de 6 gravadores e nunca teve leitor (nenhum processed_at preenchido); o conteúdo duplicava
-- estado que já existe em interactions e feedbacks. Desde esta versão o código não grava mais nela. A tabela continua no
-- banco nesta migration porque servidores em execução com o código anterior ainda gravam (expandir/contrair): ela sai numa
-- migration posterior, quando nenhum código em execução a referenciar. O outbox volta junto com o primeiro consumidor
-- real, já com processed_at, tentativas e expurgo (docs/arquitetura-evolutiva-inia.md).
comment on table outbox_events is 'DESCONTINUADA (migration 139): nenhum código grava ou lê; sai numa migration posterior. Não usar.';
