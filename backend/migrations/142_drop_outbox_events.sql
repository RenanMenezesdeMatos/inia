-- outbox_events APAGADA — fase "contrair" da 139 (docs/dev/escala-read-model-e-ciclo-de-vida.md, parte B; decisão de 13/10/2026).
--
-- A 139 tirou do código os 6 gravadores (a tabela nunca teve leitor) e deixou a tabela no banco enquanto servidores com o
-- código anterior ainda gravavam nela. Esta migration só pode rodar quando nenhum código em execução a referenciar: um
-- servidor anterior à 139 falha ao publicar feedback e ao receber interação. As linhas históricas (eventos sem consumidor,
-- duplicando o que já está em interactions e feedbacks) saem junto. Sem cascade: nada depende da tabela, e se algo passar a
-- depender a migration falha em vez de levar junto. O outbox volta com o primeiro consumidor real, já com processed_at,
-- tentativas e expurgo (docs/arquitetura-evolutiva-inia.md).
drop table outbox_events;
